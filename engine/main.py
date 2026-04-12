import hashlib
import os
import re
import secrets
import logging
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

import time as _time
from collections import defaultdict as _defaultdict

from fastapi import FastAPI, HTTPException, Depends, Header, Query, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, model_validator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import jwt as _jwt

from src.config import DATABASE_URL, ENVIRONMENT, MIN_CLIENT_VERSION
from src.vision.capture import capture_screen, crop_roi
from src.vision.engine import VisionEngine, VisionEngineConfig
from src.vision.rage_quit import RageQuitDetector
from src.slack_alerts import slack_post
try:
    from src.contract import build_escrow_client
except ImportError:
    # web3 C extensions not available in this environment (e.g. Windows without MSVC).
    # Engine runs without escrow client — build_escrow_client returns None gracefully.
    def build_escrow_client(_session_factory):  # type: ignore[misc]
        return None
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
_listener_task = None  # background thread task — EscrowClient.listen()
_slack_oracle_task = None  # Slack watchdog (escrow + SLACK_ALERTS_WEBHOOK_URL only)

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
        except Exception as exc:
            logger.error("_expired_match_cleanup_loop error: %s", exc)


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
            conn.commit()
        logger.info("✅ Arena Engine connected to DB")
    except Exception as exc:
        logger.warning("⚠️  DB not available at startup: %s", exc)

    # Load daily stake limit from platform_settings (non-fatal)
    _reload_at_daily_limit()
    logger.info("✅ Daily stake limit loaded: %d AT ($%d)", _at_daily_limit, _at_daily_limit // 100)

    # Escrow client — optional, requires BLOCKCHAIN_RPC_URL + CONTRACT_ADDRESS + PRIVATE_KEY
    global _escrow_client
    _escrow_client = build_escrow_client(SessionLocal)
    if _escrow_client:
        logger.info("✅ EscrowClient initialised (contract=%s)", _escrow_client.contract.address)
    else:
        logger.info("ℹ️  EscrowClient disabled — blockchain env vars not set")

    # Rage-quit detector — runs as background task; works with or without EscrowClient
    _rage_quit_detector = RageQuitDetector(SessionLocal, _escrow_client)
    import asyncio
    _rq_task = asyncio.create_task(_rage_quit_detector.run())
    logger.info("✅ RageQuitDetector started")

    # EscrowClient event listener — only when escrow is available.
    # listen() is a blocking loop (time.sleep) so it runs in a thread pool.
    # Resumes from oracle_sync_state.last_block on restart — no missed events.
    global _listener_task
    if _escrow_client:
        _listener_task = asyncio.create_task(
            asyncio.to_thread(_escrow_client.listen, 15)
        )
        logger.info("✅ EscrowClient event listener started")

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

    # Slack alerts for oracle/RPC health — only when escrow is on and webhook URL is set.
    global _slack_oracle_task
    if _escrow_client and (os.getenv("SLACK_ALERTS_WEBHOOK_URL") or "").strip():
        _slack_oracle_task = asyncio.create_task(_oracle_slack_watch_loop())
        logger.info("✅ Oracle Slack watchdog started")

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    _rq_task.cancel()
    _cleanup_task.cancel()
    _stale_task.cancel()
    if _slack_oracle_task:
        _slack_oracle_task.cancel()
        try:
            await _slack_oracle_task
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    import time as _time
    start = _time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((_time.perf_counter() - start) * 1000, 2)
    response.headers["x-process-time-ms"] = str(elapsed_ms)
    return response


# ── Auth dependency ───────────────────────────────────────────────────────────
async def verify_token(authorization: str = Header(...)) -> dict:
    """Decode and validate a JWT Bearer token. Returns the decoded payload."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid token format")
    token = authorization.removeprefix("Bearer ")
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


async def optional_token(authorization: str | None = Header(default=None)) -> dict | None:
    """Like verify_token but returns None instead of 401 when header is absent."""
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ")
    try:
        return auth.decode_token(token)
    except (_jwt.ExpiredSignatureError, _jwt.InvalidTokenError):
        return None


# ── Auth models ───────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    steam_id: str | None = None   # CS2 account; at least one game account required
    riot_id:  str | None = None   # Valorant account; at least one game account required

    @model_validator(mode="after")
    def require_and_validate_game_account(self) -> "RegisterRequest":
        """
        Enforce two rules at the Pydantic layer (→ automatic 422):
          1. At least one of steam_id / riot_id must be provided.
          2. Whichever is provided must pass the format check.
        Format checks are pure string validation — no DB or network calls.
        """
        steam = self.steam_id.strip() if self.steam_id else None
        riot  = self.riot_id.strip()  if self.riot_id  else None

        if not steam and not riot:
            raise ValueError(
                "At least one game account is required: "
                "provide steam_id (for CS2) or riot_id (for Valorant)"
            )

        if steam:
            err = auth.validate_steam_id(steam)
            if err:
                raise ValueError(err)
            self.steam_id = steam   # store stripped value

        if riot:
            err = auth.validate_riot_id(riot)
            if err:
                raise ValueError(err)
            self.riot_id = riot     # store stripped value

        return self


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


def _auto_payout_on_consensus(match_id: str, agreed_result: str) -> None:
    """
    Triggered automatically when MatchConsensus reaches REACHED status.

    Finds the winning player (the one who submitted agreed_result), updates
    the match to 'completed', and releases payout.

    Winner determination:
      - Query match_consensus for wallets that submitted agreed_result.
      - Join with users to resolve wallet_address → user_id.
      - For 1v1: one winner wallet; for team match: first agreeing player is
        the representative winner_id (team payout is handled by the contract).

    Idempotent guard: UPDATE … WHERE status='in_progress' ensures a match
    that was already completed (e.g. by admin or submit_result) is skipped.

    Non-fatal: any error is logged and swallowed; admin can use
    POST /admin/match/{id}/declare-winner as fallback.

    DB-ready: match_consensus, users, matches
    CONTRACT-ready: EscrowClient.declare_winner() for CRYPTO matches
    """
    try:
        # ── Find winner_id from consensus votes ───────────────────────────────
        winner_id: str | None = None
        stake_currency: str = "CRYPTO"
        try:
            with SessionLocal() as session:
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

    # ── 2. Submission limit: 1 per user per match (non-fatal if DB unavailable)
    wallet_address: str | None = None
    try:
        with SessionLocal() as session:
            wallet_row = session.execute(
                text("SELECT wallet_address FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()
            wallet_address = wallet_row[0] if wallet_row else None

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
        logger.warning("validate_screenshot: submission limit check skipped (DB error): %s", exc)

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

    # ── 6. Submit to MatchConsensus (DB-backed, non-fatal) ───────────────────
    # Instantiate a DB-backed MatchConsensus for this match.  Because the
    # constructor calls _restore_from_db(), any votes persisted before an
    # engine restart are re-loaded automatically — no lost votes on crash.
    #
    # If consensus is REACHED on this submission we log it; the actual payout
    # trigger is owned by POST /match/result once the winner_id is confirmed
    # by the client.  This step is purely vote-tracking.
    #
    # DB-ready: match_consensus table (013-match-consensus.sql)
    consensus_status_str: str | None = None
    consensus_result_str: str | None = None

    if output.result and wallet_address:
        try:
            from src.vision.consensus import MatchConsensus, ConsensusStatus

            # Fetch max_players from DB to know when consensus is complete
            _expected = 2   # safe default
            try:
                with SessionLocal() as _s:
                    _mp_row = _s.execute(
                        text("SELECT max_players FROM matches WHERE id = :mid"),
                        {"mid": match_id},
                    ).fetchone()
                    if _mp_row and _mp_row[0]:
                        _expected = int(_mp_row[0])
            except Exception as _exc:
                logger.debug("consensus: max_players lookup failed (using 2): %s", _exc)

            _consensus = MatchConsensus(
                match_id=match_id,
                expected_players=_expected,
                session_factory=SessionLocal,
            )
            _status = _consensus.submit(wallet_address, output)
            consensus_status_str = _status.value

            if _status == ConsensusStatus.REACHED:
                _verdict = _consensus.evaluate()
                consensus_result_str = _verdict.agreed_result
                logger.info(
                    "consensus REACHED: match=%s result=%s agreeing=%d/%d flagged=%s",
                    match_id, _verdict.agreed_result,
                    _verdict.agreeing_players, _verdict.total_players,
                    _verdict.flagged_wallets,
                )
                # Auto-payout: find winner from votes and release funds.
                # Non-fatal — admin can use declare-winner as fallback.
                if _verdict.agreed_result:
                    _auto_payout_on_consensus(match_id, _verdict.agreed_result)
                # Auto-flag players whose result contradicted majority (Issue #155).
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
    )


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
                    "       COALESCE(mp.team, 'A') AS team "
                    "FROM match_players mp "
                    "JOIN users u ON u.id = mp.user_id "
                    "WHERE mp.match_id = :mid "
                    "ORDER BY COALESCE(mp.team, 'A'), mp.joined_at"
                ),
                {"mid": match_id},
            ).fetchall()

            # Identify the caller's own slot (avoids client-side duplication)
            your_team = next(
                (p[4] for p in players if str(p[0]) == user_id), None
            )

            return {
                "match": {
                    "match_id":       match_id,
                    "game":           row[1],
                    "status":         row[2],
                    "bet_amount":     str(row[3]) if row[3] is not None else None,
                    "stake_currency": row[4],
                    "type":           row[5],
                    "code":           row[6],
                    "created_at":     row[7].isoformat() if row[7] else None,
                    "mode":           row[8],
                    "host_id":        str(row[9]) if row[9] else None,
                    "host_username":  row[10],
                    "max_players":    row[11],
                    "max_per_team":   row[12],
                    # your_user_id + your_team let the UI mark "me" without
                    # duplicating from local state
                    "your_user_id":   user_id,
                    "your_team":      your_team,
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
                    SELECT status, winner_id, on_chain_match_id, stake_per_player
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

                return {
                    "match_id":          match_id,
                    "status":            match_status_val,
                    "winner_id":         winner_id_val,
                    "on_chain_match_id": row[2],
                    "stake_per_player":  float(row[3]) if row[3] is not None else None,
                    "your_team":         your_team,
                    "result":            result_val,
                    "score":             score_val,
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
async def register(req: RegisterRequest, request: Request):
    """
    Register a new Arena user.

    Creates rows in: users, user_stats, user_balances, user_roles.
    DB-ready: all inserts use the users table from infra/sql/init.sql.
    """
    _check_rate_limit(f"register:{request.client.host}", max_calls=5, window_secs=60)

    # ── Normalize inputs ──────────────────────────────────────────────────────
    email    = req.email.strip().lower()
    username = req.username.strip()
    steam_id = req.steam_id.strip() if req.steam_id else None
    riot_id  = req.riot_id.strip()  if req.riot_id  else None

    try:
        with SessionLocal() as session:
            # ── Duplicate checks — one clear 409 per field ────────────────────
            if session.execute(
                text("SELECT 1 FROM users WHERE lower(email) = :e"), {"e": email}
            ).fetchone():
                raise HTTPException(409, "Email already in use")

            if session.execute(
                text("SELECT 1 FROM users WHERE lower(username) = lower(:u)"), {"u": username}
            ).fetchone():
                raise HTTPException(409, "Username already taken")

            if steam_id and session.execute(
                text("SELECT 1 FROM users WHERE steam_id = :s"), {"s": steam_id}
            ).fetchone():
                raise HTTPException(409, "Steam ID already linked to another account")

            if riot_id and session.execute(
                text("SELECT 1 FROM users WHERE riot_id = :r"), {"r": riot_id}
            ).fetchone():
                raise HTTPException(409, "Riot ID already linked to another account")

            # ── Blacklist checks (migration 025) ──────────────────────────────
            wallet_addr = getattr(req, "wallet_address", None)
            if wallet_addr and session.execute(
                text("SELECT 1 FROM wallet_blacklist WHERE wallet_address = :w"),
                {"w": wallet_addr},
            ).fetchone():
                raise HTTPException(409, "This wallet address is banned from the platform")

            if steam_id and session.execute(
                text("SELECT 1 FROM wallet_blacklist WHERE steam_id = :s"),
                {"s": steam_id},
            ).fetchone():
                raise HTTPException(409, "This Steam ID is banned from the platform")

            if riot_id and session.execute(
                text("SELECT 1 FROM wallet_blacklist WHERE riot_id = :r"),
                {"r": riot_id},
            ).fetchone():
                raise HTTPException(409, "This Riot ID is banned from the platform")

            # ── Create user ───────────────────────────────────────────────────
            pw_hash  = auth.hash_password(req.password)
            arena_id = auth.generate_arena_id()
            row = session.execute(
                text(
                    "INSERT INTO users (username, email, password_hash, arena_id, steam_id, riot_id, at_balance) "
                    "VALUES (:u, :e, :h, :a, :s, :r, 200) "
                    "RETURNING id, username, email, arena_id"
                ),
                {"u": username, "e": email, "h": pw_hash, "a": arena_id,
                 "s": steam_id, "r": riot_id},
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

    token = auth.issue_token(user_id, email, username)
    return AuthResponse(
        access_token=token,
        user_id=user_id,
        username=username,
        email=email,
        arena_id=arena_id,
        requires_2fa=False,
    )


@app.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest, request: Request):
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
                    "       COALESCE(totp_enabled, FALSE), totp_secret "
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

    user_id = str(row[0])
    if totp_enabled:
        temp = auth.issue_2fa_pending_token(user_id)
        return AuthResponse(requires_2fa=True, temp_token=temp)

    token = auth.issue_token(user_id, row[2], row[1])
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
async def auth_google(req: GoogleAuthRequest, request: Request):
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
                return _auth_response_from_google_row(row)

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
                    text("UPDATE users SET google_id = :g WHERE id = :id"),
                    {"g": str(sub), "id": str(row_em[0])},
                )
                session.commit()
                row2 = session.execute(
                    text(sel + "WHERE id = :id"),
                    {"id": str(row_em[0])},
                ).fetchone()
                if row2:
                    return _auth_response_from_google_row(row2)
                raise HTTPException(500, "Google link failed")

            username = _allocate_unique_username_from_google(session, email, display_name)
            arena_id = auth.generate_arena_id()
            ins = session.execute(
                text(
                    "INSERT INTO users (username, email, password_hash, arena_id, "
                    "                   google_id, auth_provider, at_balance) "
                    "VALUES (:u, :e, NULL, :a, :g, 'google', 200) "
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
                    "       COALESCE(u.auth_provider, 'email') "
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
    )


class PatchUserRequest(BaseModel):
    """
    PATCH /users/me payload — partial update of identity fields.
    All fields optional; only provided fields are written to DB.
    DB-ready: maps to users table columns.
    """
    avatar: str | None = None
    avatar_bg: str | None = None
    equipped_badge_icon: str | None = None
    forge_unlocked_item_ids: list[str] | None = None
    # Identity fields — uniqueness enforced per field
    username:       str | None = None   # case-insensitive unique
    steam_id:       str | None = None   # globally unique; pass "" to unlink
    riot_id:        str | None = None   # globally unique; pass "" to unlink
    wallet_address: str | None = None   # Ethereum address; pass "" or null to unlink


@app.patch("/users/me", response_model=UserProfile)
async def patch_user_me(req: PatchUserRequest, payload: dict = Depends(verify_token)):
    """
    Partial update of the authenticated user's profile.

    Cosmetic fields (avatar, badge, forge items) are updated directly.
    Identity fields (username, steam_id, riot_id, wallet_address) are checked
    for uniqueness before writing — returns 409 if the value is already taken.
    Pass "" or null to unlink a field (sets column to NULL in DB).
    wallet_address: validated as 0x + 40 hex chars; "" or null → unlink.
    DB-ready: writes to users table columns.
    """
    user_id: str = payload["sub"]

    # ── Uniqueness checks for identity fields ─────────────────────────────────
    try:
        with SessionLocal() as session:
            if req.username is not None:
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE lower(username) = lower(:u) AND id != :uid"),
                    {"u": req.username.strip(), "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Username already taken")

            if req.steam_id is not None and req.steam_id != "":
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE steam_id = :s AND id != :uid"),
                    {"s": req.steam_id.strip(), "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Steam ID already linked to another account")

            if req.riot_id is not None and req.riot_id != "":
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE riot_id = :r AND id != :uid"),
                    {"r": req.riot_id.strip(), "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Riot ID already linked to another account")

            if req.wallet_address is not None and req.wallet_address.strip() != "":
                addr = req.wallet_address.strip()
                # Basic Ethereum address format check (0x + 40 hex chars)
                import re
                if not re.fullmatch(r"0x[0-9a-fA-F]{40}", addr):
                    raise HTTPException(400, "Invalid Ethereum wallet address format")
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE wallet_address = :w AND id != :uid"),
                    {"w": addr, "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Wallet address already linked to another account")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("patch_user_me uniqueness check error: %s", exc)
        raise HTTPException(500, "Profile update failed")

    # ── Guard: cannot unlink both game accounts simultaneously ───────────────
    # A user without any game account can't join any match.
    # We check the resulting state: if both would become NULL → 400.
    unlinking_steam = req.steam_id is not None and req.steam_id.strip() == ""
    unlinking_riot  = req.riot_id  is not None and req.riot_id.strip()  == ""
    if unlinking_steam and unlinking_riot:
        raise HTTPException(
            400,
            "Cannot unlink both game accounts at once. "
            "Keep at least one (Steam ID or Riot ID) to remain eligible for matches."
        )

    # ── Build update fields ───────────────────────────────────────────────────
    fields: dict = {}
    if req.avatar                  is not None: fields["avatar"]                  = req.avatar
    if req.avatar_bg               is not None: fields["avatar_bg"]               = req.avatar_bg
    if req.equipped_badge_icon     is not None: fields["equipped_badge_icon"]     = req.equipped_badge_icon
    if req.forge_unlocked_item_ids is not None:
        fields["forge_unlocked_item_ids"] = req.forge_unlocked_item_ids
    if req.username       is not None: fields["username"]       = req.username.strip()
    if req.steam_id       is not None: fields["steam_id"]       = req.steam_id.strip()       or None  # "" → NULL
    if req.riot_id        is not None: fields["riot_id"]        = req.riot_id.strip()        or None  # "" → NULL
    if req.wallet_address is not None: fields["wallet_address"] = req.wallet_address.strip() or None  # "" → NULL (unlink)

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
    """PATCH /users/settings — region only (Phase 2)."""
    region: str


_ALLOWED_REGIONS = frozenset({"EU", "NA", "ASIA", "SA", "OCE", "ME"})


@app.patch("/users/settings")
async def patch_user_settings(
    req: UserSettingsRegionPatch,
    payload: dict = Depends(verify_token),
):
    """Update user_settings.region (EU | NA | ASIA | SA | OCE | ME)."""
    r = req.region.strip().upper()
    if r not in _ALLOWED_REGIONS:
        raise HTTPException(400, f"region must be one of: {', '.join(sorted(_ALLOWED_REGIONS))}")
    uid = payload["sub"]
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "INSERT INTO user_settings (user_id, region) VALUES (:uid, :reg) "
                    "ON CONFLICT (user_id) DO UPDATE SET "
                    "region = EXCLUDED.region, updated_at = NOW()"
                ),
                {"uid": uid, "reg": r},
            )
            session.commit()
    except Exception as exc:
        logger.error("patch_user_settings error: %s", exc)
        raise HTTPException(500, "Failed to update settings")
    return {"region": r}


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
async def twofa_confirm(req: TwoFAConfirmBody, request: Request):
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
async def logout(payload: dict = Depends(verify_token)):
    """
    Logout — invalidates the client session for the authenticated user.

    JWTs are stateless, so true invalidation requires a blocklist (Phase 6).
    For now: marks all active client_sessions for this user as disconnected.
    The client should discard its stored token on receipt of 200.
    """
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


def _assert_game_account(game: str, steam_id: str | None, riot_id: str | None) -> None:
    """
    Raise HTTPException(403) if the user lacks the required game account.

    CS2      → needs steam_id
    Valorant → needs riot_id
    """
    if game == "CS2" and not steam_id:
        raise HTTPException(
            403,
            "A verified Steam ID is required to create or join CS2 matches. "
            "Add your Steam ID in Profile → Settings."
        )
    if game == "Valorant" and not riot_id:
        raise HTTPException(
            403,
            "A verified Riot ID is required to create or join Valorant matches. "
            "Add your Riot ID in Profile → Settings."
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
      password     → matches.password  (optional; plain text for MVP —
                                        TODO: bcrypt hash before public beta)

    DB-ready: writes to matches + match_players tables.
    CONTRACT-ready: stake_amount → ArenaEscrow.lockStake() once wallet is linked.
    """
    game: str = "CS2"                # "CS2" | "Valorant"
    stake_amount: float = 1.0        # stake per player (USDT for CRYPTO, AT tokens for AT)
    mode: str = "1v1"                # "1v1" | "2v2" | "4v4" | "5v5"
    match_type: str = "custom"       # "public" | "custom"
    stake_currency: str = "CRYPTO"   # "CRYPTO" (ETH/BNB via escrow) | "AT" (Arena Tokens)
    password: str | None = None      # optional room password (stored in matches.password)


class JoinMatchRequest(BaseModel):
    """
    POST /matches/{match_id}/join — optional room password + optional team preference.

    team: "A" | "B" | None
      When provided, the server honors the preference if that team still has a free
      slot (returns 409 if full so the client can show "Team X is full").
      When omitted, the server auto-assigns (fills A first, then B).
    """
    password: str | None = None
    team: str | None = None  # "A" | "B" — optional; honored if slot available


_VALID_CURRENCIES = {"CRYPTO", "AT"}
_AT_FEE_PCT = 0.05  # 5% platform fee on AT match winnings — mirrors ArenaEscrow fee

# ── M8 Kill Switch ─────────────────────────────────────────────────────────────
# When True: all payout disbursement is suspended (AT credit + CRYPTO on-chain).
# Match is still marked completed with winner_id set — only fund release is frozen.
# Toggle via POST /admin/freeze  (admin-only).
_PAYOUTS_FROZEN: bool = False


AT_DAILY_STAKE_LIMIT = 50000  # $500/day default (1 AT = $0.01 → 50,000 AT = $500)
_at_daily_limit: int = AT_DAILY_STAKE_LIMIT  # runtime cache — reloaded from platform_config at startup


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


def _get_daily_limit(_session=None) -> int:
    """Return the current daily AT stake limit from the in-memory cache."""
    return _at_daily_limit


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
    """Raise 402 if user's at_balance < required AT."""
    row = session.execute(
        text("SELECT at_balance FROM users WHERE id = :uid"),
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


def _settle_at_match(match_id: str, winner_id: str) -> None:
    """
    Distribute AT for a completed AT-currency match.

    Flow (mirrors ArenaEscrow.declareWinner):
      1. Read all players and their AT stake from the match.
      2. Compute pot = stake_per_player * player_count.
      3. Deduct 5% fee → winner receives 95% of pot.
      4. Credit winner, log fee transaction, commit.

    DB-ready: uses users.at_balance + transactions table.
    """
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT stake_currency, bet_amount FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row or match_row[0] != "AT":
                return  # not an AT match — nothing to do

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
    DB-ready: uses users.at_balance + transactions table.
    """
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text("SELECT stake_currency, bet_amount FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()

            if not match_row or match_row[0] != "AT":
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
            logger.info(
                "_refund_at_match: match=%s refunded %d/%d players %d AT each",
                match_id, refunded, len(player_rows), stake_per_player,
            )
    except Exception as exc:
        logger.error("_refund_at_match error (non-fatal): match=%s error=%s", match_id, exc)


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

    match_type = req.match_type.strip()
    if match_type not in ("public", "custom"):
        raise HTTPException(400, "match_type must be 'public' or 'custom'")

    stake_currency = req.stake_currency.upper().strip()
    if stake_currency not in _VALID_CURRENCIES:
        raise HTTPException(400, "stake_currency must be 'CRYPTO' or 'AT'")

    # bet_amount has CHECK > 0 in DB; clamp to minimum to prevent constraint error
    bet_amount = max(float(req.stake_amount), 0.01)
    at_stake = int(bet_amount) if stake_currency == "AT" else 0

    # Derive max_players and max_per_team from mode
    _mode_sizes = {"1v1": 1, "2v2": 2, "4v4": 4, "5v5": 5}
    team_size   = _mode_sizes.get(mode, 1)
    max_players = team_size * 2

    try:
        with SessionLocal() as session:
            # ── Look up creator's game accounts ───────────────────────────────
            user_row = session.execute(
                text("SELECT steam_id, riot_id, wallet_address FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            steam_id, riot_id, wallet_address = user_row
            _assert_game_account(game, steam_id, riot_id)

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

            # ── Generate unique room code ─────────────────────────────────────
            import secrets as _secrets
            import string as _string
            _chars = _string.ascii_uppercase + _string.digits
            room_code = "ARENA-" + "".join(_secrets.choice(_chars) for _ in range(5))

            # ── Create match ──────────────────────────────────────────────────
            # password stored as plain text for MVP.
            # TODO: replace with bcrypt hash before public beta.
            match_row = session.execute(
                text(
                    "INSERT INTO matches "
                    "  (type, game, host_id, mode, bet_amount, stake_currency, code, password, max_players, max_per_team) "
                    "VALUES (:mtype, :g, :host, :mode, :bet, :sc, :code, :pw, :maxp, :mpt) "
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
                    "pw":    req.password or None,
                    "maxp":  max_players,
                    "mpt":   team_size,
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

    try:
        with SessionLocal() as session:
            # ── Verify match exists and is open ───────────────────────────────
            match_row = session.execute(
                text(
                    "SELECT game, status, bet_amount, stake_currency, password, "
                    "       max_players, max_per_team "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row:
                raise HTTPException(404, "Match not found")

            game, status, stake_amount, stake_currency, match_password, max_players, max_per_team = match_row
            game = _normalize_game(game or "CS2")
            stake_currency = (stake_currency or "CRYPTO").upper()

            if status != "waiting":
                raise HTTPException(409, f"Match is not open for joining (status: {status})")

            # ── Password check ────────────────────────────────────────────────
            if match_password and (req.password or "") != match_password:
                raise HTTPException(403, "Incorrect room password")

            # ── Check joiner's game account ───────────────────────────────────
            user_row = session.execute(
                text("SELECT steam_id, riot_id, wallet_address FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            steam_id, riot_id, wallet_address = user_row
            _assert_game_account(game, steam_id, riot_id)

            # ── Suspension / ban check ────────────────────────────────────────
            _assert_not_suspended(session, user_id)

            # ── Currency-specific balance checks ──────────────────────────────
            if stake_currency == "AT":
                # AT match: check arena token balance + daily stake cap
                at_stake = int(stake_amount or 0)
                _assert_at_balance(session, user_id, at_stake)
                _check_daily_stake_limit(session, user_id, at_stake)
            else:
                # CRYPTO match: wallet must be linked + on-chain balance check
                if not wallet_address:
                    raise HTTPException(
                        400,
                        "You must link a wallet before joining a staked match. "
                        "Go to Profile → Wallet and connect your MetaMask."
                    )
                if stake_amount:
                    _assert_usdt_balance(wallet_address, float(stake_amount))

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

            # ── Auto-start: transition waiting → in_progress when room fills ──
            # Count includes the newly inserted row (same session, uncommitted).
            count_row = session.execute(
                text("SELECT COUNT(*) FROM match_players WHERE match_id = :mid"),
                {"mid": match_id},
            ).fetchone()
            match_started = False
            if count_row and int(count_row[0]) >= (max_players or 2):
                session.execute(
                    text(
                        "UPDATE matches SET status = 'in_progress', started_at = NOW() "
                        "WHERE id = :mid AND status = 'waiting'"
                    ),
                    {"mid": match_id},
                )
                match_started = True

            session.commit()

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
        "team":           assigned_team,  # "A" or "B" — assigned based on current roster
        "started":        match_started,  # True when room just filled and transitioned to in_progress
    }


@app.delete("/matches/{match_id}", status_code=200)
async def cancel_match(match_id: str, payload: dict = Depends(verify_token)):
    """
    DELETE /matches/{match_id} — host cancels a waiting match room.

    Rules:
      - Match must exist and be in 'waiting' status.
      - Caller must be the host (host_id = user_id).
      - Sets status → 'cancelled', refunds AT for all players.

    DB-ready: UPDATE matches SET status='cancelled'; refund AT via at_transactions.
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT host_id, status, stake_currency FROM matches "
                    "WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()
            if not match_row:
                raise HTTPException(404, "Match not found")
            host_id, status, stake_currency = match_row
            if str(host_id) != user_id:
                raise HTTPException(403, "Only the host can delete this room")
            if status != "waiting":
                raise HTTPException(409, f"Cannot cancel a match with status '{status}'")

            # Refund AT for all players if AT stake
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
      - Removes player from match_players, refunds their AT stake.

    DB-ready: DELETE FROM match_players WHERE match_id=:mid AND user_id=:uid.
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

            in_match = session.execute(
                text(
                    "SELECT 1 FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()
            if not in_match:
                raise HTTPException(400, "You are not in this match")

            # Remove player
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

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("leave_match error: %s", exc)
        raise HTTPException(500, "Leave failed")

    return {"left": True, "match_id": match_id}


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
                    "       host_id, type, bet_amount, stake_currency, created_at "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

        your_team = next((p[4] for p in players if str(p[0]) == user_id), None)

        # Indices: 0=status 1=game 2=mode 3=code 4=max_players 5=max_per_team
        #          6=host_id 7=type 8=bet_amount 9=stake_currency 10=created_at
        return {
            "in_match":       True,
            "match_id":       match_id,
            "status":         match_info[0]  if match_info else None,
            "game":           match_info[1]  if match_info else None,
            "mode":           match_info[2]  if match_info else None,
            "code":           match_info[3]  if match_info else None,
            "max_players":    match_info[4]  if match_info else None,
            "max_per_team":   match_info[5]  if match_info else None,
            "host_id":        str(match_info[6]) if match_info and match_info[6] else None,
            "type":           match_info[7]  if match_info else None,
            "bet_amount":     str(match_info[8]) if match_info and match_info[8] is not None else None,
            "stake_currency": match_info[9]  if match_info else None,
            "created_at":     match_info[10].isoformat() if match_info and match_info[10] else None,
            "your_user_id":   user_id,
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
            else:
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
    at_amount: int       # AT to burn (must be multiple of 95 or 110 depending on discount)
    use_discount: bool = False  # True → 950 AT = $10, False → 1100 AT = $10


@app.post("/wallet/withdraw-at", status_code=200)
async def withdraw_arena_tokens(req: WithdrawAtRequest, payload: dict = Depends(verify_token)):
    """
    POST /wallet/withdraw-at — burn AT and send equivalent BNB to user's wallet.

    Rates (per $10 USDT equivalent):
      Standard:  1100 AT → $10 USDT → sent as BNB to user wallet
      Discounted:  950 AT → $10 USDT → sent as BNB to user wallet

    Rules:
      - User must have a linked wallet_address.
      - at_amount must be divisible by the base unit (950 or 1100).
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
        AT_PER_USDT_WITHDRAW_DISCOUNT,
        AT_DAILY_WITHDRAW_LIMIT,
        BLOCKCHAIN_RPC_URL,
        PLATFORM_WALLET_ADDRESS,
    )
    from datetime import timezone

    user_id: str = payload["sub"]
    at_amount = req.at_amount

    if at_amount <= 0:
        raise HTTPException(400, "at_amount must be greater than 0")

    # Rate: AT per $1 USDT
    rate = AT_PER_USDT_WITHDRAW_DISCOUNT if req.use_discount else AT_PER_USDT_WITHDRAW

    # Must be a whole number of $1 units
    if at_amount % rate != 0:
        unit_label = f"{rate * 10} AT" if rate == AT_PER_USDT_WITHDRAW else f"{rate * 10} AT"
        raise HTTPException(
            400,
            f"at_amount must be a multiple of {rate} "
            f"({'discounted' if req.use_discount else 'standard'} rate: {rate} AT = $1 USDT). "
            f"Smallest withdrawal: {rate * 10} AT = $10 USDT.",
        )

    usdt_value = at_amount / rate          # USDT equivalent
    if usdt_value < 10.0:
        raise HTTPException(400, f"Minimum withdrawal is $10 USDT equivalent ({rate * 10} AT).")

    try:
        with SessionLocal() as session:
            # ── Fetch user ────────────────────────────────────────────────────
            row = session.execute(
                text(
                    "SELECT at_balance, wallet_address, at_daily_withdrawn, at_withdrawal_reset_at "
                    "FROM users WHERE id = :uid"
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

@app.get("/leaderboard")
async def leaderboard(
    game: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    token: dict | None = Depends(optional_token),
):
    """
    Return the top players ranked by wins then xp.

    Optional filters:
      ?game=CS2|Valorant  — per-game leaderboard (filtered by matches played in that game)
      ?limit=N            — top N players (1–200, default 50)

    Returns user profile fields + stats for leaderboard display.
    DB-ready: users JOIN user_stats ORDER BY wins DESC, xp DESC.
    """
    params: dict = {"lim": limit}

    # Per-game filter: only include users who have played ≥1 match in that game.
    game_filter = ""
    if game:
        game_filter = """
            AND u.id IN (
                SELECT DISTINCT mp.user_id FROM match_players mp
                JOIN matches m ON m.id = mp.match_id
                WHERE m.game = :game
            )
        """
        params["game"] = _normalize_game(game)

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
                        COALESCE(s.wins,    0) AS wins,
                        COALESCE(s.losses,  0) AS losses,
                        COALESCE(s.matches, 0) AS matches,
                        COALESCE(s.win_rate, 0) AS win_rate,
                        COALESCE(s.xp,      0) AS xp,
                        COALESCE(s.total_earnings, 0) AS total_earnings
                    FROM users u
                    LEFT JOIN user_stats s ON s.user_id = u.id
                    WHERE TRUE {game_filter}
                    ORDER BY wins DESC, xp DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()
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
    conditions: list[str] = []
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

    Runs 4 queries:
      1. High win-rate players: win_rate > 80% with 10+ matches
      2. Player-pair farming: same two players matched >3 times in 24h
      3. Repeat offenders: players with 2+ penalties in player_penalties
      4. Recently banned: players banned in the last 7 days

    Response: { generated_at, flagged_players, suspicious_pairs,
                repeat_offenders, recently_banned, summary }

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

            # ── 2. Player-pair farming (same pair >3 matches in 24h) ──────────
            pair_rows = session.execute(
                text(
                    "SELECT mp1.user_id, u1.username, mp2.user_id, u2.username, "
                    "       COUNT(*) AS match_count "
                    "FROM match_players mp1 "
                    "JOIN match_players mp2 "
                    "  ON mp1.match_id = mp2.match_id AND mp1.user_id < mp2.user_id "
                    "JOIN users u1 ON u1.id = mp1.user_id "
                    "JOIN users u2 ON u2.id = mp2.user_id "
                    "JOIN matches m ON m.id = mp1.match_id "
                    "WHERE m.created_at > NOW() - INTERVAL '24 hours' "
                    "GROUP BY mp1.user_id, u1.username, mp2.user_id, u2.username "
                    "HAVING COUNT(*) > 3 "
                    "ORDER BY match_count DESC "
                    "LIMIT 50"
                )
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
            # Detects player A consistently losing to player B (5+ directional
            # losses in 7 days) — possible money transfer via matches.
            # match_players.user_id may be NULL (migration 026) — filter those out.
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
                    "  AND m.created_at > NOW() - INTERVAL '7 days' "
                    "GROUP BY mp_loser.user_id, u_loser.username, "
                    "         mp_winner.user_id, u_winner.username "
                    "HAVING COUNT(*) >= 5 "
                    "ORDER BY loss_count DESC "
                    "LIMIT 50"
                )
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
                    "  WHERE m.created_at > NOW() - INTERVAL '24 hours' "
                    "  GROUP BY mp1.user_id, mp2.user_id HAVING COUNT(*) > 3"
                    ") sub"
                )
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
                    "    AND m.created_at > NOW() - INTERVAL '7 days' "
                    "  GROUP BY mp_loser.user_id, mp_winner.user_id HAVING COUNT(*) >= 5"
                    ") sub"
                )
            ).scalar() or 0

        total = int(high_wr) + int(pair_farming) + int(repeat_off) + int(intl_losing)
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
                    "WHERE m.created_at > NOW() - INTERVAL '24 hours' "
                    "GROUP BY mp1.user_id, u1.username, mp2.user_id, u2.username "
                    "HAVING COUNT(*) > 3 ORDER BY 5 DESC LIMIT 50"
                )
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
                    "WHERE m.status = 'completed' AND m.created_at > NOW() - INTERVAL '7 days' "
                    "GROUP BY mp_loser.user_id, u_loser.username, mp_winner.user_id, u_winner.username "
                    "HAVING COUNT(*) >= 5 ORDER BY 5 DESC LIMIT 50"
                )
            ).fetchall()

        now = datetime.now(timezone.utc)
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
# Known keys: fee_pct, daily_bet_max_at, maintenance_mode,
#             new_registrations, auto_escalate_disputes

_PLATFORM_CONFIG_KEYS = {
    "fee_pct",
    "daily_bet_max_at",
    "maintenance_mode",
    "new_registrations",
    "auto_escalate_disputes",
}


class PlatformConfigUpdate(BaseModel):
    """Body for PUT /platform/config — partial update, all fields optional."""
    fee_pct:                 str | None = None   # e.g. "5" (percent, 0–50)
    daily_bet_max_at:        str | None = None   # e.g. "50000" (1 AT=$0.01 → $500/day)
    maintenance_mode:        str | None = None   # "true" | "false"
    new_registrations:       str | None = None   # "true" | "false"
    auto_escalate_disputes:  str | None = None   # "true" | "false"


@app.get("/platform/config", status_code=200)
async def get_platform_config(payload: dict = Depends(require_admin)):
    """
    Return all platform config keys from platform_config (key-value table).

    Response: { fee_pct, daily_bet_max_at, maintenance_mode,
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
            "fee_pct":                cfg.get("fee_pct", "5"),
            "daily_bet_max_at":       cfg.get("daily_bet_max_at", "50000"),
            "maintenance_mode":       cfg.get("maintenance_mode", "false"),
            "new_registrations":      cfg.get("new_registrations", "true"),
            "auto_escalate_disputes": cfg.get("auto_escalate_disputes", "false"),
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
