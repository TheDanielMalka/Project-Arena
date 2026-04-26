import asyncio
import hashlib
import hmac as _hmac
import httpx
import os
import re
import secrets
import logging
import threading
import urllib.parse
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

import time as _time
from collections import defaultdict as _defaultdict

from fastapi import FastAPI, HTTPException, Depends, Header, Query, UploadFile, File, Request, Response, Cookie, WebSocket, WebSocketDisconnect, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import jwt as _jwt

from src.config import (
    DATABASE_URL, ENVIRONMENT, MIN_CLIENT_VERSION, STEAM_API_KEY,
    ENGINE_BASE_URL, FRONTEND_URL, POOL_MANAGER_INTERVAL, ARENA_SYSTEM_USER_ID,
    DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
    FACEIT_API_KEY, FACEIT_CLIENT_ID, FACEIT_CLIENT_SECRET,
    RESEND_API_KEY,
)
from src.email_service import send_verification_email, send_email_change_email, send_password_reset_email
from src.forum import router as forum_router
from src.ws_manager import ConnectionManager
from src.tournament_routes import router as tournament_router
from src.vision.capture import capture_screen, crop_roi
from src.vision.engine import VisionEngine, VisionEngineConfig
from src.vision.disconnect_monitor import DisconnectMonitor
from src.slack_alerts import slack_post
from src.discord_alerts import discord_post
from src.discord_bot import create_match_channels
from src.risk.limits import count_completed_high_stakes_matches, sum_daily_match_losses
try:
    from src.contract import build_escrow_client
    from src.contract.reconciliation import ContractReconciler
except ImportError:
    # web3 C extensions not available in this environment (e.g. Windows without MSVC).
    # Engine runs without escrow client — build_escrow_client returns None gracefully.
    def build_escrow_client(_session_factory):  # type: ignore[misc]
        return None

    class ContractReconciler:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs): pass
        def run(self, *args, **kwargs): pass
import src.auth as auth

import pyotp

# ── Config ────────────────────────────────────────────────────────────────────
DB_URL = DATABASE_URL or "postgresql://arena_admin:arena_secret_change_me@arena-db:5432/arena"
API_SECRET = os.getenv("API_SECRET", "change_me_in_production")
SCREENSHOT_DIR = os.getenv("SCREENSHOT_DIR", "/app/screenshots")
EVIDENCE_DIR = os.getenv("EVIDENCE_DIR", "/app/evidence")
UPLOAD_REPORTS_DIR = os.getenv("UPLOAD_REPORTS_DIR", os.path.join(os.getcwd(), "uploads", "reports"))

logger = logging.getLogger("arena.engine")

db_engine = create_engine(
    DB_URL,
    pool_pre_ping=True,   # drop stale connections before use
    pool_size=10,         # base connections kept alive (~1 per 3 concurrent users for alpha)
    max_overflow=20,      # burst headroom: up to 30 total for spike traffic
    pool_timeout=30,      # raise after 30s if no connection available (avoid silent hang)
    pool_recycle=1800,    # recycle connections every 30 min (avoids server-side timeout)
    # TODO §7: raise pool_size to 20+ before public beta with 100+ concurrent users
)
SessionLocal = sessionmaker(bind=db_engine)

# ── Escrow client (Phase 6) ───────────────────────────────────────────────────
# Initialised in lifespan after DB check. None when env vars are missing
# (local dev / CI without blockchain config) — engine runs without escrow.
# CONTRACT-ready: EscrowClient.declare_winner() releases payout on-chain.
_escrow_client = None
_listener_task = None     # background thread task — EscrowClient.listen()
_reconciler_task = None   # ContractReconciler background loop
_slack_oracle_task = None  # Slack watchdog (escrow + SLACK_ALERTS_WEBHOOK_URL only)
_pii_retention_task = None  # GDPR daily purge — see migration 036
_pool_manager_task = None  # Public match pool — keeps N open rooms per config row

# Oracle → Slack: OK→bad fires immediately; sustained bad repeats every _SLACK_ORACLE_REPEAT_SECS.
_slack_oracle_prev_listener_ok: bool | None = None
_slack_oracle_prev_rpc_ok: bool | None = None
_slack_oracle_last_repeat: dict[str, float] = {}
_SLACK_ORACLE_REPEAT_SECS = 900

# ── In-memory rate limiter ────────────────────────────────────────────────────
# Sliding-window counter; safe under asyncio's single event loop per worker.
# Replace with Redis-backed limits before multi-process / multi-server deploy.
_rate_buckets: dict[str, list[float]] = _defaultdict(list)


def _check_rate_limit(key: str, max_calls: int, window_secs: int = 60) -> None:
    """Raise HTTP 429 when *key* exceeds *max_calls* within the last *window_secs*."""
    now = _time.monotonic()
    _rate_buckets[key] = [t for t in _rate_buckets[key] if now - t < window_secs]
    if len(_rate_buckets[key]) >= max_calls:
        raise HTTPException(
            429,
            "Too many requests — please wait a moment and try again",
        )
    _rate_buckets[key].append(now)


async def _stale_player_cleanup_loop(interval: int = 15) -> None:
    """
    Background task: every `interval` seconds (default 15s), remove non-host
    players in 'waiting' matches who stopped sending /heartbeat pings.

    A player is stale when last_seen < NOW() - 45s — they closed the browser
    without calling POST /matches/{id}/leave.

    AT matches: refunds the stake.  CRYPTO: no on-chain action (not deposited yet).
    The host is never removed passively — they must DELETE the room explicitly.

    Phase 7 (WebSocket) will supersede this polling bridge.
    """
    import asyncio as _asyncio
    while True:
        try:
            await _asyncio.sleep(interval)
            with SessionLocal() as read_session:
                stale = read_session.execute(
                    text(
                        "SELECT mp.match_id, mp.user_id, m.stake_currency, m.bet_amount "
                        "FROM match_players mp "
                        "JOIN matches m ON m.id = mp.match_id "
                        "WHERE m.status = 'waiting' "
                        "  AND mp.user_id != m.host_id "
                        "  AND mp.user_id IS NOT NULL "
                        "  AND mp.last_seen < NOW() - INTERVAL '45 seconds'"
                    )
                ).fetchall()

            removed = 0
            for (mid, uid, currency, bet) in stale:
                try:
                    with SessionLocal() as s:
                        s.execute(
                            text(
                                "DELETE FROM match_players "
                                "WHERE match_id = :mid AND user_id = :uid"
                            ),
                            {"mid": str(mid), "uid": str(uid)},
                        )
                        if currency == "AT":
                            at_amt = int(float(bet or 0))
                            if at_amt > 0:
                                _credit_at(
                                    s,
                                    str(uid),
                                    at_amt,
                                    str(mid),
                                    "escrow_refund_disconnect",
                                )
                        s.commit()
                        removed += 1
                except Exception as _player_err:
                    logger.error(
                        "stale_cleanup: failed uid=%s match=%s: %s",
                        uid,
                        mid,
                        _player_err,
                    )
            if removed:
                logger.info("Stale cleanup: removed %d disconnected players", removed)
        except Exception as exc:
            logger.error("_stale_player_cleanup_loop error: %s", exc)


def _get_client_host_lobby_timeout_seconds() -> int:
    """
    Seconds without a desktop /client/heartbeat before we auto-cancel a *waiting* match
    whose host has previously been seen in client_sessions (user_id = host_id).

    Config key: platform_config.client_lobby_host_timeout_sec (optional; default 60).
    """
    default = 60
    lo, hi = 30, 3600
    try:
        with SessionLocal() as s:
            row = s.execute(
                text(
                    "SELECT value FROM platform_config WHERE key = 'client_lobby_host_timeout_sec'"
                )
            ).fetchone()
            if row and row[0] is not None and str(row[0]).strip() != "":
                v = int(float(row[0]))
                return max(lo, min(hi, v))
    except Exception:
        pass
    return default


def _find_waiting_matches_host_client_timed_out(cutoff_utc: datetime) -> list[str]:
    """
    Waiting matches whose host has at least one client_sessions row and
    max(last_heartbeat) is older than cutoff_utc.

    Hosts who never opened the desktop client (no session rows) are excluded.
    """
    try:
        with SessionLocal() as read_session:
            rows = read_session.execute(
                text(
                    "SELECT m.id::text "
                    "FROM matches m "
                    "CROSS JOIN LATERAL ( "
                    "  SELECT MAX(cs.last_heartbeat) AS mx "
                    "  FROM client_sessions cs "
                    "  WHERE cs.user_id = m.host_id AND cs.user_id IS NOT NULL "
                    ") hb "
                    "WHERE m.status = 'waiting' "
                    "  AND hb.mx IS NOT NULL "
                    "  AND hb.mx < :cutoff"
                ),
                {"cutoff": cutoff_utc},
            ).fetchall()
        return [str(r[0]) for r in rows if r[0]]
    except Exception as exc:
        logger.error("_find_waiting_matches_host_client_timed_out: %s", exc)
        return []


def _try_cancel_waiting_match_host_client_timeout(match_id: str) -> bool:
    """
    Same outcome as host DELETE /matches/{id} for a waiting room: cancel + AT refund.
    Uses UPDATE ... WHERE status='waiting' so concurrent callers cannot double-refund.

    Returns True if this invocation transitioned the match to cancelled.
    """
    try:
        stake_currency: str | None = None
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "UPDATE matches SET status = 'cancelled', ended_at = NOW() "
                    "WHERE id = CAST(:mid AS uuid) AND status = 'waiting' "
                    "RETURNING stake_currency"
                ),
                {"mid": match_id},
            ).fetchone()
            if not row:
                return False
            stake_currency = str(row[0]) if row[0] is not None else None
            session.commit()

        if stake_currency == "AT":
            _refund_at_match(match_id)

        _ws_match_status(match_id, "cancelled")
        logger.info(
            "host_client_timeout: cancelled match_id=%s stake_currency=%s",
            match_id,
            stake_currency,
        )
        return True
    except Exception as exc:
        logger.error(
            "host_client_timeout: cancel failed match_id=%s error=%s",
            match_id,
            exc,
        )
        return False


async def _host_client_lobby_timeout_loop(interval: int = 15) -> None:
    """
    Periodically cancel waiting matches whose host's desktop client has been silent
    longer than client_lobby_host_timeout_sec (default 60s).
    """
    import asyncio as _asyncio

    while True:
        try:
            await _asyncio.sleep(interval)
            secs = _get_client_host_lobby_timeout_seconds()
            cutoff = datetime.now(timezone.utc) - timedelta(seconds=secs)
            mids = _find_waiting_matches_host_client_timed_out(cutoff)
            for mid in mids:
                _try_cancel_waiting_match_host_client_timeout(mid)
        except Exception as exc:
            logger.error("_host_client_lobby_timeout_loop error: %s", exc)


async def _expired_match_cleanup_loop(interval: int = 300) -> None:
    """
    Background task: every `interval` seconds (default 5 min), cancel
    all 'waiting' matches whose expires_at has passed.

    For AT matches: refunds stake to all players.
    For CRYPTO matches: no on-chain action needed (no deposits taken yet).

    DB-ready: matches.expires_at set to created_at + 1 hour via DB trigger.
    """
    import asyncio as _asyncio
    while True:
        try:
            await _asyncio.sleep(interval)
            with SessionLocal() as session:
                expired = session.execute(
                    text(
                        "UPDATE matches SET status = 'cancelled', ended_at = NOW() "
                        "WHERE status = 'waiting' AND ("
                        "    expires_at < NOW() "
                        "    OR (expires_at IS NULL AND created_at < NOW() - INTERVAL '1 hour')"
                        ") "
                        "RETURNING id, stake_currency"
                    )
                ).fetchall()
                session.commit()

            for (match_id, sc) in expired:
                mid = str(match_id)
                logger.info("Expired match cancelled: match=%s currency=%s", mid, sc)
                if sc == "AT":
                    _refund_at_match(mid)
                _ws_match_status(mid, "cancelled")
        except Exception as exc:
            logger.error("_expired_match_cleanup_loop error: %s", exc)


# ── Public Match Pool Manager ──────────────────────────────────────────────────

async def _public_pool_manager_loop() -> None:
    """
    Background task: keeps a configured number of public waiting rooms open
    for each (game, mode, stake_currency, stake_amount) in public_match_pool_config.

    Runs every POOL_MANAGER_INTERVAL seconds (default 30).
    Creates rooms as the ARENA_SYSTEM_USER_ID — a non-playable system account.

    For AT rooms: room is ready for players immediately.
    For CRYPTO rooms: room has no on_chain_match_id yet. The first player who
      joins calls createMatch on-chain and passes their onChainMatchId to the
      join endpoint, which stores it and updates the on-chain host reference.

    Race-safety: unique room code generated per room; counting uses a
    transaction-isolated read so concurrent workers never double-create.
    """
    import asyncio as _asyncio
    import secrets as _secrets
    import string as _string

    _CHARS = _string.ascii_uppercase + _string.digits
    _MODE_SIZES = {"1v1": 1, "2v2": 2, "4v4": 4, "5v5": 5}
    interval = POOL_MANAGER_INTERVAL
    system_uid = ARENA_SYSTEM_USER_ID

    # Stagger 10s so DB is fully ready after other boot tasks.
    await _asyncio.sleep(10)

    while True:
        try:
            with SessionLocal() as session:
                configs = session.execute(
                    text(
                        "SELECT game, mode, stake_currency, stake_amount, min_open_rooms "
                        "FROM public_match_pool_config WHERE is_active = TRUE"
                    )
                ).fetchall()

                for row in configs:
                    game_val, mode_val, sc, amount, min_open = (
                        row[0], row[1], row[2], row[3], row[4]
                    )
                    open_count = session.execute(
                        text(
                            "SELECT COUNT(*) FROM matches "
                            "WHERE type = 'public' AND status = 'waiting' "
                            "AND game = :g AND mode = :m "
                            "AND stake_currency = :sc AND bet_amount = :amt"
                        ),
                        {"g": game_val, "m": mode_val, "sc": sc, "amt": amount},
                    ).scalar() or 0

                    needed = max(0, min_open - open_count)
                    team_size = _MODE_SIZES.get(mode_val, 1)
                    max_players = team_size * 2

                    for _ in range(needed):
                        code = "PUB-" + "".join(
                            _secrets.choice(_CHARS) for _ in range(5)
                        )
                        session.execute(
                            text(
                                "INSERT INTO matches "
                                "  (type, game, host_id, mode, bet_amount, stake_currency, "
                                "   code, max_players, max_per_team, status) "
                                "VALUES ('public', :g, :host, :m, :amt, :sc, "
                                "        :code, :maxp, :mpt, 'waiting')"
                            ),
                            {
                                "g":    game_val,
                                "host": system_uid,
                                "m":    mode_val,
                                "amt":  amount,
                                "sc":   sc,
                                "code": code,
                                "maxp": max_players,
                                "mpt":  team_size,
                            },
                        )
                        logger.info(
                            "Pool: created public room code=%s game=%s mode=%s %s %.4f",
                            code, game_val, mode_val, sc, amount,
                        )

                session.commit()

        except Exception as exc:
            logger.error("_public_pool_manager_loop error: %s", exc)

        await _asyncio.sleep(interval)


# ── GDPR — PII retention daily purge ───────────────────────────────────────────

async def _pii_retention_purge_loop(interval: int = 86_400) -> None:
    """
    Background task: every `interval` seconds (default 24h), invoke the
    `run_pii_retention_purge()` SQL function to hard-delete PII past its
    retention window (DMs, inbox, read notifications, old audit logs,
    closed support tickets).

    Retention windows are tunable via `pii_retention_config` (migration 036).
    Every run writes a row to `pii_retention_run_log` so we keep an audit
    trail of what was deleted and when.

    Hard-failure recovery: we log & sleep — the loop keeps running so a
    single broken run does not permanently stop retention.
    """
    import asyncio as _asyncio
    # Stagger startup so the purge doesn't fight the other cleanup loops
    # for the connection pool at boot.
    await _asyncio.sleep(120)
    while True:
        try:
            with SessionLocal() as session:
                row = session.execute(
                    text(
                        "SELECT dm_deleted, inbox_deleted, notifications_deleted, "
                        "       audit_logs_deleted, admin_audit_deleted, tickets_deleted "
                        "FROM   run_pii_retention_purge('system')"
                    )
                ).fetchone()
                session.commit()
            if row is not None:
                logger.info(
                    "PII retention purge: dm=%s inbox=%s notifications=%s "
                    "audit=%s admin_audit=%s tickets=%s",
                    row[0], row[1], row[2], row[3], row[4], row[5],
                )
        except Exception as exc:
            # The function may not exist yet in very old DBs — log and continue.
            logger.error("_pii_retention_purge_loop error: %s", exc)
        await _asyncio.sleep(interval)


# ── In-progress match timeout ──────────────────────────────────────────────────

def _get_inprogress_client_timeout_seconds() -> int:
    """
    How long (seconds) a host's client can be silent while a match is in_progress
    before the match is force-cancelled.  Default: 1800 (30 min).
    Config key: platform_config.inprogress_client_timeout_sec
    """
    default = 600
    lo, hi = 300, 14400
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM platform_config WHERE key = 'inprogress_client_timeout_sec'")
            ).fetchone()
            if row and row[0] is not None and str(row[0]).strip() != "":
                return max(lo, min(hi, int(float(row[0]))))
    except Exception:
        pass
    return default


def _get_inprogress_absolute_timeout_seconds() -> int:
    """
    Hard cap: cancel an in_progress match if it has been running longer than this,
    regardless of heartbeat.  Default: 14400 (4 hours).
    Config key: platform_config.inprogress_absolute_timeout_sec
    """
    default = 14400
    lo, hi = 3600, 86400
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM platform_config WHERE key = 'inprogress_absolute_timeout_sec'")
            ).fetchone()
            if row and row[0] is not None and str(row[0]).strip() != "":
                return max(lo, min(hi, int(float(row[0]))))
    except Exception:
        pass
    return default


def _find_stale_inprogress_matches(
    heartbeat_cutoff: "datetime",
    absolute_cutoff: "datetime",
) -> list[tuple[str, str]]:
    """
    Return (match_id, stake_currency) for in_progress matches that should be
    force-cancelled because either:
      a) The host has an active client session whose last_heartbeat < heartbeat_cutoff
      b) The host has NO active client session AND started_at < heartbeat_cutoff
      c) started_at < absolute_cutoff  (hard cap, regardless of heartbeat)
    """
    try:
        with SessionLocal() as s:
            rows = s.execute(
                text(
                    "SELECT m.id::text, m.stake_currency "
                    "FROM matches m "
                    "WHERE m.status = 'in_progress' "
                    "AND ( "
                    # Hard cap: match has been running too long
                    "  m.started_at < :abs_cutoff "
                    "  OR EXISTS ( "
                    # Host has an active client session but it went silent
                    "    SELECT 1 FROM client_sessions cs "
                    "    WHERE cs.user_id = m.host_id "
                    "      AND cs.disconnected_at IS NULL "
                    "      AND cs.last_heartbeat < :hb_cutoff "
                    "  ) "
                    "  OR ( "
                    # Host has never opened the client (or all sessions disconnected)
                    # and the match started more than heartbeat_cutoff ago
                    "    NOT EXISTS ( "
                    "      SELECT 1 FROM client_sessions cs2 "
                    "      WHERE cs2.user_id = m.host_id "
                    "        AND cs2.disconnected_at IS NULL "
                    "    ) "
                    "    AND m.started_at < :hb_cutoff "
                    "  ) "
                    ")"
                ),
                {"hb_cutoff": heartbeat_cutoff, "abs_cutoff": absolute_cutoff},
            ).fetchall()
        return [(str(r[0]), str(r[1] or "")) for r in rows if r[0]]
    except Exception as exc:
        logger.error("_find_stale_inprogress_matches: %s", exc)
        return []


def _try_cancel_inprogress_match_timeout(match_id: str, stake_currency: str) -> bool:
    """
    Force-terminate a stale in_progress match.
      AT     → cancelled + _refund_at_match (funds tracked in DB)
      CRYPTO → disputed  (funds locked in contract; admin resolves on-chain)

    Uses UPDATE … WHERE status='in_progress' to guard against double-execution.
    Returns True if this call performed the status transition.
    """
    try:
        new_status = "cancelled" if stake_currency == "AT" else "disputed"
        with SessionLocal() as s:
            row = s.execute(
                text(
                    "UPDATE matches "
                    "SET status = :new_status, ended_at = NOW() "
                    "WHERE id = CAST(:mid AS uuid) AND status = 'in_progress' "
                    "RETURNING id"
                ),
                {"new_status": new_status, "mid": match_id},
            ).fetchone()
            if not row:
                return False
            s.commit()

        if stake_currency == "AT":
            _refund_at_match(match_id)
            logger.info(
                "inprogress_timeout: cancelled AT match=%s, refund issued", match_id
            )
        else:
            logger.warning(
                "inprogress_timeout: CRYPTO match=%s marked disputed — admin action required",
                match_id,
            )
        _ws_match_status(match_id, new_status)
        return True
    except Exception as exc:
        logger.error(
            "inprogress_timeout: failed match=%s error=%s", match_id, exc
        )
        return False


async def _inprogress_match_timeout_loop(interval: int = 60) -> None:
    """
    Background task: every `interval` seconds, detect and terminate in_progress
    matches whose host client has been silent too long or that exceeded the
    absolute duration cap.

    Configurable via platform_config rows:
      inprogress_client_timeout_sec   — heartbeat silence threshold (default 1800 = 30 min)
      inprogress_absolute_timeout_sec — max match duration regardless (default 14400 = 4 h)

    AT matches  → status='cancelled'  + AT refund to all players
    CRYPTO matches → status='disputed' + Slack warning; admin resolves on-chain
    """
    import asyncio as _asyncio

    while True:
        try:
            await _asyncio.sleep(interval)
            hb_secs = _get_inprogress_client_timeout_seconds()
            abs_secs = _get_inprogress_absolute_timeout_seconds()
            now_utc = datetime.now(timezone.utc)
            hb_cutoff = now_utc - timedelta(seconds=hb_secs)
            abs_cutoff = now_utc - timedelta(seconds=abs_secs)
            stale = _find_stale_inprogress_matches(hb_cutoff, abs_cutoff)
            for (mid, currency) in stale:
                _try_cancel_inprogress_match_timeout(mid, currency)
        except Exception as exc:
            logger.error("_inprogress_match_timeout_loop error: %s", exc)


async def _oracle_slack_watch_loop(interval: int = 90) -> None:
    """
    Periodic check: when EscrowClient is enabled, alert Slack if the listener task
    died or RPC/contract health fails.

    Anti-spam: immediate notify on transition from healthy → unhealthy; while
    unhealthy persists, repeat at most once per _SLACK_ORACLE_REPEAT_SECS per channel.
    """
    import asyncio as _asyncio
    import time as _time

    while True:
        try:
            await _asyncio.sleep(interval)
            if not (os.getenv("SLACK_ALERTS_WEBHOOK_URL") or "").strip():
                continue
            ec = _escrow_client
            if not ec:
                continue

            global _slack_oracle_prev_listener_ok, _slack_oracle_prev_rpc_ok
            global _slack_oracle_last_repeat

            listener_ok = (
                _listener_task is not None and not _listener_task.done()
            )
            try:
                rpc_ok = ec.is_healthy()
            except Exception:
                rpc_ok = False

            now = _time.monotonic()
            env_tag = ENVIRONMENT or "unknown"

            def _allow_repeat(key: str) -> bool:
                last = _slack_oracle_last_repeat.get(key, 0.0)
                if now - last >= _SLACK_ORACLE_REPEAT_SECS:
                    _slack_oracle_last_repeat[key] = now
                    return True
                return False

            if not listener_ok:
                prev = _slack_oracle_prev_listener_ok
                if prev is True:
                    logger.warning(
                        "Escrow listener task inactive while escrow is enabled — Slack alert"
                    )
                    slack_post(
                        f"⚠️ [{env_tag}] Arena: Escrow oracle listener task is not running "
                        f"(escrow enabled). Check engine logs / container."
                    )
                elif prev is False:
                    if _allow_repeat("listener"):
                        slack_post(
                            f"⚠️ [{env_tag}] Arena: Escrow listener still inactive (repeat)."
                        )
                else:
                    # First sample after watchdog start
                    if _allow_repeat("listener"):
                        logger.warning(
                            "Escrow listener inactive on first watchdog sample — Slack alert"
                        )
                        slack_post(
                            f"⚠️ [{env_tag}] Arena: Escrow oracle listener inactive."
                        )

            if not rpc_ok:
                prev_h = _slack_oracle_prev_rpc_ok
                if prev_h is True:
                    logger.warning(
                        "EscrowClient unhealthy (RPC/pause) — Slack alert"
                    )
                    slack_post(
                        f"⚠️ [{env_tag}] Arena: Escrow RPC or contract unhealthy "
                        f"(not connected or paused). Check RPC and kill-switch."
                    )
                elif prev_h is False:
                    if _allow_repeat("rpc"):
                        slack_post(
                            f"⚠️ [{env_tag}] Arena: Escrow still unhealthy (repeat)."
                        )
                else:
                    if _allow_repeat("rpc"):
                        logger.warning(
                            "EscrowClient unhealthy on first watchdog sample — Slack alert"
                        )
                        slack_post(
                            f"⚠️ [{env_tag}] Arena: Escrow RPC/contract unhealthy."
                        )

            _slack_oracle_prev_listener_ok = listener_ok
            _slack_oracle_prev_rpc_ok = rpc_ok
        except _asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("_oracle_slack_watch_loop error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create runtime directories at startup, not at import time.
    # Gracefully skipped in CI / restricted environments (tests still run).
    for d in (SCREENSHOT_DIR, EVIDENCE_DIR, UPLOAD_REPORTS_DIR):
        try:
            os.makedirs(d, exist_ok=True)
        except PermissionError:
            logger.warning("⚠️  Cannot create dir %s (restricted env — skipping)", d)

    # DB connectivity check + schema migrations — non-fatal so tests still run.
    try:
        with db_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            # Safety-net: create client_sessions if init.sql hasn't been applied yet.
            # On a DB initialised from infra/sql/init.sql this is a harmless no-op.
            # All other tables (matches, match_evidence, users, …) are owned by
            # init.sql — never duplicated here to avoid schema drift.
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS client_sessions (
                    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    wallet_address  VARCHAR UNIQUE NOT NULL,
                    status          VARCHAR DEFAULT 'connected',
                    game            VARCHAR,
                    client_version  VARCHAR,
                    match_id        UUID,
                    last_heartbeat  TIMESTAMPTZ DEFAULT NOW(),
                    user_id         UUID REFERENCES users(id),
                    disconnected_at TIMESTAMPTZ
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_cs_wallet ON client_sessions(wallet_address)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_cs_user ON client_sessions(user_id)"
            ))
            # Migration 014: last_seen for heartbeat / stale-player cleanup.
            # Safe no-op when column already exists.
            conn.execute(text(
                "ALTER TABLE match_players "
                "ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW()"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_match_players_last_seen "
                "ON match_players(last_seen)"
            ))
            # Migration 015: partial UNIQUE index on transactions.tx_hash
            # Prevents the same on-chain tx from being credited twice.
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tx_hash_unique "
                "ON transactions(tx_hash) WHERE tx_hash IS NOT NULL"
            ))

            # Migration 039: Forum — 4 new tables, no changes to existing tables.
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS forum_categories (
                    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    parent_id       UUID REFERENCES forum_categories(id) ON DELETE CASCADE,
                    slug            VARCHAR(60)  UNIQUE NOT NULL,
                    name            VARCHAR(120) NOT NULL,
                    description     TEXT,
                    icon            VARCHAR(80),
                    color           VARCHAR(20)  DEFAULT '#6366f1',
                    sort_order      INT          DEFAULT 0,
                    post_count      INT          DEFAULT 0,
                    thread_count    INT          DEFAULT 0,
                    last_post_at    TIMESTAMPTZ,
                    last_post_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                    is_announcements BOOLEAN     DEFAULT FALSE,
                    created_at      TIMESTAMPTZ  DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS forum_threads (
                    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    category_id     UUID NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
                    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
                    title           VARCHAR(300) NOT NULL,
                    body            TEXT         NOT NULL,
                    slug            VARCHAR(340) UNIQUE NOT NULL,
                    status          VARCHAR(20)  DEFAULT 'open',
                    is_pinned       BOOLEAN      DEFAULT FALSE,
                    is_announcement BOOLEAN      DEFAULT FALSE,
                    views           INT          DEFAULT 0,
                    reply_count     INT          DEFAULT 0,
                    last_reply_at   TIMESTAMPTZ,
                    last_reply_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                    tags            TEXT[]       DEFAULT '{}',
                    created_at      TIMESTAMPTZ  DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS forum_posts (
                    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    thread_id       UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
                    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
                    parent_post_id  UUID REFERENCES forum_posts(id) ON DELETE SET NULL,
                    body            TEXT         NOT NULL,
                    is_deleted      BOOLEAN      DEFAULT FALSE,
                    edit_count      INT          DEFAULT 0,
                    edited_at       TIMESTAMPTZ,
                    reactions       JSONB        DEFAULT '{}',
                    created_at      TIMESTAMPTZ  DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS forum_moderators (
                    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    category_id UUID REFERENCES forum_categories(id) ON DELETE CASCADE,
                    granted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
                    granted_at  TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (user_id, category_id)
                )
            """))
            # Forum indexes
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_forum_threads_category "
                "ON forum_threads(category_id, last_reply_at DESC)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_forum_posts_thread "
                "ON forum_posts(thread_id, created_at ASC) WHERE is_deleted = FALSE"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_forum_threads_fts "
                "ON forum_threads USING GIN(to_tsvector('english', title || ' ' || body))"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_forum_threads_author "
                "ON forum_threads(author_id, created_at DESC)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_forum_posts_author "
                "ON forum_posts(author_id, created_at DESC)"
            ))
            # Seed initial categories (idempotent)
            conn.execute(text("""
                INSERT INTO forum_categories (slug, name, description, icon, color, sort_order)
                VALUES
                  ('cs2',      'CS2',                'Counter-Strike 2 discussion, guides and highlights', 'cs2',      '#4FC3F7', 1),
                  ('valorant', 'Valorant',           'Valorant strategies, clips and LFG',               'valorant', '#FF4655', 2),
                  ('general',  'General Arena',      'Off-topic, platform news and community chat',      'arena',    '#6366f1', 3),
                  ('feedback', 'Suggestions & Bugs', 'Feature requests and bug reports',                 'bug',      '#F59E0B', 4)
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed sub-categories for CS2
            conn.execute(text("""
                INSERT INTO forum_categories (parent_id, slug, name, description, icon, color, sort_order, is_announcements)
                SELECT id, slug2, name2, desc2, icon2, color2, ord2, ann2
                FROM forum_categories,
                (VALUES
                  ('cs2-announcements', 'Announcements',     'Official CS2 announcements',          'megaphone', '#4FC3F7', 1, TRUE),
                  ('cs2-discussion',    'Discussion',        'General CS2 talk',                    'chat',      '#4FC3F7', 2, FALSE),
                  ('cs2-strategy',      'Strategy & Guides', 'Tactics, setups and tips',            'book',      '#4FC3F7', 3, FALSE),
                  ('cs2-lfg',           'Looking for Match', 'Find teammates for competitive play', 'users',     '#4FC3F7', 4, FALSE),
                  ('cs2-clips',         'Clips & Highlights','Share your best plays',               'video',     '#4FC3F7', 5, FALSE)
                ) AS t(slug2, name2, desc2, icon2, color2, ord2, ann2)
                WHERE forum_categories.slug = 'cs2'
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed sub-categories for Valorant
            conn.execute(text("""
                INSERT INTO forum_categories (parent_id, slug, name, description, icon, color, sort_order, is_announcements)
                SELECT id, slug2, name2, desc2, icon2, color2, ord2, ann2
                FROM forum_categories,
                (VALUES
                  ('val-announcements', 'Announcements',     'Official Valorant announcements',     'megaphone', '#FF4655', 1, TRUE),
                  ('val-discussion',    'Discussion',        'General Valorant talk',               'chat',      '#FF4655', 2, FALSE),
                  ('val-strategy',      'Strategy & Guides', 'Agent comps, lineups and tips',       'book',      '#FF4655', 3, FALSE),
                  ('val-lfg',           'Looking for Match', 'Find teammates for ranked play',      'users',     '#FF4655', 4, FALSE),
                  ('val-clips',         'Clips & Highlights','Share your best plays',               'video',     '#FF4655', 5, FALSE)
                ) AS t(slug2, name2, desc2, icon2, color2, ord2, ann2)
                WHERE forum_categories.slug = 'valorant'
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed top-level categories: MLBB, Wild Rift, Honor of Kings
            conn.execute(text("""
                INSERT INTO forum_categories (slug, name, description, icon, color, sort_order)
                VALUES
                  ('mlbb',     'Mobile Legends',   'MLBB strategies, heroes and LFG',             'mlbb',     '#F59E0B', 5),
                  ('wildrift', 'Wild Rift',         'Wild Rift builds, ranked tips and highlights', 'wildrift', '#06B6D4', 6),
                  ('honorofkings', 'Honor of Kings','HoK gameplay, strategies and community',      'hok',      '#8B5CF6', 7)
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed sub-categories for MLBB
            conn.execute(text("""
                INSERT INTO forum_categories (parent_id, slug, name, description, icon, color, sort_order, is_announcements)
                SELECT id, slug2, name2, desc2, icon2, color2, ord2, ann2
                FROM forum_categories,
                (VALUES
                  ('mlbb-announcements', 'Announcements',     'Official MLBB announcements',          'megaphone', '#F59E0B', 1, TRUE),
                  ('mlbb-discussion',    'Discussion',        'General MLBB talk',                    'chat',      '#F59E0B', 2, FALSE),
                  ('mlbb-strategy',      'Strategy & Guides', 'Hero builds, rotations and tips',      'book',      '#F59E0B', 3, FALSE),
                  ('mlbb-lfg',           'Looking for Match', 'Find teammates for ranked play',       'users',     '#F59E0B', 4, FALSE),
                  ('mlbb-clips',         'Clips & Highlights','Share your best plays',                'video',     '#F59E0B', 5, FALSE)
                ) AS t(slug2, name2, desc2, icon2, color2, ord2, ann2)
                WHERE forum_categories.slug = 'mlbb'
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed sub-categories for Wild Rift
            conn.execute(text("""
                INSERT INTO forum_categories (parent_id, slug, name, description, icon, color, sort_order, is_announcements)
                SELECT id, slug2, name2, desc2, icon2, color2, ord2, ann2
                FROM forum_categories,
                (VALUES
                  ('wr-announcements', 'Announcements',     'Official Wild Rift announcements',     'megaphone', '#06B6D4', 1, TRUE),
                  ('wr-discussion',    'Discussion',        'General Wild Rift talk',               'chat',      '#06B6D4', 2, FALSE),
                  ('wr-strategy',      'Strategy & Guides', 'Champion builds and lane guides',      'book',      '#06B6D4', 3, FALSE),
                  ('wr-lfg',           'Looking for Match', 'Find duo or team partners',            'users',     '#06B6D4', 4, FALSE),
                  ('wr-clips',         'Clips & Highlights','Share your best plays',                'video',     '#06B6D4', 5, FALSE)
                ) AS t(slug2, name2, desc2, icon2, color2, ord2, ann2)
                WHERE forum_categories.slug = 'wildrift'
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed sub-categories for Honor of Kings
            conn.execute(text("""
                INSERT INTO forum_categories (parent_id, slug, name, description, icon, color, sort_order, is_announcements)
                SELECT id, slug2, name2, desc2, icon2, color2, ord2, ann2
                FROM forum_categories,
                (VALUES
                  ('hok-announcements', 'Announcements',     'Official HoK announcements',           'megaphone', '#8B5CF6', 1, TRUE),
                  ('hok-discussion',    'Discussion',        'General HoK talk',                     'chat',      '#8B5CF6', 2, FALSE),
                  ('hok-strategy',      'Strategy & Guides', 'Hero guides and team compositions',    'book',      '#8B5CF6', 3, FALSE),
                  ('hok-lfg',           'Looking for Match', 'Find ranked teammates',                'users',     '#8B5CF6', 4, FALSE),
                  ('hok-clips',         'Clips & Highlights','Share your best plays',                'video',     '#8B5CF6', 5, FALSE)
                ) AS t(slug2, name2, desc2, icon2, color2, ord2, ann2)
                WHERE forum_categories.slug = 'honorofkings'
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed sub-categories for General Arena
            conn.execute(text("""
                INSERT INTO forum_categories (parent_id, slug, name, description, icon, color, sort_order, is_announcements)
                SELECT id, slug2, name2, desc2, icon2, color2, ord2, ann2
                FROM forum_categories,
                (VALUES
                  ('general-announcements', 'Announcements',     'Platform-wide announcements',      'megaphone', '#6366f1', 1, TRUE),
                  ('general-discussion',    'Discussion',        'Off-topic community chat',         'chat',      '#6366f1', 2, FALSE),
                  ('general-introductions', 'Introductions',     'New here? Introduce yourself',     'user',      '#6366f1', 3, FALSE)
                ) AS t(slug2, name2, desc2, icon2, color2, ord2, ann2)
                WHERE forum_categories.slug = 'general'
                ON CONFLICT (slug) DO NOTHING
            """))
            # Seed sub-categories for Suggestions & Bugs
            conn.execute(text("""
                INSERT INTO forum_categories (parent_id, slug, name, description, icon, color, sort_order, is_announcements)
                SELECT id, slug2, name2, desc2, icon2, color2, ord2, ann2
                FROM forum_categories,
                (VALUES
                  ('feedback-features',  'Feature Requests', 'Suggest new features or improvements', 'sparkles', '#F59E0B', 1, FALSE),
                  ('feedback-bugs',      'Bug Reports',      'Report bugs and technical issues',      'bug',      '#F59E0B', 2, FALSE),
                  ('feedback-balance',   'Balance & Rules',  'Discuss match rules and fairness',      'scale',    '#F59E0B', 3, FALSE)
                ) AS t(slug2, name2, desc2, icon2, color2, ord2, ann2)
                WHERE forum_categories.slug = 'feedback'
                ON CONFLICT (slug) DO NOTHING
            """))
            # Migration 040: country field on users (ISO 3166-1 alpha-2)
            conn.execute(text("""
                ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(2)
            """))
            conn.commit()

            # Migration 039b: forum_reports table
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS forum_reports (
                    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    post_id     UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
                    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    reason      VARCHAR(200) NOT NULL,
                    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
                    reviewed_by UUID REFERENCES users(id),
                    reviewed_at TIMESTAMPTZ,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (post_id, reporter_id)
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_forum_reports_status
                ON forum_reports(status, created_at DESC)
            """))
            # Migration 054: email verification + pending email change
            conn.execute(text(
                "ALTER TABLE users "
                "ADD COLUMN IF NOT EXISTS email_verified                 BOOLEAN     NOT NULL DEFAULT FALSE, "
                "ADD COLUMN IF NOT EXISTS verification_token             UUID, "
                "ADD COLUMN IF NOT EXISTS verification_token_expires_at  TIMESTAMPTZ, "
                "ADD COLUMN IF NOT EXISTS pending_email                  VARCHAR(255), "
                "ADD COLUMN IF NOT EXISTS pending_email_token            UUID, "
                "ADD COLUMN IF NOT EXISTS pending_email_token_expires_at TIMESTAMPTZ"
            ))
            # All users that existed before verification was introduced are pre-verified
            conn.execute(text(
                "UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS users_verification_token_idx "
                "ON users(verification_token) WHERE verification_token IS NOT NULL"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS users_pending_email_token_idx "
                "ON users(pending_email_token) WHERE pending_email_token IS NOT NULL"
            ))
            # Migration 055: password reset token
            conn.execute(text(
                "ALTER TABLE users "
                "ADD COLUMN IF NOT EXISTS password_reset_token             UUID, "
                "ADD COLUMN IF NOT EXISTS password_reset_token_expires_at  TIMESTAMPTZ"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS users_password_reset_token_idx "
                "ON users(password_reset_token) WHERE password_reset_token IS NOT NULL"
            ))
            conn.commit()
        logger.info("✅ Arena Engine connected to DB")
    except Exception as exc:
        logger.warning("⚠️  DB not available at startup: %s", exc)

    # Load daily stake limit from platform_settings (non-fatal)
    _reload_at_daily_limit()
    logger.info("✅ Daily stake limit loaded: %d AT ($%d)", _at_daily_limit, _at_daily_limit // 100)
    _reload_at_daily_usdt_limit()
    logger.info("✅ Daily USDT stake limit loaded: %.2f USDT / 24h", _at_daily_usdt_limit)
    _reload_risk_limits()
    logger.info(
        "✅ Risk limits loaded: high_stakes_max=%d loss_caps AT=%d USDT=%.2f",
        _high_stakes_daily_max,
        _daily_loss_cap_at,
        _daily_loss_cap_usdt,
    )
    _reload_fraud_detection_config()
    fp = _fraud_report_bind_params()
    logger.info(
        "✅ Fraud detection thresholds: pair_gt=%d pair_hours=%d loss_min=%d loss_days=%d",
        fp["fraud_pair_gt"],
        fp["fraud_pair_hours"],
        fp["fraud_loss_min"],
        fp["fraud_loss_days"],
    )

    # Escrow client — optional, requires BLOCKCHAIN_RPC_URL + CONTRACT_ADDRESS + PRIVATE_KEY
    global _escrow_client
    _escrow_client = build_escrow_client(SessionLocal)
    if _escrow_client:
        logger.info("✅ EscrowClient initialised (contract=%s)", _escrow_client.contract.address)
    else:
        logger.info("ℹ️  EscrowClient disabled — blockchain env vars not set")

    # Disconnect monitor — grace-period rage-quit detector; works with or without EscrowClient.
    # Replaces RageQuitDetector with 2-phase WARNING → FORFEIT / HOLDING state machine.
    # AT forfeit:   _settle_at_match (pay winner from DB)
    # AT holding:   _refund_at_match (refund all, no winner)
    # CRYPTO forfeit:  escrow_client.declare_winner (on-chain)
    # CRYPTO holding:  escrow_client.transfer_to_holding (pending contract upgrade)
    import asyncio
    _rq_task = asyncio.create_task(
        DisconnectMonitor(
            session_factory=SessionLocal,
            escrow_client=_escrow_client,
            settle_at_fn=_settle_at_match,
            refund_at_fn=_refund_at_match,
            ws_manager=ws_manager,
        ).run()
    )
    logger.info("✅ DisconnectMonitor started")

    # EscrowClient event listener — only when escrow is available.
    # listen() is a blocking loop (time.sleep) so it runs in a thread pool.
    # Resumes from oracle_sync_state.last_block on restart — no missed events.
    global _listener_task
    if _escrow_client:
        _listener_task = asyncio.create_task(
            asyncio.to_thread(_escrow_client.listen, 15)
        )
        logger.info("✅ EscrowClient event listener started")

    # Contract reconciler — monitors CRYPTO matches for DB vs on-chain divergence,
    # logs stuck WAITING matches past the 1-hour timeout, and expires stale pending_leaves.
    # Does NOT auto-cancel on-chain — oracle is not a depositor.
    global _reconciler_task
    _reconciler = ContractReconciler(SessionLocal, _escrow_client)
    _reconciler_task = asyncio.create_task(asyncio.to_thread(_reconciler.run, 300))
    logger.info("✅ ContractReconciler started")

    # Expired match cleanup — runs every 5 minutes.
    # Cancels 'waiting' rooms whose expires_at has passed (1 hour after creation).
    # AT matches: refunds stake to all players. CRYPTO: non-deposited → no on-chain action.
    _cleanup_task = asyncio.create_task(_expired_match_cleanup_loop())
    logger.info("✅ Expired match cleanup task started")

    # Stale player cleanup — runs every 15 seconds.
    # Removes non-host players who closed the browser without calling leave_match.
    # Bridges the gap until Phase 7 WebSocket replaces polling.
    _stale_task = asyncio.create_task(_stale_player_cleanup_loop())
    logger.info("✅ Stale player cleanup task started")

    _host_client_timeout_task = asyncio.create_task(_host_client_lobby_timeout_loop())
    logger.info("✅ Host client lobby timeout task started")

    # In-progress match timeout — runs every 60 seconds.
    # Cancels (AT) or disputes (CRYPTO) in_progress matches whose host client
    # has been silent > inprogress_client_timeout_sec (default 30 min),
    # or that exceeded inprogress_absolute_timeout_sec (default 4 h).
    _inprogress_timeout_task = asyncio.create_task(_inprogress_match_timeout_loop())
    logger.info("✅ In-progress match timeout task started")

    # GDPR PII retention purge — runs once per day.
    # Invokes run_pii_retention_purge() (migration 036) to hard-delete PII
    # past its retention window. Windows are tunable via pii_retention_config.
    global _pii_retention_task
    _pii_retention_task = asyncio.create_task(_pii_retention_purge_loop())
    logger.info("✅ PII retention daily purge task started")

    # Slack alerts for oracle/RPC health — only when escrow is on and webhook URL is set.
    global _slack_oracle_task
    if _escrow_client and (os.getenv("SLACK_ALERTS_WEBHOOK_URL") or "").strip():
        _slack_oracle_task = asyncio.create_task(_oracle_slack_watch_loop())
        logger.info("✅ Oracle Slack watchdog started")

    # Public match pool — keeps configured number of open rooms per game/mode/stake.
    global _pool_manager_task
    _pool_manager_task = asyncio.create_task(_public_pool_manager_loop())
    logger.info("✅ Public match pool manager started")

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    _reconciler.stop()
    _reconciler_task.cancel()
    try:
        await _reconciler_task
    except asyncio.CancelledError:
        pass
    _rq_task.cancel()
    _cleanup_task.cancel()
    _stale_task.cancel()
    _host_client_timeout_task.cancel()
    _inprogress_timeout_task.cancel()
    _pii_retention_task.cancel()
    for _t in (_host_client_timeout_task, _inprogress_timeout_task, _pii_retention_task):
        try:
            await _t
        except asyncio.CancelledError:
            pass
    if _slack_oracle_task:
        _slack_oracle_task.cancel()
        try:
            await _slack_oracle_task
        except asyncio.CancelledError:
            pass
    if _pool_manager_task:
        _pool_manager_task.cancel()
        try:
            await _pool_manager_task
        except asyncio.CancelledError:
            pass
    if _listener_task:
        _listener_task.cancel()
        try:
            await _listener_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Arena Engine",
    version="2.0.0",
    description="OCR + Vision match validator for Arena platform",
    lifespan=lifespan,
)

_DEFAULT_CORS_ORIGINS = "https://project-arena.com,http://localhost:3000,http://localhost"
_cors_origins = [
    o.strip()
    for o in (os.getenv("CORS_ALLOWED_ORIGINS") or _DEFAULT_CORS_ORIGINS).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(forum_router)
app.include_router(tournament_router)

# ── Global WebSocket connection manager ──────────────────────────────────────
# Single instance — Phase 1 (single Uvicorn worker). When scaling to multiple
# workers, replace with Redis pub/sub in ws_manager.py before this changes.
ws_manager = ConnectionManager()


# ── WS broadcast helpers ──────────────────────────────────────────────────────
# Thin wrappers so routes stay readable. All use fire_* (thread-safe,
# non-blocking) so they can be called from both async routes and sync bg tasks.

def _ws_match_status(match_id: str, status: str, **extra) -> None:
    """Broadcast match:status_changed to every socket in the match room."""
    ws_manager.fire_match(match_id, "match:status_changed", {
        "match_id": match_id,
        "status":   status,
        **extra,
    })


def _ws_roster_updated(match_id: str, players: list[dict]) -> None:
    """Broadcast match:roster_updated when a player joins or leaves."""
    ws_manager.fire_match(match_id, "match:roster_updated", {
        "match_id": match_id,
        "players":  players,
    })


def _ws_notification(user_id: str, notification: dict) -> None:
    """Push a notification:new event to a specific user's sockets."""
    ws_manager.fire_user(user_id, "notification:new", notification)


def _ws_profile_updated(user_id: str, **fields) -> None:
    """Push user:profile_updated (AT balance, XP, rank) to the user's sockets."""
    ws_manager.fire_user(user_id, "user:profile_updated", {"user_id": user_id, **fields})


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    import time as _time
    start = _time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((_time.perf_counter() - start) * 1000, 2)
    response.headers["x-process-time-ms"] = str(elapsed_ms)
    return response


# ── Auth cookie (F1: httpOnly Secure SameSite=Strict) ─────────────────────────
# Web uses an httpOnly cookie so XSS can't exfiltrate the JWT; desktop client
# keeps using Authorization: Bearer. verify_token accepts either.
AUTH_COOKIE_NAME = "arena_access_token"
_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days — mirrors JWT exp in src/auth.py


def _set_auth_cookie(response: Response, token: str) -> None:
    is_prod = ENVIRONMENT == "production"
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=_AUTH_COOKIE_MAX_AGE,
        httponly=True,
        secure=is_prod,
        samesite="strict" if is_prod else "lax",
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")


# ── Auth dependency ───────────────────────────────────────────────────────────
async def verify_token(
    authorization: str | None = Header(default=None),
    access_cookie: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
) -> dict:
    """Decode and validate a JWT. Accepts either httpOnly cookie (web) or
    Authorization: Bearer header (desktop client)."""
    token: str | None = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
    elif access_cookie:
        token = access_cookie
    if not token:
        raise HTTPException(401, "Invalid token format")
    try:
        payload = auth.decode_token(token)
    except _jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except _jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    if payload.get("token_use") == "2fa_pending":
        raise HTTPException(401, "Complete 2FA — use POST /auth/2fa/confirm with temp_token")
    return payload


async def require_admin(payload: dict = Depends(verify_token)) -> dict:
    """Raises 403 unless the authenticated user has role=admin in user_roles."""
    user_id = payload.get("sub")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT 1 FROM user_roles WHERE user_id = :uid AND role = 'admin'"),
                {"uid": user_id},
            ).fetchone()
    except Exception:
        row = None
    if not row:
        raise HTTPException(403, "Admin only")
    return payload


async def optional_token(
    authorization: str | None = Header(default=None),
    access_cookie: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
) -> dict | None:
    """Like verify_token but returns None instead of 401 when no credential present."""
    token: str | None = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
    elif access_cookie:
        token = access_cookie
    if not token:
        return None
    try:
        return auth.decode_token(token)
    except (_jwt.ExpiredSignatureError, _jwt.InvalidTokenError):
        return None


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    token: str | None = Query(default=None),
):
    """
    Authenticated WebSocket connection.

    Auth: ?token=<JWT>  (same JWT the HTTP API uses)
    Cookie auth is NOT supported over WS — pass token in query param.

    On connect the server:
      1. Validates JWT — closes with 4001 if invalid/expired
      2. Looks up the user's active match — joins that room if found
      3. Sends {"type": "ws:connected", "data": {"user_id": ..., "match_id": ...}}
      4. Maintains with WebSocket ping/pong (Uvicorn/Starlette handles protocol)
      5. Calls ws_manager.disconnect() on any close

    Mid-session room changes (player joins a match after connect):
      The server broadcasts match:status_changed which the client uses
      to know a match is active; the client reconnects with the match_id
      already cached from the REST call that created/joined the match.
      No explicit room-join message is needed from the client.
    """
    # ── Validate JWT ─────────────────────────────────────────────────────────
    if not token:
        await ws.close(code=4001, reason="Missing token")
        return
    try:
        payload = auth.decode_token(token)
    except _jwt.ExpiredSignatureError:
        await ws.close(code=4001, reason="Token expired")
        return
    except _jwt.InvalidTokenError:
        await ws.close(code=4001, reason="Invalid token")
        return
    if payload.get("token_use") == "2fa_pending":
        await ws.close(code=4001, reason="2FA pending")
        return

    user_id: str = payload["sub"]

    # ── Resolve active match (join room if in one) ────────────────────────────
    match_id: str | None = None
    try:
        with SessionLocal() as s:
            row = s.execute(
                text(
                    "SELECT mp.match_id::text "
                    "FROM match_players mp "
                    "JOIN matches m ON m.id = mp.match_id "
                    "WHERE mp.user_id = :uid "
                    "  AND m.status IN ('waiting', 'in_progress') "
                    "LIMIT 1"
                ),
                {"uid": user_id},
            ).fetchone()
            if row:
                match_id = str(row[0])
    except Exception as exc:
        logger.warning("WS match lookup failed user=%s: %s", user_id, exc)

    await ws_manager.connect(ws, user_id, match_id)

    # ── Confirmation message ──────────────────────────────────────────────────
    try:
        await ws.send_json({
            "type": "ws:connected",
            "data": {"user_id": user_id, "match_id": match_id},
        })
    except Exception:
        await ws_manager.disconnect(ws)
        return

    # ── Keep alive — receive loop ─────────────────────────────────────────────
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = __import__("json").loads(raw)
            except Exception:
                continue
            # Client may send {"type": "ws:subscribe_match", "match_id": "<id>"}
            # to join a match room after connecting (e.g. right after create/join).
            if msg.get("type") == "ws:subscribe_match":
                mid = msg.get("match_id") or ""
                if mid:
                    with SessionLocal() as s:
                        allowed = s.execute(
                            text(
                                "SELECT 1 FROM match_players "
                                "WHERE match_id = :mid AND user_id = :uid"
                            ),
                            {"mid": mid, "uid": user_id},
                        ).fetchone()
                    if allowed:
                        await ws_manager.subscribe_match(ws, mid)
                        await ws.send_json({
                            "type": "ws:subscribed",
                            "data": {"match_id": mid},
                        })
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WS error user=%s: %s", user_id, exc)
    finally:
        await ws_manager.disconnect(ws)


# ── Per-match WebSocket endpoint ─────────────────────────────────────────────

@app.websocket("/ws/match/{match_id}")
async def ws_match_endpoint(
    ws: WebSocket,
    match_id: str,
    token: str | None = Query(default=None),
):
    """
    GET /ws/match/{match_id} — per-match real-time channel.

    Auth: ?token=<JWT> (query param — cookies are unreliable on WS upgrade).
    Closes with code 4001 on auth failure, 4003 if caller is not in this match.

    On connect:
      1. Validates JWT.
      2. Verifies caller is a player in this match.
      3. Joins the ws_manager match room.
      4. Sends ws:connected confirmation.
      5. Launches a 2s DB-poll loop that pushes match_state events.
         The loop exits when the match reaches a terminal status or the socket closes.

    Push events:
      {"type": "match:state", "data": { ...heartbeat-shape fields... }}
        — pushed every 2s while status is waiting/in_progress
      {"type": "match:result", "data": {"match_id", "status", "winner_id"}}
        — pushed once when status is completed/tied/cancelled/disputed
      {"type": "notification:unread_count", "data": {"count": int}}
        — pushed every 10s (piggybacks on the loop)

    Client → server messages:
      {"type": "ws:ping"}    → server replies {"type": "ws:pong"}
    """
    if not token:
        await ws.close(code=4001, reason="Missing token")
        return
    try:
        payload = auth.decode_token(token)
    except _jwt.ExpiredSignatureError:
        await ws.close(code=4001, reason="Token expired")
        return
    except _jwt.InvalidTokenError:
        await ws.close(code=4001, reason="Invalid token")
        return
    if payload.get("token_use") == "2fa_pending":
        await ws.close(code=4001, reason="2FA pending")
        return

    user_id: str = payload["sub"]

    try:
        with SessionLocal() as _s:
            member = _s.execute(
                text(
                    "SELECT 1 FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()
    except Exception as _exc:
        logger.warning("ws_match membership check failed: %s", _exc)
        member = None

    if not member:
        await ws.close(code=4003, reason="Not a player in this match")
        return

    await ws_manager.connect(ws, user_id, match_id)

    try:
        await ws.send_json({
            "type": "ws:connected",
            "data": {"user_id": user_id, "match_id": match_id},
        })
    except Exception:
        await ws_manager.disconnect(ws)
        return

    _POLL_INTERVAL = 2.0
    _NOTIF_EVERY   = 5  # send unread count every 5 ticks = 10s
    _tick_count    = 0

    async def _poll_loop() -> None:
        nonlocal _tick_count
        while True:
            await asyncio.sleep(_POLL_INTERVAL)
            _tick_count += 1
            try:
                with SessionLocal() as _s:
                    players_rows = _s.execute(
                        text(
                            "SELECT u.id, u.username, u.avatar, u.arena_id, "
                            "       COALESCE(mp.team, 'A') AS team "
                            "FROM match_players mp "
                            "JOIN users u ON u.id = mp.user_id "
                            "WHERE mp.match_id = :mid "
                            "ORDER BY COALESCE(mp.team, 'A'), mp.joined_at"
                        ),
                        {"mid": match_id},
                    ).fetchall()
                    mi = _s.execute(
                        text(
                            "SELECT status, game, mode, code, max_players, max_per_team, "
                            "       host_id, type, bet_amount, stake_currency, created_at, "
                            "       forfeit_warning_at, forfeit_warning_team, winner_id "
                            "FROM matches WHERE id = :mid"
                        ),
                        {"mid": match_id},
                    ).fetchone()

                if not mi:
                    break

                status = mi[0]
                terminal = status in ("completed", "cancelled", "disputed", "tied")

                your_team = next(
                    (str(p[4]) for p in players_rows if str(p[0]) == user_id), None
                )

                if not terminal:
                    await ws.send_json({
                        "type": "match:state",
                        "data": {
                            "match_id":             match_id,
                            "status":               status,
                            "game":                 mi[1],
                            "mode":                 mi[2],
                            "code":                 mi[3],
                            "max_players":          mi[4],
                            "max_per_team":         mi[5],
                            "host_id":              str(mi[6]) if mi[6] else None,
                            "type":                 mi[7],
                            "bet_amount":           str(mi[8]) if mi[8] is not None else None,
                            "stake_currency":       mi[9],
                            "created_at":           mi[10].isoformat() if mi[10] else None,
                            "forfeit_warning_at":   mi[11].isoformat() if mi[11] else None,
                            "forfeit_warning_team": mi[12],
                            "your_team":            your_team,
                            "players": [
                                {"user_id": str(p[0]), "username": p[1],
                                 "avatar": p[2], "arena_id": p[3], "team": p[4]}
                                for p in players_rows
                            ],
                        },
                    })
                else:
                    await ws.send_json({
                        "type": "match:result",
                        "data": {
                            "match_id":  match_id,
                            "status":    status,
                            "winner_id": str(mi[13]) if mi[13] else None,
                        },
                    })
                    break

                if _tick_count % _NOTIF_EVERY == 0:
                    try:
                        with SessionLocal() as _ns:
                            dm_cnt = _ns.execute(
                                text(
                                    "SELECT COUNT(*) FROM direct_messages "
                                    "WHERE receiver_id = :me AND read = FALSE"
                                ),
                                {"me": user_id},
                            ).scalar()
                            ib_cnt = _ns.execute(
                                text(
                                    "SELECT COUNT(*) FROM inbox_messages "
                                    "WHERE receiver_id = :me AND read = FALSE AND deleted = FALSE"
                                ),
                                {"me": user_id},
                            ).scalar()
                        await ws.send_json({
                            "type": "notification:unread_count",
                            "data": {"count": int(dm_cnt or 0) + int(ib_cnt or 0)},
                        })
                    except Exception as _ne:
                        logger.debug("ws_match notif count failed: %s", _ne)

            except WebSocketDisconnect:
                return
            except Exception as _pe:
                logger.debug("ws_match poll tick error match=%s: %s", match_id, _pe)
                return

    poll_task = asyncio.create_task(_poll_loop())

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = __import__("json").loads(raw)
            except Exception:
                continue
            if msg.get("type") == "ws:ping":
                await ws.send_json({"type": "ws:pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("ws_match error user=%s match=%s: %s", user_id, match_id, exc)
    finally:
        poll_task.cancel()
        try:
            await poll_task
        except asyncio.CancelledError:
            pass
        await ws_manager.disconnect(ws)


# ── Auth models ───────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    email:    str
    password: str


class LoginRequest(BaseModel):
    identifier: str   # email OR username
    password: str


class GoogleAuthRequest(BaseModel):
    """POST /auth/google — ID token from Google Identity Services (front-end @react-oauth/google)."""
    id_token: str


class AuthResponse(BaseModel):
    # DB-ready: user_id maps to users.id (UUID)
    # When requires_2fa=True (login only), access_token is omitted — use temp_token + POST /auth/2fa/confirm
    access_token: str | None = None
    token_type: str = "bearer"
    user_id: str | None = None
    username: str | None = None
    email: str | None = None
    arena_id: str | None = None
    wallet_address: str | None = None   # DB-ready: from users.wallet_address
    requires_2fa: bool = False
    temp_token: str | None = None
    verification_required: bool = False


class UserProfile(BaseModel):
    # DB-ready: joins users + user_stats
    user_id: str
    username: str
    email: str
    arena_id: str | None = None
    rank: str | None = None
    wallet_address: str | None = None
    steam_id: str | None = None
    riot_id: str | None = None
    xp: int = 0
    xp_to_next_level: int = 1000
    daily_staked_at: int = 0       # AT from completed matches in last 24h (cancelled rooms excluded)
    daily_limit_at: int = 50000    # current admin-set daily cap (default $500)
    daily_staked_usdt: float = 0.0  # USDT from completed CRYPTO matches in last 24h
    daily_limit_usdt: float = 500.0  # admin-set daily_bet_max_usdt
    wins: int = 0
    losses: int = 0
    # Arena Tokens — platform currency for Forge store (NOT on-chain)
    # DB-ready: users.at_balance — awarded 200 on signup, spent in Forge
    at_balance: int = 0
    # Effective privilege from user_roles: admin > moderator > user
    role: str = "user"
    # Identity / Forge fields (from users table)
    avatar: str | None = None
    avatar_bg: str | None = None
    equipped_badge_icon: str | None = None
    forge_unlocked_item_ids: list[str] = []
    vip_expires_at: str | None = None
    region: str = "EU"  # user_settings.region — EU | NA | ASIA | SA | OCE | ME
    # DB-ready: users.auth_provider — 'email' | 'google'
    auth_provider: str = "email"
    # Game account verification — TRUE only after real OAuth/OpenID proof
    steam_verified: bool = False
    riot_verified:  bool = False
    # Discord OAuth linking
    discord_id:       str | None = None
    discord_username: str | None = None
    discord_verified: bool = False
    # FACEIT OAuth linking
    faceit_id:       str | None = None
    faceit_nickname: str | None = None
    faceit_elo:      int | None = None
    faceit_level:    int | None = None
    faceit_verified: bool = False
    # ISO 3166-1 alpha-2 country code (user-set once, shown as flag in profile)
    country: str | None = None


# ── Request / Response models ─────────────────────────────────────────────────

class MatchResult(BaseModel):
    """
    Validated match result submitted by the desktop client after the local
    StateMachine reaches CONFIRMED.

    TODO:
    - validate match_id against DB before accepting
    - cross-reference players_detected with registered match participants
    - trigger escrow release once winner_id is confirmed
    """
    match_id: str
    winner_id: str
    game: str = "CS2"                    # "CS2" | "Valorant"
    screenshot_path: str | None = None
    ocr_confidence: float = 0.0
    players_detected: list[str] = []
    agents_detected: list[str] = []      # Valorant agent names; [] for CS2
    score: str | None = None


class HealthResponse(BaseModel):
    status: str
    db: str
    environment: str


class ReadinessResponse(BaseModel):
    """
    Response returned by GET /ready.

    DB-ready: maps to client_sessions.status = 'ready' | 'connected'.
    When WebSocket is live this becomes a push event instead of a poll.
    """
    ready: bool
    reason: str = ""     # human-readable when ready=False


class ValidationResponse(BaseModel):
    """
    Response returned by POST /validate/screenshot.

    Fields match CLAUDE.md naming contract exactly:
      result, confidence, accepted, game, players, agents, score

    Step-3 additions (consensus state, both optional so old callers still work):
      consensus_status : "pending" | "reached" | "failed" | None
      consensus_result : agreed result string when reached, else None
    """
    match_id: str
    game: str                            # "CS2" | "Valorant"
    result: str | None
    confidence: float
    accepted: bool                       # True when result is non-None AND confidence >= threshold
    players: list[str]
    agents: list[str] = []              # Valorant agent names; [] for CS2
    score: str | None
    evidence_path: str | None
    consensus_status: str | None = None  # "pending" | "reached" | "failed"
    consensus_result: str | None = None  # agreed outcome when consensus reached
    winning_team: str | None = None       # "team_a" | "team_b" | None
    is_cross_validated: bool = False       # True when both teams confirmed
    screen_type: str = "unknown"           # "victory"|"defeat"|"live"|"unknown"
    live_score: dict | None = None         # {"ct": int, "t": int} | None
    is_round_start: bool = False           # True when live HUD shows 0-0


class CaptureResponse(BaseModel):
    filepath: str
    message: str


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    try:
        with db_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected", "environment": ENVIRONMENT or "development"}
    except Exception:
        return {"status": "ok", "db": "disconnected", "environment": ENVIRONMENT or "development"}


@app.get("/ready", response_model=ReadinessResponse)
async def ready():
    """
    Secondary readiness check — confirms the capture subsystem is operational.

    Returns ready=True when:
      - The engine HTTP server is running (implied by responding)
      - The screenshot directory is accessible for writing

    DB-ready: will additionally check client_sessions.status once DB is wired.
    WS-ready: replace polling with a "client:ready" WebSocket push event.
    """
    try:
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
        # Quick write-access probe
        probe = os.path.join(SCREENSHOT_DIR, ".ready_probe")
        with open(probe, "w") as f:
            f.write("")
        os.remove(probe)
        return ReadinessResponse(ready=True)
    except Exception as exc:
        return ReadinessResponse(ready=False, reason=f"Capture dir not writable: {exc}")


@app.post("/capture", response_model=CaptureResponse)
async def take_capture(monitor: int = 1, token: str = Depends(verify_token)):
    """Take a screenshot from the desktop client."""
    filepath = capture_screen(output_dir=SCREENSHOT_DIR, monitor_num=monitor)
    if not filepath:
        raise HTTPException(500, "Failed to capture screen")
    return {"filepath": filepath, "message": "Screenshot captured"}


@app.post("/capture/crop", response_model=CaptureResponse)
async def crop_capture(
    image_path: str, x: int, y: int, w: int, h: int,
    token: str = Depends(verify_token)
):
    """Crop a region of interest from a screenshot."""
    filepath = crop_roi(image_path, x, y, w, h, output_dir=SCREENSHOT_DIR)
    if not filepath:
        raise HTTPException(404, "Image not found or crop failed")
    return {"filepath": filepath, "message": "ROI cropped"}


def _auto_flag_consensus(wallet_addresses: list[str]) -> None:
    """
    Called after consensus is REACHED and flagged_wallets is non-empty.
    Inserts a 'vision_flag' penalty for each flagged player with the standard
    escalation tiers: 1st→24h suspension, 2nd→7d, 3rd+→permanent ban.
    Non-fatal — errors are logged and swallowed so consensus payout is not blocked.
    DB-ready: player_penalties (migration 016), wallet_blacklist (migration 025).
    """
    if not wallet_addresses:
        return
    try:
        with SessionLocal() as session:
            for wallet in wallet_addresses:
                try:
                    user_row = session.execute(
                        text("SELECT id FROM users WHERE wallet_address = :w"),
                        {"w": wallet},
                    ).fetchone()
                    if not user_row:
                        logger.warning("_auto_flag_consensus: no user for wallet=%s — skipped", wallet)
                        continue
                    user_id = str(user_row[0])

                    cnt_row = session.execute(
                        text(
                            "SELECT COALESCE(MAX(offense_count), 0) "
                            "FROM player_penalties WHERE user_id = :uid"
                        ),
                        {"uid": user_id},
                    ).scalar()
                    new_count = int(cnt_row or 0) + 1

                    now_utc = datetime.now(timezone.utc)
                    suspended_until = None
                    banned_at = None
                    if new_count == 1:
                        suspended_until = now_utc + timedelta(hours=24)
                        action = "suspended_24h"
                    elif new_count == 2:
                        suspended_until = now_utc + timedelta(days=7)
                        action = "suspended_7d"
                    else:
                        banned_at = now_utc
                        action = "banned_permanent"

                    session.execute(
                        text(
                            "INSERT INTO player_penalties "
                            "  (user_id, offense_type, notes, offense_count, "
                            "   suspended_until, banned_at) "
                            "VALUES (:uid, 'vision_flag', "
                            "  'Auto-flagged by consensus: result contradicted majority', "
                            "  :cnt, :sus, :ban)"
                        ),
                        {
                            "uid": user_id,
                            "cnt": new_count,
                            "sus": suspended_until,
                            "ban": banned_at,
                        },
                    )

                    # On permanent ban → insert to wallet_blacklist
                    if banned_at is not None:
                        id_row = session.execute(
                            text(
                                "SELECT steam_id, riot_id, wallet_address "
                                "FROM users WHERE id = :uid"
                            ),
                            {"uid": user_id},
                        ).fetchone()
                        if id_row:
                            session.execute(
                                text(
                                    "INSERT INTO wallet_blacklist "
                                    "  (wallet_address, steam_id, riot_id, user_id, reason) "
                                    "VALUES (:w, :s, :r, :uid, 'consensus_ban') "
                                    "ON CONFLICT DO NOTHING"
                                ),
                                {
                                    "w":   id_row[2],
                                    "s":   id_row[0],
                                    "r":   id_row[1],
                                    "uid": user_id,
                                },
                            )

                    session.commit()
                    logger.warning(
                        "_auto_flag_consensus: user=%s wallet=%s offense=%d action=%s",
                        user_id, wallet, new_count, action,
                    )
                    _log_audit(
                        "system",
                        "AUTO_FLAG",
                        target_id=user_id,
                        notes=f"vision_flag offense={new_count} action={action}",
                    )
                except Exception as inner_exc:
                    session.rollback()
                    logger.error(
                        "_auto_flag_consensus inner error: wallet=%s error=%s",
                        wallet, inner_exc,
                    )
    except Exception as exc:
        logger.error("_auto_flag_consensus outer error: %s", exc)


def _auto_payout_on_consensus(
    match_id: str,
    agreed_result: str,
    winning_team: str | None = None,
) -> None:
    """
    Triggered automatically when MatchConsensus reaches REACHED status.

    Finds the winning player, updates the match to 'completed', releases payout.

    Winner determination (in order of preference):
      1. When winning_team is "team_a" or "team_b": query match_players JOIN users
         for the first player on that team — most accurate for cross-team consensus.
      2. Fallback (no team info): query match_consensus for the "victory" submitter.

    Non-fatal: any error is logged and swallowed; admin can use
    POST /admin/match/{id}/declare-winner as fallback.
    """
    try:
        # ── Find winner_id ────────────────────────────────────────────────────
        winner_id: str | None = None
        stake_currency: str = "CRYPTO"
        try:
            with SessionLocal() as session:
                if winning_team in ("team_a", "team_b"):
                    db_team = "A" if winning_team == "team_a" else "B"
                    row = session.execute(
                        text("""
                            SELECT u.id, m.stake_currency
                            FROM   match_players mp
                            JOIN   users u ON u.wallet_address = mp.wallet_address
                            JOIN   matches m ON m.id = mp.match_id
                            WHERE  mp.match_id = :mid
                              AND  mp.team      = :team
                            LIMIT  1
                        """),
                        {"mid": match_id, "team": db_team},
                    ).fetchone()
                else:
                    row = session.execute(
                        text("""
                            SELECT u.id, m.stake_currency
                            FROM   match_consensus mc
                            JOIN   users u ON u.wallet_address = mc.wallet_address
                            JOIN   matches m ON m.id = mc.match_id
                            WHERE  mc.match_id = :mid
                              AND  mc.result   = :result
                            LIMIT  1
                        """),
                        {"mid": match_id, "result": agreed_result},
                    ).fetchone()
            if row:
                winner_id      = str(row[0])
                stake_currency = (row[1] or "CRYPTO")
        except Exception as exc:
            logger.warning(
                "_auto_payout: winner lookup failed (non-fatal): match=%s error=%s",
                match_id, exc,
            )

        if not winner_id:
            logger.warning(
                "_auto_payout: no winner found for match=%s result=%s — "
                "use POST /admin/match/{id}/declare-winner as fallback",
                match_id, agreed_result,
            )
            return

        # ── Mark match completed (idempotent guard on status) ─────────────────
        try:
            with SessionLocal() as session:
                session.execute(
                    text(
                        "UPDATE matches "
                        "SET status = 'completed', winner_id = :winner, ended_at = NOW() "
                        "WHERE id = :mid AND status = 'in_progress'"
                    ),
                    {"winner": winner_id, "mid": match_id},
                )
                session.commit()
            _ws_match_status(match_id, "completed", winner_id=winner_id)
        except Exception as exc:
            logger.error(
                "_auto_payout: match UPDATE failed (non-fatal): match=%s error=%s",
                match_id, exc,
            )
            return

        # ── Release payout ────────────────────────────────────────────────────
        if _PAYOUTS_FROZEN:
            logger.warning(
                "_auto_payout FROZEN: match=%s winner=%s currency=%s — "
                "funds withheld until admin unfreezes via POST /admin/freeze",
                match_id, winner_id, stake_currency,
            )
            return

        if stake_currency == "AT":
            _settle_at_match(match_id, winner_id)
        elif _escrow_client:
            try:
                tx_hash = _escrow_client.declare_winner(match_id, winner_id)
                logger.info(
                    "_auto_payout on-chain: match=%s winner=%s tx=%s",
                    match_id, winner_id, tx_hash,
                )
            except Exception as exc:
                logger.error(
                    "_auto_payout on-chain failed (non-fatal): match=%s error=%s",
                    match_id, exc,
                )

        logger.info(
            "_auto_payout complete: match=%s winner=%s currency=%s",
            match_id, winner_id, stake_currency,
        )

    except Exception as exc:
        logger.error(
            "_auto_payout_on_consensus unexpected error (non-fatal): match=%s error=%s",
            match_id, exc,
        )


def _auto_payout_on_tie(match_id: str) -> None:
    """
    Triggered automatically when MatchConsensus reaches REACHED with agreed_result="tie".

    Marks the match as 'tied', then refunds all players minus 5% fee via the
    appropriate currency path (AT in-memory or CRYPTO on-chain).

    Non-fatal: any error is logged and swallowed; admin can use the contract
    directly as a fallback.
    """
    try:
        stake_currency: str = "CRYPTO"
        try:
            with SessionLocal() as session:
                row = session.execute(
                    text("SELECT stake_currency FROM matches WHERE id = :mid"),
                    {"mid": match_id},
                ).fetchone()
                if row:
                    stake_currency = row[0] or "CRYPTO"
        except Exception as exc:
            logger.warning(
                "_auto_payout_on_tie: currency lookup failed (non-fatal): match=%s error=%s",
                match_id, exc,
            )

        try:
            with SessionLocal() as session:
                session.execute(
                    text(
                        "UPDATE matches SET status = 'tied', ended_at = NOW() "
                        "WHERE id = :mid AND status = 'in_progress'"
                    ),
                    {"mid": match_id},
                )
                session.commit()
            _ws_match_status(match_id, "tied")
        except Exception as exc:
            logger.error(
                "_auto_payout_on_tie: match UPDATE failed (non-fatal): match=%s error=%s",
                match_id, exc,
            )
            return

        if _PAYOUTS_FROZEN:
            logger.warning(
                "_auto_payout_on_tie FROZEN: match=%s currency=%s — "
                "funds withheld until admin unfreezes via POST /admin/freeze",
                match_id, stake_currency,
            )
            return

        if stake_currency == "AT":
            _settle_at_tie_match(match_id)
        elif _escrow_client:
            try:
                tx_hash = _escrow_client.declare_tie(match_id)
                logger.info(
                    "_auto_payout_on_tie on-chain: match=%s tx=%s", match_id, tx_hash
                )
            except Exception as exc:
                logger.error(
                    "_auto_payout_on_tie on-chain failed (non-fatal): match=%s error=%s",
                    match_id, exc,
                )

        logger.info(
            "_auto_payout_on_tie complete: match=%s currency=%s", match_id, stake_currency
        )

    except Exception as exc:
        logger.error(
            "_auto_payout_on_tie unexpected error (non-fatal): match=%s error=%s",
            match_id, exc,
        )


@app.post("/validate/screenshot", response_model=ValidationResponse)
async def validate_screenshot(
    match_id: str,
    game: str = "CS2",
    file: UploadFile = File(...),
    payload: dict = Depends(verify_token),
):
    """
    Upload a screenshot → run the full vision pipeline → return match result.

    The `game` query parameter ("CS2" | "Valorant") determines which colour
    detector and OCR regions are used.  All routing goes through VisionEngine
    so this endpoint always stays in sync with the watcher pipeline.

    Pipeline:
      1. Validate match exists and is in_progress
      2. Enforce 1 submission per user per match (409 if duplicate)
      3. Save screenshot to disk
      4. Run VisionEngine.process_frame()
      5. Persist result to match_evidence table in DB
      6. Return ValidationResponse

    DB-ready: match_evidence table; users.wallet_address for identity.
    """
    import shutil
    import uuid as _uuid
    from datetime import datetime

    user_id: str = payload["sub"]

    # ── 1. Validate match status (non-fatal if DB unavailable) ───────────────
    # If DB is reachable and match is found: enforce status.
    # If DB is unavailable or match_id is not a valid UUID: proceed gracefully.
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text("SELECT status FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()
        if match_row and match_row[0] not in ("in_progress", "waiting"):
            raise HTTPException(
                409,
                f"Match {match_id} is {match_row[0]} — screenshots not accepted",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("validate_screenshot: match status check skipped (DB error): %s", exc)
        match_row = None

    # ── 2. Participant gate + submission limit ────────────────────────────────
    # 2a. Submitter must be a registered player in this match.
    # 2b. Only 1 accepted screenshot per wallet per match.
    wallet_address: str | None = None
    try:
        with SessionLocal() as session:
            wallet_row = session.execute(
                text("SELECT wallet_address FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            wallet_address = wallet_row[0] if wallet_row else None

            # 2a — match_players membership check
            is_participant = session.execute(
                text(
                    "SELECT 1 FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid LIMIT 1"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()
            if not is_participant:
                raise HTTPException(
                    403,
                    "You are not a participant in this match.",
                )

            # 2b — duplicate submission check
            if wallet_address:
                existing = session.execute(
                    text(
                        "SELECT id FROM match_evidence "
                        "WHERE match_id = :mid AND wallet_address = :wallet"
                    ),
                    {"mid": match_id, "wallet": wallet_address},
                ).fetchone()
                if existing:
                    raise HTTPException(
                        409,
                        f"User already submitted a screenshot for match {match_id}. "
                        "Only 1 submission per player per match is allowed.",
                    )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("validate_screenshot: participant/limit check skipped (DB error): %s", exc)

    # ── 3. Save screenshot to disk ────────────────────────────────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    save_path = os.path.join(SCREENSHOT_DIR, f"match_{match_id}_{timestamp}.png")
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # ── 4. Run VisionEngine pipeline ──────────────────────────────────────────
    vision = VisionEngine(config=VisionEngineConfig(game=game))
    output = vision.process_frame(save_path)

    evidence_path = None
    if output.result:
        from src.vision.matcher import save_evidence
        evidence_path = save_evidence(save_path, output.result, output.confidence)

    # ── 5. Persist to match_evidence ─────────────────────────────────────────
    # Always insert — even when result is None — so every submitted screenshot
    # is auditable (e.g. low-confidence frames, connection drops, disputes).
    # ON CONFLICT DO NOTHING is safe: the submission-limit check above already
    # blocks a second row for the same (match_id, wallet_address).
    # DB-ready: match_evidence table (infra/sql/init.sql)
    try:
        with SessionLocal() as session:
            session.execute(
                text("""
                    INSERT INTO match_evidence
                        (id, match_id, wallet_address, game, result, confidence,
                         accepted, players, agents, score, screenshot_path, evidence_path)
                    VALUES
                        (:id, :mid, :wallet, :game, :result, :confidence,
                         :accepted, :players, :agents, :score, :sspath, :evpath)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id":         str(_uuid.uuid4()),
                    "mid":        match_id,
                    "wallet":     wallet_address,
                    "game":       game,
                    "result":     output.result,
                    "confidence": float(output.confidence),
                    "accepted":   bool(output.accepted),
                    "players":    output.players,
                    "agents":     output.agents,
                    "score":      output.score,
                    "sspath":     save_path,
                    "evpath":     evidence_path,
                },
            )
            session.commit()
    except Exception as exc:
        logger.error("validate_screenshot evidence insert error (non-fatal): %s", exc)

    # ── 5b. Live score upsert (HUD frames — no end-screen) ───────────────────
    if output.screen_type == "live" and output.live_score:
        try:
            _ls = output.live_score
            with SessionLocal() as _s:
                _s.execute(
                    text("""
                        INSERT INTO match_live_state
                            (match_id, ct_score, t_score, round_confirmed,
                             first_round_at, submissions, updated_at)
                        VALUES
                            (:mid, :ct, :t, :rc, :frat, 1, NOW())
                        ON CONFLICT (match_id) DO UPDATE SET
                            ct_score        = EXCLUDED.ct_score,
                            t_score         = EXCLUDED.t_score,
                            round_confirmed = match_live_state.round_confirmed
                                              OR EXCLUDED.round_confirmed,
                            first_round_at  = CASE
                                WHEN EXCLUDED.round_confirmed
                                     AND match_live_state.first_round_at IS NULL
                                THEN NOW()
                                ELSE match_live_state.first_round_at
                            END,
                            submissions     = match_live_state.submissions + 1,
                            updated_at      = NOW()
                    """),
                    {
                        "mid": match_id,
                        "ct":  _ls["ct"],
                        "t":   _ls["t"],
                        "rc":  output.is_round_start,
                        "frat": datetime.now(timezone.utc) if output.is_round_start else None,
                    },
                )
                _s.commit()
            logger.info(
                "live_score upsert: match=%s ct=%d t=%d round_start=%s",
                match_id, _ls["ct"], _ls["t"], output.is_round_start,
            )
            ws_manager.fire_match(match_id, "match:live_score", {
                "match_id":  match_id,
                "ct_score":  _ls["ct"],
                "t_score":   _ls["t"],
                "round_confirmed": output.is_round_start,
            })
        except Exception as exc:
            logger.error("validate_screenshot live_score upsert error (non-fatal): %s", exc)

    # ── 6. Submit to MatchConsensus (DB-backed, non-fatal) ───────────────────
    # Fetch actual joined player count + team wallets for cross-team validation.
    # This replaces the old max_players lookup and eliminates the 50/50 deadlock.
    consensus_status_str: str | None = None
    consensus_result_str: str | None = None
    _winning_team: str | None = None
    _is_cross_validated: bool = False

    if output.result and wallet_address:
        try:
            from src.vision.consensus import MatchConsensus, ConsensusStatus

            _team_a_wallets: list[str] = []
            _team_b_wallets: list[str] = []
            _expected = 2
            try:
                with SessionLocal() as _s:
                    _mp_rows = _s.execute(
                        text("""
                            SELECT team, wallet_address
                            FROM   match_players
                            WHERE  match_id = :mid
                              AND  wallet_address IS NOT NULL
                        """),
                        {"mid": match_id},
                    ).fetchall()
                    _expected = max(len(_mp_rows), 2)
                    for _team, _wallet in _mp_rows:
                        if _team == "A":
                            _team_a_wallets.append(_wallet)
                        else:
                            _team_b_wallets.append(_wallet)
            except Exception as _exc:
                logger.debug("consensus: team wallet lookup failed (using defaults): %s", _exc)

            _consensus = MatchConsensus(
                match_id=match_id,
                expected_players=_expected,
                team_a_wallets=_team_a_wallets,
                team_b_wallets=_team_b_wallets,
                session_factory=SessionLocal,
            )
            _status = _consensus.submit(wallet_address, output)
            consensus_status_str = _status.value

            if _status == ConsensusStatus.REACHED:
                _verdict = _consensus.evaluate()
                consensus_result_str  = _verdict.agreed_result
                _winning_team         = _verdict.winning_team
                _is_cross_validated   = _verdict.is_cross_validated
                logger.info(
                    "consensus REACHED: match=%s result=%s winning_team=%s "
                    "cross_validated=%s agreeing=%d/%d flagged=%s",
                    match_id, _verdict.agreed_result, _verdict.winning_team,
                    _verdict.is_cross_validated,
                    _verdict.agreeing_players, _verdict.total_players,
                    _verdict.flagged_wallets,
                )
                if _verdict.agreed_result == "tie":
                    _auto_payout_on_tie(match_id)
                elif _verdict.agreed_result:
                    _auto_payout_on_consensus(
                        match_id,
                        _verdict.agreed_result,
                        winning_team=_verdict.winning_team,
                    )
                if _verdict.flagged_wallets:
                    _auto_flag_consensus(_verdict.flagged_wallets)
        except Exception as exc:
            logger.error("validate_screenshot consensus step error (non-fatal): %s", exc)

    # ── 7. Return response ────────────────────────────────────────────────────
    return ValidationResponse(
        match_id=match_id,
        game=game,
        result=output.result,
        confidence=output.confidence,
        accepted=output.accepted,
        players=output.players,
        agents=output.agents,
        score=output.score,
        evidence_path=evidence_path,
        consensus_status=consensus_status_str,
        consensus_result=consensus_result_str,
        winning_team=_winning_team,
        is_cross_validated=_is_cross_validated,
        screen_type=output.screen_type,
        live_score=output.live_score,
        is_round_start=output.is_round_start,
    )


@app.get("/matches/{match_id}/live-state")
async def get_live_state(match_id: str, token: dict = Depends(verify_token)):
    """
    Return the latest live HUD score for an in-progress match.

    Response (200):
      {
        "match_id":        "<uuid>",
        "ct_score":        <int>,
        "t_score":         <int>,
        "round_confirmed": <bool>,   # True once 0-0 was seen from any client
        "first_round_at":  "<iso>" | null,
        "submissions":     <int>,    # number of HUD screenshots received
        "updated_at":      "<iso>"
      }

    404 when no live-score data exists yet for this match (e.g. still in
    warmup, or all screenshots so far were non-HUD end-screens).

    The frontend polls this endpoint every 5 seconds while match status is
    "in_progress" and displays "CT <n> – T <n>" on the match card.
    """
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("""
                    SELECT ct_score, t_score, round_confirmed,
                           first_round_at, submissions, updated_at
                    FROM   match_live_state
                    WHERE  match_id = :mid
                """),
                {"mid": match_id},
            ).fetchone()
    except Exception as exc:
        logger.error("get_live_state DB error: match=%s error=%s", match_id, exc)
        raise HTTPException(503, "Database unavailable")

    if row is None:
        raise HTTPException(404, f"No live score data for match {match_id}")

    ct_score, t_score, round_confirmed, first_round_at, submissions, updated_at = row
    return {
        "match_id":        match_id,
        "ct_score":        ct_score,
        "t_score":         t_score,
        "round_confirmed": bool(round_confirmed),
        "first_round_at":  first_round_at.isoformat() if first_round_at else None,
        "submissions":     submissions,
        "updated_at":      updated_at.isoformat() if updated_at else None,
    }


@app.post("/match/result")
async def submit_result(result: MatchResult, token: dict = Depends(verify_token)):
    """
    Receives a validated match result from the desktop client after local
    consensus is reached.

    Writes to match_evidence and updates matches.status/winner_id.
    CONTRACT-ready: winner_id → ArenaEscrow.declareWinner() (Phase 6).
    """
    # ── Persist result + update user_stats ───────────────────────────────────
    # match_evidence rows are written by POST /validate/screenshot (VisionEngine
    # pipeline). This endpoint updates matches.status / winner_id AND increments
    # user_stats so wins/losses/xp accumulate in DB for every completed match.
    # CONTRACT-ready: declareWinner() call replaces this UPDATE in Phase 6.
    #
    # XP formula: winner +100 XP, all other players +25 XP (participation).
    # win_rate is recalculated as wins / matches * 100 after each update.
    try:
        with SessionLocal() as session:
            # Update match status to completed + set winner if provided
            if result.winner_id:
                session.execute(
                    text("""
                        UPDATE matches
                        SET status = 'completed', winner_id = :winner_id, ended_at = NOW()
                        WHERE id = :match_id
                    """),
                    {"winner_id": result.winner_id, "match_id": result.match_id},
                )
            else:
                session.execute(
                    text("UPDATE matches SET status = 'completed', ended_at = NOW() WHERE id = :match_id"),
                    {"match_id": result.match_id},
                )

            # ── Update user_stats for all players in this match ───────────────
            # DB-ready: match_players JOIN → update each participant's row.
            if result.winner_id:
                player_rows = session.execute(
                    text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                    {"mid": result.match_id},
                ).fetchall()

                for (uid,) in player_rows:
                    if uid is None:
                        continue  # migration 026: user_id nullable (deleted account)
                    uid_str = str(uid)
                    is_winner = uid_str == str(result.winner_id)
                    xp_gain   = 100 if is_winner else 25
                    session.execute(
                        text("""
                            UPDATE user_stats
                            SET matches  = matches  + 1,
                                wins     = wins     + :wins,
                                losses   = losses   + :losses,
                                xp       = xp       + :xp,
                                win_rate = CASE
                                    WHEN (matches + 1) > 0
                                    THEN ROUND((wins + :wins)::NUMERIC / (matches + 1) * 100, 2)
                                    ELSE 0
                                END
                            WHERE user_id = :uid
                        """),
                        {
                            "wins":   1 if is_winner else 0,
                            "losses": 0 if is_winner else 1,
                            "xp":     xp_gain,
                            "uid":    uid_str,
                        },
                    )
                    logger.info(
                        "user_stats updated: user=%s win=%s xp+%d",
                        uid_str, is_winner, xp_gain,
                    )
                    # ── Auto inbox notification ───────────────────────────────
                    # DB-ready: ARENA_SYSTEM_USER_ID env var must be set to a
                    # seeded system user row in the users table.
                    if is_winner:
                        _send_system_inbox(
                            session, uid_str,
                            subject="🏆 Victory — Match Result",
                            content=(
                                f"You won match {result.match_id}! "
                                f"+100 XP added to your profile. "
                                f"Winnings will be released by the escrow contract."
                            ),
                        )
                    else:
                        _send_system_inbox(
                            session, uid_str,
                            subject="Match Result",
                            content=(
                                f"Match {result.match_id} is over. "
                                f"+25 XP added for participation. Keep grinding!"
                            ),
                        )

            session.commit()
        logger.info("match_evidence saved: match=%s winner=%s", result.match_id, result.winner_id)
    except Exception as exc:
        logger.error("submit_result db error: %s", exc)
        # Non-fatal: return accepted so client doesn't retry endlessly
        # Non-fatal: DB record is source of truth

    # ── Payout ───────────────────────────────────────────────────────────────
    if result.winner_id:
        try:
            with SessionLocal() as _s:
                _sc_row = _s.execute(
                    text("SELECT stake_currency FROM matches WHERE id = :mid"),
                    {"mid": result.match_id},
                ).fetchone()
                _stake_currency = (_sc_row[0] if _sc_row else "CRYPTO") or "CRYPTO"
        except Exception:
            _stake_currency = "CRYPTO"

        if _stake_currency == "AT":
            # AT match: settle off-chain — distribute AT to winner minus 5% fee
            _settle_at_match(str(result.match_id), str(result.winner_id))
        elif _escrow_client:
            # CRYPTO match: release funds on-chain via escrow contract
            try:
                tx_hash = _escrow_client.declare_winner(
                    str(result.match_id), str(result.winner_id)
                )
                logger.info("declareWinner tx: match=%s tx=%s", result.match_id, tx_hash)
            except Exception as exc:
                logger.error(
                    "declareWinner failed (non-fatal): match=%s error=%s",
                    result.match_id, exc,
                )

    return {
        "accepted": True,
        "match_id": result.match_id,
        "message": "Result recorded",
    }


# ── Client Status — in-memory store ──────────────────────────────────────────
# DB-ready: replace with UPSERT on client_sessions table
#   Columns: wallet_address, status, game, session_id, match_id,
#            client_version, last_heartbeat
# Each connected desktop client sends a heartbeat every HEARTBEAT_INTERVAL
# seconds; the web UI polls GET /client/status to display the connection badge.

_client_store_lock = threading.Lock()
_client_statuses: dict[str, dict] = {}   # wallet_address → latest heartbeat payload

# A heartbeat older than this threshold is treated as "offline".
# Client sends every 4s; 10s = ~2 missed beats before marking offline.
_CLIENT_TIMEOUT_SECONDS = 10


def _version_ok(ver: str | None) -> bool:
    """Return True if *ver* meets the minimum client version requirement."""
    if not ver or ver == "unknown":
        return False
    try:
        def _t(v: str) -> tuple:
            return tuple(int(x) for x in v.split(".")[:3])
        return _t(ver) >= _t(MIN_CLIENT_VERSION)
    except Exception:
        return False


class HeartbeatRequest(BaseModel):
    """
    Payload sent by the desktop client every HEARTBEAT_INTERVAL seconds.

    DB-ready: maps to client_sessions row —
      wallet_address, status, game, session_id, match_id,
      client_version, user_id, last_heartbeat (server-stamped)
    """
    wallet_address: str
    client_version: str = "unknown"
    status: str = "idle"            # "idle" | "in_game" | "in_match"
    game: str | None = None         # "CS2" | "Valorant" | None
    session_id: str | None = None   # DB-ready: FK → client_sessions.id
    match_id: str | None = None     # DB-ready: FK → matches.id
    user_id: str | None = None      # DB-ready: FK → users.id; sent after client login


class ClientStatusResponse(BaseModel):
    """
    Canonical client status — Phase 4 contract.
    This is the single endpoint UI uses to gate Join / Escrow / Match actions.
    DB-ready: sourced from client_sessions table.
    """
    online: bool                   # True if last heartbeat < _CLIENT_TIMEOUT_SECONDS ago
    status: str                    # "disconnected"|"idle"|"in_game"|"in_match"
    session_id: str | None         # UUID from client config.json
    user_id: str | None            # FK → users.id; set via POST /client/bind
    wallet_address: str
    match_id: str | None
    version: str | None            # client_version string
    version_ok: bool               # True if version >= MIN_CLIENT_VERSION
    last_seen: str                 # ISO-8601 UTC; "" when never seen
    game: str | None


class BindRequest(BaseModel):
    """POST /client/bind payload — links a client session to an authenticated user."""
    session_id: str


@app.post("/client/heartbeat", status_code=200)
async def client_heartbeat(payload: HeartbeatRequest):
    """
    Receive a liveness heartbeat from the Arena desktop client.

    Always updates the in-memory store (fast, test-safe).
    Also UPSERT into client_sessions when session_id is provided.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {**payload.model_dump(), "last_seen": now_iso}

    # ── In-memory update (always) ─────────────────────────────
    with _client_store_lock:
        existing = _client_statuses.get(payload.wallet_address, {})
        # user_id: prefer the heartbeat-provided value; fall back to a prior bind
        record["user_id"] = payload.user_id or existing.get("user_id")
        _client_statuses[payload.wallet_address] = record

    # ── DB UPSERT (best-effort, only when session_id is present) ─────────────
    # Conflict target: partial unique index on wallet_address WHERE disconnected_at IS NULL.
    # This matches idx_client_sessions_wallet_active from infra/sql/init.sql.
    # Behaviour:
    #   • Active session exists for this wallet  → UPDATE it (refresh heartbeat + user_id)
    #   • No active session (all disconnected)   → INSERT a new active row
    # disconnected_at is always NULL on upsert (we are declaring ourselves alive).
    if payload.session_id:
        try:
            with SessionLocal() as session:
                session.execute(
                    text(
                        "INSERT INTO client_sessions "
                        "  (id, wallet_address, status, game, client_version, match_id, user_id, "
                        "   last_heartbeat, disconnected_at) "
                        "VALUES (:sid, :w, :s, :g, :v, :m, :uid, NOW(), NULL) "
                        "ON CONFLICT (wallet_address) WHERE disconnected_at IS NULL DO UPDATE SET "
                        "  status         = EXCLUDED.status, "
                        "  game           = EXCLUDED.game, "
                        "  client_version = EXCLUDED.client_version, "
                        "  match_id       = EXCLUDED.match_id, "
                        "  user_id        = COALESCE(EXCLUDED.user_id, client_sessions.user_id), "
                        "  last_heartbeat = NOW(), "
                        "  disconnected_at = NULL"
                    ),
                    {
                        "sid": payload.session_id,
                        "w":   payload.wallet_address,
                        "s":   payload.status,
                        "g":   payload.game,
                        "v":   payload.client_version,
                        "m":   payload.match_id,
                        "uid": payload.user_id,
                    },
                )
                session.commit()
        except Exception as exc:
            logger.debug("heartbeat DB write skipped: %s", exc)

    return {"accepted": True}


@app.get("/client/status", response_model=ClientStatusResponse)
async def client_status(
    wallet_address: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """
    Canonical client status endpoint — single source of truth for UI gating.

    Accepts either:
      • ?wallet_address=0x...        — desktop client / direct lookup
      • Authorization: Bearer <jwt>  — website: resolved to user_id → wallet_address via DB

    Priority: DB row (has user_id, authoritative) → in-memory fallback.
    UI rule: allow Join/Escrow/Match only when
      online=True AND version_ok=True AND status matches requirement.
    """
    resolved_wallet = wallet_address

    # ── Resolve wallet from JWT when wallet_address not provided ──────────────
    if not resolved_wallet and authorization and authorization.startswith("Bearer "):
        try:
            payload = auth.decode_token(authorization.removeprefix("Bearer "))
            uid = payload.get("sub")
            if uid:
                try:
                    with SessionLocal() as session:
                        row = session.execute(
                            text(
                                "SELECT wallet_address FROM client_sessions "
                                "WHERE user_id = :uid AND disconnected_at IS NULL "
                                "ORDER BY last_heartbeat DESC LIMIT 1"
                            ),
                            {"uid": uid},
                        ).fetchone()
                    if row:
                        resolved_wallet = row[0]
                    else:
                        # Authenticated user has no active bound session yet
                        return ClientStatusResponse(
                            online=False, status="disconnected",
                            session_id=None, user_id=uid,
                            wallet_address="", match_id=None,
                            version=None, version_ok=False,
                            last_seen="", game=None,
                        )
                except Exception as exc:
                    logger.debug("client_status JWT wallet lookup failed: %s", exc)
        except Exception:
            pass  # Invalid/expired token — fall through to 422

    if not resolved_wallet:
        raise HTTPException(
            status_code=422,
            detail="wallet_address query param or Authorization header required",
        )

    # ── DB-first lookup ───────────────────────────────────────────────────────
    db_row = None
    try:
        with SessionLocal() as session:
            db_row = session.execute(
                text(
                    "SELECT id, wallet_address, status, game, client_version, "
                    "       match_id, last_heartbeat, user_id "
                    "FROM client_sessions "
                    "WHERE wallet_address = :w AND disconnected_at IS NULL "
                    "ORDER BY last_heartbeat DESC LIMIT 1"
                ),
                {"w": resolved_wallet},
            ).fetchone()
    except Exception as exc:
        logger.debug("client_status DB read skipped: %s", exc)

    if db_row:
        last_seen_str = db_row[6].isoformat() if db_row[6] else ""
        try:
            elapsed = (datetime.now(timezone.utc) - db_row[6]).total_seconds()
            online = elapsed < _CLIENT_TIMEOUT_SECONDS
        except Exception:
            online = False
        ver = db_row[4]
        return ClientStatusResponse(
            online=online,
            status=db_row[2],
            session_id=str(db_row[0]),
            user_id=str(db_row[7]) if db_row[7] else None,
            wallet_address=db_row[1],
            match_id=str(db_row[5]) if db_row[5] else None,
            version=ver,
            version_ok=_version_ok(ver),
            last_seen=last_seen_str,
            game=db_row[3],
        )

    # ── Fallback: in-memory ───────────────────────────────────────────────────
    with _client_store_lock:
        record = _client_statuses.get(resolved_wallet)

    if record is None:
        return ClientStatusResponse(
            online=False,
            status="disconnected",
            session_id=None,
            user_id=None,
            wallet_address=resolved_wallet,
            match_id=None,
            version=None,
            version_ok=False,
            last_seen="",
            game=None,
        )

    last_seen_str = record.get("last_seen", "")
    try:
        last_seen_dt = datetime.fromisoformat(last_seen_str)
        elapsed = (datetime.now(timezone.utc) - last_seen_dt).total_seconds()
        online = elapsed < _CLIENT_TIMEOUT_SECONDS
    except (ValueError, TypeError):
        online = False

    ver = record.get("client_version")
    return ClientStatusResponse(
        online=online,
        status=record.get("status", "idle"),
        session_id=record.get("session_id"),
        user_id=record.get("user_id"),
        wallet_address=record["wallet_address"],
        match_id=record.get("match_id"),
        version=ver,
        version_ok=_version_ok(ver),
        last_seen=last_seen_str,
        game=record.get("game"),
    )


@app.get("/client/match")
async def client_active_match(wallet_address: str):
    """
    Return the active match_id for a given wallet address.

    The desktop client polls this every few seconds while monitoring.
    When a match_id is returned the client starts uploading screenshots.

    Lookup strategy: join match_players (wallet_address) → matches (status).
    'in_progress' = escrow is locked and the game is live.

    DB-ready: matches JOIN match_players ON mp.wallet_address = :w
              WHERE m.status = 'in_progress'
    CONTRACT-ready: active match = escrow locked; client captures & uploads
                    until match transitions to 'completed'.
    """
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT m.id FROM matches m "
                    "JOIN match_players mp ON mp.match_id = m.id "
                    "WHERE mp.wallet_address = :w "
                    "  AND m.status = 'in_progress' "
                    "ORDER BY m.created_at DESC LIMIT 1"
                ),
                {"w": wallet_address},
            ).fetchone()
            if row:
                return {"match_id": str(row[0]), "wallet_address": wallet_address}
    except Exception:
        pass
    # DB not available or no active match found
    return {"match_id": None, "wallet_address": wallet_address}


@app.get("/match/active")
async def get_active_match(payload: dict = Depends(verify_token)):
    """
    Return the calling user's current active match (status 'waiting' or 'in_progress').
    Used by MatchLobby to restore lobby state after page navigation.

    DB-ready: matches JOIN match_players WHERE status IN ('waiting','in_progress')
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT m.id, m.game, m.status, m.bet_amount, m.stake_currency, "
                    "       m.type, m.code, m.created_at, "
                    "       m.mode, m.host_id, u.username AS host_username, "
                    "       m.max_players, m.max_per_team "
                    "FROM matches m "
                    "JOIN match_players mp ON mp.match_id = m.id "
                    "JOIN users u ON u.id = m.host_id "
                    "WHERE mp.user_id = :uid "
                    "  AND m.status IN ('waiting','in_progress') "
                    "ORDER BY m.created_at DESC LIMIT 1"
                ),
                {"uid": user_id},
            ).fetchone()
            if not row:
                return {"match": None}

            match_id = str(row[0])

            # Touch last_seen so the existing 3-second frontend poll doubles as
            # a keep-alive.  Without this, _stale_player_cleanup_loop would remove
            # active lobby users after 45 s just because they never called /heartbeat.
            session.execute(
                text(
                    "UPDATE match_players SET last_seen = NOW() "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            )
            session.commit()

            players = session.execute(
                text(
                    "SELECT u.id, u.username, u.avatar, u.arena_id, "
                    "       COALESCE(mp.team, 'A') AS team, "
                    "       mp.has_deposited "
                    "FROM match_players mp "
                    "JOIN users u ON u.id = mp.user_id "
                    "WHERE mp.match_id = :mid "
                    "ORDER BY COALESCE(mp.team, 'A'), mp.joined_at"
                ),
                {"mid": match_id},
            ).fetchall()

            # Identify the caller's own slot (avoids client-side duplication)
            your_team         = next((p[4] for p in players if str(p[0]) == user_id), None)
            your_has_deposited = next((bool(p[5]) for p in players if str(p[0]) == user_id), False)

            return {
                "match": {
                    "match_id":          match_id,
                    "game":              row[1],
                    "status":            row[2],
                    "bet_amount":        str(row[3]) if row[3] is not None else None,
                    "stake_currency":    row[4],
                    "type":              row[5],
                    "code":              row[6],
                    "created_at":        row[7].isoformat() if row[7] else None,
                    "mode":              row[8],
                    "host_id":           str(row[9]) if row[9] else None,
                    "host_username":     row[10],
                    "max_players":       row[11],
                    "max_per_team":      row[12],
                    "your_user_id":      user_id,
                    "your_team":         your_team,
                    "your_has_deposited": your_has_deposited,
                    "players": [
                        {"user_id": str(p[0]), "username": p[1], "avatar": p[2],
                         "arena_id": p[3], "team": p[4]}
                        for p in players
                    ],
                }
            }
    except Exception as exc:
        logger.error("get_active_match error: %s", exc)
        raise HTTPException(500, "Failed to fetch active match")


@app.get("/match/{match_id}/status")
async def match_status(
    match_id: str,
    token: dict | None = Depends(optional_token),
):
    """
    Check match validation status from DB.

    Returns:
      - status, winner_id         — always present
      - on_chain_match_id         — BIGINT from matches table; null until MatchCreated event
      - stake_per_player          — BNB amount each player staked (float, e.g. 0.1)
      - your_team                 — 0 (Team A) or 1 (Team B) for the calling user;
                                    null when unauthenticated or user not in match

    Frontend uses on_chain_match_id + your_team to call
    ArenaEscrow.deposit(on_chain_match_id, your_team, { value: stake_wei }).

    DB-ready: matches + match_players
    CONTRACT-ready: on_chain_match_id → ArenaEscrow.deposit() / declareWinner()
    """
    user_id: str | None = token.get("sub") if token else None  # JWT uses "sub", not "user_id"
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("""
                    SELECT status, winner_id, on_chain_match_id, stake_per_player,
                           game_password
                    FROM matches
                    WHERE id = :mid
                """),
                {"mid": match_id},
            ).fetchone()
            if row:
                match_status_val = row[0]
                winner_id_val    = str(row[1]) if row[1] else None
                your_team: int | None = None
                if user_id:
                    team_row = session.execute(
                        text(
                            "SELECT team FROM match_players "
                            "WHERE match_id = :mid AND user_id = :uid"
                        ),
                        {"mid": match_id, "uid": user_id},
                    ).fetchone()
                    if team_row:
                        # DB stores 'A' / 'B'; contract uses 0 / 1
                        your_team = 0 if team_row[0] == "A" else 1

                # result: "victory" | "defeat" | null — only meaningful when completed
                result_val: str | None = None
                if match_status_val == "completed" and winner_id_val and user_id:
                    result_val = "victory" if winner_id_val == user_id else "defeat"

                # score: first non-null score agreed in match_consensus
                score_val: str | None = None
                score_row = session.execute(
                    text(
                        "SELECT score FROM match_consensus "
                        "WHERE match_id = :mid AND score IS NOT NULL "
                        "LIMIT 1"
                    ),
                    {"mid": match_id},
                ).fetchone()
                if score_row:
                    score_val = score_row[0]

                # consensus progress — submissions so far vs expected
                submissions_count = session.execute(
                    text("SELECT COUNT(*) FROM match_consensus WHERE match_id = :mid"),
                    {"mid": match_id},
                ).scalar() or 0
                expected_count = session.execute(
                    text("SELECT COUNT(*) FROM match_players WHERE match_id = :mid"),
                    {"mid": match_id},
                ).scalar() or 0

                if match_status_val == "completed":
                    consensus_status_val = "reached"
                elif match_status_val == "disputed":
                    consensus_status_val = "failed"
                elif match_status_val == "in_progress":
                    consensus_status_val = "pending"
                else:
                    consensus_status_val = None

                return {
                    "match_id":           match_id,
                    "status":             match_status_val,
                    "winner_id":          winner_id_val,
                    "on_chain_match_id":  row[2],
                    "stake_per_player":   float(row[3]) if row[3] is not None else None,
                    "your_team":          your_team,
                    "result":             result_val,
                    "score":              score_val,
                    "game_password":      row[4] if match_status_val == "in_progress" else None,
                    "consensus_status":   consensus_status_val,
                    "submissions_count":  int(submissions_count),
                    "submissions_needed": int(expected_count),
                }
    except Exception:
        pass
    return {
        "match_id":          match_id,
        "status":            "pending",
        "winner_id":         None,
        "on_chain_match_id": None,
        "stake_per_player":  None,
        "your_team":         None,
    }



@app.get("/match/{match_id}/refund-status")
async def match_refund_status(
    match_id: str,
    token: dict | None = Depends(optional_token),
):
    """
    GET /match/:id/refund-status — can the calling player call ArenaEscrow.claimRefund()?

    claimRefund() is only valid for ACTIVE matches past the 2-hour on-chain TIMEOUT.
    Cancelled matches (cancelMatch/cancelWaiting) already auto-refund inside those calls.

    canRefund = True when ALL of:
      1. match status is 'in_progress'        (= ACTIVE on-chain)
      2. started_at < NOW() - 2h             (contract TIMEOUT elapsed)
      3. on_chain_match_id IS NOT NULL
      4. player has_deposited = TRUE

    Returns: canRefund, reason, amount (BNB string), onChainMatchId
    CONTRACT-ready: canRefund=true → frontend calls ArenaEscrow.claimRefund(onChainMatchId)
    """
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    user_id: str = token["sub"]
    CONTRACT_TIMEOUT_SECONDS = 7200  # ArenaEscrow.sol: TIMEOUT = 2 hours
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT status, on_chain_match_id, stake_per_player, started_at "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

            if not row:
                return {"canRefund": False, "reason": "match_not_found", "amount": "0", "onChainMatchId": None}

            match_status_val, on_chain_match_id, stake, started_at = row

            if match_status_val != "in_progress":
                return {"canRefund": False, "reason": "match_not_active", "amount": str(stake or "0"), "onChainMatchId": on_chain_match_id}

            if on_chain_match_id is None:
                return {"canRefund": False, "reason": "no_on_chain_id", "amount": str(stake or "0"), "onChainMatchId": None}

            if started_at is None:
                return {"canRefund": False, "reason": "not_started", "amount": str(stake or "0"), "onChainMatchId": on_chain_match_id}

            elapsed_row = session.execute(
                text("SELECT EXTRACT(EPOCH FROM (NOW() - :started))::int >= :timeout AS elapsed"),
                {"started": started_at, "timeout": CONTRACT_TIMEOUT_SECONDS},
            ).fetchone()
            if not elapsed_row or not elapsed_row[0]:
                return {"canRefund": False, "reason": "timeout_not_reached", "amount": str(stake or "0"), "onChainMatchId": on_chain_match_id}

            player_row = session.execute(
                text("SELECT has_deposited FROM match_players WHERE match_id = :mid AND user_id = :uid"),
                {"mid": match_id, "uid": user_id},
            ).fetchone()

            if not player_row:
                return {"canRefund": False, "reason": "not_a_player", "amount": str(stake or "0"), "onChainMatchId": on_chain_match_id}

            if not player_row[0]:
                return {"canRefund": False, "reason": "no_deposit", "amount": "0", "onChainMatchId": on_chain_match_id}

            return {"canRefund": True, "reason": "eligible", "amount": str(stake or "0"), "onChainMatchId": on_chain_match_id}

    except Exception as exc:
        logger.error("match_refund_status error: %s", exc)
        raise HTTPException(500, "Failed to fetch refund status")


@app.get("/match/{match_id}/consensus")
async def match_consensus_state(
    match_id: str,
    token: dict | None = Depends(optional_token),
):
    """
    Return the current consensus state for a match.

    Reads directly from the match_consensus table (persistent storage) so
    this always reflects the true state, even after an engine restart.

    Response shape:
      {
        "match_id":          "<uuid>",
        "status":            "pending" | "reached" | "failed",
        "agreed_result":     "<result>" | null,
        "total_votes":       <int>,
        "agreeing_votes":    <int>,
        "expected_players":  <int>,
        "flagged_wallets":   ["0x..."],
        "submissions": [
          {
            "wallet_address": "0x...",
            "result":         "<result>" | null,
            "confidence":     0.95,
            "submitted_at":   "2026-01-01T00:00:00Z"
          }
        ]
      }

    Returns {"status": "no_data"} when no votes have been recorded yet.
    Requires no authentication (match info is already public via GET /matches).

    DB-ready: match_consensus table (013-match-consensus.sql)
    """
    try:
        with SessionLocal() as session:
            # Fetch all votes for this match
            vote_rows = session.execute(
                text("""
                    SELECT wallet_address, result, confidence, submitted_at
                    FROM   match_consensus
                    WHERE  match_id = :mid
                    ORDER  BY submitted_at
                """),
                {"mid": match_id},
            ).fetchall()

            # Also look up expected_players from matches table
            match_row = session.execute(
                text("SELECT max_players FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()

        expected = int(match_row[0]) if match_row and match_row[0] else 2

        if not vote_rows:
            return {
                "match_id":         match_id,
                "status":           "no_data",
                "agreed_result":    None,
                "total_votes":      0,
                "agreeing_votes":   0,
                "expected_players": expected,
                "flagged_wallets":  [],
                "submissions":      [],
            }

        # Reconstruct consensus in memory from DB rows (cheap, no vision work)
        from src.vision.consensus import MatchConsensus, ConsensusStatus

        _c = MatchConsensus(match_id=match_id, expected_players=expected)
        for row in vote_rows:
            wallet, result, confidence, _ = row
            # Inject directly into _submissions dict (bypass persist — already in DB)
            from src.vision.consensus import PlayerSubmission
            from datetime import datetime as _dt, timezone as _tz
            submitted_at = row[3] or _dt.now(_tz.utc)
            _c._submissions[wallet] = PlayerSubmission(
                wallet_address=wallet,
                result=result,
                confidence=float(confidence),
                players=[],   # not stored in summary query for brevity
                submitted_at=submitted_at,
            )

        # Use _current_status() so PENDING is returned when fewer than
        # expected_players have submitted, even if the fraction already meets
        # the threshold among those who have.  Only call evaluate() when all
        # players have submitted (is_complete() == True).
        current_status = _c._current_status()

        if current_status == ConsensusStatus.PENDING:
            verdict_result    = None
            agreeing_players  = 0
            flagged: list[str] = []
        else:
            verdict           = _c.evaluate()
            verdict_result    = verdict.agreed_result
            agreeing_players  = verdict.agreeing_players
            flagged           = verdict.flagged_wallets

        return {
            "match_id":         match_id,
            "status":           current_status.value,
            "agreed_result":    verdict_result,
            "total_votes":      len(vote_rows),
            "agreeing_votes":   agreeing_players,
            "expected_players": expected,
            "flagged_wallets":  flagged,
            "submissions": [
                {
                    "wallet_address": row[0],
                    "result":         row[1],
                    "confidence":     float(row[2]),
                    "submitted_at":   row[3].isoformat() if row[3] else None,
                }
                for row in vote_rows
            ],
        }

    except Exception as exc:
        logger.error("match_consensus_state error: match=%s error=%s", match_id, exc)
        return {
            "match_id":         match_id,
            "status":           "error",
            "agreed_result":    None,
            "total_votes":      0,
            "agreeing_votes":   0,
            "expected_players": 2,
            "flagged_wallets":  [],
            "submissions":      [],
        }


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, request: Request, response: Response):
    """
    Register a new Arena user.

    Creates rows in: users, user_stats, user_balances, user_roles.
    DB-ready: all inserts use the users table from infra/sql/init.sql.
    """
    _check_rate_limit(f"register:{request.client.host}", max_calls=5, window_secs=60)

    # ── Normalize inputs ──────────────────────────────────────────────────────
    email    = req.email.strip().lower()
    username = req.username.strip()

    try:
        with SessionLocal() as session:
            # ── Duplicate checks ──────────────────────────────────────────────
            if session.execute(
                text("SELECT 1 FROM users WHERE lower(email) = :e"), {"e": email}
            ).fetchone():
                raise HTTPException(409, "Email already in use")

            if session.execute(
                text("SELECT 1 FROM users WHERE lower(username) = lower(:u)"), {"u": username}
            ).fetchone():
                raise HTTPException(409, "Username already taken")

            # ── 24h post-deletion cooldown (migration 023 `deleted_accounts`) ─
            # Same identifiers cannot be re-registered within 24h of a prior
            # account deletion. Hashing matches the scheme in _delete_user_account.
            email_hash    = hashlib.sha256(email.encode()).hexdigest()
            username_hash = hashlib.sha256(username.encode()).hexdigest()
            _assert_identifier_cooldown(session, "email",    email_hash)
            _assert_identifier_cooldown(session, "username", username_hash)

            # ── Wallet blacklist (migration 025) ──────────────────────────────
            wallet_addr = getattr(req, "wallet_address", None)
            if wallet_addr and session.execute(
                text("SELECT 1 FROM wallet_blacklist WHERE wallet_address = :w"),
                {"w": wallet_addr},
            ).fetchone():
                raise HTTPException(409, "This wallet address is banned from the platform")

            # ── Create user ───────────────────────────────────────────────────
            pw_hash  = auth.hash_password(req.password)
            arena_id = auth.generate_arena_id()
            import uuid as _uuid
            v_token   = str(_uuid.uuid4())
            needs_verify = bool(RESEND_API_KEY)
            row = session.execute(
                text(
                    "INSERT INTO users (username, email, password_hash, arena_id, at_balance, "
                    "                   email_verified, verification_token, verification_token_expires_at) "
                    "VALUES (:u, :e, :h, :a, 200, :ev, :vt, NOW() + INTERVAL '24 hours') "
                    "RETURNING id, username, email, arena_id"
                ),
                {"u": username, "e": email, "h": pw_hash, "a": arena_id,
                 "ev": not needs_verify, "vt": v_token if needs_verify else None},
            ).fetchone()

            user_id = str(row[0])

            # ── Seed companion rows ───────────────────────────────────────────
            session.execute(text("INSERT INTO user_stats (user_id) VALUES (:uid)"),    {"uid": user_id})
            session.execute(text("INSERT INTO user_balances (user_id) VALUES (:uid)"), {"uid": user_id})
            session.execute(text("INSERT INTO user_roles (user_id, role) VALUES (:uid, 'user')"), {"uid": user_id})
            session.execute(
                text(
                    "INSERT INTO user_settings (user_id) VALUES (:uid) "
                    "ON CONFLICT (user_id) DO NOTHING"
                ),
                {"uid": user_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        # Catch any remaining DB-level UNIQUE violations as a safe 409
        err = str(exc).lower()
        if "unique" in err or "duplicate" in err:
            logger.warning("register unique violation: %s", exc)
            raise HTTPException(409, "An account with these details already exists")
        logger.error("register error: %s", exc)
        raise HTTPException(500, "Registration failed")

    if needs_verify:
        await asyncio.to_thread(send_verification_email, email, username, v_token)
        return AuthResponse(
            verification_required=True,
            user_id=user_id,
            username=username,
            email=email,
            arena_id=arena_id,
        )

    token = auth.issue_token(user_id, email, username)
    _set_auth_cookie(response, token)
    return AuthResponse(
        access_token=token,
        user_id=user_id,
        username=username,
        email=email,
        arena_id=arena_id,
        requires_2fa=False,
    )


@app.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest, request: Request, response: Response):
    """
    Login with email OR username + password.

    DB-ready: SELECT from users table; verifies bcrypt hash.
    When totp_enabled, returns requires_2fa + temp_token (5 min); full JWT from POST /auth/2fa/confirm.
    """
    _check_rate_limit(f"login:{request.client.host}", max_calls=10, window_secs=60)
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id, username, email, password_hash, arena_id, wallet_address, "
                    "       COALESCE(totp_enabled, FALSE), totp_secret, "
                    "       COALESCE(email_verified, TRUE) "
                    "FROM users "
                    "WHERE lower(email) = lower(:id) OR lower(username) = lower(:id)"
                ),
                {"id": req.identifier.strip()},
            ).fetchone()
    except Exception as exc:
        logger.error("login db error: %s", exc)
        raise HTTPException(500, "Login failed")

    totp_enabled = bool(row[6]) if row and len(row) >= 8 else False

    if not row:
        raise HTTPException(401, "Invalid credentials")
    if row[3] is None:
        raise HTTPException(401, "This account uses Google sign-in")
    if not auth.verify_password(req.password, row[3]):
        raise HTTPException(401, "Invalid credentials")
    email_verified = bool(row[8]) if len(row) > 8 else True
    if not email_verified:
        raise HTTPException(403, "email_not_verified")

    user_id = str(row[0])
    if totp_enabled:
        temp = auth.issue_2fa_pending_token(user_id)
        return AuthResponse(requires_2fa=True, temp_token=temp)

    token = auth.issue_token(user_id, row[2], row[1])
    _set_auth_cookie(response, token)
    return AuthResponse(
        access_token=token,
        user_id=user_id,
        username=row[1],
        email=row[2],
        arena_id=row[4],
        wallet_address=row[5],
        requires_2fa=False,
    )


def _allocate_unique_username_from_google(session, email: str, display_name: str | None) -> str:
    """Derive a valid unique username from Google profile (users.username unique, max 50)."""
    raw_name = (display_name or "").strip()
    if raw_name:
        base = re.sub(r"[^a-zA-Z0-9_]+", "_", raw_name).strip("_")[:40]
    else:
        local = email.split("@", 1)[0] if "@" in email else email
        base = re.sub(r"[^a-zA-Z0-9_]+", "_", local).strip("_")[:40]
    if len(base) < 3:
        base = "player"
    for attempt in range(12):
        suffix = "" if attempt == 0 else f"_{secrets.token_hex(2)}"
        max_base = max(3, 50 - len(suffix))
        cand = (base[:max_base] + suffix)[:50]
        if not session.execute(
            text("SELECT 1 FROM users WHERE lower(username) = lower(:u)"),
            {"u": cand},
        ).fetchone():
            return cand
    return f"g_{secrets.token_hex(8)}"[:50]


def _auth_response_from_google_row(
    row: tuple,
    response: Response | None = None,
) -> AuthResponse:
    """
    Build AuthResponse from SELECT id, username, email, arena_id, wallet_address, totp_enabled.
    """
    user_id = str(row[0])
    username, email, arena_id, wallet = row[1], row[2], row[3], row[4]
    totp_enabled = bool(row[5])
    if totp_enabled:
        temp = auth.issue_2fa_pending_token(user_id)
        return AuthResponse(requires_2fa=True, temp_token=temp)
    tok = auth.issue_token(user_id, email, username)
    if response is not None:
        _set_auth_cookie(response, tok)
    return AuthResponse(
        access_token=tok,
        user_id=user_id,
        username=username,
        email=email,
        arena_id=arena_id,
        wallet_address=wallet,
        requires_2fa=False,
    )


@app.post("/auth/google", response_model=AuthResponse)
async def auth_google(req: GoogleAuthRequest, request: Request, response: Response):
    """
    Sign in or register with a Google ID token (verified server-side).

    DB-ready: users.google_id, users.auth_provider, nullable password_hash (migration 029).
    """
    _check_rate_limit(f"google_auth:{request.client.host}", max_calls=20, window_secs=60)
    client_id = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    if not client_id:
        raise HTTPException(503, "Google sign-in is not configured on this server")

    raw_tok = (req.id_token or "").strip()
    if not raw_tok:
        raise HTTPException(400, "id_token is required")

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as ga_requests

        idinfo = google_id_token.verify_oauth2_token(raw_tok, ga_requests.Request(), client_id)
    except ValueError as ve:
        logger.warning("google id_token verify failed: %s", ve)
        raise HTTPException(401, "Invalid or expired Google token")
    except Exception as exc:
        logger.error("google id_token verify error: %s", exc)
        raise HTTPException(500, "Google sign-in verification failed")

    sub = idinfo.get("sub")
    email_raw = idinfo.get("email")
    if not sub or not email_raw or not isinstance(email_raw, str):
        raise HTTPException(400, "Google token missing required identity claims")
    if not idinfo.get("email_verified", False):
        raise HTTPException(400, "Google email must be verified")

    email = email_raw.strip().lower()
    display_name = idinfo.get("name")
    display_name = display_name.strip() if isinstance(display_name, str) else None

    sel = (
        "SELECT id, username, email, arena_id, wallet_address, "
        "       COALESCE(totp_enabled, FALSE) "
        "FROM users "
    )

    try:
        with SessionLocal() as session:
            row = session.execute(
                text(sel + "WHERE google_id = :g"),
                {"g": str(sub)},
            ).fetchone()
            if row:
                return _auth_response_from_google_row(row, response)

            row_em = session.execute(
                text(sel + "WHERE lower(email) = :e"),
                {"e": email},
            ).fetchone()
            if row_em:
                existing_gid = session.execute(
                    text("SELECT google_id FROM users WHERE id = :id"),
                    {"id": str(row_em[0])},
                ).scalar()
                if existing_gid and str(existing_gid) != str(sub):
                    raise HTTPException(
                        409,
                        "This email is linked to a different Google account",
                    )
                session.execute(
                    text("UPDATE users SET google_id = :g, email_verified = TRUE WHERE id = :id"),
                    {"g": str(sub), "id": str(row_em[0])},
                )
                session.commit()
                row2 = session.execute(
                    text(sel + "WHERE id = :id"),
                    {"id": str(row_em[0])},
                ).fetchone()
                if row2:
                    return _auth_response_from_google_row(row2, response)
                raise HTTPException(500, "Google link failed")

            username = _allocate_unique_username_from_google(session, email, display_name)
            arena_id = auth.generate_arena_id()
            ins = session.execute(
                text(
                    "INSERT INTO users (username, email, password_hash, arena_id, "
                    "                   google_id, auth_provider, at_balance, email_verified) "
                    "VALUES (:u, :e, NULL, :a, :g, 'google', 200, TRUE) "
                    "RETURNING id, username, email, arena_id, wallet_address"
                ),
                {
                    "u": username,
                    "e": email,
                    "a": arena_id,
                    "g": str(sub),
                },
            ).fetchone()
            if not ins:
                raise HTTPException(500, "Registration failed")
            user_id = str(ins[0])

            session.execute(text("INSERT INTO user_stats (user_id) VALUES (:uid)"), {"uid": user_id})
            session.execute(text("INSERT INTO user_balances (user_id) VALUES (:uid)"), {"uid": user_id})
            session.execute(
                text("INSERT INTO user_roles (user_id, role) VALUES (:uid, 'user')"),
                {"uid": user_id},
            )
            session.execute(
                text(
                    "INSERT INTO user_settings (user_id) VALUES (:uid) "
                    "ON CONFLICT (user_id) DO NOTHING"
                ),
                {"uid": user_id},
            )
            session.commit()

            tok = auth.issue_token(user_id, str(ins[2]), str(ins[1]))
            _set_auth_cookie(response, tok)
            return AuthResponse(
                access_token=tok,
                user_id=user_id,
                username=str(ins[1]),
                email=str(ins[2]),
                arena_id=str(ins[3]) if ins[3] is not None else None,
                wallet_address=str(ins[4]) if ins[4] is not None else None,
                requires_2fa=False,
            )
    except HTTPException:
        raise
    except Exception as exc:
        err = str(exc).lower()
        if "unique" in err or "duplicate" in err:
            logger.warning("auth_google unique violation: %s", exc)
            raise HTTPException(409, "An account with these details already exists")
        logger.error("auth_google error: %s", exc)
        raise HTTPException(500, "Google sign-in failed")


@app.get("/auth/me", response_model=UserProfile)
async def me(payload: dict = Depends(verify_token)):
    """
    Return the authenticated user's profile from DB.

    Joins users + user_stats; returns all identity fields
    (avatar, badge, forge_unlocked_item_ids, vip_expires_at).
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT u.id, u.username, u.email, u.arena_id, "
                    "       u.rank, u.wallet_address, u.steam_id, u.riot_id, "
                    "       COALESCE(s.xp, 0), COALESCE(s.wins, 0), COALESCE(s.losses, 0), "
                    "       u.avatar, u.avatar_bg, u.equipped_badge_icon, "
                    "       u.forge_unlocked_item_ids, u.vip_expires_at, "
                    "       COALESCE(u.at_balance, 0), "
                    "       CASE "
                    "         WHEN EXISTS (SELECT 1 FROM user_roles ar "
                    "                      WHERE ar.user_id = u.id AND ar.role = 'admin') "
                    "           THEN 'admin' "
                    "         WHEN EXISTS (SELECT 1 FROM user_roles mr "
                    "                      WHERE mr.user_id = u.id AND mr.role = 'moderator') "
                    "           THEN 'moderator' "
                    "         ELSE 'user' "
                    "       END, "
                    "       COALESCE(us.region, 'EU'), "
                    "       COALESCE(u.auth_provider, 'email'), "
                    "       COALESCE(u.steam_verified, FALSE), "
                    "       COALESCE(u.riot_verified,  FALSE), "
                    "       u.country, "
                    "       u.discord_id, u.discord_username, "
                    "       COALESCE(u.discord_verified, FALSE), "
                    "       u.faceit_id, u.faceit_nickname, "
                    "       u.faceit_elo, u.faceit_level, "
                    "       COALESCE(u.faceit_verified, FALSE) "
                    "FROM users u "
                    "LEFT JOIN user_stats s ON s.user_id = u.id "
                    "LEFT JOIN user_settings us ON us.user_id = u.id "
                    "WHERE u.id = :uid"
                ),
                {"uid": user_id},
            ).fetchone()
            if not row:
                raise HTTPException(404, "User not found")
            xp_val = int(row[8])
            try:
                daily_staked = _get_daily_staked(session, user_id)
            except Exception:
                daily_staked = 0
            daily_limit = _get_daily_limit()
            try:
                daily_staked_usdt = _get_daily_staked_usdt(session, user_id)
            except Exception:
                daily_staked_usdt = 0.0
            daily_limit_usdt = _get_daily_limit_usdt()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("me db error: %s", exc)
        raise HTTPException(500, "Profile fetch failed")

    return UserProfile(
        user_id=str(row[0]),
        username=row[1],
        email=row[2],
        arena_id=row[3],
        rank=row[4],
        wallet_address=row[5],
        steam_id=row[6],
        riot_id=row[7],
        xp=xp_val,
        xp_to_next_level=((xp_val // 1000) + 1) * 1000,
        daily_staked_at=daily_staked,
        daily_limit_at=daily_limit,
        daily_staked_usdt=daily_staked_usdt,
        daily_limit_usdt=daily_limit_usdt,
        wins=int(row[9]),
        losses=int(row[10]),
        avatar=row[11],
        avatar_bg=row[12],
        equipped_badge_icon=row[13],
        forge_unlocked_item_ids=list(row[14]) if row[14] else [],
        vip_expires_at=row[15].isoformat() if row[15] else None,
        at_balance=int(row[16]),
        role=str(row[17]) if row[17] is not None else "user",
        region=str(row[18]) if len(row) > 18 and row[18] else "EU",
        auth_provider=str(row[19]) if len(row) > 19 and row[19] else "email",
        steam_verified=bool(row[20]) if len(row) > 20 and row[20] is not None else False,
        riot_verified=bool(row[21]) if len(row) > 21 and row[21] is not None else False,
        country=str(row[22]) if len(row) > 22 and row[22] else None,
        discord_id=str(row[23]) if len(row) > 23 and row[23] else None,
        discord_username=str(row[24]) if len(row) > 24 and row[24] else None,
        discord_verified=bool(row[25]) if len(row) > 25 and row[25] is not None else False,
        faceit_id=str(row[26]) if len(row) > 26 and row[26] else None,
        faceit_nickname=str(row[27]) if len(row) > 27 and row[27] else None,
        faceit_elo=int(row[28]) if len(row) > 28 and row[28] is not None else None,
        faceit_level=int(row[29]) if len(row) > 29 and row[29] is not None else None,
        faceit_verified=bool(row[30]) if len(row) > 30 and row[30] is not None else False,
    )


class PatchUserRequest(BaseModel):
    """
    PATCH /users/me payload — partial update of identity fields.
    All fields optional; only provided fields are written to DB.

    Identity-lock policy:
      • steam_id / riot_id — NEVER writable via this endpoint. Set only by the
        OpenID / OAuth callback; cleared only by account deletion. Any non-null
        value on these fields is rejected with 400.
      • wallet_address — write-once. May be linked only while the user's current
        wallet_address is NULL. Re-assignment or unlink is rejected with 400.

    DB-ready: maps to users table columns.
    """
    model_config = ConfigDict(extra="forbid")
    avatar: str | None = None
    avatar_bg: str | None = None
    equipped_badge_icon: str | None = None
    forge_unlocked_item_ids: list[str] | None = None
    username:       str | None = None   # case-insensitive unique
    # Identity fields — write rules enforced in handler, see docstring above.
    steam_id:       str | None = None   # REJECTED if non-null (OpenID only)
    riot_id:        str | None = None   # REJECTED if non-null (OAuth only)
    wallet_address: str | None = None   # set or replace; None means "no change"
    unlink_wallet:  bool       = False  # True → clear wallet_address (distinct from "no change")


@app.patch("/users/me", response_model=UserProfile)
async def patch_user_me(req: PatchUserRequest, payload: dict = Depends(verify_token)):
    """
    Partial update of the authenticated user's profile.

    Cosmetic fields (avatar, badge, forge items, username) are updated directly.

    Identity-lock policy (see PatchUserRequest docstring):
      • steam_id / riot_id — rejected outright. Only the OpenID / OAuth callback
        may set these. Account deletion is the only way to clear them.
      • wallet_address — write-once. Allowed only when the user's current
        wallet_address is NULL and the value is not in the 24-hour post-deletion
        cooldown. Changes or unlinks return 400.

    DB-ready: writes to users table columns.
    """
    user_id: str = payload["sub"]

    # ── Identity-lock enforcement ─────────────────────────────────────────────
    # steam_id / riot_id are never writable here. Any non-null value (including
    # an empty string, which previously meant "unlink") is a client-side attempt
    # to bypass the OpenID/OAuth flow and must be rejected.
    if req.steam_id is not None:
        raise HTTPException(
            400,
            "Steam ID is set only by the Steam OpenID flow and cleared only by "
            "account deletion. This field cannot be modified here.",
        )
    if req.riot_id is not None:
        raise HTTPException(
            400,
            "Riot ID is set only by the Riot OAuth flow and cleared only by "
            "account deletion. This field cannot be modified here.",
        )

    # ── Uniqueness / lock checks for remaining writable identity fields ───────
    try:
        with SessionLocal() as session:
            if req.username is not None:
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE lower(username) = lower(:u) AND id != :uid"),
                    {"u": req.username.strip(), "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Username already taken")

            if req.wallet_address is not None:
                if req.wallet_address.strip() == "":
                    raise HTTPException(400, "Invalid Ethereum wallet address format")
                addr = req.wallet_address.strip()
                import re
                if not re.fullmatch(r"0x[0-9a-fA-F]{40}", addr):
                    raise HTTPException(400, "Invalid Ethereum wallet address format")

                # Uniqueness across live users.
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE wallet_address = :w AND id != :uid"),
                    {"w": addr, "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Wallet address already linked to another account")

                # 24h post-deletion cooldown.
                _assert_identifier_cooldown(session, "wallet_address", addr)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("patch_user_me check error: %s", exc)
        raise HTTPException(500, "Profile update failed")

    # ── Build update fields ───────────────────────────────────────────────────
    # steam_id / riot_id are never written here (rejected above).
    fields: dict = {}
    if req.avatar                  is not None: fields["avatar"]                  = req.avatar
    if req.avatar_bg               is not None: fields["avatar_bg"]               = req.avatar_bg
    if req.equipped_badge_icon     is not None: fields["equipped_badge_icon"]     = req.equipped_badge_icon
    if req.forge_unlocked_item_ids is not None:
        fields["forge_unlocked_item_ids"] = req.forge_unlocked_item_ids
    if req.username       is not None: fields["username"]       = req.username.strip()
    if req.unlink_wallet:             fields["wallet_address"]  = None
    elif req.wallet_address is not None: fields["wallet_address"] = req.wallet_address.strip()

    if fields:
        set_clause = ", ".join(f"{col} = :{col}" for col in fields)
        fields["user_id"] = user_id
        try:
            with SessionLocal() as session:
                session.execute(
                    text(
                        f"UPDATE users SET {set_clause}, updated_at = NOW() "
                        "WHERE id = :user_id"
                    ),
                    fields,
                )
                session.commit()
        except Exception as exc:
            logger.error("patch_user_me error: %s", exc)
            raise HTTPException(500, "Profile update failed")

    # Return fresh profile
    return await me(payload)


class UserSettingsRegionPatch(BaseModel):
    """PATCH /users/settings — region, preferred_game, and/or country."""
    region: str | None = None
    preferred_game: str | None = None
    country: str | None = None


_ALLOWED_REGIONS = frozenset({"EU", "NA", "ASIA", "SA", "OCE", "ME"})
_ALLOWED_GAMES   = frozenset({"CS2", "Valorant", "COD", "League of Legends", "PUBG",
                               "Overwatch 2", "Team Fortress 2", "Fortnite",
                               "FIFA / EA FC", "PES / eFootball",
                               "MLBB", "Wild Rift", "COD Mobile", "PUBG Mobile",
                               "Fortnite Mobile", "Honor of Kings"})


@app.patch("/users/settings")
async def patch_user_settings(
    req: UserSettingsRegionPatch,
    payload: dict = Depends(verify_token),
):
    """Update user_settings.region and/or users.preferred_game."""
    uid = payload["sub"]
    result: dict = {}
    try:
        with SessionLocal() as session:
            if req.region is not None:
                r = req.region.strip().upper()
                if r not in _ALLOWED_REGIONS:
                    raise HTTPException(400, f"region must be one of: {', '.join(sorted(_ALLOWED_REGIONS))}")
                session.execute(
                    text(
                        "INSERT INTO user_settings (user_id, region) VALUES (:uid, :reg) "
                        "ON CONFLICT (user_id) DO UPDATE SET "
                        "region = EXCLUDED.region, updated_at = NOW()"
                    ),
                    {"uid": uid, "reg": r},
                )
                result["region"] = r

            if req.preferred_game is not None:
                g = req.preferred_game.strip()
                if g not in _ALLOWED_GAMES:
                    raise HTTPException(400, f"Unknown game: {g}")
                session.execute(
                    text("UPDATE users SET preferred_game = :g WHERE id = :uid"),
                    {"g": g, "uid": uid},
                )
                result["preferred_game"] = g

            if req.country is not None:
                c = req.country.strip().upper()
                if len(c) != 2 or not c.isalpha():
                    raise HTTPException(400, "country must be a 2-letter ISO 3166-1 alpha-2 code")
                session.execute(
                    text("UPDATE users SET country = :c WHERE id = :uid"),
                    {"c": c, "uid": uid},
                )
                result["country"] = c

            if not result:
                raise HTTPException(400, "No valid fields provided")
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("patch_user_settings error: %s", exc)
        raise HTTPException(500, "Failed to update settings")
    return result


class DeleteAccountBody(BaseModel):
    confirm_text: str


@app.delete("/users/me")
async def delete_my_account(
    body: DeleteAccountBody,
    payload: dict = Depends(verify_token),
):
    """Permanently delete the authenticated account (FK-safe). Type 'delete' to confirm."""
    if body.confirm_text != "delete":
        raise HTTPException(400, "Type 'delete' to confirm")
    uid = payload["sub"]
    try:
        with SessionLocal() as session:
            try:
                _delete_user_account(session, uid)
                session.commit()
            except HTTPException:
                session.rollback()
                raise
            except Exception as exc:
                session.rollback()
                logger.error("delete_my_account error: %s", exc)
                raise HTTPException(500, "Account deletion failed")
    except HTTPException:
        raise
    return {"deleted": True}


class TwoFAVerifyBody(BaseModel):
    code: str


class TwoFADisableBody(BaseModel):
    password: str
    code: str


class TwoFAConfirmBody(BaseModel):
    temp_token: str
    code: str


@app.post("/auth/2fa/setup")
async def twofa_setup(payload: dict = Depends(verify_token)):
    """Generate TOTP secret (not enabled until POST /auth/2fa/verify)."""
    uid = payload["sub"]
    secret = pyotp.random_base32()
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT email FROM users WHERE id = :uid"),
                {"uid": uid},
            ).fetchone()
            if not row:
                raise HTTPException(404, "User not found")
            email = row[0]
            session.execute(
                text(
                    "UPDATE users SET totp_secret = :sec, totp_enabled = FALSE WHERE id = :uid"
                ),
                {"sec": secret, "uid": uid},
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("twofa_setup error: %s", exc)
        raise HTTPException(500, "2FA setup failed")
    qr_uri = (
        f"otpauth://totp/ProjectArena:{email}?secret={secret}&issuer=ProjectArena"
    )
    return {"secret": secret, "qr_uri": qr_uri}


@app.post("/auth/2fa/verify")
async def twofa_verify(req: TwoFAVerifyBody, payload: dict = Depends(verify_token)):
    """Verify first TOTP code and enable 2FA."""
    uid = payload["sub"]
    code = req.code.strip().replace(" ", "")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT totp_secret FROM users WHERE id = :uid"),
                {"uid": uid},
            ).fetchone()
            if not row or not row[0]:
                raise HTTPException(400, "Run POST /auth/2fa/setup first")
            if not pyotp.TOTP(row[0]).verify(code, valid_window=1):
                raise HTTPException(400, "Invalid verification code")
            session.execute(
                text("UPDATE users SET totp_enabled = TRUE WHERE id = :uid"),
                {"uid": uid},
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("twofa_verify error: %s", exc)
        raise HTTPException(500, "2FA verify failed")
    return {"enabled": True}


@app.delete("/auth/2fa")
async def twofa_disable(req: TwoFADisableBody, payload: dict = Depends(verify_token)):
    """Disable 2FA after password + TOTP verification."""
    uid = payload["sub"]
    code = req.code.strip().replace(" ", "")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = :uid"
                ),
                {"uid": uid},
            ).fetchone()
            if not row:
                raise HTTPException(404, "User not found")
            ph, sec, en = row[0], row[1], bool(row[2])
            if not en:
                raise HTTPException(400, "2FA is not enabled")
            if not auth.verify_password(req.password, ph):
                raise HTTPException(401, "Invalid password")
            if not sec or not pyotp.TOTP(sec).verify(code, valid_window=1):
                raise HTTPException(400, "Invalid verification code")
            session.execute(
                text(
                    "UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = :uid"
                ),
                {"uid": uid},
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("twofa_disable error: %s", exc)
        raise HTTPException(500, "2FA disable failed")
    return {"disabled": True}


@app.post("/auth/2fa/confirm", response_model=AuthResponse)
async def twofa_confirm(req: TwoFAConfirmBody, request: Request, response: Response):
    """Exchange temp_token (from login) + TOTP for a full access JWT."""
    _check_rate_limit(f"2fa_confirm:{request.client.host}", max_calls=20, window_secs=60)
    try:
        pl = auth.decode_token(req.temp_token.strip())
    except _jwt.ExpiredSignatureError:
        raise HTTPException(401, "Temporary token expired — log in again")
    except _jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid temporary token")
    if pl.get("token_use") != "2fa_pending":
        raise HTTPException(401, "Not a 2FA pending token")
    uid = pl["sub"]
    code = req.code.strip().replace(" ", "")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT username, email, arena_id, wallet_address, totp_secret, totp_enabled "
                    "FROM users WHERE id = :uid"
                ),
                {"uid": uid},
            ).fetchone()
            if not row:
                raise HTTPException(404, "User not found")
            if not row[5] or not row[4]:
                raise HTTPException(400, "2FA not configured")
            if not pyotp.TOTP(row[4]).verify(code, valid_window=1):
                raise HTTPException(400, "Invalid verification code")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("twofa_confirm error: %s", exc)
        raise HTTPException(500, "2FA confirmation failed")

    token = auth.issue_token(uid, row[1], row[0])
    _set_auth_cookie(response, token)
    return AuthResponse(
        access_token=token,
        user_id=uid,
        username=row[0],
        email=row[1],
        arena_id=row[2],
        wallet_address=row[3],
        requires_2fa=False,
    )


# TODO[GOOGLE]: POST /auth/google — verify Google id_token, create/find user by google_id
# (Phase 0 plan). Do NOT implement until Client ID + DB columns google_id / auth_provider exist.

@app.post("/auth/logout", status_code=200)
async def logout(response: Response, payload: dict = Depends(verify_token)):
    """
    Logout — invalidates the client session for the authenticated user.

    JWTs are stateless, so true invalidation requires a blocklist (Phase 6).
    For now: marks all active client_sessions for this user as disconnected,
    AND clears the httpOnly auth cookie so the browser can't re-use it.
    The desktop client should also discard its stored token on receipt of 200.
    """
    _clear_auth_cookie(response)
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "UPDATE client_sessions "
                    "SET status = 'disconnected', disconnected_at = NOW() "
                    "WHERE user_id = :uid AND disconnected_at IS NULL"
                ),
                {"uid": user_id},
            )
            session.commit()
    except Exception as exc:
        logger.debug("logout DB update skipped: %s", exc)

    # Clean in-memory records for this user
    with _client_store_lock:
        to_clear = [
            w for w, r in _client_statuses.items()
            if r.get("user_id") == user_id
        ]
        for w in to_clear:
            _client_statuses.pop(w, None)

    return {"logged_out": True}


@app.get("/auth/steam")
async def steam_auth_start(token: str):
    """
    Redirect the user's browser to Steam OpenID login.
    Pass the JWT as `token` query param so the callback can identify the user.
    """
    params = {
        "openid.ns":         "http://specs.openid.net/auth/2.0",
        "openid.mode":       "checkid_setup",
        "openid.return_to":  f"{ENGINE_BASE_URL}/auth/steam/callback?token={urllib.parse.quote(token, safe='')}",
        "openid.realm":      ENGINE_BASE_URL,
        "openid.identity":   "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    url = "https://steamcommunity.com/openid/login?" + urllib.parse.urlencode(params)
    return RedirectResponse(url, status_code=302)


@app.get("/auth/steam/callback")
async def steam_auth_callback(token: str, request: Request):
    """
    Steam OpenID callback. Verifies the assertion server-to-server, extracts
    the verified Steam64 ID, and saves it to the authenticated user's profile.
    Redirects the browser back to the frontend with ?steam_linked=1 on success.
    """
    error_url = f"{FRONTEND_URL}/profile?steam_error=1"

    # Forward all query params back to Steam for verification
    check_params = dict(request.query_params)
    check_params["openid.mode"] = "check_authentication"

    try:
        async with httpx.AsyncClient(timeout=10.0) as _hc:
            _verify = await _hc.post(
                "https://steamcommunity.com/openid/login",
                data=check_params,
            )
        if "is_valid:true" not in _verify.text:
            return RedirectResponse(error_url, status_code=302)
    except Exception as _e:
        logger.warning("Steam OpenID verification error: %s", _e)
        return RedirectResponse(error_url, status_code=302)

    # Extract Steam64 ID from claimed_id URL
    claimed_id = check_params.get("openid.claimed_id", "")
    steam_id = claimed_id.split("/")[-1]
    if not re.match(r"^7656119\d{10}$", steam_id):
        return RedirectResponse(error_url, status_code=302)

    # Decode token to get user_id
    try:
        payload = auth.decode_token(token)
        user_id = str(payload["sub"])
    except Exception:
        return RedirectResponse(error_url, status_code=302)

    try:
        with SessionLocal() as session:
            # Reject if Steam ID already belongs to another account
            if session.execute(
                text("SELECT 1 FROM users WHERE steam_id = :s AND id != :uid"),
                {"s": steam_id, "uid": user_id},
            ).fetchone():
                return RedirectResponse(f"{FRONTEND_URL}/profile?steam_error=taken", status_code=302)

            # Reject if this Steam ID was attached to an account deleted in the
            # last 24h (identity cooldown — migration 023 `deleted_accounts`).
            try:
                _assert_identifier_cooldown(session, "steam_id", steam_id)
            except HTTPException:
                return RedirectResponse(
                    f"{FRONTEND_URL}/profile?steam_error=cooldown",
                    status_code=302,
                )

            # Block relinking the current user's own steam_id to itself if it's
            # already set and verified — identity is locked post-link.
            current = session.execute(
                text("SELECT steam_id, steam_verified FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            if current and current[0] and current[0] != steam_id:
                # User already has a different Steam ID locked to this account.
                return RedirectResponse(
                    f"{FRONTEND_URL}/profile?steam_error=locked",
                    status_code=302,
                )

            session.execute(
                text(
                    "UPDATE users "
                    "SET steam_id = :s, steam_verified = TRUE, steam_verified_at = NOW() "
                    "WHERE id = :uid"
                ),
                {"s": steam_id, "uid": user_id},
            )
            session.commit()
    except Exception as _e:
        logger.error("Steam link DB error: %s", _e)
        return RedirectResponse(error_url, status_code=302)

    return RedirectResponse(f"{FRONTEND_URL}/profile?steam_linked=1", status_code=302)


@app.get("/auth/discord")
async def discord_auth_start(token: str):
    """Redirect the user's browser to Discord OAuth2 consent screen."""
    if not DISCORD_CLIENT_ID:
        raise HTTPException(503, "Discord OAuth not configured")
    params = {
        "client_id":     DISCORD_CLIENT_ID,
        "redirect_uri":  f"{ENGINE_BASE_URL}/auth/discord/callback",
        "response_type": "code",
        "scope":         "identify email",
        "state":         token,
    }
    url = "https://discord.com/oauth2/authorize?" + urllib.parse.urlencode(params)
    return RedirectResponse(url, status_code=302)


@app.get("/auth/discord/callback")
async def discord_auth_callback(code: str, state: str):
    """Discord OAuth2 callback: exchange code → token → fetch user → save to DB."""
    error_url = f"{FRONTEND_URL}/profile?discord_error=1"

    if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET:
        return RedirectResponse(error_url, status_code=302)

    try:
        async with httpx.AsyncClient(timeout=10.0) as hc:
            token_resp = await hc.post(
                "https://discord.com/api/oauth2/token",
                data={
                    "client_id":     DISCORD_CLIENT_ID,
                    "client_secret": DISCORD_CLIENT_SECRET,
                    "grant_type":    "authorization_code",
                    "code":          code,
                    "redirect_uri":  f"{ENGINE_BASE_URL}/auth/discord/callback",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if token_resp.status_code != 200:
                return RedirectResponse(error_url, status_code=302)

            access_token = token_resp.json().get("access_token")
            if not access_token:
                return RedirectResponse(error_url, status_code=302)

            me_resp = await hc.get(
                "https://discord.com/api/users/@me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if me_resp.status_code != 200:
                return RedirectResponse(error_url, status_code=302)

            discord_data = me_resp.json()
    except Exception as exc:
        logger.warning("Discord OAuth error: %s", exc)
        return RedirectResponse(error_url, status_code=302)

    discord_id = discord_data.get("id", "").strip()
    global_name = discord_data.get("global_name") or discord_data.get("username", "")
    discord_username = f"{global_name}".strip()

    if not discord_id:
        return RedirectResponse(error_url, status_code=302)

    try:
        payload = auth.decode_token(state)
        user_id = str(payload["sub"])
    except Exception:
        return RedirectResponse(error_url, status_code=302)

    try:
        with SessionLocal() as session:
            if session.execute(
                text("SELECT 1 FROM users WHERE discord_id = :d AND id != :uid"),
                {"d": discord_id, "uid": user_id},
            ).fetchone():
                return RedirectResponse(f"{FRONTEND_URL}/profile?discord_error=taken", status_code=302)

            session.execute(
                text(
                    "UPDATE users "
                    "SET discord_id = :d, discord_username = :u, "
                    "    discord_verified = TRUE, discord_verified_at = NOW() "
                    "WHERE id = :uid"
                ),
                {"d": discord_id, "u": discord_username, "uid": user_id},
            )
            session.commit()
    except Exception as exc:
        logger.error("Discord link DB error: %s", exc)
        return RedirectResponse(error_url, status_code=302)

    return RedirectResponse(f"{FRONTEND_URL}/profile?discord_linked=1", status_code=302)


@app.delete("/auth/discord", status_code=200)
async def discord_auth_disconnect(payload: dict = Depends(verify_token)):
    """Remove Discord link from the authenticated user's account."""
    user_id = str(payload["sub"])
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "UPDATE users "
                    "SET discord_id = NULL, discord_username = NULL, "
                    "    discord_verified = FALSE, discord_verified_at = NULL "
                    "WHERE id = :uid"
                ),
                {"uid": user_id},
            )
            session.commit()
    except Exception as exc:
        logger.error("Discord unlink DB error: %s", exc)
        raise HTTPException(500, "Failed to unlink Discord")
    return {"unlinked": True}


# ── FACEIT OAuth2 (PKCE) ──────────────────────────────────────────────────────

def _faceit_pkce_pair() -> tuple[str, str]:
    import hashlib, base64
    verifier  = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def _faceit_states_ensure_table() -> None:
    try:
        with SessionLocal() as s:
            s.execute(text("""
                CREATE TABLE IF NOT EXISTS faceit_oauth_states (
                    nonce        TEXT PRIMARY KEY,
                    jwt_token    TEXT NOT NULL,
                    code_verifier TEXT NOT NULL,
                    expires_at   TIMESTAMPTZ NOT NULL
                )
            """))
            s.commit()
    except Exception as exc:
        logger.error("FACEIT: failed to create faceit_oauth_states table: %s", exc)

_faceit_states_ensure_table()


@app.get("/auth/faceit")
async def faceit_auth_start(token: str):
    """Redirect user to FACEIT OAuth2 consent screen.
    Uses PKCE only for public clients (no client_secret).
    Confidential clients authenticate via client_secret at token exchange.
    """
    if not FACEIT_CLIENT_ID:
        raise HTTPException(503, "FACEIT OAuth not configured")
    use_pkce = not FACEIT_CLIENT_SECRET
    verifier, challenge = (_faceit_pkce_pair() if use_pkce else ("", ""))
    nonce = secrets.token_urlsafe(16)
    with SessionLocal() as s:
        s.execute(text("""
            INSERT INTO faceit_oauth_states (nonce, jwt_token, code_verifier, expires_at)
            VALUES (:n, :j, :v, NOW() + INTERVAL '10 minutes')
            ON CONFLICT (nonce) DO UPDATE SET jwt_token=EXCLUDED.jwt_token,
                code_verifier=EXCLUDED.code_verifier, expires_at=EXCLUDED.expires_at
        """), {"n": nonce, "j": token, "v": verifier})
        s.execute(text("DELETE FROM faceit_oauth_states WHERE expires_at < NOW()"))
        s.commit()
    params: dict = {
        "response_type": "code",
        "client_id":     FACEIT_CLIENT_ID,
        "redirect_uri":  f"{ENGINE_BASE_URL.rstrip('/')}/auth/faceit/callback",
        "scope":         "openid email profile",
        "state":         nonce,
    }
    if use_pkce:
        params["code_challenge"]        = challenge
        params["code_challenge_method"] = "S256"
    url = "https://accounts.faceit.com/oauth/authorize?" + urllib.parse.urlencode(params)
    return RedirectResponse(url, status_code=302)


def _faceit_resp(redirect_url: str, success: bool, wants_json: bool = False):
    if wants_json:
        from fastapi.responses import JSONResponse
        return JSONResponse({"success": success})
    return _faceit_html(redirect_url, success)


def _faceit_html(redirect_url: str, success: bool) -> HTMLResponse:
    s = "true" if success else "false"
    return HTMLResponse(f"""<!DOCTYPE html><html><body><script>
(function(){{
  var ok={s};
  var m={{type:"faceit_linked",success:ok,ts:Date.now()}};
  if(window.opener){{try{{window.opener.postMessage(m,"*");}}catch(e){{}}}}
  window.close();
  setTimeout(function(){{window.location.href="{redirect_url}";}},500);
}})();
</script></body></html>""")


def _faceit_decode_id_token(id_token: str) -> dict | None:
    import base64 as _b64, json as _json
    try:
        parts = id_token.split(".")
        if len(parts) < 2:
            return None
        padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
        return _json.loads(_b64.urlsafe_b64decode(padded))
    except Exception:
        return None


@app.get("/auth/faceit/callback")
async def faceit_auth_callback(
    request: Request,
    state: str,
    code: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    """FACEIT OAuth2 callback: exchange code → token → fetch player → save to DB."""
    error_url = f"{FRONTEND_URL}/profile?faceit_error=1"
    wants_json = "application/json" in request.headers.get("accept", "")

    if error:
        logger.warning("FACEIT callback: provider returned error=%s description=%s", error, error_description)
        return _faceit_resp(error_url, False, wants_json)

    if not code:
        logger.error("FACEIT callback: no code and no error in callback params")
        return _faceit_resp(error_url, False, wants_json)

    if not FACEIT_CLIENT_ID:
        logger.error("FACEIT callback: FACEIT_CLIENT_ID not set")
        return _faceit_resp(error_url, False, wants_json)

    try:
        with SessionLocal() as _s:
            _row = _s.execute(text("""
                DELETE FROM faceit_oauth_states
                WHERE nonce = :nonce AND expires_at > NOW()
                RETURNING jwt_token, code_verifier
            """), {"nonce": state}).fetchone()
            _s.commit()
    except Exception as exc:
        logger.error("FACEIT callback: nonce table query failed: %s", exc)
        return _faceit_resp(error_url, False, wants_json)

    if not _row:
        logger.warning("FACEIT callback: nonce not found or expired (state prefix=%s)", state[:8])
        return _faceit_resp(error_url, False, wants_json)

    jwt_token, code_verifier = _row[0], _row[1]
    redirect_uri = f"{ENGINE_BASE_URL.rstrip('/')}/auth/faceit/callback"

    token_data: dict = {
        "grant_type":   "authorization_code",
        "client_id":    FACEIT_CLIENT_ID,
        "code":         code,
        "redirect_uri": redirect_uri,
    }
    if FACEIT_CLIENT_SECRET:
        token_data["client_secret"] = FACEIT_CLIENT_SECRET
    elif code_verifier:
        token_data["code_verifier"] = code_verifier

    try:
        async with httpx.AsyncClient(timeout=10.0) as hc:
            token_resp = await hc.post(
                "https://accounts.faceit.com/oauth/token",
                data=token_data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if token_resp.status_code != 200:
                logger.error("FACEIT token exchange failed: status=%s body=%s",
                             token_resp.status_code, token_resp.text[:500])
                return _faceit_resp(error_url, False, wants_json)

            token_json = token_resp.json()
            access_token = token_json.get("access_token")
            id_token_raw = token_json.get("id_token")

            if not access_token:
                logger.error("FACEIT token exchange: no access_token in response keys=%s", list(token_json.keys()))
                return _faceit_resp(error_url, False, wants_json)

            userinfo: dict | None = None
            userinfo_resp = await hc.get(
                "https://api.faceit.com/auth/v1/resources/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if userinfo_resp.status_code == 200:
                userinfo = userinfo_resp.json()
            else:
                logger.warning("FACEIT userinfo endpoint failed: status=%s body=%s — trying id_token fallback",
                               userinfo_resp.status_code, userinfo_resp.text[:200])
                if id_token_raw:
                    userinfo = _faceit_decode_id_token(id_token_raw)
                    if userinfo:
                        logger.info("FACEIT: userinfo sourced from id_token")

            if not userinfo:
                logger.error("FACEIT: no userinfo available; access_token present=%s id_token present=%s",
                             bool(access_token), bool(id_token_raw))
                return _faceit_resp(error_url, False, wants_json)

    except Exception as exc:
        logger.error("FACEIT OAuth network error: %s", exc)
        return _faceit_resp(error_url, False, wants_json)

    faceit_id       = (userinfo.get("guid") or userinfo.get("sub") or "").strip()
    faceit_nickname = (userinfo.get("nickname") or userinfo.get("name") or "").strip()

    if not faceit_id:
        logger.error("FACEIT: no user ID in userinfo; available keys=%s", list(userinfo.keys()))
        return _faceit_resp(error_url, False, wants_json)

    faceit_elo, faceit_level = None, None
    if FACEIT_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=8.0) as hc:
                player_resp = await hc.get(
                    f"https://open.faceit.com/data/v4/players/{faceit_id}",
                    headers={"Authorization": f"Bearer {FACEIT_API_KEY}"},
                )
                if player_resp.status_code == 200:
                    pd = player_resp.json()
                    games = pd.get("games", {})
                    cs2   = games.get("cs2") or games.get("csgo") or {}
                    faceit_elo   = cs2.get("faceit_elo")
                    faceit_level = cs2.get("skill_level")
        except Exception:
            pass

    try:
        payload  = auth.decode_token(jwt_token)
        user_id  = str(payload["sub"])
    except Exception as exc:
        logger.error("FACEIT callback: JWT decode failed: %s", exc)
        return _faceit_resp(error_url, False, wants_json)

    try:
        with SessionLocal() as session:
            if session.execute(
                text("SELECT 1 FROM users WHERE faceit_id = :f AND id != :uid"),
                {"f": faceit_id, "uid": user_id},
            ).fetchone():
                return _faceit_resp(f"{FRONTEND_URL}/profile?faceit_error=taken", False, wants_json)

            session.execute(
                text(
                    "UPDATE users "
                    "SET faceit_id = :f, faceit_nickname = :n, "
                    "    faceit_elo = :e, faceit_level = :l, "
                    "    faceit_verified = TRUE, faceit_verified_at = NOW() "
                    "WHERE id = :uid"
                ),
                {"f": faceit_id, "n": faceit_nickname,
                 "e": faceit_elo, "l": faceit_level, "uid": user_id},
            )
            session.commit()
    except Exception as exc:
        logger.error("FACEIT link DB error: %s", exc)
        return _faceit_resp(error_url, False, wants_json)

    return _faceit_resp(f"{FRONTEND_URL}/profile?faceit_linked=1", True, wants_json)


@app.delete("/auth/faceit", status_code=200)
async def faceit_auth_disconnect(payload: dict = Depends(verify_token)):
    """Remove FACEIT link from the authenticated user's account."""
    user_id = str(payload["sub"])
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "UPDATE users "
                    "SET faceit_id = NULL, faceit_nickname = NULL, "
                    "    faceit_elo = NULL, faceit_level = NULL, "
                    "    faceit_verified = FALSE, faceit_verified_at = NULL "
                    "WHERE id = :uid"
                ),
                {"uid": user_id},
            )
            session.commit()
    except Exception as exc:
        logger.error("FACEIT unlink DB error: %s", exc)
        raise HTTPException(500, "Failed to unlink FACEIT")
    return {"unlinked": True}


@app.post("/auth/riot", status_code=200)
async def riot_save(riot_id: str = Body(..., embed=True), payload: dict = Depends(verify_token)):
    """Save a Riot ID (Name#TAG) for the authenticated user — format-validated, uniqueness-checked."""
    user_id = str(payload["sub"])
    rid = riot_id.strip()
    fmt_err = auth.validate_riot_id(rid)
    if fmt_err:
        raise HTTPException(400, fmt_err)
    try:
        with SessionLocal() as session:
            conflict = session.execute(
                text("SELECT id FROM users WHERE riot_id = :r AND id != :uid"),
                {"r": rid, "uid": user_id},
            ).fetchone()
            if conflict:
                raise HTTPException(409, "This Riot ID is already linked to another account")
            session.execute(
                text(
                    "UPDATE users "
                    "SET riot_id = :r, riot_verified = TRUE, riot_verified_at = NOW() "
                    "WHERE id = :uid"
                ),
                {"r": rid, "uid": user_id},
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Riot save DB error: %s", exc)
        raise HTTPException(500, "Failed to save Riot ID")
    return {"linked": True, "riot_id": rid}


@app.delete("/auth/riot", status_code=200)
async def riot_disconnect(payload: dict = Depends(verify_token)):
    """Remove Riot ID link from the authenticated user's account."""
    user_id = str(payload["sub"])
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "UPDATE users "
                    "SET riot_id = NULL, riot_verified = FALSE, riot_verified_at = NULL "
                    "WHERE id = :uid"
                ),
                {"uid": user_id},
            )
            session.commit()
    except Exception as exc:
        logger.error("Riot unlink DB error: %s", exc)
        raise HTTPException(500, "Failed to unlink Riot ID")
    return {"unlinked": True}


# ── Email verification ─────────────────────────────────────────────────────────

@app.get("/auth/verify-email")
async def verify_email(token: str = Query(...)):
    """Click-link from verification email → marks email_verified=TRUE → redirect to frontend."""
    import uuid as _uuid
    try:
        _uuid.UUID(token)
    except ValueError:
        raise HTTPException(400, "Invalid verification token")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id, username FROM users "
                    "WHERE verification_token = :t "
                    "  AND verification_token_expires_at > NOW() "
                    "  AND email_verified = FALSE"
                ),
                {"t": token},
            ).fetchone()
            if not row:
                from fastapi.responses import RedirectResponse
                return RedirectResponse(f"{FRONTEND_URL}/auth?verified=expired")
            session.execute(
                text(
                    "UPDATE users "
                    "SET email_verified = TRUE, verification_token = NULL, "
                    "    verification_token_expires_at = NULL "
                    "WHERE id = :uid"
                ),
                {"uid": str(row[0])},
            )
            session.commit()
    except Exception as exc:
        logger.error("verify_email DB error: %s", exc)
        raise HTTPException(500, "Verification failed")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(f"{FRONTEND_URL}/auth?verified=1")


@app.post("/auth/resend-verification", status_code=200)
async def resend_verification(request: Request):
    """Resend verification email for unverified account."""
    import uuid as _uuid
    _check_rate_limit(f"resend_verify:{request.client.host}", max_calls=3, window_secs=300)
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "email required")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id, username FROM users WHERE lower(email) = :e AND email_verified = FALSE"),
                {"e": email},
            ).fetchone()
            if not row:
                return {"sent": True}  # silent: don't reveal whether email exists
            new_token = str(_uuid.uuid4())
            session.execute(
                text(
                    "UPDATE users SET verification_token = :t, "
                    "verification_token_expires_at = NOW() + INTERVAL '24 hours' "
                    "WHERE id = :uid"
                ),
                {"t": new_token, "uid": str(row[0])},
            )
            session.commit()
    except Exception as exc:
        logger.error("resend_verification DB error: %s", exc)
        raise HTTPException(500, "Failed to resend")
    await asyncio.to_thread(send_verification_email, email, row[1], new_token)
    return {"sent": True}


@app.post("/auth/request-email-change", status_code=200)
async def request_email_change(request: Request, payload: dict = Depends(verify_token)):
    """Initiate email change: verify password, send confirmation to new address."""
    import uuid as _uuid
    user_id = str(payload["sub"])
    body = await request.json()
    new_email  = (body.get("new_email") or "").strip().lower()
    password   = body.get("password") or ""
    if not new_email or not password:
        raise HTTPException(400, "new_email and password required")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT username, email, password_hash, auth_provider FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            if not row:
                raise HTTPException(404, "User not found")
            if row[3] == "google":
                raise HTTPException(400, "Google accounts cannot change email here")
            if not auth.verify_password(password, row[2]):
                raise HTTPException(401, "Incorrect password")
            if new_email == row[1]:
                raise HTTPException(400, "That is already your current email")
            conflict = session.execute(
                text("SELECT 1 FROM users WHERE lower(email) = :e AND id != :uid"),
                {"e": new_email, "uid": user_id},
            ).fetchone()
            if conflict:
                raise HTTPException(409, "That email is already in use")
            token = str(_uuid.uuid4())
            session.execute(
                text(
                    "UPDATE users SET pending_email = :pe, pending_email_token = :t, "
                    "pending_email_token_expires_at = NOW() + INTERVAL '24 hours' "
                    "WHERE id = :uid"
                ),
                {"pe": new_email, "t": token, "uid": user_id},
            )
            session.commit()
            username = row[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("request_email_change DB error: %s", exc)
        raise HTTPException(500, "Failed to initiate email change")
    await asyncio.to_thread(send_email_change_email, new_email, username, token)
    return {"sent": True}


@app.get("/auth/verify-email-change")
async def verify_email_change(token: str = Query(...)):
    """Click-link from email-change email → updates users.email → redirect to settings."""
    import uuid as _uuid
    try:
        _uuid.UUID(token)
    except ValueError:
        raise HTTPException(400, "Invalid token")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM users "
                    "WHERE pending_email_token = :t "
                    "  AND pending_email_token_expires_at > NOW()"
                ),
                {"t": token},
            ).fetchone()
            if not row:
                from fastapi.responses import RedirectResponse
                return RedirectResponse(f"{FRONTEND_URL}/settings?email_changed=expired")
            session.execute(
                text(
                    "UPDATE users "
                    "SET email = pending_email, email_verified = TRUE, "
                    "    pending_email = NULL, pending_email_token = NULL, "
                    "    pending_email_token_expires_at = NULL "
                    "WHERE id = :uid"
                ),
                {"uid": str(row[0])},
            )
            session.commit()
    except Exception as exc:
        logger.error("verify_email_change DB error: %s", exc)
        raise HTTPException(500, "Failed to confirm email change")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(f"{FRONTEND_URL}/settings?email_changed=1")


@app.post("/auth/forgot-password", status_code=200)
async def forgot_password(request: Request):
    """Send a password-reset link to the given email. Always returns 200 (no user enumeration)."""
    import uuid as _uuid
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "email required")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id, username, auth_provider FROM users WHERE lower(email) = :e"),
                {"e": email},
            ).fetchone()
            if not row:
                return {"sent": True}
            if row[2] == "google":
                return {"sent": True}
            token = str(_uuid.uuid4())
            session.execute(
                text(
                    "UPDATE users SET password_reset_token = :t, "
                    "password_reset_token_expires_at = NOW() + INTERVAL '1 hour' "
                    "WHERE id = :uid"
                ),
                {"t": token, "uid": str(row[0])},
            )
            session.commit()
            username = row[1]
    except Exception as exc:
        logger.error("forgot_password DB error: %s", exc)
        return {"sent": True}
    await asyncio.to_thread(send_password_reset_email, email, username, token)
    return {"sent": True}


@app.post("/auth/reset-password", status_code=200)
async def reset_password(request: Request):
    """Validate reset token and set new password."""
    import uuid as _uuid
    body = await request.json()
    token       = (body.get("token") or "").strip()
    new_password = body.get("new_password") or ""
    if not token or not new_password:
        raise HTTPException(400, "token and new_password required")
    if len(new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    try:
        _uuid.UUID(token)
    except ValueError:
        raise HTTPException(400, "Invalid token")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM users "
                    "WHERE password_reset_token = :t "
                    "  AND password_reset_token_expires_at > NOW()"
                ),
                {"t": token},
            ).fetchone()
            if not row:
                raise HTTPException(400, "invalid_or_expired_token")
            new_hash = auth.hash_password(new_password)
            session.execute(
                text(
                    "UPDATE users "
                    "SET password_hash = :h, "
                    "    password_reset_token = NULL, "
                    "    password_reset_token_expires_at = NULL "
                    "WHERE id = :uid"
                ),
                {"h": new_hash, "uid": str(row[0])},
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("reset_password DB error: %s", exc)
        raise HTTPException(500, "Failed to reset password")
    return {"reset": True}


@app.get("/users/me/faceit-stats")
async def get_faceit_stats(payload: dict = Depends(verify_token)):
    """Fetch live FACEIT stats for the authenticated user from FACEIT Data API."""
    if not FACEIT_API_KEY:
        raise HTTPException(503, "FACEIT API not configured")

    user_id = str(payload["sub"])
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT faceit_id, faceit_nickname FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
    except Exception:
        raise HTTPException(500, "DB error")

    if not row or not row[0]:
        raise HTTPException(404, "FACEIT account not linked")

    faceit_id       = row[0]
    faceit_nickname = row[1] or ""

    try:
        async with httpx.AsyncClient(timeout=8.0) as hc:
            player_resp, stats_resp = await asyncio.gather(
                hc.get(
                    f"https://open.faceit.com/data/v4/players/{faceit_id}",
                    headers={"Authorization": f"Bearer {FACEIT_API_KEY}"},
                ),
                hc.get(
                    f"https://open.faceit.com/data/v4/players/{faceit_id}/stats/cs2",
                    headers={"Authorization": f"Bearer {FACEIT_API_KEY}"},
                ),
            )
    except Exception as exc:
        logger.warning("FACEIT Data API error: %s", exc)
        raise HTTPException(502, "FACEIT API unavailable")

    player_data = player_resp.json() if player_resp.status_code == 200 else {}
    stats_data  = stats_resp.json()  if stats_resp.status_code == 200  else {}

    games    = player_data.get("games", {})
    cs2_game = games.get("cs2") or games.get("csgo") or {}
    lifetime = stats_data.get("lifetime", {})

    return {
        "nickname":    faceit_nickname,
        "avatar":      player_data.get("avatar"),
        "country":     player_data.get("country"),
        "elo":         cs2_game.get("faceit_elo"),
        "level":       cs2_game.get("skill_level"),
        "matches":     lifetime.get("Matches"),
        "win_rate":    lifetime.get("Win Rate %"),
        "kd_ratio":    lifetime.get("Average K/D Ratio"),
        "headshots":   lifetime.get("Average Headshots %"),
        "faceit_url":  player_data.get("faceit_url", "").replace("{lang}", "en"),
    }


@app.post("/client/bind", status_code=200)
async def client_bind(req: BindRequest, payload: dict = Depends(verify_token)):
    """
    Bind a desktop client session to an authenticated user.

    Called by the website after login when it detects a client is online.
    Writes user_id into client_sessions so GET /client/status returns user_id.

    Flow:
      1. User logs in on website → receives JWT
      2. Website calls GET /client/status → gets session_id
      3. Website calls POST /client/bind {session_id} + Bearer <token>
      4. Engine writes user_id → client_sessions row
    """
    user_id: str = payload["sub"]
    session_id: str = req.session_id

    # ── DB write ──────────────────────────────────────────────
    try:
        with SessionLocal() as session:
            # Allow binding to a previously-disconnected session so that
            # re-login after sign-out works immediately (before the next heartbeat).
            row = session.execute(
                text("SELECT id, user_id FROM client_sessions WHERE id = :sid"),
                {"sid": session_id},
            ).fetchone()

            if not row:
                raise HTTPException(404, "Session not found")

            existing_user = str(row[1]) if row[1] else None
            if existing_user and existing_user != user_id:
                raise HTTPException(403, "Session already bound to a different user")

            # Bind user_id and clear disconnected_at — this re-activates the session
            # for a client that just re-logged in after a sign-out.
            session.execute(
                text(
                    "UPDATE client_sessions "
                    "SET user_id = :uid, disconnected_at = NULL "
                    "WHERE id = :sid"
                ),
                {"uid": user_id, "sid": session_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("client_bind error: %s", exc)
        raise HTTPException(500, "Bind failed")

    # ── Mirror into in-memory ────────────────────────────────
    with _client_store_lock:
        for record in _client_statuses.values():
            if record.get("session_id") == session_id:
                record["user_id"] = user_id
                break

    return {"bound": True, "user_id": user_id, "session_id": session_id}


# ── Match lifecycle ───────────────────────────────────────────────────────────

_VALID_GAMES = {"CS2", "Valorant"}


def _normalize_game(raw: str) -> str:
    """Normalise game name to canonical form ('CS2' or 'Valorant')."""
    mapping = {"cs2": "CS2", "valorant": "Valorant"}
    return mapping.get(raw.strip().lower(), raw.strip())


_IDENTIFIER_COOLDOWN_HOURS = 24

_COOLDOWN_COLUMN_MAP = {
    # Logical name → (deleted_accounts column, human-readable label)
    "steam_id":       ("steam_id",       "Steam ID"),
    "riot_id":        ("riot_id",        "Riot ID"),
    "wallet_address": ("wallet_address", "Wallet address"),
    "email":          ("email_hash",     "Email"),
    "username":       ("username_hash",  "Username"),
}


def _assert_identifier_cooldown(session, field: str, value: str) -> None:
    """
    Reject re-use of an identifier within 24h of an account deletion.

    `value` is the raw value for steam_id / riot_id / wallet_address, or the
    already-sha256-hashed string for email / username (since deleted_accounts
    stores email_hash / username_hash, not plaintext).

    DB-ready: reads from deleted_accounts (migration 023).
    Raises HTTPException(409) with a deterministic "retry after" timestamp.
    """
    try:
        col, label = _COOLDOWN_COLUMN_MAP[field]
    except KeyError:
        # Programmer error — fail loudly.
        raise RuntimeError(f"_assert_identifier_cooldown: unknown field {field!r}")

    row = session.execute(
        text(
            f"SELECT deleted_at FROM deleted_accounts "
            f"WHERE {col} = :v "
            f"  AND deleted_at > NOW() - INTERVAL '{_IDENTIFIER_COOLDOWN_HOURS} hours' "
            f"ORDER BY deleted_at DESC LIMIT 1"
        ),
        {"v": value},
    ).fetchone()
    if row:
        retry_at = row[0] + timedelta(hours=_IDENTIFIER_COOLDOWN_HOURS)
        raise HTTPException(
            409,
            f"{label} is in a {_IDENTIFIER_COOLDOWN_HOURS}-hour cooldown after a "
            f"previous account deletion. Available again at "
            f"{retry_at.isoformat(timespec='seconds')}.",
        )


def _assert_game_account(
    game: str,
    steam_id: str | None,
    riot_id: str | None,
    steam_verified: bool = False,
    riot_verified: bool = False,
) -> None:
    """
    Raise HTTPException(403) if the user is not verified for the requested game.

    CS2      → steam_verified must be TRUE (linked via Steam OpenID)
    Valorant → riot_verified must be TRUE (linked via Riot OAuth — coming soon)
    """
    if game == "CS2":
        if not steam_id or not steam_verified:
            raise HTTPException(
                403,
                "Your Steam account must be verified to create or join CS2 matches. "
                "Go to Profile → Connections → Steam → Connect."
            )
    if game == "Valorant":
        if not riot_id or not riot_verified:
            raise HTTPException(
                403,
                "Your Riot account must be verified to create or join Valorant matches. "
                "Go to Profile → Connections → Riot Games → Connect."
            )


def _assert_usdt_balance(wallet_address: str, required_usdt: float) -> None:
    """
    Verify wallet_address holds at least required_usdt USDT on-chain.
    Raises HTTPException(400) if balance is insufficient.
    Skips silently if BLOCKCHAIN_RPC_URL or USDT_CONTRACT_ADDRESS not set
    (fail-open so dev/test environments without RPC still work).

    CONTRACT-ready: ERC20 balanceOf() on BSC — 18 decimals.
    """
    from src.config import BLOCKCHAIN_RPC_URL, USDT_CONTRACT_ADDRESS
    if not BLOCKCHAIN_RPC_URL or not USDT_CONTRACT_ADDRESS:
        logger.debug("_assert_usdt_balance: RPC/USDT contract not configured, skipping")
        return
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider(BLOCKCHAIN_RPC_URL))
        abi = [{
            "inputs": [{"name": "account", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function",
        }]
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(USDT_CONTRACT_ADDRESS), abi=abi
        )
        balance_wei = contract.functions.balanceOf(
            Web3.to_checksum_address(wallet_address)
        ).call()
        balance_usdt = balance_wei / 10 ** 18   # USDT on BSC: 18 decimals
        if balance_usdt < required_usdt:
            raise HTTPException(
                400,
                f"Insufficient USDT balance. Need {required_usdt} USDT, "
                f"your wallet has {balance_usdt:.4f} USDT.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("_assert_usdt_balance: on-chain check failed, skipping: %s", exc)


_VALID_MODES = {"1v1", "2v2", "4v4", "5v5"}


class CreateMatchRequest(BaseModel):
    """
    POST /matches — create a new match lobby.

    Field names mirror infra/sql/init.sql exactly:
      game         → matches.game  (game enum: 'CS2' | 'Valorant' | …)
      stake_amount → matches.bet_amount  (NUMERIC, must be > 0; CHECK enforced by DB)
      mode         → matches.mode  (match_mode enum: '1v1' | '2v2' | '4v4' | '5v5')
      match_type   → matches.type  (match_type enum: 'public' | 'custom')
      password     → matches.password  (optional; stored bcrypt-hashed)

    DB-ready: writes to matches + match_players tables.
    CONTRACT-ready: stake_amount → ArenaEscrow.lockStake() once wallet is linked.
    """
    game: str = "CS2"                # "CS2" | "Valorant"
    # H3: reject non-positive stakes at the edge (was silently clamped to 0.01).
    stake_amount: float = Field(default=1.0, gt=0)
    mode: str = "1v1"                # "1v1" | "2v2" | "4v4" | "5v5"
    match_type: str = "custom"       # "public" | "custom"
    stake_currency: str = "CRYPTO"   # "CRYPTO" (ETH/BNB via escrow) | "AT" (Arena Tokens)
    password: str | None = None      # optional room password (stored in matches.password)
    on_chain_match_id: int | None = None  # ArenaEscrow matchId — sent immediately from frontend receipt


class JoinMatchRequest(BaseModel):
    """
    POST /matches/{match_id}/join — optional room password + optional team preference.

    team: "A" | "B" | None
      When provided, the server honors the preference if that team still has a free
      slot (returns 409 if full so the client can show "Team X is full").
      When omitted, the server auto-assigns (fills A first, then B).

    on_chain_match_id: provided ONLY by the first joiner of a public CRYPTO room.
      The system user created the DB room with no on-chain ID. The first player
      calls createMatch on-chain and passes the resulting matchId here so the
      server can link the contract match to this DB room immediately (no EscrowClient lag).
    """
    password: str | None = None
    team: str | None = None  # "A" | "B" — optional; honored if slot available
    on_chain_match_id: int | None = None  # public CRYPTO rooms only — first joiner sets this


_VALID_CURRENCIES = {"CRYPTO", "AT"}
_AT_FEE_PCT = 0.05  # 5% platform fee on AT match winnings — mirrors ArenaEscrow fee


def _verify_room_password(submitted: str | None, stored: str | None) -> bool:
    """Constant-time room password check. Supports bcrypt (H1) + legacy plaintext.

    Returns True when:
      - stored is empty/NULL (no password required), or
      - submitted matches stored (bcrypt.checkpw when hashed, hmac.compare_digest
        for legacy plaintext still in DB before the cycle-out completes).
    """
    if not stored:
        return True
    submitted_s = submitted or ""
    if stored.startswith("$2"):
        try:
            return auth.verify_password(submitted_s, stored)
        except Exception:
            return False
    return _hmac.compare_digest(submitted_s, stored)

# ── M8 Kill Switch ─────────────────────────────────────────────────────────────
# When True: all payout disbursement is suspended (AT credit + CRYPTO on-chain).
# Match is still marked completed with winner_id set — only fund release is frozen.
# Toggle via POST /admin/freeze  (admin-only).
_PAYOUTS_FROZEN: bool = False


AT_DAILY_STAKE_LIMIT = 50000  # $500/day default (1 AT = $0.01 → 50,000 AT = $500)
_at_daily_limit: int = AT_DAILY_STAKE_LIMIT  # runtime cache — reloaded from platform_config at startup

# CRYPTO / USDT escrow — separate daily cap (platform_config key daily_bet_max_usdt), not mixed with AT units.
USDT_DAILY_STAKE_LIMIT_DEFAULT = 500.0
_at_daily_usdt_limit: float = USDT_DAILY_STAKE_LIMIT_DEFAULT

# GitHub #40 — optional risk caps (0 = feature off). Loaded from platform_config via _reload_risk_limits().
_high_stakes_daily_max: int = 0
_high_stakes_min_bet_at: int = 25000
_high_stakes_min_bet_usdt: float = 100.0
_daily_loss_cap_at: int = 0
_daily_loss_cap_usdt: float = 0.0

# AML / fraud report thresholds (Issue #57) — loaded from platform_config via _reload_fraud_detection_config().
# Pair farming: same two players with COUNT(*) > fraud_pair_match_gt within fraud_pair_window_hours.
# Intentional losing: directional losses >= fraud_intentional_loss_min_count within fraud_intentional_loss_days.
_fraud_pair_match_gt: int = 3
_fraud_pair_window_hours: int = 24
_fraud_intentional_loss_min_count: int = 5
_fraud_intentional_loss_days: int = 7


def _fraud_report_bind_params() -> dict[str, int]:
    """Bound params for fraud SQL (integers only — safe for make_interval / HAVING)."""
    return {
        "fraud_pair_gt": _fraud_pair_match_gt,
        "fraud_pair_hours": _fraud_pair_window_hours,
        "fraud_loss_min": _fraud_intentional_loss_min_count,
        "fraud_loss_days": _fraud_intentional_loss_days,
    }


def _reload_fraud_detection_config() -> None:
    """Load fraud_* keys from platform_config. Non-fatal on DB errors."""
    global _fraud_pair_match_gt, _fraud_pair_window_hours
    global _fraud_intentional_loss_min_count, _fraud_intentional_loss_days
    try:
        with SessionLocal() as s:

            def _cfg_int_clamped(key: str, default: int, lo: int, hi: int) -> int:
                row = s.execute(
                    text("SELECT value FROM platform_config WHERE key = :k"),
                    {"k": key},
                ).fetchone()
                if not row or row[0] is None or str(row[0]).strip() == "":
                    v = default
                else:
                    v = int(float(row[0]))
                return max(lo, min(hi, v))

            _fraud_pair_match_gt = _cfg_int_clamped("fraud_pair_match_gt", 3, 1, 500)
            _fraud_pair_window_hours = _cfg_int_clamped("fraud_pair_window_hours", 24, 1, 8760)
            _fraud_intentional_loss_min_count = _cfg_int_clamped(
                "fraud_intentional_loss_min_count", 5, 2, 500
            )
            _fraud_intentional_loss_days = _cfg_int_clamped("fraud_intentional_loss_days", 7, 1, 365)
    except Exception:
        pass


def _reload_at_daily_limit() -> None:
    """
    Load daily_bet_max_at from platform_config (key-value table, migration 017).
    Called at startup and after admin updates the value via PUT /platform/config.
    Non-fatal: leaves _at_daily_limit unchanged if DB is unavailable.
    """
    global _at_daily_limit
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM platform_config WHERE key = 'daily_bet_max_at'")
            ).fetchone()
            if row and row[0]:
                _at_daily_limit = max(1, int(float(row[0])))
    except Exception:
        pass


def _reload_at_daily_usdt_limit() -> None:
    """Load daily_bet_max_usdt from platform_config (USDT per rolling 24h for CRYPTO matches)."""
    global _at_daily_usdt_limit
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM platform_config WHERE key = 'daily_bet_max_usdt'")
            ).fetchone()
            if row and row[0]:
                _at_daily_usdt_limit = max(0.01, float(row[0]))
    except Exception:
        pass


def _reload_risk_limits() -> None:
    """Load high-stakes + daily loss caps from platform_config (Issue #40)."""
    global _high_stakes_daily_max, _high_stakes_min_bet_at, _high_stakes_min_bet_usdt
    global _daily_loss_cap_at, _daily_loss_cap_usdt
    try:
        with SessionLocal() as s:

            def _cfg_int(key: str, default: int) -> int:
                row = s.execute(
                    text("SELECT value FROM platform_config WHERE key = :k"),
                    {"k": key},
                ).fetchone()
                if not row or row[0] is None or str(row[0]).strip() == "":
                    return default
                return max(0, int(float(row[0])))

            def _cfg_float(key: str, default: float) -> float:
                row = s.execute(
                    text("SELECT value FROM platform_config WHERE key = :k"),
                    {"k": key},
                ).fetchone()
                if not row or row[0] is None or str(row[0]).strip() == "":
                    return default
                return max(0.0, float(row[0]))

            _high_stakes_daily_max = _cfg_int("high_stakes_daily_max", 0)
            _high_stakes_min_bet_at = max(1, _cfg_int("high_stakes_min_bet_at", 25000))
            _high_stakes_min_bet_usdt = max(0.01, _cfg_float("high_stakes_min_bet_usdt", 100.0))
            _daily_loss_cap_at = _cfg_int("daily_loss_cap_at", 0)
            _daily_loss_cap_usdt = _cfg_float("daily_loss_cap_usdt", 0.0)
    except Exception:
        pass


def _get_daily_limit(_session=None) -> int:
    """Return the current daily AT stake limit from the in-memory cache."""
    return _at_daily_limit


def _get_daily_limit_usdt() -> float:
    """Return the current daily USDT stake limit from the in-memory cache."""
    return _at_daily_usdt_limit


def _get_daily_staked(session, user_id: str) -> int:
    """
    Sum of AT bet_amount in COMPLETED matches in the last 24 hours for this user.

    Only status='completed' matches count — cancelled / in-progress rooms are excluded.
    This means opening and cancelling a lobby does NOT consume the daily limit.
    The limit is consumed only when a match finishes (win or loss).

    DB-ready: uses matches JOIN match_players.
    CONTRACT-ready Phase 6: extend with stake_currency='CRYPTO' when on-chain.
    """
    try:
        row = session.execute(
            text(
                "SELECT COALESCE(SUM(m.bet_amount), 0) "
                "FROM matches m "
                "JOIN match_players mp ON mp.match_id = m.id "
                "WHERE mp.user_id = :uid "
                "  AND m.stake_currency = 'AT' "
                "  AND m.status = 'completed' "
                "  AND m.ended_at > NOW() - INTERVAL '24 hours'"
            ),
            {"uid": user_id},
        ).fetchone()
        return int(row[0]) if row else 0
    except (TypeError, ValueError, Exception):
        return 0


def _get_daily_staked_usdt(session, user_id: str) -> float:
    """
    Sum of USDT bet_amount in COMPLETED CRYPTO matches in the last 24 hours for this user.

    Same rules as AT: only status='completed', stake_currency='CRYPTO'.
    """
    try:
        row = session.execute(
            text(
                "SELECT COALESCE(SUM(m.bet_amount), 0) "
                "FROM matches m "
                "JOIN match_players mp ON mp.match_id = m.id "
                "WHERE mp.user_id = :uid "
                "  AND m.stake_currency = 'CRYPTO' "
                "  AND m.status = 'completed' "
                "  AND m.ended_at > NOW() - INTERVAL '24 hours'"
            ),
            {"uid": user_id},
        ).fetchone()
        return float(row[0]) if row else 0.0
    except (TypeError, ValueError, Exception):
        return 0.0


def _check_daily_stake_limit(session, user_id: str, new_stake: int) -> None:
    """
    M8: Block match create/join if staking new_stake would exceed the daily cap.
    Limit comes from _at_daily_limit (loaded from platform_config at startup).
    Admin changes via PUT /platform/config take effect immediately (reloads cache).
    Covers AT stakes now; CRYPTO stakes added in Phase 6 via crypto_escrow_lock type.
    """
    limit        = _at_daily_limit
    daily_staked = _get_daily_staked(session, user_id)
    if daily_staked + new_stake > limit:
        remaining = max(0, limit - daily_staked)
        raise HTTPException(
            429,
            f"Daily staking limit reached. "
            f"You can stake up to {remaining} more AT today "
            f"(limit: {limit} AT / 24h = ${limit // 100}).",
        )


def _check_daily_usdt_stake_limit(session, user_id: str, new_stake_usdt: float) -> None:
    """
    Block match create/join for CRYPTO when new USDT stake would exceed the daily cap.
    Limit from _at_daily_usdt_limit (platform_config daily_bet_max_usdt).
    """
    if new_stake_usdt <= 0:
        return
    limit = _at_daily_usdt_limit
    daily_staked = _get_daily_staked_usdt(session, user_id)
    if daily_staked + new_stake_usdt > limit + 1e-9:
        remaining = max(0.0, limit - daily_staked)
        raise HTTPException(
            429,
            f"Daily USDT staking limit reached. "
            f"You can stake up to {remaining:.2f} more USDT today "
            f"(limit: {limit:.2f} USDT / 24h, completed CRYPTO matches only).",
        )


def _check_high_stakes_daily_cap(session, user_id: str, stake_currency: str, bet_amount: float) -> None:
    """
    Block create/join/invite when the room stake qualifies as high-stakes and the user
    already completed `high_stakes_daily_max` such matches in the last 24 hours.
    Disabled when high_stakes_daily_max == 0.
    """
    if _high_stakes_daily_max <= 0 or bet_amount <= 0:
        return
    sc = (stake_currency or "CRYPTO").upper()
    if sc == "AT":
        if bet_amount < float(_high_stakes_min_bet_at):
            return
        n = count_completed_high_stakes_matches(
            session, user_id, stake_currency="AT", min_bet=float(_high_stakes_min_bet_at)
        )
    elif sc == "CRYPTO":
        if bet_amount < _high_stakes_min_bet_usdt - 1e-9:
            return
        n = count_completed_high_stakes_matches(
            session, user_id, stake_currency="CRYPTO", min_bet=_high_stakes_min_bet_usdt
        )
    else:
        return
    if n >= _high_stakes_daily_max:
        raise HTTPException(
            429,
            f"Daily high-stakes match limit reached ({_high_stakes_daily_max} completed "
            f"matches per 24h with stake ≥ threshold). Try a lower stake or wait.",
        )


def _check_daily_loss_cap(session, user_id: str, stake_currency: str, new_stake: float) -> None:
    """
    Block when today's realized losses + potential loss from this stake would exceed cap.
    Disabled when daily_loss_cap_* == 0.
    """
    if new_stake <= 0:
        return
    sc = (stake_currency or "CRYPTO").upper()
    if sc == "AT":
        cap = _daily_loss_cap_at
        if cap <= 0:
            return
        lost = sum_daily_match_losses(session, user_id, stake_currency="AT")
        if lost + new_stake > cap:
            rem = max(0, cap - int(lost))
            raise HTTPException(
                429,
                f"Daily AT loss limit reached. You can risk up to {rem} more AT today "
                f"(cap: {cap} AT lost in completed matches / 24h).",
            )
    elif sc == "CRYPTO":
        cap = _daily_loss_cap_usdt
        if cap <= 0:
            return
        lost = sum_daily_match_losses(session, user_id, stake_currency="CRYPTO")
        if lost + new_stake > cap + 1e-9:
            rem = max(0.0, cap - lost)
            raise HTTPException(
                429,
                f"Daily USDT loss limit reached. You can risk up to {rem:.2f} more USDT today "
                f"(cap: {cap:.2f} USDT lost in completed matches / 24h).",
            )


def _assert_not_suspended(session, user_id: str) -> None:
    """
    M8: Raise 403 if player has an active suspension or a permanent ban.

    Reads the most recent row from player_penalties for the user.
    - banned_at IS NOT NULL → permanent ban → 403
    - suspended_until > NOW() → active suspension → 403 with expiry time

    DB-ready: player_penalties table (migration 016).
    """
    row = session.execute(
        text(
            "SELECT suspended_until, banned_at FROM player_penalties "
            "WHERE user_id = :uid ORDER BY created_at DESC LIMIT 1"
        ),
        {"uid": user_id},
    ).fetchone()
    if not row:
        return
    suspended_until, banned_at = row
    if banned_at:
        raise HTTPException(403, "Your account has been permanently banned.")
    if suspended_until and suspended_until > datetime.now(timezone.utc):
        raise HTTPException(
            403,
            f"Your account is suspended until "
            f"{suspended_until.strftime('%Y-%m-%d %H:%M UTC')}.",
        )


def _assert_at_balance(session, user_id: str, required: int) -> None:
    """
    Raise 402 if user's at_balance < required AT.

    Uses SELECT ... FOR UPDATE to lock the users row for the remainder of the
    caller's transaction, so the subsequent _deduct_at cannot be raced by a
    concurrent withdrawal / join / challenge that reads the same balance and
    bypasses the check (C12).
    """
    row = session.execute(
        text("SELECT at_balance FROM users WHERE id = :uid FOR UPDATE"),
        {"uid": user_id},
    ).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    if int(row[0]) < required:
        raise HTTPException(
            402,
            f"Insufficient Arena Tokens — you need {required} AT but have {int(row[0])} AT.",
        )


def _cleanup_report_attachments_for_ticket(session, ticket_id: str) -> None:
    """Remove attachment files on disk and DB rows for a support ticket."""
    rows = session.execute(
        text("SELECT file_path FROM report_attachments WHERE ticket_id = :tid"),
        {"tid": ticket_id},
    ).fetchall()
    root = os.path.abspath(UPLOAD_REPORTS_DIR)
    for (fp,) in rows:
        if not fp:
            continue
        try:
            abs_fp = os.path.abspath(fp)
            if abs_fp.startswith(root) and os.path.isfile(abs_fp):
                os.remove(abs_fp)
        except OSError:
            pass
    session.execute(text("DELETE FROM report_attachments WHERE ticket_id = :tid"), {"tid": ticket_id})


def _delete_user_account(session, user_id: str) -> None:
    """
    FK-safe account deletion: backup row in deleted_accounts, purge dependent rows, DELETE user.
    DB-ready: migrations 022–026 (totp, deleted_accounts, report_attachments,
              wallet_blacklist, match_players nullable user_id).
    match_players rows are anonymized (user_id = NULL) to preserve match history.
    If the user was previously banned, their identifiers are added to wallet_blacklist.
    """
    active = session.execute(
        text(
            "SELECT 1 FROM match_players mp "
            "JOIN matches m ON m.id = mp.match_id "
            "WHERE mp.user_id = :uid AND m.status IN ('waiting','in_progress','disputed')"
        ),
        {"uid": user_id},
    ).fetchone()
    if active:
        raise HTTPException(
            409,
            "Cannot delete account while in a waiting, in-progress, or disputed match. Leave or finish first.",
        )

    urow = session.execute(
        text(
            "SELECT steam_id, riot_id, wallet_address, email, username "
            "FROM users WHERE id = :uid"
        ),
        {"uid": user_id},
    ).fetchone()
    if not urow:
        raise HTTPException(404, "User not found")

    steam_id, riot_id, wallet, email, username = urow
    eh = hashlib.sha256(email.encode()).hexdigest() if email else None
    uh = hashlib.sha256(username.encode()).hexdigest() if username else None
    session.execute(
        text(
            "INSERT INTO deleted_accounts "
            "(steam_id, riot_id, wallet_address, email_hash, username_hash) "
            "VALUES (:s, :r, :w, :eh, :uh)"
        ),
        {"s": steam_id, "r": riot_id, "w": wallet, "eh": eh, "uh": uh},
    )

    # If user was ever permanently banned → ensure wallet_blacklist has an entry
    # so they cannot re-register with the same wallet/steam/riot (migration 025)
    was_banned = session.execute(
        text(
            "SELECT 1 FROM player_penalties "
            "WHERE user_id = :uid AND banned_at IS NOT NULL LIMIT 1"
        ),
        {"uid": user_id},
    ).fetchone()
    if was_banned:
        session.execute(
            text(
                "INSERT INTO wallet_blacklist "
                "  (wallet_address, steam_id, riot_id, user_id, reason) "
                "VALUES (:w, :s, :r, :uid, 'account_deleted_while_banned') "
                "ON CONFLICT DO NOTHING"
            ),
            {"w": wallet, "s": steam_id, "r": riot_id, "uid": user_id},
        )

    tix = session.execute(
        text("SELECT id FROM support_tickets WHERE reporter_id = :uid"),
        {"uid": user_id},
    ).fetchall()
    for (tid,) in tix:
        _cleanup_report_attachments_for_ticket(session, str(tid))
    session.execute(text("DELETE FROM support_tickets WHERE reporter_id = :uid"), {"uid": user_id})
    session.execute(
        text("UPDATE support_tickets SET reported_id = NULL WHERE reported_id = :uid"),
        {"uid": user_id},
    )

    session.execute(text("DELETE FROM transactions WHERE user_id = :uid"), {"uid": user_id})
    session.execute(
        text("DELETE FROM disputes WHERE player_a = :uid OR player_b = :uid"),
        {"uid": user_id},
    )
    session.execute(text("UPDATE admin_audit_log SET admin_id = NULL WHERE admin_id = :uid"), {"uid": user_id})
    session.execute(text("UPDATE platform_config SET updated_by = NULL WHERE updated_by = :uid"), {"uid": user_id})
    session.execute(
        text("UPDATE player_penalties SET created_by = NULL WHERE created_by = :uid"),
        {"uid": user_id},
    )
    session.execute(text("UPDATE audit_logs SET admin_id = NULL WHERE admin_id = :uid"), {"uid": user_id})
    try:
        session.execute(
            text("UPDATE platform_settings SET updated_by = NULL WHERE updated_by = :uid"),
            {"uid": user_id},
        )
    except Exception:
        pass

    for table, col in [
        ("notifications", "user_id"),
    ]:
        session.execute(text(f"DELETE FROM {table} WHERE {col} = :uid"), {"uid": user_id})

    session.execute(
        text("DELETE FROM direct_messages WHERE sender_id = :uid OR receiver_id = :uid"),
        {"uid": user_id},
    )
    session.execute(
        text("DELETE FROM inbox_messages WHERE sender_id = :uid OR receiver_id = :uid"),
        {"uid": user_id},
    )

    # Anonymize match history: set user_id = NULL instead of deleting rows
    # (migration 026 made user_id nullable with ON DELETE SET NULL).
    session.execute(
        text("UPDATE match_players SET user_id = NULL WHERE user_id = :uid"),
        {"uid": user_id},
    )
    session.execute(text("UPDATE matches SET winner_id = NULL WHERE winner_id = :uid"), {"uid": user_id})
    # Reassign host to another player with non-null user_id (migration 026: user_id nullable)
    session.execute(
        text(
            "UPDATE matches m SET host_id = ("
            "  SELECT mp.user_id FROM match_players mp "
            "  WHERE mp.match_id = m.id AND mp.user_id IS NOT NULL "
            "  ORDER BY mp.joined_at NULLS LAST LIMIT 1"
            ") "
            "WHERE m.host_id = :uid "
            "AND EXISTS ("
            "  SELECT 1 FROM match_players mp2 "
            "  WHERE mp2.match_id = m.id AND mp2.user_id IS NOT NULL"
            ")"
        ),
        {"uid": user_id},
    )
    session.execute(
        text(
            "DELETE FROM matches m "
            "WHERE m.host_id = :uid "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.user_id IS NOT NULL"
            ")"
        ),
        {"uid": user_id},
    )

    rem = session.execute(
        text("SELECT 1 FROM matches WHERE host_id = :uid"),
        {"uid": user_id},
    ).fetchone()
    if rem:
        raise HTTPException(
            409,
            "Account still hosts matches that could not be reassigned. Cancel those matches first.",
        )

    session.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})


def _deduct_at(session, user_id: str, amount: int, match_id: str, tx_type: str = "escrow_lock") -> None:
    """Deduct AT from user and record transaction. Called inside an open session (caller commits)."""
    session.execute(
        text("UPDATE users SET at_balance = at_balance - :amt WHERE id = :uid"),
        {"amt": amount, "uid": user_id},
    )
    session.execute(
        text(
            "INSERT INTO transactions (user_id, type, amount, token, status, match_id) "
            "VALUES (:uid, :ttype, :amt, 'AT', 'completed', :mid)"
        ),
        {"uid": user_id, "ttype": tx_type, "amt": amount, "mid": match_id},
    )


def _credit_at(session, user_id: str, amount: int, match_id: str, tx_type: str = "match_win") -> None:
    """Credit AT to user and record transaction. Called inside an open session (caller commits)."""
    session.execute(
        text("UPDATE users SET at_balance = at_balance + :amt WHERE id = :uid"),
        {"amt": amount, "uid": user_id},
    )
    session.execute(
        text(
            "INSERT INTO transactions (user_id, type, amount, token, status, match_id) "
            "VALUES (:uid, :ttype, :amt, 'AT', 'completed', :mid)"
        ),
        {"uid": user_id, "ttype": tx_type, "amt": amount, "mid": match_id},
    )


def _at_payout_already_happened(session, match_id: str) -> bool:
    """
    True if this match already has a match_win, refund, or tie_refund AT transaction.
    Shared idempotency guard for _settle_at_match, _refund_at_match, and
    _settle_at_tie_match. Blocks any double-credit path regardless of outcome type.
    Caller must hold a FOR UPDATE lock on matches.id = match_id.
    """
    row = session.execute(
        text(
            "SELECT 1 FROM transactions "
            "WHERE match_id = :mid AND type IN ('match_win', 'refund', 'tie_refund') LIMIT 1"
        ),
        {"mid": match_id},
    ).fetchone()
    return row is not None


def _settle_at_match(match_id: str, winner_id: str) -> None:
    """
    Distribute AT for a completed AT-currency match.

    Flow (mirrors ArenaEscrow.declareWinner):
      1. Read all players and their AT stake from the match.
      2. Compute pot = stake_per_player * player_count.
      3. Deduct 5% fee → winner receives 95% of pot.
      4. Credit winner, log fee transaction, commit.

    Idempotent: re-invocation for the same match_id is a no-op. The match
    row is locked FOR UPDATE so concurrent callers serialize, and a single
    match_win/refund transaction for that match aborts any later payout.

    DB-ready: uses users.at_balance + transactions table.
    """
    try:
        with SessionLocal() as session:
            # FOR UPDATE serializes concurrent settle/refund calls for this match.
            match_row = session.execute(
                text(
                    "SELECT stake_currency, bet_amount FROM matches "
                    "WHERE id = :mid FOR UPDATE"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row or match_row[0] != "AT":
                return  # not an AT match — nothing to do

            if _at_payout_already_happened(session, match_id):
                logger.info("_settle_at_match: match=%s already paid — skipping", match_id)
                return

            stake_per_player = int(match_row[1])
            player_rows = session.execute(
                text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                {"mid": match_id},
            ).fetchall()

            player_count = len(player_rows)
            if player_count == 0:
                return

            pot = stake_per_player * player_count
            fee = int(pot * _AT_FEE_PCT)
            winner_payout = pot - fee

            _credit_at(session, winner_id, winner_payout, match_id, "match_win")

            # Fee transaction (platform revenue — no user credited)
            session.execute(
                text(
                    "INSERT INTO transactions (user_id, type, amount, token, status, match_id) "
                    "VALUES (:uid, 'fee', :amt, 'AT', 'completed', :mid)"
                ),
                {"uid": winner_id, "amt": fee, "mid": match_id},
            )
            session.commit()
            _ws_profile_updated(winner_id)
            logger.info(
                "_settle_at_match: match=%s winner=%s payout=%d AT fee=%d AT",
                match_id, winner_id, winner_payout, fee,
            )
    except Exception as exc:
        logger.error("_settle_at_match error (non-fatal): match=%s error=%s", match_id, exc)


def _refund_at_match(match_id: str) -> None:
    """
    Refund all AT stakes for a cancelled AT-currency match.
    Returns stake_per_player AT to every player in match_players.

    Idempotent: re-invocation for the same match_id is a no-op. Shares the
    same FOR UPDATE + match_win/refund guard used by _settle_at_match.

    DB-ready: uses users.at_balance + transactions table.
    """
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT stake_currency, bet_amount FROM matches "
                    "WHERE id = :mid FOR UPDATE"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row or match_row[0] != "AT":
                return

            if _at_payout_already_happened(session, match_id):
                logger.info("_refund_at_match: match=%s already paid — skipping", match_id)
                return

            stake_per_player = int(match_row[1])
            player_rows = session.execute(
                text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                {"mid": match_id},
            ).fetchall()

            refunded = 0
            for (uid,) in player_rows:
                if uid is None:
                    continue  # migration 026: user_id nullable (deleted account)
                _credit_at(session, str(uid), stake_per_player, match_id, "refund")
                refunded += 1

            session.commit()
            for (uid,) in player_rows:
                if uid is not None:
                    _ws_profile_updated(str(uid))
            logger.info(
                "_refund_at_match: match=%s refunded %d/%d players %d AT each",
                match_id, refunded, len(player_rows), stake_per_player,
            )
    except Exception as exc:
        logger.error("_refund_at_match error (non-fatal): match=%s error=%s", match_id, exc)


def _settle_at_tie_match(match_id: str) -> None:
    """
    Refund all AT players at 95 % of their stake (5 % fee) for a draw outcome.

    Flow (mirrors ArenaEscrow.declareTie):
      1. Read all players and their AT stake from the match.
      2. pot = stake_per_player * player_count.
      3. fee = 5% of pot; refund_per_player = (pot - fee) // player_count.
      4. Credit each player with 'tie_refund', increment user_stats.ties.
      5. Fee transaction.

    Idempotent: re-invocation is a no-op (shared _at_payout_already_happened guard).
    DB-ready: uses users.at_balance + transactions + user_stats tables.
    """
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT stake_currency, bet_amount FROM matches "
                    "WHERE id = :mid FOR UPDATE"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row or match_row[0] != "AT":
                return

            if _at_payout_already_happened(session, match_id):
                logger.info("_settle_at_tie_match: match=%s already settled — skipping", match_id)
                return

            stake_per_player = int(match_row[1])
            player_rows = session.execute(
                text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                {"mid": match_id},
            ).fetchall()

            player_count = len(player_rows)
            if player_count == 0:
                return

            pot              = stake_per_player * player_count
            fee              = int(pot * _AT_FEE_PCT)
            refund_pool      = pot - fee
            refund_per_player = refund_pool // player_count

            for (uid,) in player_rows:
                if uid is None:
                    continue
                uid_str = str(uid)
                _credit_at(session, uid_str, refund_per_player, match_id, "tie_refund")
                session.execute(
                    text("UPDATE user_stats SET ties = ties + 1 WHERE user_id = :uid"),
                    {"uid": uid_str},
                )

            session.execute(
                text(
                    "INSERT INTO transactions (user_id, type, amount, token, status, match_id) "
                    "VALUES (:uid, 'fee', :amt, 'AT', 'completed', :mid)"
                ),
                {"uid": str(player_rows[0][0]), "amt": fee, "mid": match_id},
            )
            session.commit()
            for (uid,) in player_rows:
                if uid is not None:
                    _ws_profile_updated(str(uid))
            logger.info(
                "_settle_at_tie_match: match=%s refund=%d AT each fee=%d AT players=%d",
                match_id, refund_per_player, fee, player_count,
            )
    except Exception as exc:
        logger.error("_settle_at_tie_match error (non-fatal): match=%s error=%s", match_id, exc)


@app.post("/matches", status_code=201)
async def create_match(req: CreateMatchRequest, payload: dict = Depends(verify_token)):
    """
    Create a new match lobby.

    Game-account gate:
      CS2      → creator must have steam_id
      Valorant → creator must have riot_id

    On success returns match_id + status='waiting' so the frontend can
    open the lobby and wait for the second player.

    DB-ready: inserts into matches (id, game, creator_id, stake_amount, status)
              and match_players (match_id, user_id, wallet_address).
    """
    user_id: str = payload["sub"]
    _check_rate_limit(f"matches:{user_id}", max_calls=20, window_secs=60)
    game = _normalize_game(req.game)

    if game not in _VALID_GAMES:
        raise HTTPException(400, f"game must be one of: {', '.join(sorted(_VALID_GAMES))}")

    mode = req.mode.strip()
    if mode not in _VALID_MODES:
        raise HTTPException(400, f"mode must be one of: {', '.join(sorted(_VALID_MODES))}")

    if game == "Valorant" and mode != "5v5":
        raise HTTPException(400, "Valorant only supports 5v5 mode")

    match_type = req.match_type.strip()
    if match_type not in ("public", "custom"):
        raise HTTPException(400, "match_type must be 'public' or 'custom'")

    stake_currency = req.stake_currency.upper().strip()
    if stake_currency not in _VALID_CURRENCIES:
        raise HTTPException(400, "stake_currency must be 'CRYPTO' or 'AT'")

    # H3: Pydantic enforces gt=0; defend-in-depth reject if coercion got past it.
    bet_amount = float(req.stake_amount)
    if bet_amount <= 0:
        raise HTTPException(400, "stake_amount must be greater than 0")
    at_stake = int(bet_amount) if stake_currency == "AT" else 0

    # Derive max_players and max_per_team from mode
    _mode_sizes = {"1v1": 1, "2v2": 2, "4v4": 4, "5v5": 5}
    if mode not in _mode_sizes:
        raise HTTPException(400, f"Invalid mode '{mode}' — must be one of: {', '.join(_mode_sizes)}")
    team_size   = _mode_sizes[mode]
    max_players = team_size * 2

    try:
        with SessionLocal() as session:
            # ── Look up creator's game accounts + verification ────────────────
            user_row = session.execute(
                text(
                    "SELECT steam_id, riot_id, wallet_address, "
                    "       COALESCE(steam_verified, FALSE), COALESCE(riot_verified, FALSE) "
                    "FROM users WHERE id = :uid"
                ),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            steam_id, riot_id, wallet_address, steam_verified, riot_verified = user_row
            _assert_game_account(game, steam_id, riot_id, steam_verified, riot_verified)

            # ── Block duplicate rooms: 1 active room per user ─────────────────
            active_room = session.execute(
                text(
                    "SELECT m.id FROM matches m "
                    "JOIN match_players mp ON mp.match_id = m.id "
                    "WHERE mp.user_id = :uid AND m.status IN ('waiting','in_progress') "
                    "LIMIT 1"
                ),
                {"uid": user_id},
            ).fetchone()
            if active_room:
                raise HTTPException(
                    409,
                    "You already have an active match room. "
                    "Leave or finish your current room before opening a new one.",
                )

            # ── Suspension / ban check ────────────────────────────────────────
            _assert_not_suspended(session, user_id)

            # ── AT balance + daily stake limit (before creating the match row) ──
            if stake_currency == "AT":
                _assert_at_balance(session, user_id, at_stake)
                _check_daily_stake_limit(session, user_id, at_stake)
            elif stake_currency == "CRYPTO":
                _check_daily_usdt_stake_limit(session, user_id, float(bet_amount))

            _check_high_stakes_daily_cap(session, user_id, stake_currency, float(bet_amount))
            _check_daily_loss_cap(session, user_id, stake_currency, float(bet_amount))

            # ── Generate unique room code ─────────────────────────────────────
            import secrets as _secrets
            import string as _string
            _chars = _string.ascii_uppercase + _string.digits
            room_code = "ARENA-" + "".join(_secrets.choice(_chars) for _ in range(5))

            # ── Create match ──────────────────────────────────────────────────
            # H1: password stored as bcrypt hash (see auth.hash_password).
            match_row = session.execute(
                text(
                    "INSERT INTO matches "
                    "  (type, game, host_id, mode, bet_amount, stake_currency, code, password, max_players, max_per_team, on_chain_match_id) "
                    "VALUES (:mtype, :g, :host, :mode, :bet, :sc, :code, :pw, :maxp, :mpt, :ocmid) "
                    "RETURNING id"
                ),
                {
                    "mtype": match_type,
                    "g":     game,
                    "host":  user_id,
                    "mode":  mode,
                    "bet":   bet_amount,
                    "sc":    stake_currency,
                    "code":  room_code,
                    "pw":    (auth.hash_password(req.password) if req.password else None),
                    "maxp":  max_players,
                    "mpt":   team_size,
                    "ocmid": req.on_chain_match_id,
                },
            ).fetchone()
            match_id = str(match_row[0])

            # ── Add creator as first player (always Team A) ───────────────────
            session.execute(
                text(
                    "INSERT INTO match_players (match_id, user_id, wallet_address, team) "
                    "VALUES (:mid, :uid, :w, 'A')"
                ),
                {"mid": match_id, "uid": user_id, "w": wallet_address},
            )

            # ── Lock creator's AT stake ───────────────────────────────────────
            if stake_currency == "AT":
                _deduct_at(session, user_id, at_stake, match_id, "escrow_lock")

            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        import traceback as _tb

        logger.error("create_match error: %s\n%s", exc, _tb.format_exc())
        raise HTTPException(500, "Match creation failed")

    return {
        "match_id":        match_id,
        "game":            game,
        "mode":            mode,
        "match_type":      match_type,
        "status":          "waiting",
        "stake_amount":    bet_amount,
        "stake_currency":  stake_currency,
        "code":            room_code,
        "max_players":     max_players,
        "max_per_team":    team_size,
    }


@app.post("/matches/{match_id}/join", status_code=200)
async def join_match(match_id: str, req: JoinMatchRequest, payload: dict = Depends(verify_token)):
    """
    Join an existing match lobby.

    Game-account gate (same as create_match):
      CS2      → joiner must have steam_id
      Valorant → joiner must have riot_id

    Password check: if matches.password IS NOT NULL, req.password must match.
    Auto-start: when player_count reaches max_players, status → in_progress.

    DB-ready: validates match exists + is 'waiting', checks duplicate join,
              inserts into match_players.
    CONTRACT-ready: triggers escrow lock once both players have joined.
    """
    user_id: str = payload["sub"]
    # H4: cap join-spam — abusers can't brute-force room passwords.
    _check_rate_limit(f"join_match:{user_id}", max_calls=20, window_secs=60)

    try:
        with SessionLocal() as session:
            # ── Verify match exists and is open ───────────────────────────────
            match_row = session.execute(
                text(
                    "SELECT game, status, bet_amount, stake_currency, password, "
                    "       max_players, max_per_team, type, on_chain_match_id "
                    "FROM matches WHERE id = :mid FOR UPDATE"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row:
                raise HTTPException(404, "Match not found")

            game, status, stake_amount, stake_currency, match_password, max_players, max_per_team, match_type_val, existing_ocmid = match_row
            game = _normalize_game(game or "CS2")
            stake_currency = (stake_currency or "CRYPTO").upper()

            if status != "waiting":
                raise HTTPException(409, f"Match is not open for joining (status: {status})")

            # ── Password check (H1/H2: constant-time, bcrypt w/ legacy fallback) ─
            if match_password and not _verify_room_password(req.password, match_password):
                raise HTTPException(403, "Incorrect room password")

            # ── Check joiner's game account + verification ────────────────────
            user_row = session.execute(
                text(
                    "SELECT steam_id, riot_id, wallet_address, "
                    "       COALESCE(steam_verified, FALSE), COALESCE(riot_verified, FALSE) "
                    "FROM users WHERE id = :uid"
                ),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            steam_id, riot_id, wallet_address, steam_verified, riot_verified = user_row
            _assert_game_account(game, steam_id, riot_id, steam_verified, riot_verified)

            # ── Suspension / ban check ────────────────────────────────────────
            _assert_not_suspended(session, user_id)

            # ── Currency-specific balance checks ──────────────────────────────
            if stake_currency == "AT":
                # AT match: check arena token balance + daily stake cap
                at_stake = int(stake_amount or 0)
                _assert_at_balance(session, user_id, at_stake)
                _check_daily_stake_limit(session, user_id, at_stake)
            else:
                # CRYPTO match: daily USDT cap before wallet checks
                _check_daily_usdt_stake_limit(session, user_id, float(stake_amount or 0))
                # CRYPTO match: wallet must be linked + on-chain balance check
                if not wallet_address:
                    raise HTTPException(
                        400,
                        "You must link a wallet before joining a staked match. "
                        "Go to Profile → Wallet and connect your MetaMask."
                    )
                if stake_amount:
                    _assert_usdt_balance(wallet_address, float(stake_amount))

            _check_high_stakes_daily_cap(session, user_id, stake_currency, float(stake_amount or 0))
            _check_daily_loss_cap(session, user_id, stake_currency, float(stake_amount or 0))

            # ── One active room per player (join path) ────────────────────────
            active_room = session.execute(
                text(
                    "SELECT m.id FROM matches m "
                    "JOIN match_players mp ON mp.match_id = m.id "
                    "WHERE mp.user_id = :uid "
                    "  AND m.status IN ('waiting','in_progress') "
                    "LIMIT 1"
                ),
                {"uid": user_id},
            ).fetchone()

            if active_room:
                raise HTTPException(
                    409,
                    "You are already in an active match room. "
                    "Leave or finish your current room before joining another.",
                )

            # ── Duplicate join guard (same match) ─────────────────────────────
            already = session.execute(
                text(
                    "SELECT 1 FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()

            if already:
                raise HTTPException(409, "Already joined this match")

            # ── Determine team assignment ─────────────────────────────────────
            # Count both teams in one query.
            # NULL team is treated as 'A' (legacy hosts created before team column
            # was made explicit — they are always the Team A slot owner).
            counts_row = session.execute(
                text(
                    "SELECT "
                    "  COUNT(*) FILTER (WHERE team = 'A' OR team IS NULL) AS a_count, "
                    "  COUNT(*) FILTER (WHERE team = 'B')                 AS b_count "
                    "FROM match_players WHERE match_id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()
            team_a_count = int(counts_row[0])
            team_b_count = int(counts_row[1])
            mpt           = int(max_per_team or 1)

            if req.team is not None:
                # Honor explicit team preference when the slot is available.
                req_team = req.team.upper()
                if req_team not in ("A", "B"):
                    raise HTTPException(400, "team must be 'A' or 'B'")
                requested_count = team_a_count if req_team == "A" else team_b_count
                if requested_count >= mpt:
                    other = "B" if req_team == "A" else "A"
                    raise HTTPException(
                        409,
                        f"Team {req_team} is full — join Team {other} instead.",
                    )
                assigned_team = req_team
            else:
                # Auto-assign: fill Team A first, then Team B.
                assigned_team = "A" if team_a_count < mpt else "B"

            # ── Join ──────────────────────────────────────────────────────────
            session.execute(
                text(
                    "INSERT INTO match_players (match_id, user_id, wallet_address, team) "
                    "VALUES (:mid, :uid, :w, :team)"
                ),
                {"mid": match_id, "uid": user_id, "w": wallet_address, "team": assigned_team},
            )

            # ── Lock joiner's AT stake ────────────────────────────────────────
            if stake_currency == "AT":
                _deduct_at(session, user_id, int(stake_amount or 0), match_id, "escrow_lock")

            # ── Public CRYPTO: first joiner links the on-chain match ──────────
            # Pool manager creates public CRYPTO rooms with no on_chain_match_id.
            # The first player calls createMatch on-chain, gets a matchId, and
            # passes it here. We store it and make this player the effective host
            # so they can call cancelMatch if the room never fills.
            if (
                match_type_val == "public"
                and stake_currency == "CRYPTO"
                and req.on_chain_match_id is not None
                and existing_ocmid is None
                and team_a_count == 0  # this player is the first joiner (team A slot 0)
            ):
                session.execute(
                    text(
                        "UPDATE matches "
                        "SET on_chain_match_id = :ocmid, host_id = :uid "
                        "WHERE id = :mid AND on_chain_match_id IS NULL"
                    ),
                    {"ocmid": req.on_chain_match_id, "uid": user_id, "mid": match_id},
                )
                logger.info(
                    "Public CRYPTO room %s linked on_chain_match_id=%s by user %s",
                    match_id, req.on_chain_match_id, user_id,
                )

            # ── Auto-start: transition waiting → in_progress when room fills ──
            # Count includes the newly inserted row (same session, uncommitted).
            count_row = session.execute(
                text("SELECT COUNT(*) FROM match_players WHERE match_id = :mid"),
                {"mid": match_id},
            ).fetchone()
            match_started = False
            game_password: str | None = None
            if count_row and int(count_row[0]) >= (max_players or 2):
                import secrets as _sec, string as _str
                _pwchars = _str.ascii_letters + _str.digits
                game_password = "".join(_sec.choice(_pwchars) for _ in range(8))
                session.execute(
                    text(
                        "UPDATE matches "
                        "SET status = 'in_progress', started_at = NOW(), game_password = :pw "
                        "WHERE id = :mid AND status = 'waiting'"
                    ),
                    {"mid": match_id, "pw": game_password},
                )
                match_started = True

            session.commit()

        # Subscribe the joining user's WS socket to this match room.
        # (Idempotent: ws_manager does nothing if already subscribed.)
        for _ws in list(ws_manager._user_sockets.get(user_id, set())):
            import asyncio as _aio
            try:
                loop = _aio.get_event_loop()
                if loop.is_running():
                    loop.call_soon_threadsafe(
                        loop.create_task, ws_manager.subscribe_match(_ws, match_id)
                    )
            except Exception:
                pass

        _ws_roster_updated(match_id, [{"user_id": user_id, "team": assigned_team}])

        if match_started:
            _ws_match_status(match_id, "in_progress")

        # ── Match just went LIVE ──────────────────────────────────────────────
        if match_started:
            import json as _json2, string as _str2
            _pwchars2       = _str2.ascii_letters + _str2.digits
            team_a_password = "".join(secrets.choice(_pwchars2) for _ in range(8))
            team_b_password = "".join(secrets.choice(_pwchars2) for _ in range(8))

            try:
                # Phase 1 — persist team passwords + fetch match info and players
                _mode    = "?"
                _code    = match_id[:8]
                _players = []
                with SessionLocal() as _ms:
                    _ms.execute(
                        text(
                            "UPDATE matches "
                            "SET team_a_password = :pa, team_b_password = :pb "
                            "WHERE id = :mid"
                        ),
                        {"mid": match_id, "pa": team_a_password, "pb": team_b_password},
                    )
                    _info = _ms.execute(
                        text("SELECT mode, code FROM matches WHERE id = :mid"),
                        {"mid": match_id},
                    ).fetchone()
                    if _info:
                        _mode = _info[0] or "?"
                        _code = _info[1] or match_id[:8]
                    _players = _ms.execute(
                        text(
                            "SELECT u.id, u.username, mp.team "
                            "FROM match_players mp "
                            "JOIN users u ON u.id = mp.user_id "
                            "WHERE mp.match_id = :mid AND mp.user_id IS NOT NULL"
                        ),
                        {"mid": match_id},
                    ).fetchall()
                    _ms.commit()

                # Phase 2 — create Discord channels (blocking I/O → thread pool)
                _team_size   = max_per_team or max(1, (max_players or 2) // 2)
                _discord_chs = await asyncio.to_thread(
                    create_match_channels,
                    match_id, _code, _team_size, _team_size,
                )

                # Phase 3 — persist Discord channel IDs if bot succeeded
                if _discord_chs:
                    with SessionLocal() as _ms:
                        _ms.execute(
                            text(
                                "UPDATE matches "
                                "SET discord_team_a_channel_id = :ca, "
                                "    discord_team_b_channel_id = :cb "
                                "WHERE id = :mid"
                            ),
                            {
                                "mid": match_id,
                                "ca":  _discord_chs.team_a_channel_id,
                                "cb":  _discord_chs.team_b_channel_id,
                            },
                        )
                        _ms.commit()

                # Phase 4 — send per-player notifications with real invite links
                with SessionLocal() as _ms:
                    for _pid, _uname, _team in _players:
                        _team_pw = (
                            team_a_password if _team == "A" else team_b_password
                        )
                        if _discord_chs:
                            _discord_ch  = (
                                f"match-{_code.lower()}-team-{_team.lower()}"
                            )
                            _discord_inv = (
                                _discord_chs.team_a_invite
                                if _team == "A"
                                else _discord_chs.team_b_invite
                            )
                        else:
                            _discord_ch  = f"Arena-Match-Team-{_team}"
                            _discord_inv = ""
                        _ms.execute(
                            text(
                                "INSERT INTO notifications "
                                "  (user_id, type, title, message, metadata) "
                                "VALUES (:uid, 'system', :title, :msg, :meta::jsonb)"
                            ),
                            {
                                "uid":   str(_pid),
                                "title": "⚔️ Match is LIVE!",
                                "msg": (
                                    f"{game} {_mode} · Team {_team} · "
                                    f"CS2 password: {game_password} · "
                                    f"Discord: #{_discord_ch}"
                                ),
                                "meta": _json2.dumps({
                                    "match_id":        match_id,
                                    "match_code":      _code,
                                    "game":            game,
                                    "mode":            _mode,
                                    "team":            _team,
                                    "game_password":   game_password,
                                    "team_password":   _team_pw,
                                    "discord_channel": _discord_ch,
                                    "discord_invite":  _discord_inv,
                                }),
                            },
                        )
                    _ms.commit()

                # Phase 5 — announce in Discord lobby webhook
                _a_count = sum(1 for p in _players if p[2] == "A")
                _b_count = sum(1 for p in _players if p[2] == "B")
                discord_post(
                    f"⚔️ **Match LIVE** | {game} {_mode} "
                    f"| {float(stake_amount):g} {stake_currency} "
                    f"| Code: `{_code}` "
                    f"| Team A ({_a_count}) vs Team B ({_b_count}) "
                    f"| https://project-arena.com/lobby"
                )

            except Exception as _ne:
                logger.error("match_start notifications failed (non-fatal): %s", _ne)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("join_match error: %s", exc)
        raise HTTPException(500, "Join failed")

    return {
        "joined":         True,
        "match_id":       match_id,
        "game":           game,
        "stake_currency": stake_currency,
        "team":           assigned_team,
        "started":        match_started,
        "game_password":  game_password,
    }


@app.delete("/matches/{match_id}", status_code=200)
async def cancel_match(match_id: str, payload: dict = Depends(verify_token)):
    """
    DELETE /matches/{match_id} — host cancels a waiting match room.

    Rules:
      - Match must exist and be in 'waiting' status.
      - Caller must be the host (host_id = user_id).
      - AT: refunds all players immediately via at_transactions.
      - CRYPTO with deposits: returns 400 with requires_on_chain_cancel=true.
        The frontend must call ArenaEscrow.cancelMatch(on_chain_match_id) first;
        the MatchCancelled event listener will then update the DB automatically.
      - CRYPTO with zero deposits: cancels the DB row directly (no on-chain needed).

    DB-ready: UPDATE matches SET status='cancelled'; refund AT via at_transactions.
    CONTRACT-ready: CRYPTO with deposits must be resolved on-chain via cancelMatch().
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT host_id, status, stake_currency, "
                    "       deposits_received, on_chain_match_id "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()
            if not match_row:
                raise HTTPException(404, "Match not found")
            host_id, status, stake_currency, deposits_received, on_chain_id = match_row
            if str(host_id) != user_id:
                raise HTTPException(403, "Only the host can delete this room")
            if status != "waiting":
                raise HTTPException(409, f"Cannot cancel a match with status '{status}'")

            # CRYPTO with any deposits locked on-chain → frontend must cancel on-chain first.
            # The MatchCancelled event listener handles the DB update after the tx confirms.
            if stake_currency == "CRYPTO" and (deposits_received or 0) > 0:
                raise HTTPException(
                    400,
                    detail={
                        "code": "requires_on_chain_cancel",
                        "message": (
                            "This CRYPTO match has deposits locked in escrow. "
                            "Call ArenaEscrow.cancelMatch(on_chain_match_id) from your wallet first — "
                            "the on-chain transaction will refund all depositors and update the DB automatically."
                        ),
                        "on_chain_match_id": str(on_chain_id) if on_chain_id is not None else None,
                    },
                )

            # AT: refund all players
            if stake_currency == "AT":
                _refund_at_match(match_id)

            session.execute(
                text(
                    "UPDATE matches SET status = 'cancelled', ended_at = NOW() "
                    "WHERE id = :mid"
                ),
                {"mid": match_id},
            )
            session.commit()
            _ws_match_status(match_id, "cancelled")

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("cancel_match error: %s", exc)
        raise HTTPException(500, "Cancel failed")

    return {"cancelled": True, "match_id": match_id}


@app.post("/matches/{match_id}/leave", status_code=200)
async def leave_match(match_id: str, payload: dict = Depends(verify_token)):
    """
    POST /matches/{match_id}/leave — non-host player leaves a waiting match.

    Rules:
      - Match must be in 'waiting' status.
      - Caller must be a player (not the host — host should use DELETE /matches/{id}).
      - AT: removes from match_players and refunds stake immediately.
      - CRYPTO + has_deposited=TRUE: returns 400 — funds are on-chain and cannot be
        reclaimed by the player directly. The host must call cancelMatch() or the player
        must wait for WAITING_TIMEOUT (1 hour) and call cancelWaiting() from their wallet.
      - CRYPTO + has_deposited=FALSE: removes from match_players (no on-chain action needed).

    DB-ready: DELETE FROM match_players WHERE match_id=:mid AND user_id=:uid.
    CONTRACT-ready: CRYPTO depositors must resolve on-chain — no refund path exists via API.
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT host_id, status, stake_currency, bet_amount "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()
            if not match_row:
                raise HTTPException(404, "Match not found")
            host_id, status, stake_currency, bet_amount = match_row

            if str(host_id) == user_id:
                raise HTTPException(
                    400, "Host cannot leave — use DELETE /matches/{id} to close the room"
                )
            if status != "waiting":
                raise HTTPException(409, f"Cannot leave a match with status '{status}'")

            player_row = session.execute(
                text(
                    "SELECT has_deposited FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()
            if not player_row:
                raise HTTPException(400, "You are not in this match")

            has_deposited = bool(player_row[0])

            # CRYPTO with an on-chain deposit cannot be refunded via API —
            # the host must call cancelMatch() or the player waits 1h → cancelWaiting().
            if stake_currency == "CRYPTO" and has_deposited:
                raise HTTPException(
                    400,
                    detail={
                        "code": "crypto_deposit_locked",
                        "message": (
                            "Your stake is locked in the ArenaEscrow contract. "
                            "The host must cancel the room (cancelMatch) to refund you, "
                            "or you can rescue your funds after 1 hour by calling "
                            "cancelWaiting() from your wallet."
                        ),
                    },
                )

            # Remove player from the room
            session.execute(
                text(
                    "DELETE FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            )

            # Refund AT stake to this player
            if stake_currency == "AT":
                at_amount = int(float(bet_amount)) if bet_amount else 0
                if at_amount > 0:
                    _credit_at(session, user_id, at_amount, match_id, "escrow_refund_leave")

            session.commit()
            _ws_roster_updated(match_id, [])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("leave_match error: %s", exc)
        raise HTTPException(500, "Leave failed")

    return {"left": True, "match_id": match_id}


@app.get("/wallet/pending-withdrawals", status_code=200)
async def get_pending_withdrawals(payload: dict = Depends(verify_token)):
    """
    GET /wallet/pending-withdrawals — check on-chain pendingWithdrawals balance.

    Returns the amount (in wei) that the caller's wallet has pending in the
    ArenaEscrow pull-payment ledger (pendingWithdrawals[wallet]).
    This is only non-zero when a direct ETH payout failed (rare DoS-guard case).

    Also returns DB-tracked unclaimed credits from pending_withdrawals table.

    CONTRACT-ready: reads pendingWithdrawals(address) view on ArenaEscrow.
    DB-ready: pending_withdrawals table (migration 046).
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            user_row = session.execute(
                text("SELECT wallet_address FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            wallet = str(user_row[0]).lower() if user_row and user_row[0] else None

            on_chain_wei = 0
            if wallet and _escrow_client is not None:
                try:
                    on_chain_wei = _escrow_client.read_pending_withdrawals(wallet)
                except Exception as exc:
                    logger.warning("read_pending_withdrawals failed: %s", exc)

            db_row = session.execute(
                text(
                    "SELECT COALESCE(SUM(amount_wei), 0) "
                    "FROM pending_withdrawals "
                    "WHERE user_id = :uid AND claimed_at IS NULL"
                ),
                {"uid": user_id},
            ).fetchone()
            db_wei = int(db_row[0]) if db_row else 0

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_pending_withdrawals error: %s", exc)
        raise HTTPException(500, "Failed to fetch pending withdrawals")

    return {
        "on_chain_wei": str(on_chain_wei),
        "db_tracked_wei": str(db_wei),
        "has_pending": on_chain_wei > 0 or db_wei > 0,
        "wallet": wallet,
    }


@app.get("/matches/{match_id}/leave-status", status_code=200)
async def get_leave_status(match_id: str, payload: dict = Depends(verify_token)):
    """
    GET /matches/{match_id}/leave-status — check leave/cancel eligibility for a CRYPTO match.

    Returns:
      can_leave_now   — True when leave requires no on-chain action (AT or CRYPTO no deposit)
      requires_cancel — True when the user is the host and has deposits → must cancelMatch()
      rescue_available — True when WAITING_TIMEOUT (1h) has elapsed → user can cancelWaiting()
      has_deposited   — True when this user has an on-chain deposit in this match
      created_at      — ISO timestamp of match creation (for client-side timeout math)
      on_chain_match_id — bigint as string, or null

    DB-ready: matches + match_players.
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT host_id, status, stake_currency, created_at, "
                    "       deposits_received, on_chain_match_id "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()
            if not match_row:
                raise HTTPException(404, "Match not found")
            host_id, status, stake_currency, created_at, deposits_received, on_chain_id = match_row

            player_row = session.execute(
                text(
                    "SELECT has_deposited FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()
            has_deposited = bool(player_row[0]) if player_row else False

            is_host = str(host_id) == user_id
            is_crypto = stake_currency == "CRYPTO"

            import datetime as _dt
            now = _dt.datetime.now(_dt.timezone.utc)
            created_utc = created_at.replace(tzinfo=_dt.timezone.utc) if created_at and not created_at.tzinfo else created_at
            rescue_available = (
                is_crypto
                and has_deposited
                and status == "waiting"
                and created_utc is not None
                and (now - created_utc).total_seconds() >= 3600
            )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_leave_status error: %s", exc)
        raise HTTPException(500, "Failed to fetch leave status")

    return {
        "can_leave_now":    not is_crypto or not has_deposited,
        "requires_cancel":  is_host and is_crypto and (deposits_received or 0) > 0,
        "rescue_available": rescue_available,
        "has_deposited":    has_deposited,
        "is_host":          is_host,
        "stake_currency":   stake_currency,
        "created_at":       created_at.isoformat() if created_at else None,
        "on_chain_match_id": str(on_chain_id) if on_chain_id is not None else None,
    }


class KickPlayerRequest(BaseModel):
    """POST /matches/{match_id}/kick body."""
    user_id: str


@app.post("/matches/{match_id}/kick", status_code=200)
async def kick_player(
    match_id: str,
    req: KickPlayerRequest,
    payload: dict = Depends(verify_token),
):
    """
    POST /matches/{match_id}/kick — host removes a player from a waiting lobby.

    Rules:
      - Caller must be the match host → 403 otherwise
      - Match must be in 'waiting' status → 409 if already in_progress
      - Cannot kick yourself (host cannot kick themselves) → 400
      - Target user must be in the room → 404 if not
      - AT match: refunds the kicked player's stake immediately

    Detection on the kicked client:
      Next heartbeat call returns in_match=False → client navigates away.
      No extra push/websocket mechanism needed until Phase 7.

    DB-ready: DELETE FROM match_players; refund via _credit_at.
    """
    user_id: str = payload["sub"]
    _check_rate_limit(f"kick:{user_id}", max_calls=10, window_secs=60)

    target_id = req.user_id.strip()
    if target_id == user_id:
        raise HTTPException(400, "You cannot kick yourself from the room")

    try:
        with SessionLocal() as session:
            # ── Verify match + host ownership ─────────────────────────────────
            match_row = session.execute(
                text(
                    "SELECT host_id, status, stake_currency, bet_amount "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row:
                raise HTTPException(404, "Match not found")

            host_id, status, stake_currency, bet_amount = match_row

            if str(host_id) != user_id:
                raise HTTPException(403, "Only the host can kick players")

            if status != "waiting":
                raise HTTPException(
                    409,
                    f"Cannot kick a player from a match with status '{status}'"
                )

            # ── Verify target is in room ──────────────────────────────────────
            in_room = session.execute(
                text(
                    "SELECT 1 FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": target_id},
            ).fetchone()

            if not in_room:
                raise HTTPException(404, "Player is not in this match")

            # ── Remove target from room ───────────────────────────────────────
            session.execute(
                text(
                    "DELETE FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": target_id},
            )

            # ── Refund AT stake to kicked player ──────────────────────────────
            if (stake_currency or "").upper() == "AT":
                at_amount = int(float(bet_amount)) if bet_amount else 0
                if at_amount > 0:
                    _credit_at(
                        session, target_id, at_amount, match_id,
                        "escrow_refund_kicked"
                    )

            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("kick_player error: %s", exc)
        raise HTTPException(500, "Kick failed")

    return {"kicked": True, "match_id": match_id, "user_id": target_id}


@app.post("/matches/{match_id}/heartbeat", status_code=200)
async def match_heartbeat(match_id: str, payload: dict = Depends(verify_token)):
    """
    POST /matches/{match_id}/heartbeat — lobby keep-alive ping.

    Call every 3-5 seconds while in MatchLobby (both host and guests).
    Each call:
      1. Refreshes last_seen for this player (proves browser is still open)
      2. Removes stale players whose last_seen expired (closed browser without leave)
         — only in 'waiting' matches; refunds AT stake for removed players
      3. Returns the current fresh roster + match status

    Response:
      in_match    — False if caller is not (or no longer) in this match
      players     — full current roster with team assignments
      your_team   — 'A' | 'B' for the calling user
      status      — current match status
      stale_removed — count of players cleaned up this tick (debug info)

    This bridges the gap until Phase 7 (WebSocket) provides true real-time.

    DB-ready: match_players.last_seen + matches table.
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            # ── Refresh last_seen for this player ─────────────────────────────
            updated = session.execute(
                text(
                    "UPDATE match_players SET last_seen = NOW() "
                    "WHERE match_id = :mid AND user_id = :uid "
                    "RETURNING user_id"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()

            if not updated:
                # Caller is not in this match (already removed or never joined)
                session.rollback()
                return {"in_match": False, "match_id": match_id, "players": []}

            # ── Stale roster snapshot (removals use isolated sessions below) ──
            stale = session.execute(
                text(
                    "SELECT mp.user_id, m.stake_currency, m.bet_amount "
                    "FROM match_players mp "
                    "JOIN matches m ON m.id = mp.match_id "
                    "WHERE mp.match_id = :mid "
                    "  AND m.status = 'waiting' "
                    "  AND mp.user_id != m.host_id "
                    "  AND mp.user_id IS NOT NULL "
                    "  AND mp.last_seen < NOW() - INTERVAL '30 seconds'"
                ),
                {"mid": match_id},
            ).fetchall()

            session.commit()

        stale_removed = 0
        for (stale_uid, currency, bet) in stale:
            try:
                with SessionLocal() as refund_session:
                    refund_session.execute(
                        text(
                            "DELETE FROM match_players "
                            "WHERE match_id = :mid AND user_id = :uid"
                        ),
                        {"mid": match_id, "uid": str(stale_uid)},
                    )
                    if currency == "AT":
                        at_amt = int(float(bet or 0))
                        if at_amt > 0:
                            _credit_at(
                                refund_session,
                                str(stale_uid),
                                at_amt,
                                match_id,
                                "escrow_refund_disconnect",
                            )
                    refund_session.commit()
                stale_removed += 1
            except Exception as _e:
                logger.error(
                    "heartbeat stale remove: uid=%s match=%s err=%s",
                    stale_uid,
                    match_id,
                    _e,
                )

        with SessionLocal() as session:
            # ── Fresh roster (after stale cleanup) ────────────────────────────
            players = session.execute(
                text(
                    "SELECT u.id, u.username, u.avatar, u.arena_id, "
                    "       COALESCE(mp.team, 'A') AS team "
                    "FROM match_players mp "
                    "JOIN users u ON u.id = mp.user_id "
                    "WHERE mp.match_id = :mid "
                    "ORDER BY COALESCE(mp.team, 'A'), mp.joined_at"
                ),
                {"mid": match_id},
            ).fetchall()

            match_info = session.execute(
                text(
                    "SELECT status, game, mode, code, max_players, max_per_team, "
                    "       host_id, type, bet_amount, stake_currency, created_at, "
                    "       forfeit_warning_at, forfeit_warning_team "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

        your_team = next((p[4] for p in players if str(p[0]) == user_id), None)

        # Indices: 0=status 1=game 2=mode 3=code 4=max_players 5=max_per_team
        #          6=host_id 7=type 8=bet_amount 9=stake_currency 10=created_at
        #          11=forfeit_warning_at 12=forfeit_warning_team
        return {
            "in_match":             True,
            "match_id":             match_id,
            "status":               match_info[0]  if match_info else None,
            "game":                 match_info[1]  if match_info else None,
            "mode":                 match_info[2]  if match_info else None,
            "code":                 match_info[3]  if match_info else None,
            "max_players":          match_info[4]  if match_info else None,
            "max_per_team":         match_info[5]  if match_info else None,
            "host_id":              str(match_info[6]) if match_info and match_info[6] else None,
            "type":                 match_info[7]  if match_info else None,
            "bet_amount":           str(match_info[8]) if match_info and match_info[8] is not None else None,
            "stake_currency":       match_info[9]  if match_info else None,
            "created_at":           match_info[10].isoformat() if match_info and match_info[10] else None,
            "forfeit_warning_at":   match_info[11].isoformat() if match_info and match_info[11] else None,
            "forfeit_warning_team": match_info[12] if match_info else None,
            "your_user_id":         user_id,
            "your_team":      your_team,
            "stale_removed":  stale_removed,
            "players": [
                {"user_id": str(p[0]), "username": p[1], "avatar": p[2],
                 "arena_id": p[3], "team": p[4]}
                for p in players
            ],
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("match_heartbeat error: %s", exc)
        raise HTTPException(500, "Heartbeat failed")


class MatchInviteRequest(BaseModel):
    """POST /matches/{match_id}/invite body."""
    friend_id: str


@app.post("/matches/{match_id}/invite", status_code=201)
async def invite_to_match(
    match_id: str,
    req: MatchInviteRequest,
    payload: dict = Depends(verify_token),
):
    """
    Send a match_invite notification to an accepted friend.

    Rules:
      - match must exist and be 'waiting'
      - inviter must be a player in the match
      - friend_id must be an accepted friend of the inviter
      - AT match:     friend must have enough AT (402 if not)
      - CRYPTO match: friend must have a linked wallet (400 if not)
                      and sufficient USDT balance (400 if check passes but fails)

    DB-ready: notifications table, type='match_invite'
    """
    user_id: str = payload["sub"]
    _check_rate_limit(f"invite:{user_id}", max_calls=10, window_secs=60)
    if user_id == req.friend_id:
        raise HTTPException(400, "Cannot invite yourself")

    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text("SELECT m.game, m.status, m.bet_amount, m.stake_currency, m.code FROM matches m WHERE m.id = :mid"),
                {"mid": match_id},
            ).fetchone()
            if not match_row:
                raise HTTPException(404, "Match not found")
            if match_row[1] != "waiting":
                raise HTTPException(409, "Match is no longer open")

            in_match = session.execute(
                text("SELECT 1 FROM match_players WHERE match_id = :mid AND user_id = :uid"),
                {"mid": match_id, "uid": user_id},
            ).fetchone()
            if not in_match:
                raise HTTPException(403, "You are not in this match")

            # ── Friend already in room? ───────────────────────────────────────
            friend_in_match = session.execute(
                text("SELECT 1 FROM match_players WHERE match_id = :mid AND user_id = :fid"),
                {"mid": match_id, "fid": req.friend_id},
            ).fetchone()
            if friend_in_match:
                raise HTTPException(409, "This player is already in your room")

            friendship = session.execute(
                text(
                    "SELECT 1 FROM friendships "
                    "WHERE status = 'accepted' "
                    "  AND ((initiator_id = :me AND receiver_id = :them) "
                    "    OR (initiator_id = :them AND receiver_id = :me))"
                ),
                {"me": user_id, "them": req.friend_id},
            ).fetchone()
            if not friendship:
                raise HTTPException(403, "Not friends with this user")

            # ── Pre-validate: friend must be able to afford this room ─────────
            # Blocked invite is better than a notification that can never be acted on.
            invite_currency = (match_row[3] or "CRYPTO").upper()
            invite_stake    = match_row[2]   # bet_amount (Decimal | float | None)

            friend_row = session.execute(
                text("SELECT wallet_address FROM users WHERE id = :fid"),
                {"fid": req.friend_id},
            ).fetchone()
            if not friend_row:
                raise HTTPException(404, "Friend not found")

            if invite_currency == "AT":
                at_stake = int(float(invite_stake or 0))
                # Wrap to give the inviter a meaningful message (not "you need X AT").
                try:
                    _assert_at_balance(session, req.friend_id, at_stake)
                except HTTPException as _e:
                    if _e.status_code == 402:
                        raise HTTPException(
                            402,
                            f"Your friend doesn't have enough Arena Tokens to join. "
                            f"This room costs {at_stake} AT. "
                            "Ask them to top up their AT balance first.",
                        )
                    raise
                _check_daily_stake_limit(session, req.friend_id, at_stake)
                _check_high_stakes_daily_cap(session, req.friend_id, "AT", float(at_stake))
                _check_daily_loss_cap(session, req.friend_id, "AT", float(at_stake))
            else:
                # CRYPTO: daily USDT cap for the invitee (same as join).
                _check_daily_usdt_stake_limit(session, req.friend_id, float(invite_stake or 0))
                _check_high_stakes_daily_cap(session, req.friend_id, "CRYPTO", float(invite_stake or 0))
                _check_daily_loss_cap(session, req.friend_id, "CRYPTO", float(invite_stake or 0))
                # CRYPTO: wallet must be linked (hard requirement, no on-chain fallback).
                friend_wallet = friend_row[0]
                if not friend_wallet:
                    raise HTTPException(
                        400,
                        "Your friend does not have a wallet linked and cannot join a staked match. "
                        "Ask them to connect their MetaMask in Profile → Wallet first."
                    )
                # on-chain balance check — non-fatal if RPC unavailable (skipped gracefully).
                if invite_stake:
                    _assert_usdt_balance(friend_wallet, float(invite_stake))

            inviter = session.execute(
                text("SELECT username FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            inviter_name = inviter[0] if inviter else "A player"

            import json as _json
            session.execute(
                text(
                    "INSERT INTO notifications (user_id, type, title, message, metadata) "
                    "VALUES (:uid, 'match_invite', :title, :msg, :meta::jsonb)"
                ),
                {
                    "uid":   req.friend_id,
                    "title": f"{inviter_name} invited you to a match",
                    "msg":   f"Join {match_row[0]} · {match_row[2]} {match_row[3]} · Room {match_row[4]}",
                    "meta":  _json.dumps({
                        "match_id":         match_id,
                        "inviter_id":       user_id,
                        "inviter_username": inviter_name,
                        "code":             match_row[4],
                        "game":             match_row[0],
                        "bet_amount":       str(match_row[2]),
                        "stake_currency":   match_row[3],
                    }),
                },
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("invite_to_match error: %s", exc, exc_info=True)
        detail = str(exc)
        # Surface enum-related errors as a migration hint in logs only — never expose raw DB errors.
        if "notification_type" in detail or "invalid input value" in detail.lower():
            logger.error("invite_to_match: DB enum missing 'match_invite' — run migration 011")
        raise HTTPException(500, "Invite could not be sent. Please try again.")

    return {"invited": True, "match_id": match_id, "friend_id": req.friend_id}


# ── Arena Token purchase ───────────────────────────────────────────────────────

class BuyAtRequest(BaseModel):
    """
    POST /wallet/buy-at — credit Arena Tokens after on-chain USDT transfer.

    Flow:
      1. Frontend: user transfers USDT to platform wallet via MetaMask.
      2. Frontend: sends tx_hash + usdt_amount to this endpoint.
      3. Backend: CONTRACT-ready: verify tx on-chain (skipped if no RPC).
      4. Backend: credits at_balance += usdt_amount * AT_PER_USDT.
      5. Returns new at_balance.
    """
    tx_hash: str         # MetaMask tx hash of the USDT transfer
    usdt_amount: float   # USDT transferred (must be > 0)


@app.post("/wallet/buy-at")
async def buy_arena_tokens(req: BuyAtRequest, payload: dict = Depends(verify_token)):
    """
    Credit Arena Tokens to the user after they transfer USDT to the platform wallet.

    CONTRACT-ready: tx_hash should be verified on-chain before crediting.
    Rate: AT_PER_USDT env var (default 10 AT per 1 USDT).
    DB-ready: UPDATE users SET at_balance = at_balance + :at WHERE id = :uid.
    """
    from src.config import AT_PER_USDT

    user_id: str = payload["sub"]
    _check_rate_limit(f"buy_at:{user_id}", max_calls=3, window_secs=60)

    if req.usdt_amount <= 0:
        raise HTTPException(400, "usdt_amount must be greater than 0")

    at_to_credit = int(req.usdt_amount * AT_PER_USDT)
    if at_to_credit <= 0:
        raise HTTPException(400, "Amount too small to purchase Arena Tokens")

    try:
        with SessionLocal() as session:
            # ── Dedup: reject replayed on-chain transactions ──────────────────
            if req.tx_hash:
                duplicate = session.execute(
                    text("SELECT 1 FROM transactions WHERE tx_hash = :h"),
                    {"h": req.tx_hash},
                ).fetchone()
                if duplicate:
                    raise HTTPException(409, "This transaction has already been processed")

            result = session.execute(
                text("""
                    UPDATE users
                       SET at_balance = at_balance + :at
                     WHERE id = :uid
                    RETURNING at_balance
                """),
                {"at": at_to_credit, "uid": user_id},
            ).fetchone()

            if not result:
                raise HTTPException(404, "User not found")

            # Record with tx_hash so the UNIQUE index blocks any future replay.
            session.execute(
                text(
                    "INSERT INTO transactions "
                    "(user_id, type, amount, token, status, tx_hash) "
                    "VALUES (:uid, 'at_purchase', :amt, 'AT', 'completed', :txh)"
                ),
                {"uid": user_id, "amt": at_to_credit, "txh": req.tx_hash or None},
            )
            session.commit()
            new_balance = int(result[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("buy_at error: %s", exc)
        raise HTTPException(500, "Purchase failed")

    logger.info(
        "buy_at: user=%s credited %d AT (%.2f USDT, tx=%s)",
        user_id, at_to_credit, req.usdt_amount, req.tx_hash,
    )
    return {
        "at_balance":  new_balance,
        "at_credited": at_to_credit,
        "usdt_spent":  req.usdt_amount,
    }


# ── AT Withdrawal ─────────────────────────────────────────────────────────────


class WithdrawAtRequest(BaseModel):
    """POST /wallet/withdraw-at body."""
    at_amount: int  # AT to burn — must be a multiple of 1050


@app.post("/wallet/withdraw-at", status_code=200)
async def withdraw_arena_tokens(req: WithdrawAtRequest, payload: dict = Depends(verify_token)):
    """
    POST /wallet/withdraw-at — burn AT and send equivalent BNB to user's wallet.

    Rate: 1050 AT = $10 USDT → sent as BNB to user wallet.
    Rules:
      - User must have a linked wallet_address.
      - at_amount must be a multiple of 1050.
      - Daily limit: 10,000 AT per user per calendar day (UTC).
      - Burns AT from DB; CONTRACT-ready: sends BNB from platform wallet.

    DB-ready:
      - Deducts at_balance, records at_daily_withdrawn.
      - Inserts into transactions (type='at_withdrawal').
    CONTRACT-ready:
      - Platform wallet sends BNB equivalent to user wallet via web3.
    """
    from src.config import (
        AT_PER_USDT_WITHDRAW,
        AT_DAILY_WITHDRAW_LIMIT,
        BLOCKCHAIN_RPC_URL,
        PLATFORM_WALLET_ADDRESS,
    )
    from datetime import timezone

    user_id: str = payload["sub"]
    # H4: cap withdrawal-request spam — limits denial/abuse + probing attempts.
    _check_rate_limit(f"withdraw_at:{user_id}", max_calls=5, window_secs=60)
    at_amount = req.at_amount

    if at_amount <= 0:
        raise HTTPException(400, "at_amount must be greater than 0")

    rate     = AT_PER_USDT_WITHDRAW        # 105 AT per $1
    unit_at  = rate * 10                   # 1050 AT per $10

    if at_amount % unit_at != 0:
        raise HTTPException(
            400,
            f"at_amount must be a multiple of {unit_at} (1050 AT = $10 USDT). "
            f"Smallest withdrawal: {unit_at} AT.",
        )

    usdt_value = at_amount / rate          # USDT equivalent
    if usdt_value < 10.0:
        raise HTTPException(400, f"Minimum withdrawal is $10 USDT equivalent ({unit_at} AT).")

    try:
        with SessionLocal() as session:
            # ── Fetch user ────────────────────────────────────────────────────
            # FOR UPDATE — locks the user row for the remainder of this
            # transaction so two concurrent withdraw-at calls cannot both
            # pass the balance check and drain the account (C12).
            row = session.execute(
                text(
                    "SELECT at_balance, wallet_address, at_daily_withdrawn, at_withdrawal_reset_at "
                    "FROM users WHERE id = :uid FOR UPDATE"
                ),
                {"uid": user_id},
            ).fetchone()
            if not row:
                raise HTTPException(404, "User not found")

            at_balance, wallet_address, daily_withdrawn, reset_at = row

            if not wallet_address:
                raise HTTPException(
                    400, "You must link a wallet before withdrawing. Connect MetaMask in your profile."
                )

            # ── Reset daily counter if it's a new UTC day ─────────────────────
            now_utc = datetime.now(timezone.utc)
            if reset_at is None or reset_at.date() < now_utc.date():
                daily_withdrawn = 0
                session.execute(
                    text(
                        "UPDATE users SET at_daily_withdrawn = 0, at_withdrawal_reset_at = :now "
                        "WHERE id = :uid"
                    ),
                    {"now": now_utc, "uid": user_id},
                )

            # ── Daily limit check ─────────────────────────────────────────────
            if daily_withdrawn + at_amount > AT_DAILY_WITHDRAW_LIMIT:
                remaining = AT_DAILY_WITHDRAW_LIMIT - daily_withdrawn
                raise HTTPException(
                    429,
                    f"Daily withdrawal limit reached. You can withdraw {remaining} more AT today "
                    f"(limit: {AT_DAILY_WITHDRAW_LIMIT} AT / day).",
                )

            # ── Balance check ─────────────────────────────────────────────────
            if int(at_balance) < at_amount:
                raise HTTPException(
                    402,
                    f"Insufficient Arena Tokens. You have {int(at_balance)} AT, "
                    f"withdrawal requires {at_amount} AT.",
                )

            # ── Burn AT ───────────────────────────────────────────────────────
            session.execute(
                text(
                    "UPDATE users "
                    "SET at_balance = at_balance - :amt, "
                    "    at_daily_withdrawn = at_daily_withdrawn + :amt "
                    "WHERE id = :uid"
                ),
                {"amt": at_amount, "uid": user_id},
            )

            # ── Record transaction ────────────────────────────────────────────
            session.execute(
                text(
                    "INSERT INTO transactions (user_id, type, amount, token, status, reference) "
                    "VALUES (:uid, 'at_withdrawal', :amt, 'AT', 'pending', :ref)"
                ),
                {
                    "uid":  user_id,
                    "amt":  at_amount,
                    "ref":  f"withdraw_{at_amount}_AT_to_{wallet_address[:10]}",
                },
            )

            new_balance_row = session.execute(
                text("SELECT at_balance FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            new_balance = int(new_balance_row[0])

            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("withdraw_at error: %s", exc)
        raise HTTPException(500, "Withdrawal failed")

    # CONTRACT-ready: send BNB to wallet_address from platform wallet
    # When BLOCKCHAIN_RPC_URL + PLATFORM_WALLET_ADDRESS are set:
    #   w3 = Web3(Web3.HTTPProvider(BLOCKCHAIN_RPC_URL))
    #   bnb_amount = usdt_value / bnb_price_usd
    #   tx = w3.eth.send_transaction({from: PLATFORM_WALLET_ADDRESS, to: wallet_address, value: bnb_amount})
    tx_hash_placeholder = None
    if BLOCKCHAIN_RPC_URL and PLATFORM_WALLET_ADDRESS:
        logger.info(
            "withdraw_at: CONTRACT-ready — would send %.4f USDT in BNB to %s",
            usdt_value, wallet_address,
        )

    logger.info(
        "withdraw_at: user=%s burned %d AT → $%.2f USDT to %s",
        user_id, at_amount, usdt_value, wallet_address,
    )

    return {
        "at_burned":      at_amount,
        "usdt_value":     round(usdt_value, 2),
        "wallet_address": wallet_address,
        "at_balance":     new_balance,
        "tx_hash":        tx_hash_placeholder,
        "rate":           f"{rate} AT = $1 USDT",
        "daily_remaining": AT_DAILY_WITHDRAW_LIMIT - (daily_withdrawn + at_amount),
    }


# ── AT packages ───────────────────────────────────────────────────────────────


@app.get("/wallet/at-packages")
async def get_at_packages():
    """
    Return all active AT purchase packages with discount info.

    DB-ready: reads at_packages table (seeded in migration 008).
    Response per package:
      at_amount    — tokens received
      usdt_price   — full price in USDT
      discount_pct — discount percentage
      final_price  — USDT after discount (usdt_price * (1 - discount_pct/100))
    """
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT DISTINCT ON (at_amount) at_amount, usdt_price, discount_pct "
                    "FROM at_packages WHERE active = TRUE ORDER BY at_amount, id"
                )
            ).fetchall()
    except Exception as exc:
        logger.error("get_at_packages error: %s", exc)
        raise HTTPException(500, "Failed to load packages")

    packages = []
    for at_amount, usdt_price, discount_pct in rows:
        disc = float(discount_pct or 0)
        final = round(float(usdt_price) * (1 - disc / 100), 2)
        packages.append({
            "at_amount":    int(at_amount),
            "usdt_price":   float(usdt_price),
            "discount_pct": disc,
            "final_price":  final,
        })

    return {"packages": packages}


class BuyAtPackageRequest(BaseModel):
    """
    POST /wallet/buy-at-package — buy a fixed AT package (with discount).

    tx_hash    — MetaMask USDT transfer proof
    at_amount  — must match one of the active at_packages rows exactly
    """
    tx_hash: str
    at_amount: int


@app.post("/wallet/buy-at-package")
async def buy_at_package(req: BuyAtPackageRequest, payload: dict = Depends(verify_token)):
    """
    Credit Arena Tokens for a pre-defined discounted package purchase.

    Flow:
      1. User transfers USDT (final_price) to platform wallet via MetaMask.
      2. Frontend sends tx_hash + at_amount.
      3. Backend validates at_amount matches a package, credits AT.

    CONTRACT-ready: tx_hash should be verified on-chain before crediting.
    DB-ready: UPDATE users SET at_balance + :at; INSERT transactions.
    """
    user_id: str = payload["sub"]
    _check_rate_limit(f"buy_at_pkg:{user_id}", max_calls=3, window_secs=60)

    try:
        with SessionLocal() as session:
            # ── Dedup: reject replayed on-chain transactions ──────────────────
            if req.tx_hash:
                duplicate = session.execute(
                    text("SELECT 1 FROM transactions WHERE tx_hash = :h"),
                    {"h": req.tx_hash},
                ).fetchone()
                if duplicate:
                    raise HTTPException(409, "This transaction has already been processed")

            pkg = session.execute(
                text(
                    "SELECT at_amount, usdt_price, discount_pct "
                    "FROM at_packages WHERE at_amount = :amt AND active = TRUE"
                ),
                {"amt": req.at_amount},
            ).fetchone()

            if not pkg:
                raise HTTPException(404, f"No active package for {req.at_amount} AT")

            at_amount, usdt_price, discount_pct = pkg
            disc = float(discount_pct or 0)
            final_price = round(float(usdt_price) * (1 - disc / 100), 2)

            result = session.execute(
                text(
                    "UPDATE users SET at_balance = at_balance + :at "
                    "WHERE id = :uid RETURNING at_balance"
                ),
                {"at": int(at_amount), "uid": user_id},
            ).fetchone()

            if not result:
                raise HTTPException(404, "User not found")

            # Include tx_hash so the UNIQUE index blocks any future replay.
            session.execute(
                text(
                    "INSERT INTO transactions "
                    "(user_id, type, amount, token, status, tx_hash) "
                    "VALUES (:uid, 'at_purchase', :amt, 'AT', 'completed', :txh)"
                ),
                {"uid": user_id, "amt": int(at_amount), "txh": req.tx_hash or None},
            )
            session.commit()
            new_balance = int(result[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("buy_at_package error: %s", exc)
        raise HTTPException(500, "Purchase failed")

    logger.info(
        "buy_at_package: user=%s pkg=%d AT final=%.2f USDT tx=%s",
        user_id, req.at_amount, final_price, req.tx_hash,
    )
    return {
        "at_balance":   new_balance,
        "at_credited":  req.at_amount,
        "usdt_spent":   final_price,
        "discount_pct": disc,
    }


# ── Forge purchase ─────────────────────────────────────────────────────────────

class ForgePurchaseRequest(BaseModel):
    """
    POST /forge/purchase — spend AT to unlock a Forge item.

    item_slug: unique item identifier from forge_items.slug
               (e.g. "avatar-dragon", "badge-founders")
    """
    item_slug: str


@app.post("/forge/purchase")
async def forge_purchase(req: ForgePurchaseRequest, payload: dict = Depends(verify_token)):
    """
    Purchase a Forge item with Arena Tokens.

    Flow:
      1. Fetch item from forge_items by slug — 404 if not found / not active.
      2. Check user does not already own it — 409 if duplicate.
      3. Check at_balance >= price_at — 400 if insufficient.
      4. Deduct at_balance, add slug to forge_unlocked_item_ids, insert forge_purchase row.
      5. Return new at_balance + item_slug.

    DB-ready: writes to users (at_balance, forge_unlocked_item_ids) + forge_purchases.
    """
    user_id: str = payload["sub"]

    try:
        with SessionLocal() as session:
            # ── 1. Fetch item ─────────────────────────────────────────────────
            item_row = session.execute(
                text(
                    "SELECT id, price_at FROM forge_items "
                    "WHERE slug = :slug AND active = TRUE"
                ),
                {"slug": req.item_slug},
            ).fetchone()

            if not item_row:
                raise HTTPException(404, f"Item '{req.item_slug}' not found or unavailable")

            item_id, price_at = item_row

            if price_at is None:
                raise HTTPException(400, f"Item '{req.item_slug}' is not available for Arena Tokens")

            # ── 2. Already owned? ─────────────────────────────────────────────
            user_row = session.execute(
                text("SELECT at_balance, forge_unlocked_item_ids FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            at_balance, owned_ids = user_row
            owned_ids = list(owned_ids) if owned_ids else []

            if req.item_slug in owned_ids:
                raise HTTPException(409, f"You already own '{req.item_slug}'")

            # ── 3. Sufficient AT? ─────────────────────────────────────────────
            if at_balance < price_at:
                raise HTTPException(
                    400,
                    f"Insufficient Arena Tokens. Need {price_at} AT, you have {at_balance} AT.",
                )

            # ── 4. Deduct + unlock ────────────────────────────────────────────
            new_ids = owned_ids + [req.item_slug]
            result = session.execute(
                text("""
                    UPDATE users
                       SET at_balance              = at_balance - :cost,
                           forge_unlocked_item_ids = :ids
                     WHERE id = :uid
                    RETURNING at_balance
                """),
                {"cost": price_at, "ids": new_ids, "uid": user_id},
            ).fetchone()

            session.execute(
                text(
                    "INSERT INTO forge_purchases (user_id, item_id, currency, amount) "
                    "VALUES (:uid, :iid, 'AT', :cost)"
                ),
                {"uid": user_id, "iid": str(item_id), "cost": price_at},
            )
            session.commit()
            new_balance = int(result[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("forge_purchase error: %s", exc)
        raise HTTPException(500, "Purchase failed")

    logger.info(
        "forge_purchase: user=%s bought %s for %d AT (balance now %d)",
        user_id, req.item_slug, price_at, new_balance,
    )
    return {
        "at_balance": new_balance,
        "item_slug":  req.item_slug,
    }


# ── Change password ────────────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    """
    POST /auth/change-password — update the authenticated user's password.

    current_password: must match the bcrypt hash stored in users.password_hash.
    new_password:     minimum 8 characters; bcrypt-hashed before storage.
    """
    current_password: str
    new_password: str


@app.post("/auth/change-password", status_code=200)
async def change_password(req: ChangePasswordRequest, payload: dict = Depends(verify_token)):
    """
    Change the authenticated user's password.

    Steps:
      1. Fetch current password_hash from DB.
      2. Verify current_password against the stored hash — 400 if wrong.
      3. Hash new_password and UPDATE users.password_hash.

    DB-ready: reads and writes users.password_hash.
    """
    user_id: str = payload["sub"]

    if len(req.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")

    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT password_hash FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not row:
                raise HTTPException(404, "User not found")

            if row[0] is None:
                raise HTTPException(
                    400,
                    "This account signs in with Google — use Google to access your account",
                )

            if not auth.verify_password(req.current_password, row[0]):
                raise HTTPException(400, "Current password is incorrect")

            new_hash = auth.hash_password(req.new_password)
            session.execute(
                text("UPDATE users SET password_hash = :h, updated_at = NOW() WHERE id = :uid"),
                {"h": new_hash, "uid": user_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("change_password error: %s", exc)
        raise HTTPException(500, "Password change failed")

    return {"changed": True}


# ── Friendships ────────────────────────────────────────────────────────────────

class FriendRequestBody(BaseModel):
    """
    POST /friends/request — send a friend request.

    user_id: UUID of the target user.
    message: optional greeting message (stored in friendships.message).
    """
    user_id: str
    message: str | None = None


@app.post("/friends/request", status_code=201)
async def send_friend_request(req: FriendRequestBody, payload: dict = Depends(verify_token)):
    """
    Send a friend request to another user.

    Rules:
      - Cannot friend yourself.
      - If a pending/accepted/blocked friendship already exists (either direction) → 409.
      - Inserts a new row with status='pending'.

    DB-ready: inserts into friendships table.
    """
    me: str = payload["sub"]

    if me == req.user_id:
        raise HTTPException(400, "Cannot send a friend request to yourself")

    try:
        with SessionLocal() as session:
            # Check target user exists
            target = session.execute(
                text("SELECT id FROM users WHERE id = :uid"),
                {"uid": req.user_id},
            ).fetchone()
            if not target:
                raise HTTPException(404, "User not found")

            # Check no existing friendship in either direction
            existing = session.execute(
                text(
                    "SELECT id, status FROM friendships "
                    "WHERE (initiator_id = :me AND receiver_id = :them) "
                    "   OR (initiator_id = :them AND receiver_id = :me)"
                ),
                {"me": me, "them": req.user_id},
            ).fetchone()

            if existing:
                status_val = existing[1]
                if status_val == "blocked":
                    raise HTTPException(403, "Cannot send a friend request to this user")
                raise HTTPException(409, "A friend request or friendship already exists")

            session.execute(
                text(
                    "INSERT INTO friendships (initiator_id, receiver_id, message) "
                    "VALUES (:me, :them, :msg)"
                ),
                {"me": me, "them": req.user_id, "msg": req.message},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("send_friend_request error: %s", exc)
        raise HTTPException(500, "Request failed")

    return {"sent": True, "to": req.user_id}


@app.get("/friends")
async def list_friends(payload: dict = Depends(verify_token)):
    """
    List all accepted friends for the authenticated user.

    Returns each friend's basic profile: user_id, username, avatar, arena_id.
    DB-ready: friendships JOIN users.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT u.id, u.username, u.arena_id, u.avatar, u.equipped_badge_icon "
                    "FROM friendships f "
                    "JOIN users u ON u.id = CASE "
                    "  WHEN f.initiator_id = :me THEN f.receiver_id "
                    "  ELSE f.initiator_id END "
                    "WHERE (f.initiator_id = :me OR f.receiver_id = :me) "
                    "  AND f.status = 'accepted' "
                    "ORDER BY u.username ASC"
                ),
                {"me": me},
            ).fetchall()
    except Exception as exc:
        logger.error("list_friends error: %s", exc)
        raise HTTPException(500, "Failed to load friends")

    return {
        "friends": [
            {
                "user_id":             str(r[0]),
                "username":            r[1],
                "arena_id":            r[2],
                "avatar":              r[3],
                "equipped_badge_icon": r[4],
            }
            for r in rows
        ]
    }


@app.get("/friends/requests")
async def list_friend_requests(payload: dict = Depends(verify_token)):
    """
    List pending friend requests for the authenticated user.

    Returns:
      incoming: requests where I am the receiver (I can accept/reject)
      outgoing: requests I sent (I can cancel)

    DB-ready: friendships JOIN users.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            incoming_rows = session.execute(
                text(
                    "SELECT f.id, u.id, u.username, u.arena_id, u.avatar, f.message, f.created_at "
                    "FROM friendships f "
                    "JOIN users u ON u.id = f.initiator_id "
                    "WHERE f.receiver_id = :me AND f.status = 'pending' "
                    "ORDER BY f.created_at DESC"
                ),
                {"me": me},
            ).fetchall()

            outgoing_rows = session.execute(
                text(
                    "SELECT f.id, u.id, u.username, u.arena_id, u.avatar, f.message, f.created_at "
                    "FROM friendships f "
                    "JOIN users u ON u.id = f.receiver_id "
                    "WHERE f.initiator_id = :me AND f.status = 'pending' "
                    "ORDER BY f.created_at DESC"
                ),
                {"me": me},
            ).fetchall()

    except Exception as exc:
        logger.error("list_friend_requests error: %s", exc)
        raise HTTPException(500, "Failed to load friend requests")

    def _fmt(rows: list) -> list:
        return [
            {
                "request_id": str(r[0]),
                "user_id":    str(r[1]),
                "username":   r[2],
                "arena_id":   r[3],
                "avatar":     r[4],
                "message":    r[5],
                "created_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]

    return {
        "incoming": _fmt(incoming_rows),
        "outgoing": _fmt(outgoing_rows),
    }


@app.post("/friends/{user_id}/accept", status_code=200)
async def accept_friend_request(user_id: str, payload: dict = Depends(verify_token)):
    """
    Accept a pending friend request from user_id.

    Only the receiver can accept. Updates status → 'accepted'.
    DB-ready: UPDATE friendships.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE initiator_id = :them AND receiver_id = :me AND status = 'pending'"
                ),
                {"them": user_id, "me": me},
            ).fetchone()

            if not row:
                raise HTTPException(404, "No pending friend request found from this user")

            session.execute(
                text(
                    "UPDATE friendships SET status = 'accepted', updated_at = NOW() "
                    "WHERE id = :fid"
                ),
                {"fid": str(row[0])},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("accept_friend_request error: %s", exc)
        raise HTTPException(500, "Accept failed")

    return {"accepted": True, "friend_id": user_id}


@app.post("/friends/{user_id}/reject", status_code=200)
async def reject_friend_request(user_id: str, payload: dict = Depends(verify_token)):
    """
    Reject (delete) a pending friend request from user_id.

    Only the receiver can reject. Deletes the friendship row.
    DB-ready: DELETE FROM friendships.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE initiator_id = :them AND receiver_id = :me AND status = 'pending'"
                ),
                {"them": user_id, "me": me},
            ).fetchone()

            if not row:
                raise HTTPException(404, "No pending friend request found from this user")

            session.execute(
                text("DELETE FROM friendships WHERE id = :fid"),
                {"fid": str(row[0])},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("reject_friend_request error: %s", exc)
        raise HTTPException(500, "Reject failed")

    return {"rejected": True, "from": user_id}


@app.delete("/friends/{user_id}", status_code=200)
async def remove_friend(user_id: str, payload: dict = Depends(verify_token)):
    """
    Remove an accepted friend (either direction).

    Deletes the friendship row regardless of who initiated it.
    DB-ready: DELETE FROM friendships.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE (initiator_id = :me AND receiver_id = :them) "
                    "   OR (initiator_id = :them AND receiver_id = :me) "
                    "  AND status = 'accepted'"
                ),
                {"me": me, "them": user_id},
            ).fetchone()

            if not row:
                raise HTTPException(404, "Friendship not found")

            session.execute(
                text("DELETE FROM friendships WHERE id = :fid"),
                {"fid": str(row[0])},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_friend error: %s", exc)
        raise HTTPException(500, "Remove failed")

    return {"removed": True, "user_id": user_id}


@app.post("/friends/{user_id}/block", status_code=200)
async def block_user(user_id: str, payload: dict = Depends(verify_token)):
    """
    Block a user.

    If a friendship exists (any status, either direction) → update it:
      set initiator_id=me, receiver_id=blocked_user, status='blocked'.
    If no friendship → insert a new blocked row.

    DB-ready: UPSERT on friendships.
    """
    me: str = payload["sub"]

    if me == user_id:
        raise HTTPException(400, "Cannot block yourself")

    try:
        with SessionLocal() as session:
            existing = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE (initiator_id = :me AND receiver_id = :them) "
                    "   OR (initiator_id = :them AND receiver_id = :me)"
                ),
                {"me": me, "them": user_id},
            ).fetchone()

            if existing:
                # Re-orient: blocker is always initiator, blocked is receiver
                session.execute(
                    text(
                        "UPDATE friendships "
                        "SET initiator_id = :me, receiver_id = :them, "
                        "    status = 'blocked', updated_at = NOW() "
                        "WHERE id = :fid"
                    ),
                    {"me": me, "them": user_id, "fid": str(existing[0])},
                )
            else:
                # Check target user exists
                target = session.execute(
                    text("SELECT id FROM users WHERE id = :uid"),
                    {"uid": user_id},
                ).fetchone()
                if not target:
                    raise HTTPException(404, "User not found")

                session.execute(
                    text(
                        "INSERT INTO friendships (initiator_id, receiver_id, status) "
                        "VALUES (:me, :them, 'blocked')"
                    ),
                    {"me": me, "them": user_id},
                )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("block_user error: %s", exc)
        raise HTTPException(500, "Block failed")

    return {"blocked": True, "user_id": user_id}


# ── Hub: Friends Online + Quick Invite ─────────────────────────────────────────


@app.get("/friends/online")
async def list_online_friends(payload: dict = Depends(verify_token)):
    """
    GET /friends/online — all accepted friends, with a client_online flag.

    Returns every accepted friend regardless of whether they have the desktop
    client running. The client_online / client_game fields are populated only
    when the friend has an active client_sessions row (heartbeat within 60s).
    This way friends logged into the website (no desktop client) still appear
    and can be invited — they'll see the invite via the website notification bell.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT DISTINCT ON (u.id) "
                    "       u.id, u.username, u.arena_id, u.avatar, "
                    "       u.equipped_badge_icon, "
                    "       cs.game, cs.status, "
                    "       (cs.id IS NOT NULL "
                    "        AND cs.disconnected_at IS NULL "
                    "        AND cs.last_heartbeat > NOW() - INTERVAL '60 seconds'"
                    "       ) AS client_online "
                    "FROM friendships f "
                    "JOIN users u ON u.id = CASE "
                    "  WHEN f.initiator_id = :me THEN f.receiver_id "
                    "  ELSE f.initiator_id END "
                    "LEFT JOIN client_sessions cs "
                    "  ON cs.user_id = u.id "
                    "  AND cs.disconnected_at IS NULL "
                    "  AND cs.last_heartbeat > NOW() - INTERVAL '60 seconds' "
                    "WHERE (f.initiator_id = :me OR f.receiver_id = :me) "
                    "  AND f.status = 'accepted' "
                    "ORDER BY u.id, u.username ASC"
                ),
                {"me": me},
            ).fetchall()
    except Exception as exc:
        logger.error("list_online_friends error: %s", exc)
        raise HTTPException(500, "Failed to load online friends")

    return {
        "friends": [
            {
                "user_id":             str(r[0]),
                "username":            r[1],
                "arena_id":            r[2],
                "avatar":              r[3],
                "equipped_badge_icon": r[4],
                "game":                r[5] if r[7] else None,
                "status":              r[6] if r[7] else None,
                "client_online":       bool(r[7]),
            }
            for r in rows
        ]
    }


@app.get("/hub/invites/pending")
async def get_pending_hub_invites(payload: dict = Depends(verify_token)):
    """
    GET /hub/invites/pending — unread match_invite notifications for the caller.

    Polled by the desktop client every 5 seconds to detect incoming game invites
    from friends. Returns up to 10 most-recent unread match_invite notifications.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT id, metadata, created_at "
                    "FROM notifications "
                    "WHERE user_id = :me "
                    "  AND type = 'match_invite' "
                    "  AND read = FALSE "
                    "ORDER BY created_at DESC "
                    "LIMIT 10"
                ),
                {"me": me},
            ).fetchall()
    except Exception as exc:
        logger.error("get_pending_hub_invites error: %s", exc)
        raise HTTPException(500, "Failed to load pending invites")

    def _meta(m, key, default=None):
        return (m or {}).get(key, default) if isinstance(m, dict) else default

    return {
        "invites": [
            {
                "notification_id":  str(r[0]),
                "match_id":         _meta(r[1], "match_id"),
                "inviter_id":       _meta(r[1], "inviter_id"),
                "inviter_username": _meta(r[1], "inviter_username", "A player"),
                "game":             _meta(r[1], "game"),
                "code":             _meta(r[1], "code"),
                "created_at":       r[2].isoformat() if r[2] else None,
            }
            for r in rows
        ]
    }


class HubQuickInviteRequest(BaseModel):
    """POST /hub/quick-invite body."""
    to_user_id: str


@app.post("/hub/quick-invite", status_code=201)
async def hub_quick_invite(req: HubQuickInviteRequest, payload: dict = Depends(verify_token)):
    """
    POST /hub/quick-invite — invite an accepted friend to the caller's current open room.

    The caller MUST have a 'waiting' match already open (created on the website).
    No match is created here; no balance check on the invitee — they handle that
    themselves on the website when they click JOIN.

    Returns { match_id, code, invite_url } so the desktop client can open the
    browser directly to the custom-matches lobby on accept.
    """
    me: str = payload["sub"]
    to_uid  = req.to_user_id.strip()

    if me == to_uid:
        raise HTTPException(400, "Cannot invite yourself")

    _check_rate_limit(f"hub_invite:{me}", max_calls=10, window_secs=60)

    import json as _json

    try:
        with SessionLocal() as session:
            # 1. Verified friendship
            friendship = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE ((initiator_id = :me AND receiver_id = :them) "
                    "    OR (initiator_id = :them AND receiver_id = :me)) "
                    "  AND status = 'accepted'"
                ),
                {"me": me, "them": to_uid},
            ).fetchone()
            if not friendship:
                raise HTTPException(403, "You are not friends with this user")

            # 2. Caller must have an open waiting room (created on the website)
            room = session.execute(
                text(
                    "SELECT m.id, m.code, m.game "
                    "FROM matches m "
                    "JOIN match_players mp ON mp.match_id = m.id "
                    "WHERE mp.user_id = :uid AND m.status = 'waiting' "
                    "LIMIT 1"
                ),
                {"uid": me},
            ).fetchone()
            if not room:
                raise HTTPException(
                    404,
                    "Open a match room on the website first, then invite from the client"
                )

            match_id  = str(room[0])
            room_code = room[1]
            game      = room[2] or "—"

            # 3. Duplicate invite guard
            dup = session.execute(
                text(
                    "SELECT id FROM notifications "
                    "WHERE user_id = :to "
                    "  AND type = 'match_invite' "
                    "  AND read = FALSE "
                    "  AND (metadata->>'inviter_id') = :me "
                    "  AND (metadata->>'match_id') = :mid "
                    "LIMIT 1"
                ),
                {"to": to_uid, "me": me, "mid": match_id},
            ).fetchone()
            if dup:
                raise HTTPException(
                    409,
                    "You already sent an invite to this friend for this room"
                )

            # 4. Caller's display name
            inviter = session.execute(
                text("SELECT username FROM users WHERE id = :uid"),
                {"uid": me},
            ).fetchone()
            inviter_name = inviter[0] if inviter else "A player"

            # 5. Send match_invite notification — no balance check (friend decides on website)
            session.execute(
                text(
                    "INSERT INTO notifications "
                    "  (user_id, type, title, message, metadata) "
                    "VALUES (:uid, 'match_invite', :title, :msg, :meta::jsonb)"
                ),
                {
                    "uid":   to_uid,
                    "title": f"{inviter_name} invited you to a match",
                    "msg":   f"{inviter_name} wants to play {game} with you. Room: {room_code}",
                    "meta":  _json.dumps({
                        "inviter_id":       me,
                        "inviter_username": inviter_name,
                        "match_id":         match_id,
                        "game":             game,
                        "code":             room_code,
                    }),
                },
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("hub_quick_invite error: %s", exc)
        raise HTTPException(500, "Failed to send invite")

    frontend_url = os.environ.get("FRONTEND_URL", "https://project-arena.com")
    return {
        "match_id":   match_id,
        "code":       room_code,
        "invite_url": f"{frontend_url}/lobby?tab=custom",
    }


# ── Direct Messages ────────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    """
    POST /messages — send a direct message to another user.

    receiver_id: UUID of the recipient.
    content:     message text; 1–2000 characters (enforced by DB CHECK constraint).
    """
    receiver_id: str
    content: str


@app.post("/messages", status_code=201)
async def send_message(req: SendMessageRequest, payload: dict = Depends(verify_token)):
    """
    Send a direct message to another user.

    Rules:
      - Cannot message yourself.
      - content must be 1–2000 characters.
      - Inserts into direct_messages; returns the new message id.

    DB-ready: INSERT into direct_messages.
    """
    me: str = payload["sub"]

    if me == req.receiver_id:
        raise HTTPException(400, "Cannot send a message to yourself")

    if not req.content or not req.content.strip():
        raise HTTPException(400, "Message content cannot be empty")

    if len(req.content) > 2000:
        raise HTTPException(400, "Message content exceeds 2000 characters")

    try:
        with SessionLocal() as session:
            # Verify receiver exists
            target = session.execute(
                text("SELECT id FROM users WHERE id = :uid"),
                {"uid": req.receiver_id},
            ).fetchone()
            if not target:
                raise HTTPException(404, "Recipient not found")

            row = session.execute(
                text(
                    "INSERT INTO direct_messages (sender_id, receiver_id, content) "
                    "VALUES (:sender, :receiver, :content) "
                    "RETURNING id, created_at"
                ),
                {"sender": me, "receiver": req.receiver_id, "content": req.content},
            ).fetchone()
            session.commit()
            msg_id = str(row[0])
            created_at = row[1].isoformat() if row[1] else None

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("send_message error: %s", exc)
        raise HTTPException(500, "Message send failed")

    return {
        "id":          msg_id,
        "sender_id":   me,
        "receiver_id": req.receiver_id,
        "content":     req.content,
        "created_at":  created_at,
    }


@app.get("/messages/unread/count")
async def messages_unread_count(payload: dict = Depends(verify_token)):
    """Unread DM + inbox (formal) messages for the authenticated user."""
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            dm = session.execute(
                text(
                    "SELECT COUNT(*) FROM direct_messages "
                    "WHERE receiver_id = :me AND read = FALSE"
                ),
                {"me": me},
            ).scalar()
            ib = session.execute(
                text(
                    "SELECT COUNT(*) FROM inbox_messages "
                    "WHERE receiver_id = :me AND read = FALSE AND deleted = FALSE"
                ),
                {"me": me},
            ).scalar()
    except Exception as exc:
        logger.error("messages_unread_count error: %s", exc)
        raise HTTPException(500, "Failed to count unread messages")
    total = int(dm or 0) + int(ib or 0)
    return {"count": total}


@app.get("/messages/{friend_id}")
async def get_conversation(
    friend_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    payload: dict = Depends(verify_token),
):
    """
    Get the conversation between the authenticated user and friend_id.

    Returns messages ordered oldest-first (ascending created_at).
    Optional ?limit= parameter (1–200, default 50).

    DB-ready: SELECT from direct_messages (both directions).
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT id, sender_id, receiver_id, content, read, created_at "
                    "FROM direct_messages "
                    "WHERE (sender_id = :me AND receiver_id = :them) "
                    "   OR (sender_id = :them AND receiver_id = :me) "
                    "ORDER BY created_at ASC "
                    "LIMIT :lim"
                ),
                {"me": me, "them": friend_id, "lim": limit},
            ).fetchall()
    except Exception as exc:
        logger.error("get_conversation error: %s", exc)
        raise HTTPException(500, "Failed to load conversation")

    return {
        "messages": [
            {
                "id":          str(r[0]),
                "sender_id":   str(r[1]),
                "receiver_id": str(r[2]),
                "content":     r[3],
                "read":        r[4],
                "created_at":  r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ]
    }


@app.post("/messages/{friend_id}/read", status_code=200)
async def mark_messages_read(friend_id: str, payload: dict = Depends(verify_token)):
    """
    Mark all unread messages from friend_id to the authenticated user as read.

    DB-ready: UPDATE direct_messages SET read = TRUE.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            result = session.execute(
                text(
                    "UPDATE direct_messages "
                    "SET read = TRUE "
                    "WHERE sender_id = :them AND receiver_id = :me AND read = FALSE"
                ),
                {"them": friend_id, "me": me},
            )
            session.commit()
            # rowcount may not be available with all drivers — use 0 as fallback
            updated = getattr(result, "rowcount", 0) or 0

    except Exception as exc:
        logger.error("mark_messages_read error: %s", exc)
        raise HTTPException(500, "Mark read failed")

    return {"marked_read": True, "count": updated}


# ── Stats update path (documentation) ─────────────────────────────────────────
#
# How wins / losses / xp are updated:
#
#   Path A — On-chain (Phase 6, primary):
#     1. Match completes → EscrowClient.declare_winner(match_id, winner_id) is called
#        (triggered from POST /match/result or the RageQuitDetector).
#     2. The ArenaEscrow contract emits WinnerDeclared(matchId, winner).
#     3. A future Oracle listener (Phase 6) subscribes to WinnerDeclared and calls:
#          UPDATE user_stats SET wins = wins + 1 WHERE user_id = :winner_id
#          UPDATE user_stats SET losses = losses + 1 WHERE user_id IN (loser_ids)
#          UPDATE user_stats SET xp = xp + :xp_gain WHERE user_id IN (all_players)
#        XP formula (Phase 6 TODO): win = +100 XP, loss = +25 XP (participation).
#
#   Path B — Direct API (current, for testing / custom matches):
#     POST /match/result  with { winner_id }
#       → currently only updates matches.status + matches.winner_id.
#       → DB-ready: will also UPDATE user_stats when winner_id is confirmed.
#
#   GET /auth/me returns:
#     xp, wins, losses  ← from user_stats (0 for new users)
#     at_balance         ← from users.at_balance (200 for new users)
#
# DB-ready: all stat updates write to user_stats table (user_id FK → users.id).
# CONTRACT-ready: WinnerDeclared event listener triggers stat writes.


# ── Match history ──────────────────────────────────────────────────────────────

@app.get("/matches/history")
async def match_history(
    game: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    payload: dict = Depends(verify_token),
):
    """
    Return the authenticated user's match history from DB.

    Optional filters:
      ?game=CS2|Valorant  — filter by game
      ?status=completed|cancelled|disputed  — filter by status
      ?limit=N            — max rows (1–100, default 20)

    Returns matches ordered newest-first, including opponent info and result.
    DB-ready: matches JOIN match_players JOIN users.
    """
    user_id: str = payload["sub"]

    conditions = ["mp.user_id = :uid", "m.status != 'waiting'", "m.status != 'in_progress'"]
    params: dict = {"uid": user_id, "lim": limit}

    if game:
        conditions.append("m.game = :game")
        params["game"] = _normalize_game(game)
    if status:
        conditions.append("m.status = :status")
        params["status"] = status

    where = " AND ".join(conditions)

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        m.id,
                        m.game,
                        m.mode,
                        m.status,
                        m.bet_amount,
                        m.winner_id,
                        m.created_at,
                        m.ended_at,
                        -- opponent: first other player in the match
                        (SELECT u2.username
                         FROM match_players mp2
                         JOIN users u2 ON u2.id = mp2.user_id
                         WHERE mp2.match_id = m.id AND mp2.user_id != :uid
                         LIMIT 1),
                        (SELECT u2.id
                         FROM match_players mp2
                         JOIN users u2 ON u2.id = mp2.user_id
                         WHERE mp2.match_id = m.id AND mp2.user_id != :uid
                         LIMIT 1),
                        (SELECT u2.avatar
                         FROM match_players mp2
                         JOIN users u2 ON u2.id = mp2.user_id
                         WHERE mp2.match_id = m.id AND mp2.user_id != :uid
                         LIMIT 1)
                    FROM matches m
                    JOIN match_players mp ON mp.match_id = m.id
                    WHERE {where}
                    ORDER BY m.created_at DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("match_history error: %s", exc)
        raise HTTPException(500, "Failed to load match history")

    return {
        "matches": [
            {
                "id":              str(r[0]),
                "game":            r[1],
                "mode":            r[2],
                "status":          r[3],
                "bet_amount":      float(r[4]) if r[4] is not None else 0.0,
                "result":          (
                    "win"  if r[5] and str(r[5]) == user_id else
                    "loss" if r[5] else
                    "draw"
                ),
                "winner_id":       str(r[5]) if r[5] else None,
                "created_at":      r[6].isoformat() if r[6] else None,
                "ended_at":        r[7].isoformat() if r[7] else None,
                "opponent":        r[8],
                "opponent_id":     str(r[9])  if r[9]  else None,
                "opponent_avatar": r[10],
            }
            for r in rows
        ]
    }


# ── Available matches (lobby) ──────────────────────────────────────────────────

@app.get("/matches")
async def list_matches(
    game: str | None = Query(default=None),
    mode: str | None = Query(default=None),
    match_type: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    token: dict | None = Depends(optional_token),
):
    """
    List open (waiting) matches available to join.

    Optional filters:
      ?game=CS2|Valorant     — filter by game
      ?mode=1v1|2v2|4v4|5v5  — filter by mode
      ?match_type=public|custom
      ?limit=N               — max rows (1–100, default 20)

    Returns matches with host info and current player count.
    DB-ready: matches JOIN match_players JOIN users.
    """
    conditions = ["m.status = 'waiting'"]
    params: dict = {"lim": limit}

    if game:
        conditions.append("m.game = :game")
        params["game"] = _normalize_game(game)
    if mode:
        conditions.append("m.mode = :mode")
        params["mode"] = mode.strip()
    if match_type:
        conditions.append("m.type = :mtype")
        params["mtype"] = match_type.strip()

    where = " AND ".join(conditions)

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        m.id,
                        m.game,
                        m.mode,
                        m.type,
                        m.bet_amount,
                        m.status,
                        m.code,
                        m.created_at,
                        m.max_players,
                        u.username              AS host_username,
                        u.id                    AS host_id,
                        u.avatar                AS host_avatar,
                        COUNT(mp.user_id)       AS player_count,
                        m.max_per_team,
                        m.stake_currency,
                        (m.password IS NOT NULL) AS has_password
                    FROM matches m
                    JOIN users u ON u.id = m.host_id
                    LEFT JOIN match_players mp ON mp.match_id = m.id
                    WHERE {where}
                    GROUP BY m.id, u.id
                    ORDER BY m.created_at DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()

            # ── Secondary query: ordered roster for all returned matches ──────
            # One JOIN query for all match_ids avoids N+1.
            # Ordered by joined_at so client sees stable slot order.
            roster_by_match: dict[str, list[dict]] = {}
            if rows:
                match_ids = [str(r[0]) for r in rows]
                # Build named placeholders (:mid0, :mid1, …) — safe, no injection risk.
                placeholders = ", ".join(f":mid{i}" for i in range(len(match_ids)))
                roster_params = {f"mid{i}": mid for i, mid in enumerate(match_ids)}
                roster_rows = session.execute(
                    text(
                        f"SELECT mp.match_id, u.id, u.username, "
                        f"       COALESCE(mp.team, 'A') AS team "
                        f"FROM match_players mp "
                        f"JOIN users u ON u.id = mp.user_id "
                        f"WHERE mp.match_id IN ({placeholders}) "
                        f"ORDER BY mp.match_id, mp.joined_at"
                    ),
                    roster_params,
                ).fetchall()
                for rr in roster_rows:
                    mid = str(rr[0])
                    roster_by_match.setdefault(mid, []).append({
                        "user_id":  str(rr[1]),
                        "username": rr[2],
                        "team":     rr[3],
                    })

    except Exception as exc:
        logger.error("list_matches error: %s", exc)
        raise HTTPException(500, "Failed to load matches")

    result_matches = []
    for r in rows:
        mid = str(r[0])
        players_list = roster_by_match.get(mid, [])
        team_a = [p for p in players_list if p["team"] == "A"]
        team_b = [p for p in players_list if p["team"] == "B"]
        result_matches.append({
            "id":             mid,
            "game":           r[1],
            "mode":           r[2],
            "type":           r[3],
            "bet_amount":     float(r[4]) if r[4] is not None else 0.0,
            "status":         r[5],
            "code":           r[6],
            "created_at":     r[7].isoformat() if r[7] else None,
            "max_players":    r[8],
            "host_username":  r[9],
            "host_id":        str(r[10]) if r[10] else None,
            "host_avatar":    r[11],
            "player_count":   int(r[12]),
            "max_per_team":   r[13],
            "stake_currency": r[14],
            "has_password":   bool(r[15]),
            # Ordered roster — client uses this for slot display and team counts.
            # team may be None until team-assignment logic is added (Doc B §4).
            "players":        players_list,
            "team_a_count":   len(team_a),
            "team_b_count":   len(team_b),
        })

    return {"matches": result_matches}


# ── Leaderboard ────────────────────────────────────────────────────────────────

def _leaderboard_game_scope_sql(game: str | None) -> tuple[str, dict[str, object]]:
    """
    Users visible on a per-game tab: preferred_game matches OR they have played
    that game at least once. (Previously only match_players — hid users who
    never completed a ranked row but still identify as CS2/Valorant.)
    """
    if not game:
        return "", {}
    g = _normalize_game(game)
    if g not in _VALID_GAMES:
        raise HTTPException(400, f"Invalid game: {game}")
    clause = """
        AND (
            u.preferred_game = :game
            OR u.id IN (
                SELECT DISTINCT mp.user_id FROM match_players mp
                JOIN matches m ON m.id = mp.match_id
                WHERE m.game = :game
            )
        )
    """
    return clause, {"game": g}


def _leaderboard_range_days(range_raw: str | None) -> int | None:
    """weekly → 7, monthly → 30, else all-time (lifetime user_stats)."""
    if not range_raw:
        return None
    r = range_raw.strip().lower()
    if r == "weekly":
        return 7
    if r == "monthly":
        return 30
    if r in ("alltime", "all_time", "all-time"):
        return None
    raise HTTPException(400, f"Invalid range: {range_raw}")


@app.get("/leaderboard")
async def leaderboard(
    game: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    range_param: str | None = Query(default=None, alias="range"),
    token: dict | None = Depends(optional_token),
):
    """
    Return the top players ranked by wins then xp.

    Optional filters:
      ?game=CS2|Valorant  — roster = preferred_game OR ≥1 match in that game
      ?range=weekly|monthly|alltime — weekly/monthly use completed matches in
        the window (wins/losses/matches/win_rate); xp and total_earnings stay
        lifetime from user_stats. alltime (default) uses full user_stats row.
      ?limit=N            — top N players (1–200, default 50)

    Returns user profile fields + stats for leaderboard display.
    DB-ready: users JOIN user_stats ORDER BY wins DESC, xp DESC.
    """
    params: dict[str, object] = {"lim": limit}
    game_filter, game_params = _leaderboard_game_scope_sql(game)
    params.update(game_params)

    period_days = _leaderboard_range_days(range_param)

    try:
        with SessionLocal() as session:
            if period_days is None:
                rows = session.execute(
                    text(f"""
                        SELECT
                            u.id,
                            u.username,
                            u.arena_id,
                            u.avatar,
                            u.equipped_badge_icon,
                            u.rank,
                            COALESCE(s.wins,    0) AS wins,
                            COALESCE(s.losses,  0) AS losses,
                            COALESCE(s.matches, 0) AS matches,
                            COALESCE(s.win_rate, 0) AS win_rate,
                            COALESCE(s.xp,      0) AS xp,
                            COALESCE(s.total_earnings, 0) AS total_earnings
                        FROM users u
                        LEFT JOIN user_stats s ON s.user_id = u.id
                        WHERE u.id != '00000000-0000-0000-0000-000000000001' {game_filter}
                        ORDER BY wins DESC, xp DESC
                        LIMIT :lim
                    """),
                    params,
                ).fetchall()
            else:
                inner_game = "AND m.game = :game" if game_params.get("game") else ""
                params_period = dict(params)
                params_period["lb_days"] = period_days
                rows = session.execute(
                    text(f"""
                        SELECT
                            u.id,
                            u.username,
                            u.arena_id,
                            u.avatar,
                            u.equipped_badge_icon,
                            u.rank,
                            COALESCE(ps.wins, 0) AS wins,
                            COALESCE(ps.losses, 0) AS losses,
                            COALESCE(ps.matches, 0) AS matches,
                            CASE
                                WHEN COALESCE(ps.matches, 0) > 0 THEN
                                    ROUND(
                                        COALESCE(ps.wins, 0)::NUMERIC
                                        / NULLIF(ps.matches, 0) * 100,
                                        2
                                    )
                                ELSE 0
                            END AS win_rate,
                            COALESCE(s.xp, 0) AS xp,
                            COALESCE(s.total_earnings, 0) AS total_earnings
                        FROM users u
                        LEFT JOIN user_stats s ON s.user_id = u.id
                        LEFT JOIN (
                            SELECT
                                mp.user_id,
                                COUNT(*)::INT AS matches,
                                SUM(
                                    CASE WHEN m.winner_id IS NOT NULL
                                         AND m.winner_id = mp.user_id
                                    THEN 1 ELSE 0 END
                                )::INT AS wins,
                                SUM(
                                    CASE WHEN m.winner_id IS NOT NULL
                                         AND m.winner_id <> mp.user_id
                                    THEN 1 ELSE 0 END
                                )::INT AS losses
                            FROM match_players mp
                            INNER JOIN matches m ON m.id = mp.match_id
                            WHERE m.status = 'completed'
                              AND m.ended_at IS NOT NULL
                              AND m.ended_at >= NOW() - make_interval(days => :lb_days)
                              {inner_game}
                            GROUP BY mp.user_id
                        ) ps ON ps.user_id = u.id
                        WHERE u.id != '00000000-0000-0000-0000-000000000001' {game_filter}
                        ORDER BY wins DESC, xp DESC
                        LIMIT :lim
                    """),
                    params_period,
                ).fetchall()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("leaderboard error: %s", exc)
        raise HTTPException(500, "Failed to load leaderboard")

    return {
        "leaderboard": [
            {
                "rank":            idx + 1,
                "user_id":         str(r[0]),
                "username":        r[1],
                "arena_id":        r[2],
                "avatar":          r[3],
                "equipped_badge":  r[4],
                "tier":            r[5],
                "wins":            int(r[6]),
                "losses":          int(r[7]),
                "matches":         int(r[8]),
                "win_rate":        float(r[9]),
                "xp":              int(r[10]),
                "total_earnings":  float(r[11]),
            }
            for idx, r in enumerate(rows)
        ]
    }


# ── Player search ──────────────────────────────────────────────────────────────

@app.get("/players")
async def search_players(
    q: str | None = Query(default=None),
    game: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    token: dict | None = Depends(optional_token),
):
    """
    Search players by username or ArenaID.

    Query params:
      ?q=<string>           — case-insensitive search on username / arena_id
      ?game=CS2|Valorant    — filter to players who have a steam_id (CS2) or riot_id (Valorant)
      ?limit=N              — max results (1–50, default 20)

    Returns public profile fields + summary stats (no email, no wallet).
    DB-ready: users LEFT JOIN user_stats WHERE username ILIKE or arena_id ILIKE.
    """
    conditions: list[str] = ["u.id != '00000000-0000-0000-0000-000000000001'"]
    params: dict = {"lim": limit}

    if q and q.strip():
        q_clean = q.strip()
        conditions.append(
            "(u.username ILIKE :q OR u.arena_id ILIKE :q)"
        )
        params["q"] = f"%{q_clean}%"

    if game:
        g = _normalize_game(game)
        if g == "CS2":
            conditions.append("u.steam_id IS NOT NULL")
        elif g == "Valorant":
            conditions.append("u.riot_id IS NOT NULL")

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        u.id,
                        u.username,
                        u.arena_id,
                        u.avatar,
                        u.equipped_badge_icon,
                        u.rank,
                        COALESCE(s.wins,    0),
                        COALESCE(s.losses,  0),
                        COALESCE(s.matches, 0),
                        COALESCE(s.win_rate, 0),
                        COALESCE(s.xp,      0)
                    FROM users u
                    LEFT JOIN user_stats s ON s.user_id = u.id
                    {where}
                    ORDER BY s.wins DESC NULLS LAST
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("search_players error: %s", exc)
        raise HTTPException(500, "Player search failed")

    return {
        "players": [
            {
                "user_id":        str(r[0]),
                "username":       r[1],
                "arena_id":       r[2],
                "avatar":         r[3],
                "equipped_badge": r[4],
                "rank":           r[5],
                "wins":           int(r[6]),
                "losses":         int(r[7]),
                "matches":        int(r[8]),
                "win_rate":       float(r[9]),
                "xp":             int(r[10]),
            }
            for r in rows
        ]
    }


# ── Public player profile ──────────────────────────────────────────────────────

@app.get("/players/{user_id}")
async def get_player_profile(
    user_id: str,
    token: dict | None = Depends(optional_token),
):
    """
    Fetch a public player profile by user_id.

    Returns public fields only — no email, no wallet address.
    DB-ready: users LEFT JOIN user_stats.
    """
    if user_id == "00000000-0000-0000-0000-000000000001":
        raise HTTPException(404, "Player not found")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("""
                    SELECT
                        u.id,
                        u.username,
                        u.arena_id,
                        u.avatar,
                        u.avatar_bg,
                        u.equipped_badge_icon,
                        u.rank,
                        COALESCE(s.wins,    0),
                        COALESCE(s.losses,  0),
                        COALESCE(s.matches, 0),
                        COALESCE(s.win_rate, 0),
                        COALESCE(s.xp,      0),
                        COALESCE(s.total_earnings, 0),
                        u.forge_unlocked_item_ids,
                        u.vip_expires_at,
                        u.steam_id,
                        u.riot_id
                    FROM users u
                    LEFT JOIN user_stats s ON s.user_id = u.id
                    WHERE u.id = :uid
                """),
                {"uid": user_id},
            ).fetchone()
    except Exception as exc:
        logger.error("get_player_profile error: %s", exc)
        raise HTTPException(500, "Profile fetch failed")

    if not row:
        raise HTTPException(404, "Player not found")

    return {
        "user_id":              str(row[0]),
        "username":             row[1],
        "arena_id":             row[2],
        "avatar":               row[3],
        "avatar_bg":            row[4],
        "equipped_badge_icon":  row[5],
        "rank":                 row[6],
        "wins":                 int(row[7]),
        "losses":               int(row[8]),
        "matches":              int(row[9]),
        "win_rate":             float(row[10]),
        "xp":                   int(row[11]),
        "total_earnings":       float(row[12]),
        "forge_unlocked_item_ids": list(row[13]) if row[13] else [],
        "vip_expires_at":       row[14].isoformat() if row[14] else None,
        "has_steam":            row[15] is not None,
        "has_riot":             row[16] is not None,
    }


# ── Inbox ──────────────────────────────────────────────────────────────────────
#
# inbox_messages: formal user-to-user messages with a subject line.
# Different from direct_messages (DMs): inbox = notifications / formal comms.
# System auto-notifications (match won/lost) are sent here by the engine itself
# using the ARENA_SYSTEM_USER_ID env var (a seeded platform user UUID).
# If ARENA_SYSTEM_USER_ID is not set, auto-notifications are silently skipped.
#
# DB-ready: inbox_messages table (init.sql).
# Cursor connects: inboxStore.ts → these endpoints.

_SYSTEM_USER_ID: str | None = os.getenv("ARENA_SYSTEM_USER_ID")


def _send_system_inbox(session, receiver_id: str, subject: str, content: str) -> None:
    """
    Insert a system notification into inbox_messages.
    Silently skipped when ARENA_SYSTEM_USER_ID is not configured.
    DB-ready: requires a seeded 'arena_system' user row in users table.
    """
    if not _SYSTEM_USER_ID:
        return
    try:
        session.execute(
            text(
                "INSERT INTO inbox_messages (sender_id, receiver_id, subject, content) "
                "VALUES (:sid, :rid, :sub, :con)"
            ),
            {
                "sid": _SYSTEM_USER_ID,
                "rid": receiver_id,
                "sub": subject,
                "con": content,
            },
        )
    except Exception as exc:
        logger.warning("_send_system_inbox failed (non-fatal): %s", exc)


class SendInboxRequest(BaseModel):
    """
    POST /inbox — send a formal inbox message to another user.

    receiver_id: UUID of the recipient.
    subject:     up to 200 characters.
    content:     1–5000 characters.
    """
    receiver_id: str
    subject: str
    content: str


@app.post("/inbox", status_code=201)
async def send_inbox_message(req: SendInboxRequest, payload: dict = Depends(verify_token)):
    """
    Send a formal inbox message (with subject) to another user.

    Rules:
      - Cannot message yourself.
      - subject: 1–200 chars; content: 1–5000 chars.
      - Receiver must exist.

    DB-ready: INSERT into inbox_messages.
    """
    me: str = payload["sub"]

    if me == req.receiver_id:
        raise HTTPException(400, "Cannot send an inbox message to yourself")

    subject = req.subject.strip()
    content = req.content.strip()

    if not subject:
        raise HTTPException(400, "Subject cannot be empty")
    if len(subject) > 200:
        raise HTTPException(400, "Subject exceeds 200 characters")
    if not content:
        raise HTTPException(400, "Content cannot be empty")
    if len(content) > 5000:
        raise HTTPException(400, "Content exceeds 5000 characters")

    try:
        with SessionLocal() as session:
            target = session.execute(
                text("SELECT id FROM users WHERE id = :uid"),
                {"uid": req.receiver_id},
            ).fetchone()
            if not target:
                raise HTTPException(404, "Recipient not found")

            row = session.execute(
                text(
                    "INSERT INTO inbox_messages (sender_id, receiver_id, subject, content) "
                    "VALUES (:sid, :rid, :sub, :con) "
                    "RETURNING id, created_at"
                ),
                {
                    "sid": me,
                    "rid": req.receiver_id,
                    "sub": subject,
                    "con": content,
                },
            ).fetchone()
            session.commit()
            msg_id    = str(row[0])
            created_at = row[1].isoformat() if row[1] else None

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("send_inbox_message error: %s", exc)
        raise HTTPException(500, "Send failed")

    return {
        "id":          msg_id,
        "sender_id":   me,
        "receiver_id": req.receiver_id,
        "subject":     subject,
        "created_at":  created_at,
    }


@app.get("/inbox")
async def get_inbox(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    payload: dict = Depends(verify_token),
):
    """
    Return the authenticated user's inbox messages (not deleted), newest first.

    Optional:
      ?unread_only=true  — only unread messages
      ?limit=N           — max rows (1–100, default 30)

    Returns sender username + avatar alongside message fields.
    DB-ready: inbox_messages JOIN users.
    """
    me: str = payload["sub"]
    params: dict = {"me": me, "lim": limit}
    extra = "AND im.read = FALSE" if unread_only else ""

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        im.id,
                        im.subject,
                        im.content,
                        im.read,
                        im.created_at,
                        u.id       AS sender_id,
                        u.username AS sender_username,
                        u.avatar   AS sender_avatar,
                        u.arena_id AS sender_arena_id
                    FROM inbox_messages im
                    JOIN users u ON u.id = im.sender_id
                    WHERE im.receiver_id = :me
                      AND im.deleted = FALSE
                      {extra}
                    ORDER BY im.created_at DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("get_inbox error: %s", exc)
        raise HTTPException(500, "Failed to load inbox")

    return {
        "messages": [
            {
                "id":              str(r[0]),
                "subject":         r[1],
                "content":         r[2],
                "read":            r[3],
                "created_at":      r[4].isoformat() if r[4] else None,
                "sender_id":       str(r[5]),
                "sender_username": r[6],
                "sender_avatar":   r[7],
                "sender_arena_id": r[8],
            }
            for r in rows
        ]
    }


@app.get("/inbox/unread-count")
async def inbox_unread_count(payload: dict = Depends(verify_token)):
    """
    Return the count of unread inbox messages for the badge indicator.
    DB-ready: COUNT from inbox_messages.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT COUNT(*) FROM inbox_messages "
                    "WHERE receiver_id = :me AND read = FALSE AND deleted = FALSE"
                ),
                {"me": me},
            ).fetchone()
            count = int(row[0]) if row else 0
    except Exception as exc:
        logger.error("inbox_unread_count error: %s", exc)
        raise HTTPException(500, "Failed to get count")

    return {"unread_count": count}


@app.patch("/inbox/{message_id}/read", status_code=200)
async def mark_inbox_read(message_id: str, payload: dict = Depends(verify_token)):
    """
    Mark a single inbox message as read.

    Only the receiver can mark their own messages.
    DB-ready: UPDATE inbox_messages SET read = TRUE.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM inbox_messages "
                    "WHERE id = :mid AND receiver_id = :me AND deleted = FALSE"
                ),
                {"mid": message_id, "me": me},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Message not found")

            session.execute(
                text("UPDATE inbox_messages SET read = TRUE WHERE id = :mid"),
                {"mid": message_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("mark_inbox_read error: %s", exc)
        raise HTTPException(500, "Update failed")

    return {"read": True, "id": message_id}


@app.patch("/inbox/read-all", status_code=200)
async def mark_all_inbox_read(payload: dict = Depends(verify_token)):
    """
    Mark ALL unread inbox messages as read for the authenticated user.
    DB-ready: UPDATE inbox_messages SET read = TRUE WHERE receiver_id = :me.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            result = session.execute(
                text(
                    "UPDATE inbox_messages SET read = TRUE "
                    "WHERE receiver_id = :me AND read = FALSE AND deleted = FALSE"
                ),
                {"me": me},
            )
            session.commit()
            updated = getattr(result, "rowcount", 0) or 0
    except Exception as exc:
        logger.error("mark_all_inbox_read error: %s", exc)
        raise HTTPException(500, "Update failed")

    return {"marked_read": updated}


@app.delete("/inbox/{message_id}", status_code=200)
async def delete_inbox_message(message_id: str, payload: dict = Depends(verify_token)):
    """
    Soft-delete an inbox message (sets deleted = TRUE).

    Only the receiver can delete their own messages.
    DB-ready: UPDATE inbox_messages SET deleted = TRUE.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM inbox_messages "
                    "WHERE id = :mid AND receiver_id = :me AND deleted = FALSE"
                ),
                {"mid": message_id, "me": me},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Message not found")

            session.execute(
                text("UPDATE inbox_messages SET deleted = TRUE WHERE id = :mid"),
                {"mid": message_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_inbox_message error: %s", exc)
        raise HTTPException(500, "Delete failed")

    return {"deleted": True, "id": message_id}


# ── Notifications ──────────────────────────────────────────────────────────────

@app.get("/notifications")
async def get_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    payload: dict = Depends(verify_token),
):
    """
    GET /notifications — paginated list of notifications for the authenticated user.
    Optional ?unread_only=true&limit=N.
    DB-ready: SELECT from notifications WHERE user_id = :me ORDER BY created_at DESC.
    """
    me: str = payload["sub"]
    extra = "AND read = FALSE" if unread_only else ""
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT id, type, title, message, read, metadata, created_at
                    FROM notifications
                    WHERE user_id = :me {extra}
                    ORDER BY created_at DESC
                    LIMIT :lim
                """),
                {"me": me, "lim": limit},
            ).fetchall()
    except Exception as exc:
        logger.error("get_notifications error: %s", exc)
        raise HTTPException(500, "Failed to load notifications")

    return {
        "notifications": [
            {
                "id":         str(r[0]),
                "type":       r[1],
                "title":      r[2],
                "message":    r[3],
                "read":       r[4],
                "metadata":   r[5] if r[5] else None,
                "created_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]
    }


@app.patch("/notifications/{notification_id}/read", status_code=200)
async def mark_notification_read(notification_id: str, payload: dict = Depends(verify_token)):
    """
    PATCH /notifications/:id/read — mark a single notification as read.
    Only the owner can mark their own notifications.
    DB-ready: UPDATE notifications SET read = TRUE WHERE id = :id AND user_id = :me.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id FROM notifications WHERE id = :nid AND user_id = :me"),
                {"nid": notification_id, "me": me},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Notification not found")
            session.execute(
                text("UPDATE notifications SET read = TRUE WHERE id = :nid"),
                {"nid": notification_id},
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("mark_notification_read error: %s", exc)
        raise HTTPException(500, "Update failed")

    return {"read": True, "id": notification_id}


@app.patch("/notifications/read-all", status_code=200)
async def mark_all_notifications_read(payload: dict = Depends(verify_token)):
    """
    PATCH /notifications/read-all — mark all of the authenticated user's notifications as read.
    DB-ready: UPDATE notifications SET read = TRUE WHERE user_id = :me AND read = FALSE.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            result = session.execute(
                text(
                    "UPDATE notifications SET read = TRUE "
                    "WHERE user_id = :me AND read = FALSE"
                ),
                {"me": me},
            )
            session.commit()
            updated = getattr(result, "rowcount", 0) or 0
    except Exception as exc:
        logger.error("mark_all_notifications_read error: %s", exc)
        raise HTTPException(500, "Update failed")

    return {"marked_read": updated}


@app.delete("/notifications/{notification_id}", status_code=200)
async def delete_notification(notification_id: str, payload: dict = Depends(verify_token)):
    """
    DELETE /notifications/:id — permanently remove a notification for the authenticated user.
    DB-ready: DELETE FROM notifications WHERE id = :id AND user_id = :me.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id FROM notifications WHERE id = :nid AND user_id = :me"),
                {"nid": notification_id, "me": me},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Notification not found")
            session.execute(
                text("DELETE FROM notifications WHERE id = :nid"),
                {"nid": notification_id},
            )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_notification error: %s", exc)
        raise HTTPException(500, "Delete failed")

    return {"deleted": True, "id": notification_id}


# ── Notification respond (accept / decline) ───────────────────────────────────

class NotificationRespondRequest(BaseModel):
    """POST /notifications/:id/respond body."""
    action: str  # "accept" | "decline"


@app.post("/notifications/{notification_id}/respond", status_code=200)
async def respond_to_notification(
    notification_id: str,
    req: NotificationRespondRequest,
    payload: dict = Depends(verify_token),
):
    """
    Accept or decline an actionable notification (e.g. match_invite).

    POST /notifications/:id/respond
    Body: {"action": "accept" | "decline"}

    On accept (match_invite):
      - Validates the match is still 'waiting' (409 if not)
      - Marks the notification as read
      - Returns match details so the client can navigate directly to MatchLobby
        and pre-fill the join flow without a second search

    On decline:
      - Marks the notification as read
      - Returns {"action": "decline"}

    DB-ready: notifications + matches tables.
    """
    me: str = payload["sub"]

    if req.action not in ("accept", "decline"):
        raise HTTPException(400, "action must be 'accept' or 'decline'")

    try:
        with SessionLocal() as session:
            notif_row = session.execute(
                text(
                    "SELECT id, type, metadata FROM notifications "
                    "WHERE id = :nid AND user_id = :me"
                ),
                {"nid": notification_id, "me": me},
            ).fetchone()

            if not notif_row:
                raise HTTPException(404, "Notification not found")

            notif_type = notif_row[1]
            metadata   = notif_row[2] or {}  # JSONB — SQLAlchemy returns dict

            # ── Mark as read regardless of action ─────────────────────────────
            session.execute(
                text("UPDATE notifications SET read = TRUE WHERE id = :nid"),
                {"nid": notification_id},
            )

            if req.action == "decline":
                session.commit()
                return {"action": "decline"}

            # ── Accept ─────────────────────────────────────────────────────────
            if notif_type != "match_invite":
                # Generic accept for non-invite types (future-proof)
                session.commit()
                return {"action": "accept"}

            match_id = metadata.get("match_id") if isinstance(metadata, dict) else None
            if not match_id:
                raise HTTPException(410, "This invite is no longer valid")

            # Validate match still joinable
            match_row = session.execute(
                text(
                    "SELECT status, game, bet_amount, stake_currency, code, "
                    "       mode, max_players, max_per_team "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row:
                raise HTTPException(410, "This match no longer exists")

            if match_row[0] != "waiting":
                _status_label = {
                    "in_progress": "started",
                    "completed":   "completed",
                    "cancelled":   "cancelled",
                }.get(match_row[0], match_row[0])
                raise HTTPException(
                    409,
                    f"This match has already {_status_label} and is no longer accepting players.",
                )

            session.commit()

            return {
                "action":           "accept",
                "match_id":         match_id,
                "code":             match_row[4],
                "game":             match_row[1],
                "bet_amount":       str(match_row[2]) if match_row[2] is not None else "0",
                "stake_currency":   match_row[3] or "CRYPTO",
                "status":           match_row[0],
                "mode":             match_row[5],
                "max_players":      match_row[6],
                "max_per_team":     match_row[7],
                "inviter_username": metadata.get("inviter_username", "") if isinstance(metadata, dict) else "",
            }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("respond_to_notification error: %s", exc)
        raise HTTPException(500, "Failed to process response. Please try again.")


# ── Disputes ───────────────────────────────────────────────────────────────────

class CreateDisputeRequest(BaseModel):
    """POST /disputes — open a dispute on a completed match."""
    match_id: str
    reason: str
    evidence: str | None = None


@app.post("/disputes", status_code=201)
async def create_dispute(req: CreateDisputeRequest, payload: dict = Depends(verify_token)):
    """
    POST /disputes — player opens a dispute on a completed or already-disputed match.

    Rules:
      - match must exist and be 'completed' or 'disputed'
      - caller must be a player in the match
      - player_a = caller, player_b = first other player in match_players
      - sets status = 'open', resolution = 'pending'
      - marks match status → 'disputed'

    DB-ready: INSERT into disputes; UPDATE matches SET status = 'disputed'.
    """
    me: str = payload["sub"]
    # H4: cap dispute submissions so one user can't flood the admin queue.
    _check_rate_limit(f"create_dispute:{me}", max_calls=5, window_secs=60)

    reason = req.reason.strip()
    if not reason:
        raise HTTPException(400, "Reason cannot be empty")

    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text("SELECT id, status FROM matches WHERE id = :mid"),
                {"mid": req.match_id},
            ).fetchone()
            if not match_row:
                raise HTTPException(404, "Match not found")
            if match_row[1] not in ("completed", "disputed"):
                raise HTTPException(409, f"Cannot dispute a match with status '{match_row[1]}'")

            player_rows = session.execute(
                text("SELECT user_id FROM match_players WHERE match_id = :mid ORDER BY joined_at"),
                {"mid": req.match_id},
            ).fetchall()
            player_ids = [str(r[0]) for r in player_rows]

            if me not in player_ids:
                raise HTTPException(403, "You are not a player in this match")

            others = [pid for pid in player_ids if pid != me]
            player_a = me
            player_b = others[0] if others else me

            row = session.execute(
                text(
                    "INSERT INTO disputes (match_id, player_a, player_b, reason, evidence) "
                    "VALUES (:mid, :pa, :pb, :reason, :evidence) "
                    "RETURNING id, created_at"
                ),
                {
                    "mid":      req.match_id,
                    "pa":       player_a,
                    "pb":       player_b,
                    "reason":   reason,
                    "evidence": req.evidence,
                },
            ).fetchone()
            session.execute(
                text("UPDATE matches SET status = 'disputed' WHERE id = :mid"),
                {"mid": req.match_id},
            )
            session.commit()
            _ws_match_status(req.match_id, "disputed")
            dispute_id = str(row[0])
            created_at = row[1].isoformat() if row[1] else None

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_dispute error: %s", exc)
        raise HTTPException(500, f"Dispute creation failed: {exc}")

    return {
        "id":         dispute_id,
        "match_id":   req.match_id,
        "player_a":   player_a,
        "player_b":   player_b,
        "reason":     reason,
        "status":     "open",
        "resolution": "pending",
        "created_at": created_at,
    }


@app.get("/disputes")
async def get_disputes(payload: dict = Depends(verify_token)):
    """
    GET /disputes — list all disputes where the caller is player_a or player_b.
    Includes match game, stake, and both players' usernames via JOIN.
    DB-ready: SELECT from disputes JOIN matches JOIN users.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text("""
                    SELECT
                        d.id, d.match_id, d.player_a, d.player_b,
                        d.reason, d.status, d.resolution,
                        d.evidence, d.admin_notes, d.resolved_by,
                        d.created_at, d.resolved_at,
                        m.game, m.bet_amount,
                        ua.username AS pa_username,
                        ub.username AS pb_username
                    FROM disputes d
                    JOIN matches m  ON m.id  = d.match_id
                    JOIN users   ua ON ua.id = d.player_a
                    JOIN users   ub ON ub.id = d.player_b
                    WHERE d.player_a = :me OR d.player_b = :me
                    ORDER BY d.created_at DESC
                """),
                {"me": me},
            ).fetchall()
    except Exception as exc:
        logger.error("get_disputes error: %s", exc)
        raise HTTPException(500, "Failed to load disputes")

    return {
        "disputes": [
            {
                "id":                  str(r[0]),
                "match_id":            str(r[1]),
                "player_a":            str(r[2]),
                "player_b":            str(r[3]),
                "reason":              r[4],
                "status":              r[5],
                "resolution":          r[6],
                "evidence":            r[7],
                "admin_notes":         r[8],
                "resolved_by":         str(r[9]) if r[9] else None,
                "created_at":          r[10].isoformat() if r[10] else None,
                "resolved_at":         r[11].isoformat() if r[11] else None,
                "game":                r[12],
                "stake":               float(r[13]) if r[13] else 0.0,
                "player_a_username":   r[14],
                "player_b_username":   r[15],
            }
            for r in rows
        ]
    }


class UpdateDisputeRequest(BaseModel):
    """PATCH /disputes/:id — admin updates status / resolution / notes."""
    status: str | None = None
    resolution: str | None = None
    admin_notes: str | None = None


@app.patch("/disputes/{dispute_id}", status_code=200)
async def update_dispute(
    dispute_id: str,
    req: UpdateDisputeRequest,
    payload: dict = Depends(require_admin),
):
    """
    PATCH /disputes/:id — admin-only: update dispute status, resolution, admin_notes.
    Sets resolved_by = caller and resolved_at = NOW() when status → 'resolved'.
    DB-ready: UPDATE disputes SET ... WHERE id = :did.
    """
    me: str = payload["sub"]

    _valid_statuses    = {"open", "reviewing", "resolved", "escalated"}
    _valid_resolutions = {"pending", "approved", "rejected", "player_a_wins", "player_b_wins", "refund", "void"}

    if req.status and req.status not in _valid_statuses:
        raise HTTPException(400, f"Invalid status '{req.status}'")
    if req.resolution and req.resolution not in _valid_resolutions:
        raise HTTPException(400, f"Invalid resolution '{req.resolution}'")

    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id FROM disputes WHERE id = :did"),
                {"did": dispute_id},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Dispute not found")

            set_parts: list[str] = []
            params: dict = {"did": dispute_id}
            if req.status:
                set_parts.append("status = :status")
                params["status"] = req.status
                if req.status == "resolved":
                    set_parts.append("resolved_by = :resolver")
                    set_parts.append("resolved_at = NOW()")
                    params["resolver"] = me
            if req.resolution:
                set_parts.append("resolution = :resolution")
                params["resolution"] = req.resolution
            if req.admin_notes is not None:
                set_parts.append("admin_notes = :admin_notes")
                params["admin_notes"] = req.admin_notes

            if not set_parts:
                raise HTTPException(400, "No fields to update")

            session.execute(
                text(f"UPDATE disputes SET {', '.join(set_parts)} WHERE id = :did"),
                params,
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_dispute error: %s", exc)
        raise HTTPException(500, "Update failed")

    return {"updated": True, "id": dispute_id}


# ── Support Tickets ────────────────────────────────────────────────────────────

class CreateSupportTicketRequest(BaseModel):
    """POST /support/tickets — file a support ticket."""
    reason: str
    description: str
    reported_id: str | None = None
    category: str = "player_report"
    match_id: str | None = None
    topic: str | None = None
    attachment_url: str | None = None


@app.post("/support/tickets", status_code=201)
async def create_support_ticket(
    req: CreateSupportTicketRequest,
    payload: dict = Depends(verify_token),
):
    """
    POST /support/tickets — player files a support ticket.

    Categories align with SupportTicketCategory in src/types/index.ts:
      player_report    — reported_id should be provided
      match_dispute    — match_id should be provided
      general_support  — topic should be provided

    DB-ready: INSERT into support_tickets (all DB enum values validated here).
    """
    me: str = payload["sub"]
    # H4: cap ticket submissions — prevents spamming the support queue.
    _check_rate_limit(f"support_ticket:{me}", max_calls=10, window_secs=60)

    _valid_reasons    = {"cheating", "harassment", "fake_screenshot", "disconnect_abuse", "other"}
    _valid_categories = {"player_report", "match_dispute", "general_support"}
    _valid_topics     = {"account_access", "payments_escrow", "bug_technical", "match_outcome", "feedback", "other"}

    if req.reason not in _valid_reasons:
        raise HTTPException(400, f"Invalid reason '{req.reason}'")
    if req.category not in _valid_categories:
        raise HTTPException(400, f"Invalid category '{req.category}'")
    if req.topic and req.topic not in _valid_topics:
        raise HTTPException(400, f"Invalid topic '{req.topic}'")

    description = req.description.strip()
    if not description:
        raise HTTPException(400, "Description cannot be empty")

    if req.reported_id and req.reported_id == me:
        raise HTTPException(400, "Cannot file a ticket against yourself")

    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "INSERT INTO support_tickets "
                    "(reporter_id, reported_id, reason, description, category, match_id, topic, attachment_url) "
                    "VALUES (:rid, :reported, :reason, :desc, :cat, :mid, :topic, :att) "
                    "RETURNING id, created_at"
                ),
                {
                    "rid":      me,
                    "reported": req.reported_id,
                    "reason":   req.reason,
                    "desc":     description,
                    "cat":      req.category,
                    "mid":      req.match_id,
                    "topic":    req.topic,
                    "att":      req.attachment_url,
                },
            ).fetchone()
            session.commit()
            ticket_id  = str(row[0])
            created_at = row[1].isoformat() if row[1] else None

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_support_ticket error: %s", exc)
        raise HTTPException(500, f"Ticket creation failed: {exc}")

    return {
        "id":          ticket_id,
        "reporter_id": me,
        "reason":      req.reason,
        "status":      "open",
        "category":    req.category,
        "created_at":  created_at,
    }


@app.get("/support/tickets")
async def get_support_tickets(
    status: str | None = Query(default=None),
    payload: dict = Depends(verify_token),
):
    """
    GET /support/tickets — list tickets filed by the authenticated user.
    Optional ?status=open|investigating|dismissed|resolved
    DB-ready: SELECT from support_tickets WHERE reporter_id = :me.
    """
    me: str = payload["sub"]
    extra = ""
    params: dict = {"me": me}
    if status:
        extra = "AND st.status = :status"
        params["status"] = status

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        st.id, st.reason, st.description, st.status,
                        st.category, st.match_id, st.topic,
                        st.admin_note, st.created_at, st.updated_at,
                        st.reported_id,
                        u.username AS reported_username
                    FROM support_tickets st
                    LEFT JOIN users u ON u.id = st.reported_id
                    WHERE st.reporter_id = :me {extra}
                    ORDER BY st.created_at DESC
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("get_support_tickets error: %s", exc)
        raise HTTPException(500, "Failed to load tickets")

    return {
        "tickets": [
            {
                "id":                str(r[0]),
                "reason":            r[1],
                "description":       r[2],
                "status":            r[3],
                "category":          r[4],
                "match_id":          str(r[5]) if r[5] else None,
                "topic":             r[6],
                "admin_note":        r[7],
                "created_at":        r[8].isoformat() if r[8] else None,
                "updated_at":        r[9].isoformat() if r[9] else None,
                "reported_id":       str(r[10]) if r[10] else None,
                "reported_username": r[11],
            }
            for r in rows
        ]
    }


@app.get("/admin/support/tickets")
async def admin_list_support_tickets(
    limit: int = Query(default=200, ge=1, le=500),
    _admin: dict = Depends(require_admin),
):
    """Admin: list all support tickets (newest first)."""
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text("""
                    SELECT
                        st.id, st.reason, st.description, st.status,
                        st.category, st.match_id, st.topic,
                        st.admin_note, st.created_at, st.updated_at,
                        st.reporter_id, st.reported_id,
                        rep.username AS reporter_username,
                        u.username AS reported_username
                    FROM support_tickets st
                    JOIN users rep ON rep.id = st.reporter_id
                    LEFT JOIN users u ON u.id = st.reported_id
                    ORDER BY st.created_at DESC
                    LIMIT :lim
                """),
                {"lim": limit},
            ).fetchall()
    except Exception as exc:
        logger.error("admin_list_support_tickets error: %s", exc)
        raise HTTPException(500, "Failed to load tickets")

    return {
        "tickets": [
            {
                "id":                 str(r[0]),
                "reason":             r[1],
                "description":        r[2],
                "status":             r[3],
                "category":           r[4],
                "match_id":           str(r[5]) if r[5] else None,
                "topic":              r[6],
                "admin_note":         r[7],
                "created_at":         r[8].isoformat() if r[8] else None,
                "updated_at":         r[9].isoformat() if r[9] else None,
                "reporter_id":        str(r[10]),
                "reported_id":        str(r[11]) if r[11] else None,
                "reporter_username":  r[12],
                "reported_username":  r[13],
            }
            for r in rows
        ]
    }


_REPORT_UPLOAD_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_REPORT_MAX_BYTES = 10 * 1024 * 1024


class AdminSupportTicketPatch(BaseModel):
    status: str | None = None
    admin_note: str | None = None


@app.patch("/admin/support/tickets/{ticket_id}", status_code=200)
async def admin_patch_support_ticket(
    ticket_id: str,
    req: AdminSupportTicketPatch,
    _admin: dict = Depends(require_admin),
):
    """Admin: update ticket status / note. Resolved or dismissed → purge attachment files + rows."""
    _valid = {"open", "investigating", "dismissed", "resolved"}
    if req.status is not None and req.status not in _valid:
        raise HTTPException(400, f"status must be one of: {', '.join(sorted(_valid))}")
    if req.status is None and req.admin_note is None:
        raise HTTPException(400, "Provide status and/or admin_note")

    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT status FROM support_tickets WHERE id = :tid"),
                {"tid": ticket_id},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Ticket not found")
            if req.status in ("resolved", "dismissed"):
                _cleanup_report_attachments_for_ticket(session, ticket_id)
            parts: list[str] = []
            params: dict = {"tid": ticket_id}
            if req.status is not None:
                parts.append("status = :st")
                params["st"] = req.status
            if req.admin_note is not None:
                parts.append("admin_note = :note")
                params["note"] = req.admin_note
            if parts:
                session.execute(
                    text(f"UPDATE support_tickets SET {', '.join(parts)} WHERE id = :tid"),
                    params,
                )
            session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_patch_support_ticket error: %s", exc)
        raise HTTPException(500, "Ticket update failed")
    return {"updated": True, "id": ticket_id}


@app.post("/support/tickets/{ticket_id}/attachments", status_code=201)
async def upload_support_ticket_attachment(
    ticket_id: str,
    payload: dict = Depends(verify_token),
    file: UploadFile = File(...),
):
    """Reporter uploads an image file for their support ticket (max 10MB)."""
    me: str = payload["sub"]
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in _REPORT_UPLOAD_MIME:
        raise HTTPException(400, "Allowed types: PNG, JPEG, WebP, GIF")
    ext = _REPORT_UPLOAD_MIME[ct]
    body = await file.read()
    if len(body) > _REPORT_MAX_BYTES:
        raise HTTPException(400, "File too large (max 10MB)")
    try:
        os.makedirs(UPLOAD_REPORTS_DIR, exist_ok=True)
    except OSError:
        pass
    file_token = str(uuid.uuid4())
    safe_name = f"{file_token}{ext}"
    abs_path = os.path.abspath(os.path.join(UPLOAD_REPORTS_DIR, safe_name))
    root = os.path.abspath(UPLOAD_REPORTS_DIR)
    if not abs_path.startswith(root):
        raise HTTPException(500, "Invalid upload path")
    try:
        with open(abs_path, "wb") as f:
            f.write(body)
    except OSError as exc:
        logger.error("upload_support_ticket_attachment write error: %s", exc)
        raise HTTPException(500, "Failed to save file")

    db_id = file_token
    try:
        with SessionLocal() as session:
            t = session.execute(
                text("SELECT reporter_id FROM support_tickets WHERE id = :tid"),
                {"tid": ticket_id},
            ).fetchone()
            if not t:
                try:
                    os.remove(abs_path)
                except OSError:
                    pass
                raise HTTPException(404, "Ticket not found")
            if str(t[0]) != me:
                try:
                    os.remove(abs_path)
                except OSError:
                    pass
                raise HTTPException(403, "Only the ticket reporter may upload attachments")
            ins = session.execute(
                text(
                    "INSERT INTO report_attachments "
                    "(ticket_id, filename, content_type, file_path, file_size, uploaded_by) "
                    "VALUES (:tid, :fn, :ct, :fp, :sz, :uid) "
                    "RETURNING id"
                ),
                {
                    "tid": ticket_id,
                    "fn": file.filename or safe_name,
                    "ct": ct,
                    "fp": abs_path,
                    "sz": len(body),
                    "uid": me,
                },
            ).fetchone()
            session.commit()
            db_id = str(ins[0]) if ins else file_token
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("upload_support_ticket_attachment db error: %s", exc)
        try:
            os.remove(abs_path)
        except OSError:
            pass
        raise HTTPException(500, "Failed to record attachment")

    return {
        "id":           db_id,
        "ticket_id":    ticket_id,
        "filename":     file.filename or safe_name,
        "content_type": ct,
        "file_size":    len(body),
    }


@app.get("/admin/support/tickets/{ticket_id}/attachments")
async def admin_list_ticket_attachments(
    ticket_id: str,
    _admin: dict = Depends(require_admin),
):
    """Admin: list metadata for all attachments on a ticket."""
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT id, filename, content_type, file_size, uploaded_at, uploaded_by "
                    "FROM report_attachments WHERE ticket_id = :tid ORDER BY uploaded_at"
                ),
                {"tid": ticket_id},
            ).fetchall()
    except Exception as exc:
        logger.error("admin_list_ticket_attachments error: %s", exc)
        raise HTTPException(500, "Failed to list attachments")
    return {
        "attachments": [
            {
                "id":           str(r[0]),
                "filename":     r[1],
                "content_type": r[2],
                "file_size":    r[3],
                "uploaded_at":  r[4].isoformat() if r[4] else None,
                "uploaded_by":  str(r[5]) if r[5] else None,
            }
            for r in rows
        ]
    }


@app.get("/attachments/{attachment_id}")
async def download_attachment(attachment_id: str, payload: dict = Depends(verify_token)):
    """Download an attachment if you are the ticket reporter or an admin."""
    me: str = payload["sub"]
    root = os.path.abspath(UPLOAD_REPORTS_DIR)
    try:
        with SessionLocal() as session:
            is_admin = session.execute(
                text("SELECT 1 FROM user_roles WHERE user_id = :uid AND role = 'admin'"),
                {"uid": me},
            ).fetchone()
            row = session.execute(
                text(
                    "SELECT ra.file_path, ra.content_type, ra.filename, st.reporter_id "
                    "FROM report_attachments ra "
                    "JOIN support_tickets st ON st.id = ra.ticket_id "
                    "WHERE ra.id = :aid"
                ),
                {"aid": attachment_id},
            ).fetchone()
    except Exception as exc:
        logger.error("download_attachment error: %s", exc)
        raise HTTPException(500, "Failed to load attachment")
    if not row:
        raise HTTPException(404, "Attachment not found")
    fp, ctype, fname, reporter = row[0], row[1], row[2], str(row[3]) if row[3] else None
    if not is_admin and reporter != me:
        raise HTTPException(403, "Not allowed to access this attachment")
    abs_fp = os.path.abspath(fp)
    if not abs_fp.startswith(root) or not os.path.isfile(abs_fp):
        raise HTTPException(404, "File missing")
    return FileResponse(abs_fp, media_type=ctype or "application/octet-stream", filename=fname or "attachment")


@app.delete("/attachments/{attachment_id}", status_code=200)
async def delete_attachment_admin(
    attachment_id: str,
    _admin: dict = Depends(require_admin),
):
    """Admin: delete attachment row and file on disk."""
    root = os.path.abspath(UPLOAD_REPORTS_DIR)
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT file_path FROM report_attachments WHERE id = :aid"),
                {"aid": attachment_id},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Attachment not found")
            fp = row[0]
            session.execute(
                text("DELETE FROM report_attachments WHERE id = :aid"),
                {"aid": attachment_id},
            )
            session.commit()
        if fp:
            abs_fp = os.path.abspath(fp)
            if abs_fp.startswith(root) and os.path.isfile(abs_fp):
                try:
                    os.remove(abs_fp)
                except OSError:
                    pass
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_attachment_admin error: %s", exc)
        raise HTTPException(500, "Delete failed")
    return {"deleted": True, "id": attachment_id}


# ── Phase 6 format-only verify stubs (real API when keys in platform_config) ──

@app.get("/verify/steam")
async def verify_steam_stub(steam_id: str = Query(..., description="Steam64 ID")):
    # TODO[VERIF]: Steam Web API ownership check when steam_api_key in platform_config
    sid = steam_id.strip()
    valid = auth.validate_steam_id(sid) is None
    unique = True
    if valid:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT 1 FROM users WHERE steam_id = :s"),
                {"s": sid},
            ).fetchone()
            unique = row is None
    return {"valid": valid, "unique": unique, "verified_by": "format"}


@app.get("/verify/riot")
async def verify_riot_stub(riot_id: str = Query(...)):
    # TODO[VERIF]: Riot API when riot_api_key in platform_config
    rid = riot_id.strip()
    valid = auth.validate_riot_id(rid) is None
    unique = True
    if valid:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT 1 FROM users WHERE riot_id = :r"),
                {"r": rid},
            ).fetchone()
            unique = row is None
    return {"valid": valid, "unique": unique, "verified_by": "format"}


@app.get("/verify/discord")
async def verify_discord_stub(discord_id: str = Query(...)):
    import re as _re

    did = discord_id.strip()
    valid = bool(_re.fullmatch(r"\d{17,19}", did))
    return {"valid": valid, "verified_by": "format"}


# ── Forge Challenges ───────────────────────────────────────────────────────────

@app.get("/forge/challenges")
async def get_forge_challenges(payload: dict = Depends(verify_token)):
    """
    GET /forge/challenges — list active daily + weekly challenges with the user's progress.

    Progress is per-cycle:
      daily   → cycle_start = today (UTC date)
      weekly  → cycle_start = most recent Monday (UTC)

    Returns status: 'active' | 'claimable' | 'claimed' and expiry timestamps.
    DB-ready: forge_challenges LEFT JOIN forge_challenge_progress for current cycle.
    """
    me: str = payload["sub"]
    try:
        import datetime as _dt
        today      = _dt.date.today()
        week_start = today - _dt.timedelta(days=today.weekday())

        with SessionLocal() as session:
            rows = session.execute(
                text("""
                    SELECT
                        fc.id, fc.title, fc.description, fc.icon,
                        fc.type, fc.reward_at, fc.reward_xp, fc.target,
                        COALESCE(fcp.progress, 0)       AS progress,
                        COALESCE(fcp.status,  'active') AS ch_status
                    FROM forge_challenges fc
                    LEFT JOIN forge_challenge_progress fcp
                      ON fcp.challenge_id = fc.id
                     AND fcp.user_id      = :me
                     AND fcp.cycle_start  = CASE
                           WHEN fc.type = 'daily'  THEN :today
                           WHEN fc.type = 'weekly' THEN :week_start
                           ELSE :today
                         END
                    WHERE fc.active = TRUE
                    ORDER BY fc.type, fc.created_at
                """),
                {"me": me, "today": today, "week_start": week_start},
            ).fetchall()
    except Exception as exc:
        logger.error("get_forge_challenges error: %s", exc)
        raise HTTPException(500, "Failed to load challenges")

    import datetime as _dt2

    def _expires_at(ch_type: str) -> str:
        t = _dt2.date.today()
        if ch_type == "daily":
            nxt = t + _dt2.timedelta(days=1)
        else:
            # next Monday
            nxt = t + _dt2.timedelta(days=7 - t.weekday())
        return _dt2.datetime.combine(nxt, _dt2.time.min, tzinfo=_dt2.timezone.utc).isoformat()

    def _status(progress: int, target: int, db_status: str) -> str:
        if db_status == "claimed":
            return "claimed"
        if progress >= target:
            return "claimable"
        return "active"

    return {
        "challenges": [
            {
                "id":          str(r[0]),
                "title":       r[1],
                "description": r[2],
                "icon":        r[3],
                "type":        r[4],
                "rewardAT":    r[5],
                "rewardXP":    r[6],
                "target":      r[7],
                "progress":    r[8],
                "status":      _status(r[8], r[7], r[9]),
                "expiresAt":   _expires_at(r[4]),
            }
            for r in rows
        ]
    }


@app.post("/forge/challenges/{challenge_id}/claim", status_code=200)
async def claim_forge_challenge(challenge_id: str, payload: dict = Depends(verify_token)):
    """
    POST /forge/challenges/:id/claim — claim AT + XP reward for a completed challenge.

    Rules:
      - challenge must exist and be active
      - user must have progress >= target for the current cycle
      - status must not already be 'claimed'
      - credits reward_at AT and reward_xp XP
      - sets forge_challenge_progress.status = 'claimed', claimed_at = NOW()

    DB-ready:
      UPDATE forge_challenge_progress SET status = 'claimed', claimed_at = NOW();
      UPDATE users SET at_balance = at_balance + :reward_at;
      UPDATE user_stats SET xp = xp + :reward_xp;
      INSERT INTO transactions (at_purchase for the AT credit).
    """
    me: str = payload["sub"]

    try:
        import datetime as _dt
        today      = _dt.date.today()
        week_start = today - _dt.timedelta(days=today.weekday())

        with SessionLocal() as session:
            ch_row = session.execute(
                text(
                    "SELECT id, type, reward_at, reward_xp, target "
                    "FROM forge_challenges WHERE id = :cid AND active = TRUE"
                ),
                {"cid": challenge_id},
            ).fetchone()
            if not ch_row:
                raise HTTPException(404, "Challenge not found")

            _, ch_type, reward_at, reward_xp, target = ch_row
            cycle_start = today if ch_type == "daily" else week_start

            prog_row = session.execute(
                text(
                    "SELECT progress, status FROM forge_challenge_progress "
                    "WHERE user_id = :me AND challenge_id = :cid AND cycle_start = :cs"
                ),
                {"me": me, "cid": challenge_id, "cs": cycle_start},
            ).fetchone()

            if not prog_row:
                raise HTTPException(400, "No progress found for this challenge in the current cycle")

            progress, db_status = prog_row
            if db_status == "claimed":
                raise HTTPException(409, "Reward already claimed for this cycle")
            if progress < target:
                raise HTTPException(400, f"Challenge not yet complete ({progress}/{target})")

            # Mark claimed
            session.execute(
                text(
                    "UPDATE forge_challenge_progress "
                    "SET status = 'claimed', claimed_at = NOW() "
                    "WHERE user_id = :me AND challenge_id = :cid AND cycle_start = :cs"
                ),
                {"me": me, "cid": challenge_id, "cs": cycle_start},
            )
            # Credit AT balance
            session.execute(
                text("UPDATE users SET at_balance = at_balance + :amt WHERE id = :uid"),
                {"amt": reward_at, "uid": me},
            )
            # Credit XP
            session.execute(
                text("UPDATE user_stats SET xp = xp + :xp WHERE user_id = :uid"),
                {"xp": reward_xp, "uid": me},
            )
            # Record AT credit transaction
            session.execute(
                text(
                    "INSERT INTO transactions (user_id, type, amount, token, status, note) "
                    "VALUES (:uid, 'at_purchase', :amt, 'AT', 'completed', :note)"
                ),
                {"uid": me, "amt": reward_at, "note": f"challenge_reward:{challenge_id}"},
            )
            session.commit()

            bal_row = session.execute(
                text("SELECT at_balance FROM users WHERE id = :uid"),
                {"uid": me},
            ).fetchone()
            new_balance = int(bal_row[0]) if bal_row else 0

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("claim_forge_challenge error: %s", exc)
        raise HTTPException(500, f"Claim failed: {exc}")

    logger.info(
        "forge_challenge_claim: user=%s challenge=%s +%d AT +%d XP",
        me, challenge_id, reward_at, reward_xp,
    )
    return {
        "claimed":      True,
        "challenge_id": challenge_id,
        "reward_at":    reward_at,
        "reward_xp":    reward_xp,
        "at_balance":   new_balance,
    }


# ── Admin — Oracle / EscrowClient ─────────────────────────────────────────────


@app.get("/admin/oracle/status")
async def admin_oracle_status(payload: dict = Depends(require_admin)):
    """
    Return the current state of the EscrowClient oracle listener.

    Fields:
      - listener_active: bool   — True when the background task is running
      - last_block: int         — last processed block stored in oracle_sync_state
      - last_sync_at: str|None  — ISO timestamp of last UPSERT
      - escrow_enabled: bool    — True when EscrowClient was initialised

    DB-ready: reads oracle_sync_state singleton row.
    """
    escrow_enabled = _escrow_client is not None
    listener_active = (
        _listener_task is not None
        and not _listener_task.done()
    )

    last_block: int = 0
    last_sync_at: str | None = None
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT last_block, last_sync_at "
                    "FROM oracle_sync_state WHERE id = 'singleton'"
                )
            ).fetchone()
            if row:
                last_block = int(row[0])
                last_sync_at = row[1].isoformat() if row[1] else None
    except Exception as exc:
        logger.warning("admin_oracle_status DB read failed: %s", exc)

    return {
        "escrow_enabled": escrow_enabled,
        "listener_active": listener_active,
        "last_block": last_block,
        "last_sync_at": last_sync_at,
    }


@app.post("/admin/oracle/sync", status_code=200)
async def admin_oracle_sync(
    from_block: int | None = Query(default=None),
    payload: dict = Depends(require_admin),
):
    """
    Manually trigger a one-off event scan from a given block to the current
    chain head.

    Query param:
      ?from_block=<N>   Start scanning from block N (recovery after outage).
                        If omitted, resumes from last_block+1 stored in DB
                        (same as automatic listener behaviour).

    Use cases:
      - Engine was down and events were missed: pass from_block=<last_known_good>
      - Force an immediate full catch-up: omit from_block

    Non-destructive: last_block in oracle_sync_state is updated after.

    DB-ready: reads oracle_sync_state, calls EscrowClient.process_events(),
              then upserts updated last_block.
    CONTRACT-ready: EscrowClient.process_events() handles all ArenaEscrow events.
    """
    if not _escrow_client:
        raise HTTPException(503, "EscrowClient not available — blockchain env vars not set")

    try:
        current_block = _escrow_client._w3.eth.block_number

        if from_block is not None:
            # Caller explicitly specified a start block — use it directly
            scan_from = max(0, from_block)
        else:
            # Resume from where the listener last left off
            saved_block = _escrow_client._load_last_block()
            scan_from = (saved_block + 1) if saved_block > 0 else max(0, current_block - 100)

        if scan_from > current_block:
            return {
                "synced": True,
                "events_processed": 0,
                "from_block": scan_from,
                "to_block": current_block,
            }

        n = _escrow_client.process_events(scan_from, current_block)
        _escrow_client._save_last_block(current_block)

        logger.info(
            "admin_oracle_sync: processed %d events | blocks %d→%d",
            n, scan_from, current_block,
        )
        return {
            "synced": True,
            "events_processed": n,
            "from_block": scan_from,
            "to_block": current_block,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_oracle_sync error: %s", exc)
        raise HTTPException(500, "Oracle sync failed")


@app.post("/admin/alerts/test-slack", status_code=200)
async def admin_alerts_test_slack(payload: dict = Depends(require_admin)):
    """
    Send a one-off Slack message to verify SLACK_ALERTS_WEBHOOK_URL in production.

    Does not affect oracle watchdog throttling.
    """
    if not (os.getenv("SLACK_ALERTS_WEBHOOK_URL") or "").strip():
        raise HTTPException(
            503,
            "SLACK_ALERTS_WEBHOOK_URL is not configured",
        )
    env_tag = ENVIRONMENT or "unknown"
    slack_post(
        f"✅ [{env_tag}] Arena Engine: Slack test alert — admin endpoint OK"
    )
    return {"ok": True, "sent": True}


class DeclareWinnerRequest(BaseModel):
    """Body for POST /admin/match/{id}/declare-winner."""
    winner_id: str
    reason: str = ""   # admin note — logged and sent to winner's inbox


@app.post("/admin/match/{match_id}/declare-winner", status_code=200)
async def admin_declare_winner(
    match_id: str,
    req: DeclareWinnerRequest,
    payload: dict = Depends(require_admin),
):
    """
    Admin manual winner declaration — bypasses consensus flow.

    Use for:
      - Dispute resolution (admin reviewed evidence and picks winner)
      - Stuck matches (all players disconnected; consensus never reached)
      - Timeout / AFK forfeit scenarios

    Flow:
      1. Verify match exists and is not already completed/cancelled
      2. UPDATE matches → status=completed, winner_id, ended_at=NOW()
      3. Trigger payout (AT: _settle_at_match; CRYPTO: EscrowClient.declare_winner)
      4. Send inbox notification to winner
      5. Return {"declared": True, match_id, winner_id, stake_currency}

    DB-ready: matches, match_players, inbox_messages
    CONTRACT-ready: EscrowClient.declare_winner() for CRYPTO matches
    """
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text("SELECT status, stake_currency FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()

        if not match_row:
            raise HTTPException(404, f"Match {match_id} not found")

        match_status, stake_currency = match_row[0], match_row[1]
        if match_status in ("completed", "cancelled"):
            raise HTTPException(
                409,
                f"Match is already {match_status} — cannot override winner",
            )

        # ── 1. Write winner to DB ─────────────────────────────────────────────
        with SessionLocal() as session:
            session.execute(
                text(
                    "UPDATE matches "
                    "SET status = 'completed', winner_id = :winner, ended_at = NOW() "
                    "WHERE id = :mid"
                ),
                {"winner": req.winner_id, "mid": match_id},
            )
            session.commit()
            _ws_match_status(match_id, "completed", winner_id=req.winner_id)

        # ── 2. Payout ─────────────────────────────────────────────────────────
        if stake_currency == "AT":
            _settle_at_match(match_id, req.winner_id)
        elif _escrow_client:
            try:
                tx_hash = _escrow_client.declare_winner(match_id, req.winner_id)
                logger.info(
                    "admin_declare_winner on-chain: match=%s tx=%s",
                    match_id, tx_hash,
                )
            except Exception as exc:
                logger.error(
                    "admin_declare_winner on-chain failed (non-fatal): match=%s error=%s",
                    match_id, exc,
                )

        # ── 3. Inbox notification to winner ───────────────────────────────────
        try:
            with SessionLocal() as session:
                reason_note = f" Reason: {req.reason}" if req.reason else ""
                _send_system_inbox(
                    session,
                    req.winner_id,
                    subject="🏆 Victory — Admin Declaration",
                    content=(
                        f"An admin has declared you the winner of match {match_id}."
                        f"{reason_note} Winnings will be released shortly."
                    ),
                )
                session.commit()
        except Exception as exc:
            logger.warning(
                "admin_declare_winner: inbox notification failed (non-fatal): %s", exc
            )

        admin_id = payload.get("sub")
        logger.info(
            "admin_declare_winner: match=%s winner=%s admin=%s reason=%r",
            match_id, req.winner_id, admin_id, req.reason,
        )
        _log_audit(
            admin_id,
            "DECLARE_WINNER",
            target_id=match_id,
            notes=f"winner={req.winner_id}" + (f" reason={req.reason}" if req.reason else ""),
        )
        return {
            "declared":       True,
            "match_id":       match_id,
            "winner_id":      req.winner_id,
            "stake_currency": stake_currency,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "admin_declare_winner error: match=%s error=%s", match_id, exc
        )
        raise HTTPException(500, "Winner declaration failed")


# ── Admin — Kill Switch ────────────────────────────────────────────────────────


class FreezeRequest(BaseModel):
    freeze: bool  # True = suspend payouts, False = resume


@app.post("/admin/freeze", status_code=200)
async def admin_freeze_payouts(
    req: FreezeRequest,
    payload: dict = Depends(require_admin),
):
    """
    M8 Kill Switch — suspend or resume all payout disbursement globally.

    When freeze=True:
      - _PAYOUTS_FROZEN is set to True
      - _auto_payout() skips fund release (AT credit + CRYPTO on-chain)
      - Match is still marked completed with winner_id — only funds are frozen
      - All frozen matches can be manually settled via POST /admin/match/{id}/declare-winner

    When freeze=False:
      - _PAYOUTS_FROZEN is set to False
      - All subsequent payouts proceed normally
      - Already-frozen matches must be settled manually (they were skipped, not queued)

    Admin-only. Requires role=admin in user_roles.
    """
    global _PAYOUTS_FROZEN
    _PAYOUTS_FROZEN = req.freeze
    action = "FROZEN" if req.freeze else "RESUMED"
    admin_id = payload.get("sub")
    logger.warning(
        "admin_freeze_payouts: payouts %s by admin=%s",
        action, admin_id,
    )
    audit_action = "FREEZE_PAYOUT" if req.freeze else "UNFREEZE_PAYOUT"
    _log_audit(admin_id, audit_action, target_id="global")

    # ── Sync on-chain pause/unpause via owner wallet ──────────────────────────
    # Oracle key (PRIVATE_KEY) cannot pause — only deployer (OWNER_PRIVATE_KEY).
    # Non-fatal: in-memory _PAYOUTS_FROZEN still blocks AT + CRYPTO payouts even
    # if the on-chain call fails or OWNER_PRIVATE_KEY is not yet configured.
    if _escrow_client:
        try:
            if req.freeze:
                _escrow_client.pause_contract()
            else:
                _escrow_client.unpause_contract()
        except Exception as exc:
            logger.error(
                "admin_freeze: on-chain %s failed (non-fatal, in-memory freeze active): %s",
                "pause" if req.freeze else "unpause", exc,
            )

    return {
        "frozen":  _PAYOUTS_FROZEN,
        "message": f"Payouts {action}. All fund releases are {'suspended' if req.freeze else 'active'}.",
    }


@app.get("/admin/freeze/status", status_code=200)
async def admin_freeze_status(payload: dict = Depends(require_admin)):
    """
    Return current state of the M8 kill switch.

    Response:
      frozen: bool  — True if payouts are currently suspended
    """
    return {"frozen": _PAYOUTS_FROZEN}


# ── Admin — Penalty System (M8) ───────────────────────────────────────────────


class PenaltyRequest(BaseModel):
    offense_type: str   # e.g. "rage_quit", "kick_abuse", "fraud", "cheating"
    notes: str = ""     # admin note for audit trail


@app.post("/admin/users/{user_id}/penalty", status_code=200)
async def admin_issue_penalty(
    user_id: str,
    req: PenaltyRequest,
    payload: dict = Depends(require_admin),
):
    """
    M8: Issue a penalty to a player.

    Escalation logic:
      1st offense → suspended_until = NOW() + 24h
      2nd offense → suspended_until = NOW() + 7 days
      3rd+ offense → banned_at = NOW() (permanent)

    Each call inserts a new row in player_penalties with the cumulative offense_count.
    Admin-only.

    DB-ready: player_penalties (migration 016).
    """
    admin_id = payload.get("sub")
    try:
        with SessionLocal() as session:
            # ── Verify target user exists ─────────────────────────────────────
            user_row = session.execute(
                text("SELECT id FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            if not user_row:
                raise HTTPException(404, "User not found")

            # ── Count prior offenses ──────────────────────────────────────────
            count_row = session.execute(
                text("SELECT COUNT(*) FROM player_penalties WHERE user_id = :uid"),
                {"uid": user_id},
            ).fetchone()
            prior_count = int(count_row[0]) if count_row else 0
            offense_count = prior_count + 1

            # ── Escalation ────────────────────────────────────────────────────
            suspended_until = None
            banned_at       = None
            now_utc         = datetime.now(timezone.utc)

            if offense_count == 1:
                suspended_until = now_utc + timedelta(hours=24)
                action = "suspended_24h"
            elif offense_count == 2:
                suspended_until = now_utc + timedelta(days=7)
                action = "suspended_7d"
            else:
                banned_at = now_utc
                action = "banned_permanent"

            session.execute(
                text(
                    "INSERT INTO player_penalties "
                    "  (user_id, offense_type, notes, offense_count, "
                    "   suspended_until, banned_at, created_by) "
                    "VALUES (:uid, :otype, :notes, :cnt, :sus, :ban, :admin)"
                ),
                {
                    "uid":   user_id,
                    "otype": req.offense_type.strip(),
                    "notes": req.notes.strip() or None,
                    "cnt":   offense_count,
                    "sus":   suspended_until,
                    "ban":   banned_at,
                    "admin": admin_id,
                },
            )

            # ── On permanent ban: blacklist wallet + steam + riot (migration 025) ──
            if banned_at is not None:
                id_row = session.execute(
                    text(
                        "SELECT steam_id, riot_id, wallet_address FROM users WHERE id = :uid"
                    ),
                    {"uid": user_id},
                ).fetchone()
                if id_row:
                    session.execute(
                        text(
                            "INSERT INTO wallet_blacklist "
                            "  (wallet_address, steam_id, riot_id, user_id, reason, banned_by) "
                            "VALUES (:w, :s, :r, :uid, 'admin_ban', :admin) "
                            "ON CONFLICT DO NOTHING"
                        ),
                        {
                            "w":     id_row[2],
                            "s":     id_row[0],
                            "r":     id_row[1],
                            "uid":   user_id,
                            "admin": admin_id,
                        },
                    )

            session.commit()

        logger.warning(
            "admin_issue_penalty: user=%s action=%s offense=%d admin=%s",
            user_id, action, offense_count, admin_id,
        )
        audit_action = "BAN_USER" if action == "banned_permanent" else "SUSPEND_USER"
        _log_audit(
            admin_id,
            audit_action,
            target_id=user_id,
            notes=f"offense={req.offense_type} count={offense_count}",
        )
        return {
            "penalized":      True,
            "user_id":        user_id,
            "offense_count":  offense_count,
            "action":         action,
            "suspended_until": suspended_until.isoformat() if suspended_until else None,
            "banned_at":      banned_at.isoformat() if banned_at else None,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_issue_penalty error: user=%s error=%s", user_id, exc)
        raise HTTPException(500, "Failed to issue penalty")


# ── Admin — Fraud Report (M8 Anomaly Detection) ───────────────────────────────


@app.get("/admin/fraud/report", status_code=200)
async def admin_fraud_report(payload: dict = Depends(require_admin)):
    """
    M8 Anomaly Detection — scan for suspicious activity patterns.

    Runs 5 query groups:
      1. High win-rate players: win_rate > 80% with 10+ matches
      2. Player-pair farming: same two players, COUNT(*) > fraud_pair_match_gt
         within fraud_pair_window_hours (platform_config)
      3. Repeat offenders: players with 2+ penalties in player_penalties
      4. Recently banned: players banned in the last 7 days
      5. Intentional losing: directional losses >= fraud_intentional_loss_min_count
         within fraud_intentional_loss_days (platform_config)

    Response: { generated_at, flagged_players, suspicious_pairs,
                repeat_offenders, recently_banned, intentional_losing, summary }

    DB-ready: user_stats, match_players, player_penalties (migration 016).
    """
    try:
        with SessionLocal() as session:

            # ── 1. High win-rate players (win_rate > 80%, 10+ matches) ────────
            wr_rows = session.execute(
                text(
                    "SELECT us.user_id, u.username, us.win_rate, us.matches, us.wins "
                    "FROM user_stats us "
                    "JOIN users u ON u.id = us.user_id "
                    "WHERE us.win_rate > 80 AND us.matches >= 10 "
                    "ORDER BY us.win_rate DESC "
                    "LIMIT 50"
                )
            ).fetchall()
            flagged_players = [
                {
                    "user_id":  str(r[0]),
                    "username": r[1],
                    "win_rate": float(r[2]),
                    "matches":  int(r[3]),
                    "wins":     int(r[4]),
                    "reason":   "win_rate_anomaly",
                }
                for r in wr_rows
            ]

            # ── 2. Player-pair farming (configurable window + COUNT threshold) ─
            _fb = _fraud_report_bind_params()
            pair_rows = session.execute(
                text(
                    "SELECT mp1.user_id, u1.username, mp2.user_id, u2.username, "
                    "       COUNT(*) AS match_count "
                    "FROM match_players mp1 "
                    "JOIN match_players mp2 "
                    "  ON mp1.match_id = mp2.match_id AND mp1.user_id < mp2.user_id "
                    "  AND mp1.user_id IS NOT NULL AND mp2.user_id IS NOT NULL "
                    "JOIN users u1 ON u1.id = mp1.user_id "
                    "JOIN users u2 ON u2.id = mp2.user_id "
                    "JOIN matches m ON m.id = mp1.match_id "
                    "WHERE m.created_at > NOW() - make_interval(0, 0, 0, 0, :fraud_pair_hours, 0, 0.0) "
                    "GROUP BY mp1.user_id, u1.username, mp2.user_id, u2.username "
                    "HAVING COUNT(*) > :fraud_pair_gt "
                    "ORDER BY match_count DESC "
                    "LIMIT 50"
                ),
                _fb,
            ).fetchall()
            suspicious_pairs = [
                {
                    "player_a":    str(r[0]),
                    "username_a":  r[1],
                    "player_b":    str(r[2]),
                    "username_b":  r[3],
                    "match_count": int(r[4]),
                    "reason":      "pair_farming",
                }
                for r in pair_rows
            ]

            # ── 3. Repeat offenders (2+ penalties) ────────────────────────────
            repeat_rows = session.execute(
                text(
                    "SELECT pp.user_id, u.username, COUNT(*) AS penalty_count, "
                    "       MAX(pp.offense_type) AS last_offense, "
                    "       BOOL_OR(pp.banned_at IS NOT NULL) AS is_banned "
                    "FROM player_penalties pp "
                    "JOIN users u ON u.id = pp.user_id "
                    "GROUP BY pp.user_id, u.username "
                    "HAVING COUNT(*) >= 2 "
                    "ORDER BY penalty_count DESC "
                    "LIMIT 50"
                )
            ).fetchall()
            repeat_offenders = [
                {
                    "user_id":       str(r[0]),
                    "username":      r[1],
                    "penalty_count": int(r[2]),
                    "last_offense":  r[3],
                    "is_banned":     bool(r[4]),
                    "reason":        "repeat_offender",
                }
                for r in repeat_rows
            ]

            # ── 4. Recently banned players (last 7 days) ──────────────────────
            banned_rows = session.execute(
                text(
                    "SELECT pp.user_id, u.username, pp.banned_at, pp.offense_type, pp.notes "
                    "FROM player_penalties pp "
                    "JOIN users u ON u.id = pp.user_id "
                    "WHERE pp.banned_at IS NOT NULL "
                    "  AND pp.banned_at > NOW() - INTERVAL '7 days' "
                    "ORDER BY pp.banned_at DESC "
                    "LIMIT 50"
                )
            ).fetchall()
            recently_banned = [
                {
                    "user_id":      str(r[0]),
                    "username":     r[1],
                    "banned_at":    r[2].isoformat() if r[2] else None,
                    "offense_type": r[3],
                    "notes":        r[4],
                    "reason":       "recently_banned",
                }
                for r in banned_rows
            ]

            # ── 5. Intentional losing / AML (Issue #57) ───────────────────────
            # Directional losses >= fraud_loss_min within fraud_loss_days (platform_config).
            intl_rows = session.execute(
                text(
                    "SELECT mp_loser.user_id, u_loser.username, "
                    "       mp_winner.user_id, u_winner.username, "
                    "       COUNT(*) AS loss_count, "
                    "       MIN(m.created_at) AS first_match, "
                    "       MAX(m.created_at) AS last_match "
                    "FROM matches m "
                    "JOIN match_players mp_loser  ON mp_loser.match_id  = m.id "
                    "     AND mp_loser.user_id  != m.winner_id "
                    "     AND mp_loser.user_id  IS NOT NULL "
                    "JOIN match_players mp_winner ON mp_winner.match_id = m.id "
                    "     AND mp_winner.user_id  = m.winner_id "
                    "     AND mp_winner.user_id  IS NOT NULL "
                    "JOIN users u_loser   ON u_loser.id  = mp_loser.user_id "
                    "JOIN users u_winner  ON u_winner.id = mp_winner.user_id "
                    "WHERE m.status = 'completed' "
                    "  AND m.created_at > NOW() - make_interval(0, 0, 0, :fraud_loss_days, 0, 0, 0.0) "
                    "GROUP BY mp_loser.user_id, u_loser.username, "
                    "         mp_winner.user_id, u_winner.username "
                    "HAVING COUNT(*) >= :fraud_loss_min "
                    "ORDER BY loss_count DESC "
                    "LIMIT 50"
                ),
                _fb,
            ).fetchall()
            intentional_losing = [
                {
                    "loser_id":       str(r[0]),
                    "loser_username":  r[1],
                    "winner_id":       str(r[2]),
                    "winner_username": r[3],
                    "loss_count":      int(r[4]),
                    "first_match":     r[5].isoformat() if r[5] else None,
                    "last_match":      r[6].isoformat() if r[6] else None,
                    "reason":          "intentional_losing",
                }
                for r in intl_rows
            ]

        total_flagged = (
            len(flagged_players)
            + len(suspicious_pairs)
            + len(repeat_offenders)
            + len(recently_banned)
            + len(intentional_losing)
        )

        _fp = _fraud_report_bind_params()
        logger.info(
            "admin_fraud_report: total=%d high_wr=%d pairs=%d repeat=%d banned7d=%d intentional=%d "
            "| thresholds pair_gt=%d pair_h=%d loss_min=%d loss_d=%d",
            total_flagged,
            len(flagged_players),
            len(suspicious_pairs),
            len(repeat_offenders),
            len(recently_banned),
            len(intentional_losing),
            _fp["fraud_pair_gt"],
            _fp["fraud_pair_hours"],
            _fp["fraud_loss_min"],
            _fp["fraud_loss_days"],
        )

        return {
            "generated_at":     datetime.now(timezone.utc).isoformat(),
            "flagged_players":   flagged_players,
            "suspicious_pairs":  suspicious_pairs,
            "repeat_offenders":  repeat_offenders,
            "recently_banned":   recently_banned,
            "intentional_losing": intentional_losing,
            "summary": {
                "total_flagged":       total_flagged,
                "high_winrate":        len(flagged_players),
                "pair_farming":        len(suspicious_pairs),
                "repeat_offenders":    len(repeat_offenders),
                "recently_banned":     len(recently_banned),
                "intentional_losing":  len(intentional_losing),
            },
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_fraud_report error: %s", exc)
        raise HTTPException(500, "Fraud report generation failed")


@app.get("/admin/fraud/summary", status_code=200)
async def admin_fraud_summary(payload: dict = Depends(require_admin)):
    """
    Lightweight fraud summary — returns counts only (no full row data).
    Called by Admin panel on page load to populate badge counts.
    Admin-only.
    DB-ready: user_stats, match_players, player_penalties (migrations 016, 026).
    """
    try:
        _fs = _fraud_report_bind_params()
        with SessionLocal() as session:
            high_wr = session.execute(
                text(
                    "SELECT COUNT(*) FROM user_stats us "
                    "WHERE us.win_rate > 80 AND us.matches >= 10"
                )
            ).scalar() or 0

            pair_farming = session.execute(
                text(
                    "SELECT COUNT(*) FROM ("
                    "  SELECT 1 FROM match_players mp1 "
                    "  JOIN match_players mp2 ON mp1.match_id = mp2.match_id "
                    "    AND mp1.user_id < mp2.user_id "
                    "    AND mp1.user_id IS NOT NULL AND mp2.user_id IS NOT NULL "
                    "  JOIN matches m ON m.id = mp1.match_id "
                    "  WHERE m.created_at > NOW() - make_interval(0, 0, 0, 0, :fraud_pair_hours, 0, 0.0) "
                    "  GROUP BY mp1.user_id, mp2.user_id HAVING COUNT(*) > :fraud_pair_gt"
                    ") sub"
                ),
                _fs,
            ).scalar() or 0

            repeat_off = session.execute(
                text(
                    "SELECT COUNT(*) FROM ("
                    "  SELECT user_id FROM player_penalties "
                    "  GROUP BY user_id HAVING COUNT(*) >= 2"
                    ") sub"
                )
            ).scalar() or 0

            intl_losing = session.execute(
                text(
                    "SELECT COUNT(*) FROM ("
                    "  SELECT 1 FROM matches m "
                    "  JOIN match_players mp_loser  ON mp_loser.match_id  = m.id "
                    "       AND mp_loser.user_id != m.winner_id AND mp_loser.user_id IS NOT NULL "
                    "  JOIN match_players mp_winner ON mp_winner.match_id = m.id "
                    "       AND mp_winner.user_id = m.winner_id AND mp_winner.user_id IS NOT NULL "
                    "  WHERE m.status = 'completed' "
                    "    AND m.created_at > NOW() - make_interval(0, 0, 0, :fraud_loss_days, 0, 0, 0.0) "
                    "  GROUP BY mp_loser.user_id, mp_winner.user_id HAVING COUNT(*) >= :fraud_loss_min"
                    ") sub"
                ),
                _fs,
            ).scalar() or 0

        total = int(high_wr) + int(pair_farming) + int(repeat_off) + int(intl_losing)
        logger.info(
            "admin_fraud_summary: total=%d pair_farming=%d intentional=%d (thresholds pair_gt=%d pair_h=%d)",
            total,
            int(pair_farming),
            int(intl_losing),
            _fs["fraud_pair_gt"],
            _fs["fraud_pair_hours"],
        )
        return {
            "generated_at":      datetime.now(timezone.utc).isoformat(),
            "total_flagged":      total,
            "high_winrate":       int(high_wr),
            "pair_farming":       int(pair_farming),
            "repeat_offenders":   int(repeat_off),
            "intentional_losing": int(intl_losing),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_fraud_summary error: %s", exc)
        raise HTTPException(500, "Fraud summary failed")


import json as _json
from fastapi.responses import Response as _FraudResponse


@app.post("/admin/fraud/report/export", status_code=200)
async def admin_fraud_report_export(payload: dict = Depends(require_admin)):
    """
    Run the full fraud report and return it as a downloadable JSON file.
    Filename: fraud_report_YYYY-MM-DD.json
    Admin-only.
    """
    try:
        _fe = _fraud_report_bind_params()
        with SessionLocal() as session:
            wr_rows = session.execute(
                text(
                    "SELECT us.user_id, u.username, us.win_rate, us.matches, us.wins "
                    "FROM user_stats us JOIN users u ON u.id = us.user_id "
                    "WHERE us.win_rate > 80 AND us.matches >= 10 "
                    "ORDER BY us.win_rate DESC LIMIT 50"
                )
            ).fetchall()
            pair_rows = session.execute(
                text(
                    "SELECT mp1.user_id, u1.username, mp2.user_id, u2.username, COUNT(*) "
                    "FROM match_players mp1 "
                    "JOIN match_players mp2 ON mp1.match_id = mp2.match_id "
                    "  AND mp1.user_id < mp2.user_id "
                    "  AND mp1.user_id IS NOT NULL AND mp2.user_id IS NOT NULL "
                    "JOIN users u1 ON u1.id = mp1.user_id "
                    "JOIN users u2 ON u2.id = mp2.user_id "
                    "JOIN matches m ON m.id = mp1.match_id "
                    "WHERE m.created_at > NOW() - make_interval(0, 0, 0, 0, :fraud_pair_hours, 0, 0.0) "
                    "GROUP BY mp1.user_id, u1.username, mp2.user_id, u2.username "
                    "HAVING COUNT(*) > :fraud_pair_gt ORDER BY 5 DESC LIMIT 50"
                ),
                _fe,
            ).fetchall()
            repeat_rows = session.execute(
                text(
                    "SELECT pp.user_id, u.username, COUNT(*), MAX(pp.offense_type), "
                    "BOOL_OR(pp.banned_at IS NOT NULL) "
                    "FROM player_penalties pp JOIN users u ON u.id = pp.user_id "
                    "GROUP BY pp.user_id, u.username HAVING COUNT(*) >= 2 "
                    "ORDER BY 3 DESC LIMIT 50"
                )
            ).fetchall()
            intl_rows = session.execute(
                text(
                    "SELECT mp_loser.user_id, u_loser.username, "
                    "       mp_winner.user_id, u_winner.username, COUNT(*), "
                    "       MIN(m.created_at), MAX(m.created_at) "
                    "FROM matches m "
                    "JOIN match_players mp_loser  ON mp_loser.match_id  = m.id "
                    "     AND mp_loser.user_id != m.winner_id AND mp_loser.user_id IS NOT NULL "
                    "JOIN match_players mp_winner ON mp_winner.match_id = m.id "
                    "     AND mp_winner.user_id = m.winner_id AND mp_winner.user_id IS NOT NULL "
                    "JOIN users u_loser   ON u_loser.id  = mp_loser.user_id "
                    "JOIN users u_winner  ON u_winner.id = mp_winner.user_id "
                    "WHERE m.status = 'completed' "
                    "  AND m.created_at > NOW() - make_interval(0, 0, 0, :fraud_loss_days, 0, 0, 0.0) "
                    "GROUP BY mp_loser.user_id, u_loser.username, mp_winner.user_id, u_winner.username "
                    "HAVING COUNT(*) >= :fraud_loss_min ORDER BY 5 DESC LIMIT 50"
                ),
                _fe,
            ).fetchall()

        now = datetime.now(timezone.utc)
        logger.info(
            "admin_fraud_report_export: rows wr=%d pairs=%d intl=%d",
            len(wr_rows),
            len(pair_rows),
            len(intl_rows),
        )
        report = {
            "generated_at": now.isoformat(),
            "flagged_players": [
                {"user_id": str(r[0]), "username": r[1], "win_rate": float(r[2]),
                 "matches": int(r[3]), "wins": int(r[4]), "reason": "win_rate_anomaly"}
                for r in wr_rows
            ],
            "suspicious_pairs": [
                {"player_a": str(r[0]), "username_a": r[1],
                 "player_b": str(r[2]), "username_b": r[3],
                 "match_count": int(r[4]), "reason": "pair_farming"}
                for r in pair_rows
            ],
            "repeat_offenders": [
                {"user_id": str(r[0]), "username": r[1], "penalty_count": int(r[2]),
                 "last_offense": r[3], "is_banned": bool(r[4]), "reason": "repeat_offender"}
                for r in repeat_rows
            ],
            "intentional_losing": [
                {"loser_id": str(r[0]), "loser_username": r[1],
                 "winner_id": str(r[2]), "winner_username": r[3],
                 "loss_count": int(r[4]),
                 "first_match": r[5].isoformat() if r[5] else None,
                 "last_match":  r[6].isoformat() if r[6] else None,
                 "reason": "intentional_losing"}
                for r in intl_rows
            ],
        }
        filename = f"fraud_report_{now.strftime('%Y-%m-%d')}.json"
        return _FraudResponse(
            content=_json.dumps(report, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_fraud_report_export error: %s", exc)
        raise HTTPException(500, "Fraud report export failed")


# ── Admin — Audit Logging helper ──────────────────────────────────────────────


def _log_audit(
    admin_id: str,
    action: str,
    target_id: str | None = None,
    notes: str | None = None,
) -> None:
    """
    Insert a row into admin_audit_log for every admin action.
    Non-fatal — if the insert fails it logs a warning and continues.

    Action names (UPPERCASE constants):
      FREEZE_PAYOUT, UNFREEZE_PAYOUT, BAN_USER, SUSPEND_USER,
      DECLARE_WINNER, CONFIG_UPDATE

    DB-ready: admin_audit_log (migration 017).
    """
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "INSERT INTO admin_audit_log (admin_id, action, target_id, notes) "
                    "VALUES (:admin_id, :action, :target_id, :notes)"
                ),
                {
                    "admin_id":  admin_id,
                    "action":    action,
                    "target_id": target_id,
                    "notes":     notes,
                },
            )
            session.commit()
    except Exception as exc:
        logger.warning("_log_audit failed (non-fatal): %s", exc)


# ── Admin — Users list ────────────────────────────────────────────────────────


@app.get("/admin/users", status_code=200)
async def admin_list_users(
    search: str | None = None,
    status: str | None = None,
    flagged: bool | None = None,
    limit: int = 50,
    offset: int = 0,
    payload: dict = Depends(require_admin),
):
    """
    Return a paginated list of all users with risk/suspension data.

    Query params:
      search  — filter by username (ILIKE %search%)
      status  — filter by users.status ('active','flagged','banned','suspended')
      flagged — if true, only users who have at least 1 penalty
      limit   — page size (max 200)
      offset  — pagination offset

    Each user row includes:
      id, username, email, status, rank, created_at,
      matches, wins, win_rate (from user_stats),
      penalty_count, is_suspended, is_banned, suspended_until (from player_penalties)

    DB-ready: users + user_stats + player_penalties (migrations 001 + 016).
    """
    limit = min(limit, 200)
    try:
        with SessionLocal() as session:
            # Build WHERE clauses dynamically
            conditions = []
            params: dict = {"limit": limit, "offset": offset}

            if search:
                conditions.append("u.username ILIKE :search")
                params["search"] = f"%{search}%"
            if status:
                conditions.append("u.status = :status")
                params["status"] = status

            where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

            # Base query: users + user_stats + at_balance + player_penalties
            base_sql = (
                "SELECT u.id, u.username, u.email, u.status, u.rank, u.created_at, "
                "       u.at_balance, u.wallet_address, "
                "       COALESCE(us.matches, 0)  AS matches, "
                "       COALESCE(us.wins, 0)     AS wins, "
                "       COALESCE(us.win_rate, 0) AS win_rate, "
                "       COALESCE(pp.penalty_count, 0) AS penalty_count, "
                "       pp.latest_suspended_until, "
                "       pp.latest_banned_at "
                "FROM users u "
                "LEFT JOIN user_stats us ON us.user_id = u.id "
                "LEFT JOIN ( "
                "    SELECT user_id, "
                "           COUNT(*) AS penalty_count, "
                "           MAX(suspended_until) AS latest_suspended_until, "
                "           MAX(banned_at) AS latest_banned_at "
                "    FROM player_penalties "
                "    GROUP BY user_id "
                ") pp ON pp.user_id = u.id "
                + where_clause
            )

            if flagged:
                joiner = " AND " if conditions else " WHERE "
                base_sql += joiner + "pp.penalty_count > 0"

            rows = session.execute(
                text(base_sql + " ORDER BY u.created_at DESC LIMIT :limit OFFSET :offset"),
                params,
            ).fetchall()

            now_utc = datetime.now(timezone.utc)
            users_out = []
            for r in rows:
                (
                    uid, username, email, ustatus, rank, created_at,
                    at_balance, wallet_address,
                    matches, wins, win_rate,
                    penalty_count, suspended_until, banned_at,
                ) = r
                is_banned     = banned_at is not None
                is_suspended  = (
                    not is_banned
                    and suspended_until is not None
                    and suspended_until > now_utc
                )
                users_out.append({
                    "user_id":         str(uid),
                    "username":        username,
                    "email":           email,
                    "status":          ustatus,
                    "rank":            rank,
                    "created_at":      created_at.isoformat() if created_at else None,
                    "at_balance":      int(at_balance) if at_balance is not None else 0,
                    "wallet_address":  wallet_address,
                    "matches":         int(matches),
                    "wins":            int(wins),
                    "win_rate":        float(win_rate),
                    "penalty_count":   int(penalty_count),
                    "is_suspended":    is_suspended,
                    "is_banned":       is_banned,
                    "suspended_until": suspended_until.isoformat() if suspended_until else None,
                    "banned_at":       banned_at.isoformat() if banned_at else None,
                })

            # Total count (no pagination)
            count_sql = (
                "SELECT COUNT(*) FROM users u "
                "LEFT JOIN ( "
                "    SELECT user_id, COUNT(*) AS penalty_count "
                "    FROM player_penalties GROUP BY user_id "
                ") pp ON pp.user_id = u.id "
                + where_clause
            )
            count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
            if flagged:
                joiner = " AND " if conditions else " WHERE "
                count_sql += joiner + "pp.penalty_count > 0"

            total_row = session.execute(text(count_sql), count_params).fetchone()
            total = int(total_row[0]) if total_row else 0

        return {"users": users_out, "total": total, "limit": limit, "offset": offset}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_list_users error: %s", exc)
        raise HTTPException(500, "Failed to fetch users")


# ── Admin — Disputes list ─────────────────────────────────────────────────────


@app.get("/admin/disputes", status_code=200)
async def admin_list_disputes(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    payload: dict = Depends(require_admin),
):
    """
    Return a paginated list of disputes with player usernames and match info.

    Query params:
      status — filter by dispute status ('open','reviewing','resolved','escalated')
      limit  — page size (max 200)
      offset — pagination offset

    DB-ready: disputes + users + matches.
    """
    limit = min(limit, 200)
    try:
        with SessionLocal() as session:
            conditions = []
            params: dict = {"limit": limit, "offset": offset}

            if status:
                conditions.append("d.status = :status")
                params["status"] = status

            where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

            rows = session.execute(
                text(
                    "SELECT d.id, d.match_id, d.player_a, "
                    "       ua.username AS raised_by_username, "
                    "       d.reason, d.status, d.resolution, d.admin_notes, "
                    "       d.created_at, d.resolved_at, "
                    "       m.game, m.bet_amount, m.stake_currency "
                    "FROM disputes d "
                    "JOIN users ua ON ua.id = d.player_a "
                    "JOIN matches m ON m.id = d.match_id "
                    + where_clause
                    + " ORDER BY d.created_at DESC LIMIT :limit OFFSET :offset"
                ),
                params,
            ).fetchall()

            disputes_out = [
                {
                    "id":                 str(r[0]),
                    "match_id":           str(r[1]),
                    "raised_by":          str(r[2]),
                    "raised_by_username": r[3],
                    "reason":             r[4],
                    "status":             r[5],
                    "resolution":         r[6],
                    "admin_notes":        r[7],
                    "created_at":         r[8].isoformat() if r[8] else None,
                    "resolved_at":        r[9].isoformat() if r[9] else None,
                    "game":               r[10],
                    "bet_amount":         float(r[11]) if r[11] else None,
                    "stake_currency":     r[12],
                }
                for r in rows
            ]

            count_sql = (
                "SELECT COUNT(*) FROM disputes d "
                + where_clause
            )
            count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
            total_row = session.execute(text(count_sql), count_params).fetchone()
            total = int(total_row[0]) if total_row else 0

        return {"disputes": disputes_out, "total": total, "limit": limit, "offset": offset}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_list_disputes error: %s", exc)
        raise HTTPException(500, "Failed to fetch disputes")


# ── Platform Config ───────────────────────────────────────────────────────────
# Uses platform_config (key-value table, migration 017).
# Known keys: fee_pct, daily_bet_max_at, daily_bet_max_usdt, maintenance_mode,
#             new_registrations, auto_escalate_disputes,
#             high_stakes_*, daily_loss_cap_* (Issue #40),
#             fraud_* (AML report thresholds, Issue #57)

_PLATFORM_CONFIG_KEYS = {
    "fee_pct",
    "daily_bet_max_at",
    "daily_bet_max_usdt",
    "high_stakes_daily_max",
    "high_stakes_min_bet_at",
    "high_stakes_min_bet_usdt",
    "daily_loss_cap_at",
    "daily_loss_cap_usdt",
    "maintenance_mode",
    "new_registrations",
    "auto_escalate_disputes",
    "fraud_pair_match_gt",
    "fraud_pair_window_hours",
    "fraud_intentional_loss_min_count",
    "fraud_intentional_loss_days",
}


class PlatformConfigUpdate(BaseModel):
    """Body for PUT /platform/config — partial update, all fields optional."""
    fee_pct:                 str | None = None   # e.g. "5" (percent, 0–50)
    daily_bet_max_at:        str | None = None   # e.g. "50000" (1 AT=$0.01 → $500/day)
    daily_bet_max_usdt:      str | None = None   # e.g. "500" (USDT per 24h, CRYPTO matches)
    high_stakes_daily_max:   str | None = None   # 0 = off
    high_stakes_min_bet_at:  str | None = None
    high_stakes_min_bet_usdt: str | None = None
    daily_loss_cap_at:       str | None = None   # 0 = off
    daily_loss_cap_usdt:     str | None = None   # 0 = off
    maintenance_mode:        str | None = None   # "true" | "false"
    new_registrations:       str | None = None   # "true" | "false"
    auto_escalate_disputes:  str | None = None   # "true" | "false"
    fraud_pair_match_gt:              str | None = None  # HAVING COUNT(*) > this (pair farming)
    fraud_pair_window_hours:          str | None = None  # rolling window for pair query
    fraud_intentional_loss_min_count: str | None = None  # HAVING COUNT(*) >= this
    fraud_intentional_loss_days:      str | None = None  # lookback for intentional losing


@app.get("/config/public-pool", status_code=200)
async def get_public_pool_config():
    """
    Return all active public match pool configurations.

    Public endpoint — no auth required (frontend reads this to populate lobby
    filter options and stake-amount selectors instead of hardcoding values).

    Response: list of { game, mode, stake_currency, stake_amount, min_open_rooms }
    DB-ready: public_match_pool_config (migration 041).
    """
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT game, mode, stake_currency, stake_amount, min_open_rooms "
                    "FROM public_match_pool_config WHERE is_active = TRUE "
                    "ORDER BY game, mode, stake_currency, stake_amount"
                )
            ).fetchall()
        return {
            "configs": [
                {
                    "game":           r[0],
                    "mode":           r[1],
                    "stake_currency": r[2],
                    "stake_amount":   float(r[3]),
                    "min_open_rooms": r[4],
                }
                for r in rows
            ]
        }
    except Exception as exc:
        logger.error("get_public_pool_config error: %s", exc)
        raise HTTPException(500, "Failed to fetch pool config")


@app.get("/platform/config", status_code=200)
async def get_platform_config(payload: dict = Depends(require_admin)):
    """
    Return all platform config keys from platform_config (key-value table).

    Response: { fee_pct, daily_bet_max_at, daily_bet_max_usdt, maintenance_mode,
                new_registrations, auto_escalate_disputes }

    DB-ready: platform_config (migration 017).
    """
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text("SELECT key, value FROM platform_config WHERE key = ANY(:keys)"),
                {"keys": list(_PLATFORM_CONFIG_KEYS)},
            ).fetchall()
        cfg = {r[0]: r[1] for r in rows}
        return {
            "fee_pct":                 cfg.get("fee_pct", "5"),
            "daily_bet_max_at":        cfg.get("daily_bet_max_at", "50000"),
            "daily_bet_max_usdt":      cfg.get("daily_bet_max_usdt", "500"),
            "high_stakes_daily_max":   cfg.get("high_stakes_daily_max", "0"),
            "high_stakes_min_bet_at":  cfg.get("high_stakes_min_bet_at", "25000"),
            "high_stakes_min_bet_usdt": cfg.get("high_stakes_min_bet_usdt", "100"),
            "daily_loss_cap_at":       cfg.get("daily_loss_cap_at", "0"),
            "daily_loss_cap_usdt":     cfg.get("daily_loss_cap_usdt", "0"),
            "maintenance_mode":        cfg.get("maintenance_mode", "false"),
            "new_registrations":       cfg.get("new_registrations", "true"),
            "auto_escalate_disputes":  cfg.get("auto_escalate_disputes", "false"),
            "fraud_pair_match_gt":              cfg.get("fraud_pair_match_gt", "3"),
            "fraud_pair_window_hours":          cfg.get("fraud_pair_window_hours", "24"),
            "fraud_intentional_loss_min_count": cfg.get("fraud_intentional_loss_min_count", "5"),
            "fraud_intentional_loss_days":      cfg.get("fraud_intentional_loss_days", "7"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_platform_config error: %s", exc)
        raise HTTPException(500, "Failed to fetch platform config")


@app.put("/platform/config", status_code=200)
async def update_platform_config(
    req: PlatformConfigUpdate,
    payload: dict = Depends(require_admin),
):
    """
    Update one or more platform config keys. Only provided fields are updated.

    Validates:
      fee_pct: numeric 0–50
      daily_bet_max_at: numeric > 0
      daily_bet_max_usdt: numeric > 0
      high_stakes_daily_max / daily_loss_cap_* : numeric >= 0
      high_stakes_min_bet_at: int >= 1
      high_stakes_min_bet_usdt: numeric > 0

    DB-ready: platform_config UPSERT per key (migration 017).
    """
    admin_id = payload.get("sub")

    # Collect only provided fields
    updates: dict[str, str] = {}
    raw = req.model_dump(exclude_none=True)
    for key, val in raw.items():
        updates[key] = str(val)

    if not updates:
        raise HTTPException(400, "No fields provided to update")

    # Validate numeric ranges
    if "fee_pct" in updates:
        try:
            v = float(updates["fee_pct"])
        except ValueError:
            raise HTTPException(400, "fee_pct must be numeric")
        if not (0 <= v <= 50):
            raise HTTPException(400, "fee_pct must be between 0 and 50")
    if "daily_bet_max_at" in updates:
        try:
            v = float(updates["daily_bet_max_at"])
        except ValueError:
            raise HTTPException(400, "daily_bet_max_at must be numeric")
        if v <= 0:
            raise HTTPException(400, "daily_bet_max_at must be positive")
    if "daily_bet_max_usdt" in updates:
        try:
            v = float(updates["daily_bet_max_usdt"])
        except ValueError:
            raise HTTPException(400, "daily_bet_max_usdt must be numeric")
        if v <= 0:
            raise HTTPException(400, "daily_bet_max_usdt must be positive")
    _risk_int_nonneg = (
        "high_stakes_daily_max",
        "daily_loss_cap_at",
    )
    for k in _risk_int_nonneg:
        if k in updates:
            try:
                v = float(updates[k])
            except ValueError:
                raise HTTPException(400, f"{k} must be numeric")
            if v < 0:
                raise HTTPException(400, f"{k} must be >= 0")
    if "high_stakes_min_bet_at" in updates:
        try:
            v = float(updates["high_stakes_min_bet_at"])
        except ValueError:
            raise HTTPException(400, "high_stakes_min_bet_at must be numeric")
        if v < 1:
            raise HTTPException(400, "high_stakes_min_bet_at must be >= 1")
    if "high_stakes_min_bet_usdt" in updates:
        try:
            v = float(updates["high_stakes_min_bet_usdt"])
        except ValueError:
            raise HTTPException(400, "high_stakes_min_bet_usdt must be numeric")
        if v <= 0:
            raise HTTPException(400, "high_stakes_min_bet_usdt must be positive")
    if "daily_loss_cap_usdt" in updates:
        try:
            v = float(updates["daily_loss_cap_usdt"])
        except ValueError:
            raise HTTPException(400, "daily_loss_cap_usdt must be numeric")
        if v < 0:
            raise HTTPException(400, "daily_loss_cap_usdt must be >= 0")

    _fraud_int_fields = {
        "fraud_pair_match_gt":              (1, 500),
        "fraud_pair_window_hours":          (1, 8760),
        "fraud_intentional_loss_min_count": (2, 500),
        "fraud_intentional_loss_days":      (1, 365),
    }
    for fk, (lo, hi) in _fraud_int_fields.items():
        if fk in updates:
            try:
                v = int(float(updates[fk]))
            except ValueError:
                raise HTTPException(400, f"{fk} must be an integer")
            if not (lo <= v <= hi):
                raise HTTPException(400, f"{fk} must be between {lo} and {hi}")

    try:
        with SessionLocal() as session:
            for key, val in updates.items():
                session.execute(
                    text(
                        "INSERT INTO platform_config (key, value, updated_at, updated_by) "
                        "VALUES (:key, :val, NOW(), :admin_id) "
                        "ON CONFLICT (key) DO UPDATE "
                        "SET value = EXCLUDED.value, "
                        "    updated_at = NOW(), "
                        "    updated_by = EXCLUDED.updated_by"
                    ),
                    {"key": key, "val": val, "admin_id": admin_id},
                )
            session.commit()

        # Reload daily limit cache immediately if it was changed
        if "daily_bet_max_at" in updates:
            _reload_at_daily_limit()
            logger.info("Daily stake limit reloaded: %d AT ($%d)", _at_daily_limit, _at_daily_limit // 100)
        if "daily_bet_max_usdt" in updates:
            _reload_at_daily_usdt_limit()
            logger.info("Daily USDT stake limit reloaded: %.2f", _at_daily_usdt_limit)
        _risk_reload_keys = {
            "high_stakes_daily_max",
            "high_stakes_min_bet_at",
            "high_stakes_min_bet_usdt",
            "daily_loss_cap_at",
            "daily_loss_cap_usdt",
        }
        if _risk_reload_keys & set(updates.keys()):
            _reload_risk_limits()

        _fraud_reload_keys = {
            "fraud_pair_match_gt",
            "fraud_pair_window_hours",
            "fraud_intentional_loss_min_count",
            "fraud_intentional_loss_days",
        }
        if _fraud_reload_keys & set(updates.keys()):
            _reload_fraud_detection_config()
            fp = _fraud_report_bind_params()
            logger.info(
                "Fraud thresholds reloaded: pair_gt=%d pair_h=%d loss_min=%d loss_d=%d",
                fp["fraud_pair_gt"],
                fp["fraud_pair_hours"],
                fp["fraud_loss_min"],
                fp["fraud_loss_days"],
            )

        logger.info("update_platform_config: admin=%s keys=%s", admin_id, list(updates.keys()))
        _log_audit(
            admin_id,
            "CONFIG_UPDATE",
            target_id="platform_config",
            notes=str(updates),
        )
        return {"updated": True, "fields": list(updates.keys())}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_platform_config error: %s", exc)
        raise HTTPException(500, "Failed to update platform config")


# ── Admin — Audit Log ─────────────────────────────────────────────────────────


@app.get("/admin/dispute-holdings", status_code=200)
async def admin_list_dispute_holdings(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    payload: dict = Depends(require_admin),
):
    """
    GET /admin/dispute-holdings — list matches where funds were moved to holding wallet.
    These require manual admin review: either award a team or refund all players.
    """
    try:
        with SessionLocal() as session:
            filters = "WHERE dh.status = :status" if status else ""
            params: dict = {"limit": limit, "offset": offset}
            if status:
                params["status"] = status
            rows = session.execute(text(f"""
                SELECT
                    dh.id,
                    dh.match_id,
                    dh.on_chain_tx_hash,
                    dh.holding_wallet,
                    dh.amount_wei::text,
                    dh.reason,
                    dh.status,
                    dh.admin_notes,
                    dh.created_at,
                    dh.resolved_at,
                    m.game,
                    m.stake_per_player,
                    COUNT(mp.user_id) FILTER (WHERE mp.has_deposited) AS player_count
                FROM dispute_holdings dh
                JOIN matches m ON m.id = dh.match_id
                LEFT JOIN match_players mp ON mp.match_id = dh.match_id
                {filters}
                GROUP BY dh.id, m.game, m.stake_per_player
                ORDER BY dh.created_at DESC
                LIMIT :limit OFFSET :offset
            """), params).fetchall()
            return {
                "holdings": [
                    {
                        "id":               str(r[0]),
                        "match_id":         str(r[1]),
                        "on_chain_tx_hash": r[2],
                        "holding_wallet":   r[3],
                        "amount_wei":       r[4],
                        "reason":           r[5],
                        "status":           r[6],
                        "admin_notes":      r[7],
                        "created_at":       r[8].isoformat() if r[8] else None,
                        "resolved_at":      r[9].isoformat() if r[9] else None,
                        "game":             r[10],
                        "stake_per_player": str(r[11]) if r[11] else None,
                        "player_count":     r[12],
                    }
                    for r in rows
                ]
            }
    except Exception as exc:
        logger.error("admin_list_dispute_holdings error: %s", exc)
        raise HTTPException(500, "Failed to fetch dispute holdings")


class DisputeHoldingResolveRequest(BaseModel):
    action: str      # "award_a" | "award_b" | "refund_all"
    notes:  str = ""


@app.post("/admin/dispute-holdings/{holding_id}/resolve", status_code=200)
async def admin_resolve_dispute_holding(
    holding_id: str,
    req: DisputeHoldingResolveRequest,
    payload: dict = Depends(require_admin),
):
    """
    POST /admin/dispute-holdings/{id}/resolve

    Admin reviews match screenshots and resolves a pending holding:
      award_a     — Team A wins: mark match completed, update winner_id
      award_b     — Team B wins: same
      refund_all  — Draw/unresolvable: mark match cancelled, refund AT players
                    (CRYPTO: admin must manually send from holding wallet)

    Writes audit_logs entry. Idempotent guard: only resolves 'pending' holdings.
    """
    admin_id = str(payload.get("sub") or payload.get("user_id", ""))
    if req.action not in ("award_a", "award_b", "refund_all"):
        raise HTTPException(400, "action must be award_a, award_b, or refund_all")
    try:
        with SessionLocal() as session:
            holding = session.execute(text("""
                SELECT dh.id, dh.match_id, dh.status, m.stake_currency
                FROM dispute_holdings dh
                JOIN matches m ON m.id = dh.match_id
                WHERE dh.id = CAST(:hid AS uuid) AND dh.status = 'pending'
                FOR UPDATE
            """), {"hid": holding_id}).fetchone()
            if not holding:
                raise HTTPException(404, "Holding not found or already resolved")

            match_id       = str(holding[1])
            stake_currency = holding[3]

            if req.action in ("award_a", "award_b"):
                team = "A" if req.action == "award_a" else "B"
                winner_row = session.execute(text("""
                    SELECT user_id FROM match_players
                    WHERE match_id = :mid AND team = :team AND has_deposited = TRUE
                    LIMIT 1
                """), {"mid": match_id, "team": team}).fetchone()
                if not winner_row:
                    raise HTTPException(400, f"No deposited player found on team {team}")
                winner_id = str(winner_row[0])

                session.execute(text("""
                    UPDATE matches
                    SET status = 'completed', winner_id = :wid, ended_at = NOW()
                    WHERE id = :mid AND status IN ('in_progress', 'disputed')
                """), {"wid": winner_id, "mid": match_id})

                if stake_currency == "AT":
                    _settle_at_match(match_id, winner_id)

            else:  # refund_all
                session.execute(text("""
                    UPDATE matches
                    SET status = 'cancelled', ended_at = NOW()
                    WHERE id = :mid AND status IN ('in_progress', 'disputed')
                """), {"mid": match_id})
                if stake_currency == "AT":
                    _refund_at_match(match_id)

            session.execute(text("""
                UPDATE dispute_holdings
                SET status = 'resolved', admin_notes = :notes,
                    resolved_at = NOW(), resolved_by = CAST(:admin AS uuid)
                WHERE id = CAST(:hid AS uuid)
            """), {"notes": req.notes, "admin": admin_id, "hid": holding_id})

            session.execute(text("""
                INSERT INTO audit_logs (admin_id, action, target_id, metadata, created_at)
                VALUES (CAST(:aid AS uuid), 'resolve_dispute_holding',
                        :hid, :meta, NOW())
            """), {
                "aid":  admin_id,
                "hid":  holding_id,
                "meta": f"action={req.action} currency={stake_currency} notes={req.notes}",
            })
            session.commit()
            final_status = "completed" if req.action in ("award_a", "award_b") else "cancelled"
            _ws_match_status(match_id, final_status)
        return {"ok": True, "resolved": holding_id, "action": req.action}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_resolve_dispute_holding error: %s", exc)
        raise HTTPException(500, "Failed to resolve dispute holding")


@app.get("/admin/audit-log", status_code=200)
async def admin_audit_log_list(
    limit: int = 50,
    offset: int = 0,
    action: str | None = None,
    payload: dict = Depends(require_admin),
):
    """
    Return paginated admin audit log.

    Query params:
      action — filter by action (e.g. 'FREEZE_PAYOUT', 'BAN_USER')
      limit  — page size (max 200)
      offset — pagination offset

    Response: { entries: [{ id, admin_username, action, target_id, notes, created_at }], total }

    DB-ready: admin_audit_log + users (migration 017).
    """
    limit = min(limit, 200)
    try:
        with SessionLocal() as session:
            conditions = []
            params: dict = {"limit": limit, "offset": offset}

            if action:
                conditions.append("al.action = :action")
                params["action"] = action

            where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

            rows = session.execute(
                text(
                    "SELECT al.id, al.admin_id, u.username AS admin_username, "
                    "       al.action, al.target_id, al.notes, al.created_at "
                    "FROM admin_audit_log al "
                    "LEFT JOIN users u ON u.id = al.admin_id "
                    + where_clause
                    + " ORDER BY al.created_at DESC LIMIT :limit OFFSET :offset"
                ),
                params,
            ).fetchall()

            entries = [
                {
                    "id":             str(r[0]),
                    "admin_id":       str(r[1]) if r[1] else None,
                    "admin_username": r[2],
                    "action":         r[3],
                    "target_id":      r[4],
                    "notes":          r[5],
                    "created_at":     r[6].isoformat() if r[6] else None,
                }
                for r in rows
            ]

            count_sql = "SELECT COUNT(*) FROM admin_audit_log al " + where_clause
            count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
            total_row = session.execute(text(count_sql), count_params).fetchone()
            total = int(total_row[0]) if total_row else 0

        return {"entries": entries, "total": total, "limit": limit, "offset": offset}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_audit_log_list error: %s", exc)
        raise HTTPException(500, "Failed to fetch audit log")


# ── Creators Hub ──────────────────────────────────────────────────────────────


@app.get("/creators", status_code=200)
async def get_creators(
    game: str | None = None,
    tier: str | None = None,
    featured: bool | None = None,
    limit: int = 50,
    offset: int = 0,
):
    """Public list of approved creators."""
    try:
        with SessionLocal() as session:
            where = ["cp.user_id = u.id"]
            params: dict = {"limit": min(limit, 100), "offset": offset}
            if game:
                where.append("cp.primary_game = :game")
                params["game"] = game
            if tier:
                where.append("cp.rank_tier = :tier")
                params["tier"] = tier
            if featured is not None:
                where.append("cp.featured = :featured")
                params["featured"] = featured
            where_sql = "WHERE " + " AND ".join(where)
            rows = session.execute(text(f"""
                SELECT cp.id, cp.user_id, cp.display_name, cp.bio, cp.primary_game,
                       cp.rank_tier, cp.twitch_url, cp.youtube_url, cp.tiktok_url,
                       cp.twitter_url, cp.clip_urls, cp.featured, cp.created_at,
                       u.username, u.avatar, u.avatar_bg, u.equipped_badge_icon, u.rank
                FROM creator_profiles cp, users u
                {where_sql}
                ORDER BY cp.featured DESC, cp.approved_at DESC
                LIMIT :limit OFFSET :offset
            """), params).fetchall()
            total = session.execute(text(f"""
                SELECT COUNT(*) FROM creator_profiles cp, users u {where_sql}
            """), {k: v for k, v in params.items() if k not in ("limit", "offset")}).scalar()
            creators = [
                {
                    "id": str(r[0]), "user_id": str(r[1]), "display_name": r[2],
                    "bio": r[3], "primary_game": r[4], "rank_tier": r[5],
                    "twitch_url": r[6], "youtube_url": r[7], "tiktok_url": r[8],
                    "twitter_url": r[9], "clip_urls": r[10] or [],
                    "featured": r[11], "created_at": r[12].isoformat() if r[12] else None,
                    "username": r[13], "avatar": r[14], "avatar_bg": r[15],
                    "equipped_badge_icon": r[16], "rank": r[17],
                }
                for r in rows
            ]
        return {"creators": creators, "total": total or 0, "limit": limit, "offset": offset}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_creators error: %s", exc)
        raise HTTPException(500, "Failed to fetch creators")


@app.get("/creators/me", status_code=200)
async def get_my_creator_profile(payload: dict = Depends(optional_token)):
    """Get the current user's own creator profile."""
    user_id = payload.get("sub") if payload else None
    if not user_id:
        raise HTTPException(401, "Authentication required")
    try:
        with SessionLocal() as session:
            row = session.execute(text("""
                SELECT cp.id, cp.user_id, cp.display_name, cp.bio, cp.primary_game,
                       cp.rank_tier, cp.twitch_url, cp.youtube_url, cp.tiktok_url,
                       cp.twitter_url, cp.clip_urls, cp.featured, cp.created_at,
                       u.username, u.avatar, u.avatar_bg, u.equipped_badge_icon, u.rank
                FROM creator_profiles cp JOIN users u ON u.id = cp.user_id
                WHERE cp.user_id = :uid
            """), {"uid": user_id}).fetchone()
            if not row:
                raise HTTPException(404, "No creator profile found")
            return {
                "id": str(row[0]), "user_id": str(row[1]),
                "display_name": row[2], "bio": row[3],
                "primary_game": row[4], "rank_tier": row[5],
                "twitch_url": row[6], "youtube_url": row[7],
                "tiktok_url": row[8], "twitter_url": row[9],
                "clip_urls": row[10] or [],
                "featured": row[11], "created_at": str(row[12]),
                "username": row[13], "avatar": row[14], "avatar_bg": row[15],
                "equipped_badge_icon": row[16], "rank": row[17],
            }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_my_creator_profile error: %s", exc)
        raise HTTPException(500, "Failed to fetch profile")


@app.get("/creators/{creator_id}", status_code=200)
async def get_creator(creator_id: str):
    """Single creator profile — public."""
    try:
        with SessionLocal() as session:
            row = session.execute(text("""
                SELECT cp.id, cp.user_id, cp.display_name, cp.bio, cp.primary_game,
                       cp.rank_tier, cp.twitch_url, cp.youtube_url, cp.tiktok_url,
                       cp.twitter_url, cp.clip_urls, cp.featured, cp.created_at,
                       u.username, u.avatar, u.avatar_bg, u.equipped_badge_icon, u.rank,
                       u.arena_id,
                       (SELECT COUNT(*) FROM matches m
                        JOIN match_players mp ON mp.match_id = m.id
                        WHERE mp.user_id = cp.user_id AND m.status = 'completed') AS total_matches,
                       (SELECT COUNT(*) FROM matches m
                        WHERE m.winner_id = cp.user_id AND m.status = 'completed') AS wins
                FROM creator_profiles cp JOIN users u ON u.id = cp.user_id
                WHERE cp.id = :cid
            """), {"cid": creator_id}).fetchone()
            if not row:
                raise HTTPException(404, "Creator not found")
            return {
                "id": str(row[0]), "user_id": str(row[1]), "display_name": row[2],
                "bio": row[3], "primary_game": row[4], "rank_tier": row[5],
                "twitch_url": row[6], "youtube_url": row[7], "tiktok_url": row[8],
                "twitter_url": row[9], "clip_urls": row[10] or [],
                "featured": row[11], "created_at": row[12].isoformat() if row[12] else None,
                "username": row[13], "avatar": row[14], "avatar_bg": row[15],
                "equipped_badge_icon": row[16], "rank": row[17], "arena_id": row[18],
                "total_matches": int(row[19] or 0), "wins": int(row[20] or 0),
            }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_creator error: %s", exc)
        raise HTTPException(500, "Failed to fetch creator")


@app.post("/creators/apply", status_code=201)
async def apply_creator(request: Request, payload: dict = Depends(optional_token)):
    """Submit a creator application. Requires auth."""
    if not payload:
        raise HTTPException(401, "Authentication required")
    user_id = payload.get("sub")
    body = await request.json()
    primary_game = body.get("primary_game", "").strip()
    if not primary_game:
        raise HTTPException(400, "primary_game is required")
    try:
        with SessionLocal() as session:
            existing = session.execute(text(
                "SELECT id, status FROM creator_applications WHERE user_id = :uid"
            ), {"uid": user_id}).fetchone()
            if existing:
                if existing[1] == "pending":
                    raise HTTPException(409, "Application already pending")
                if existing[1] == "approved":
                    raise HTTPException(409, "Already a creator")
                session.execute(text("""
                    UPDATE creator_applications
                    SET primary_game=:game, twitch_url=:tw, youtube_url=:yt,
                        tiktok_url=:tt, twitter_url=:tx, bio=:bio,
                        motivation=:mot, status='pending', reviewed_by=NULL,
                        review_note=NULL, reviewed_at=NULL, created_at=NOW()
                    WHERE user_id=:uid
                """), {
                    "uid": user_id, "game": primary_game,
                    "tw": body.get("twitch_url"), "yt": body.get("youtube_url"),
                    "tt": body.get("tiktok_url"), "tx": body.get("twitter_url"),
                    "bio": body.get("bio"), "mot": body.get("motivation"),
                })
            else:
                session.execute(text("""
                    INSERT INTO creator_applications
                      (user_id, primary_game, twitch_url, youtube_url, tiktok_url,
                       twitter_url, bio, motivation)
                    VALUES (:uid, :game, :tw, :yt, :tt, :tx, :bio, :mot)
                """), {
                    "uid": user_id, "game": primary_game,
                    "tw": body.get("twitch_url"), "yt": body.get("youtube_url"),
                    "tt": body.get("tiktok_url"), "tx": body.get("twitter_url"),
                    "bio": body.get("bio"), "mot": body.get("motivation"),
                })
            session.commit()
        return {"status": "pending", "message": "Application submitted"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("apply_creator error: %s", exc)
        raise HTTPException(500, "Failed to submit application")


@app.get("/admin/creators/applications", status_code=200)
async def admin_get_creator_applications(
    status: str = "pending",
    payload: dict = Depends(require_admin),
):
    """Admin — list creator applications."""
    try:
        with SessionLocal() as session:
            rows = session.execute(text("""
                SELECT ca.id, ca.user_id, ca.primary_game, ca.twitch_url, ca.youtube_url,
                       ca.tiktok_url, ca.twitter_url, ca.bio, ca.motivation,
                       ca.status, ca.review_note, ca.created_at,
                       u.username, u.rank, u.avatar, u.avatar_bg,
                       (SELECT COUNT(*) FROM matches m JOIN match_players mp ON mp.match_id=m.id
                        WHERE mp.user_id=ca.user_id AND m.status='completed') AS matches
                FROM creator_applications ca JOIN users u ON u.id = ca.user_id
                WHERE ca.status = :status
                ORDER BY ca.created_at DESC
            """), {"status": status}).fetchall()
            return {"applications": [
                {
                    "id": str(r[0]), "user_id": str(r[1]), "primary_game": r[2],
                    "twitch_url": r[3], "youtube_url": r[4], "tiktok_url": r[5],
                    "twitter_url": r[6], "bio": r[7], "motivation": r[8],
                    "status": r[9], "review_note": r[10],
                    "created_at": r[11].isoformat() if r[11] else None,
                    "username": r[12], "rank": r[13], "avatar": r[14],
                    "avatar_bg": r[15], "match_count": int(r[16] or 0),
                }
                for r in rows
            ]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_get_creator_applications error: %s", exc)
        raise HTTPException(500, "Failed to fetch applications")


@app.patch("/admin/creators/applications/{application_id}", status_code=200)
async def admin_review_creator_application(
    application_id: str,
    request: Request,
    payload: dict = Depends(require_admin),
):
    """Admin — approve or reject a creator application."""
    admin_id = payload.get("sub")
    body = await request.json()
    new_status = body.get("status")
    review_note = body.get("review_note", "")
    if new_status not in ("approved", "rejected"):
        raise HTTPException(400, "status must be 'approved' or 'rejected'")
    try:
        with SessionLocal() as session:
            app_row = session.execute(text("""
                SELECT ca.user_id, ca.primary_game, ca.twitch_url, ca.youtube_url,
                       ca.tiktok_url, ca.twitter_url, ca.bio, u.username, u.rank
                FROM creator_applications ca JOIN users u ON u.id = ca.user_id
                WHERE ca.id = :aid
            """), {"aid": application_id}).fetchone()
            if not app_row:
                raise HTTPException(404, "Application not found")
            session.execute(text("""
                UPDATE creator_applications
                SET status=:status, reviewed_by=:rid, review_note=:note, reviewed_at=NOW()
                WHERE id=:aid
            """), {"status": new_status, "rid": admin_id, "note": review_note, "aid": application_id})
            if new_status == "approved":
                session.execute(text("""
                    INSERT INTO creator_profiles
                      (user_id, display_name, primary_game, twitch_url, youtube_url,
                       tiktok_url, twitter_url, bio, rank_tier, approved_by, approved_at)
                    VALUES (:uid, :name, :game, :tw, :yt, :tt, :tx, :bio, :rank, :rid, NOW())
                    ON CONFLICT (user_id) DO UPDATE SET
                      display_name=EXCLUDED.display_name, primary_game=EXCLUDED.primary_game,
                      twitch_url=EXCLUDED.twitch_url, youtube_url=EXCLUDED.youtube_url,
                      tiktok_url=EXCLUDED.tiktok_url, twitter_url=EXCLUDED.twitter_url,
                      bio=EXCLUDED.bio, rank_tier=EXCLUDED.rank_tier,
                      approved_by=EXCLUDED.approved_by, approved_at=EXCLUDED.approved_at
                """), {
                    "uid": str(app_row[0]), "name": app_row[7], "game": app_row[1],
                    "tw": app_row[2], "yt": app_row[3], "tt": app_row[4],
                    "tx": app_row[5], "bio": app_row[6], "rank": app_row[8], "rid": admin_id,
                })
                session.execute(text("""
                    INSERT INTO notifications (user_id, type, title, message)
                    VALUES (:uid, 'system', 'Creator Application Approved',
                            'Congratulations! Your Arena Creator application has been approved.')
                """), {"uid": str(app_row[0])})
            else:
                session.execute(text("""
                    INSERT INTO notifications (user_id, type, title, message)
                    VALUES (:uid, 'system', 'Creator Application Update',
                            :msg)
                """), {
                    "uid": str(app_row[0]),
                    "msg": f"Your creator application was not approved. {review_note or ''}".strip(),
                })
            session.commit()
        return {"status": new_status}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_review_creator_application error: %s", exc)
        raise HTTPException(500, "Failed to review application")


@app.patch("/creators/me", status_code=200)
async def update_my_creator_profile(request: Request, payload: dict = Depends(optional_token)):
    """Update the current user's creator profile (bio and links only)."""
    user_id = payload.get("sub") if payload else None
    if not user_id:
        raise HTTPException(401, "Authentication required")
    body = await request.json()
    allowed = {"bio", "twitch_url", "youtube_url", "tiktok_url", "twitter_url"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id FROM creator_profiles WHERE user_id = :uid"), {"uid": user_id}
            ).fetchone()
            if not row:
                raise HTTPException(404, "No creator profile found")
            set_clause = ", ".join(f"{k}=:{k}" for k in updates)
            session.execute(
                text(f"UPDATE creator_profiles SET {set_clause} WHERE user_id=:uid"),
                {**updates, "uid": user_id},
            )
            session.commit()
        return {"status": "updated"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_my_creator_profile error: %s", exc)
        raise HTTPException(500, "Failed to update profile")


@app.get("/admin/creators/profiles", status_code=200)
async def admin_get_creator_profiles(
    payload: dict = Depends(require_admin),
    limit: int = 50,
    offset: int = 0,
):
    """Admin — list all approved creator profiles."""
    try:
        with SessionLocal() as session:
            rows = session.execute(text("""
                SELECT cp.id, cp.user_id, cp.display_name, cp.bio, cp.primary_game,
                       cp.rank_tier, cp.twitch_url, cp.youtube_url, cp.tiktok_url,
                       cp.twitter_url, cp.featured, cp.created_at,
                       u.username, u.avatar, u.avatar_bg, u.rank
                FROM creator_profiles cp JOIN users u ON u.id = cp.user_id
                ORDER BY cp.featured DESC, cp.created_at DESC
                LIMIT :lim OFFSET :off
            """), {"lim": limit, "off": offset}).fetchall()
            total = session.execute(text("SELECT COUNT(*) FROM creator_profiles")).scalar()
            profiles = [
                {
                    "id": str(r[0]), "user_id": str(r[1]), "display_name": r[2],
                    "bio": r[3], "primary_game": r[4], "rank_tier": r[5],
                    "twitch_url": r[6], "youtube_url": r[7], "tiktok_url": r[8],
                    "twitter_url": r[9], "featured": r[10], "created_at": str(r[11]),
                    "username": r[12], "avatar": r[13], "avatar_bg": r[14],
                    "rank": r[15], "clip_urls": [], "equipped_badge_icon": None,
                }
                for r in rows
            ]
        return {"profiles": profiles, "total": total or 0}
    except Exception as exc:
        logger.error("admin_get_creator_profiles error: %s", exc)
        raise HTTPException(500, "Failed to fetch profiles")


@app.patch("/admin/creators/{creator_id}", status_code=200)
async def admin_edit_creator_profile(
    creator_id: str,
    request: Request,
    payload: dict = Depends(require_admin),
):
    """Admin — edit any creator profile."""
    body = await request.json()
    allowed = {
        "display_name", "bio", "primary_game", "rank_tier",
        "twitch_url", "youtube_url", "tiktok_url", "twitter_url", "featured",
    }
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id FROM creator_profiles WHERE id = :cid"), {"cid": creator_id}
            ).fetchone()
            if not row:
                raise HTTPException(404, "Creator profile not found")
            set_clause = ", ".join(f"{k}=:{k}" for k in updates)
            session.execute(
                text(f"UPDATE creator_profiles SET {set_clause} WHERE id=:cid"),
                {**updates, "cid": creator_id},
            )
            session.commit()
        return {"status": "updated"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_edit_creator_profile error: %s", exc)
        raise HTTPException(500, "Failed to update creator profile")


@app.delete("/admin/creators/{creator_id}", status_code=200)
async def admin_delete_creator_profile(
    creator_id: str,
    payload: dict = Depends(require_admin),
):
    """Admin — permanently delete a creator profile."""
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT id FROM creator_profiles WHERE id = :cid"), {"cid": creator_id}
            ).fetchone()
            if not row:
                raise HTTPException(404, "Creator profile not found")
            session.execute(text("DELETE FROM creator_profiles WHERE id=:cid"), {"cid": creator_id})
            session.commit()
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_delete_creator_profile error: %s", exc)
        raise HTTPException(500, "Failed to delete creator profile")
