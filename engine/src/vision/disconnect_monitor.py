"""
ARENA Engine — DisconnectMonitor

Replaces RageQuitDetector with a two-phase grace-period state machine.

Phase 1 — WARNING  (heartbeat silent > warn_threshold seconds)
  • DB: forfeit_warning_at + forfeit_warning_team written
  • DB: notification inserted for silent players + opposing team
  • In-memory: MatchMonitorState.phase = WARNING

Phase 2 — FORFEIT  (grace_period elapsed, one team still silent)
  • Checks vision consensus first; falls back to heartbeat evidence
  • AT match  → _settle_at_fn(match_id, winner_id)
  • CRYPTO    → escrow_client.declare_winner(match_id, winner_id)
  • DB: forfeit_committed = TRUE (survives restart — not re-processed)

Phase 2 alt — HOLDING  (both teams gone after grace_period)
  • AT match  → _refund_at_fn(match_id)  (full refund, no winner)
  • CRYPTO    → escrow_client.transfer_to_holding() [requires contract upgrade]
               Falls back to 'disputed' + admin action until then.

Config (tunable via platform_config, loaded each tick):
  forfeit_warn_threshold_sec   default 30
  forfeit_grace_period_sec     default 120
  forfeit_check_interval_sec   default 15
  holding_wallet_address       default "" (env HOLDING_WALLET_ADDRESS fallback)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Callable, Optional, TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from src.contract.escrow_client import EscrowClient

log = logging.getLogger("vision.disconnect_monitor")

# ── Default thresholds (overridden by platform_config each tick) ──────────────
_DEFAULT_WARN_SEC     = int(os.getenv("FORFEIT_WARN_THRESHOLD_SEC",  "30"))
_DEFAULT_GRACE_SEC    = int(os.getenv("FORFEIT_GRACE_PERIOD_SEC",    "120"))
_DEFAULT_INTERVAL_SEC = int(os.getenv("FORFEIT_CHECK_INTERVAL_SEC",  "15"))


# ── Per-match in-memory state ─────────────────────────────────────────────────

class _Phase(str, Enum):
    NORMAL  = "normal"
    WARNING = "warning"
    DONE    = "done"


@dataclass
class _MatchState:
    match_id:          str
    phase:             _Phase        = _Phase.NORMAL
    warning_team:      Optional[str] = None   # "A", "B", or "BOTH"
    warning_at:        Optional[datetime] = None
    notified:          bool          = False


# ── Monitor ───────────────────────────────────────────────────────────────────

class DisconnectMonitor:
    """
    Background loop — replaces RageQuitDetector.

    Pass settle_at_fn  = _settle_at_match  (main.py)
         refund_at_fn  = _refund_at_match  (main.py)
    so the monitor can pay out AT matches without importing from main.
    """

    def __init__(
        self,
        session_factory,
        escrow_client: Optional[EscrowClient] = None,
        settle_at_fn: Optional[Callable[[str, str], None]] = None,
        refund_at_fn: Optional[Callable[[str], None]] = None,
    ) -> None:
        self._sf          = session_factory
        self._escrow      = escrow_client
        self._settle_at   = settle_at_fn
        self._refund_at   = refund_at_fn
        self._states:     dict[str, _MatchState] = {}

    # ── Public ────────────────────────────────────────────────────────────────

    async def run(self) -> None:
        cfg = self._load_config()
        log.info(
            "DisconnectMonitor started | warn=%ds grace=%ds interval=%ds",
            cfg["warn"], cfg["grace"], cfg["interval"],
        )
        while True:
            try:
                await asyncio.sleep(cfg["interval"])
                cfg = self._load_config()
                await asyncio.to_thread(self._tick, cfg)
            except asyncio.CancelledError:
                log.info("DisconnectMonitor stopped")
                return
            except Exception as exc:
                log.error("disconnect_monitor tick error: %s", exc)

    # ── Config ────────────────────────────────────────────────────────────────

    def _load_config(self) -> dict:
        try:
            with self._sf() as session:
                rows = session.execute(
                    text("""
                        SELECT key, value FROM platform_config
                        WHERE key IN (
                            'forfeit_warn_threshold_sec',
                            'forfeit_grace_period_sec',
                            'forfeit_check_interval_sec',
                            'holding_wallet_address'
                        )
                    """)
                ).fetchall()
                cfg = {r[0]: r[1] for r in rows}
        except Exception:
            cfg = {}

        return {
            "warn":     int(cfg.get("forfeit_warn_threshold_sec",  _DEFAULT_WARN_SEC)),
            "grace":    int(cfg.get("forfeit_grace_period_sec",    _DEFAULT_GRACE_SEC)),
            "interval": int(cfg.get("forfeit_check_interval_sec",  _DEFAULT_INTERVAL_SEC)),
            "holding_wallet": (
                cfg.get("holding_wallet_address", "").strip()
                or os.getenv("HOLDING_WALLET_ADDRESS", "").strip()
            ),
        }

    # ── Tick ──────────────────────────────────────────────────────────────────

    def _tick(self, cfg: dict) -> None:
        now = datetime.now(timezone.utc)
        for match_id, stake_currency, players in self._active_matches_with_players():
            state = self._states.setdefault(match_id, _MatchState(match_id=match_id))
            if state.phase == _Phase.DONE:
                continue
            self._process(state, players, stake_currency, cfg, now)

        # Prune DONE states that are no longer in_progress (avoid unbounded growth)
        active_ids = {mid for mid, _, _ in self._active_matches_with_players()}
        for mid in list(self._states):
            if mid not in active_ids and self._states[mid].phase == _Phase.DONE:
                del self._states[mid]

    def _process(
        self,
        state: _MatchState,
        players: list[dict],
        stake_currency: str,
        cfg: dict,
        now: datetime,
    ) -> None:
        warn_cutoff  = now - timedelta(seconds=cfg["warn"])
        grace_expire = (
            state.warning_at + timedelta(seconds=cfg["grace"])
            if state.warning_at else None
        )

        by_team: dict[str, list[dict]] = {"A": [], "B": []}
        for p in players:
            by_team[p["team"]].append(p)

        if not by_team["A"] or not by_team["B"]:
            return

        a_alive = _team_alive(by_team["A"], warn_cutoff)
        b_alive = _team_alive(by_team["B"], warn_cutoff)

        # ── Both alive ───────────────────────────────────────────────────────
        if a_alive and b_alive:
            if state.phase == _Phase.WARNING:
                log.info("disconnect_monitor: match=%s team_%s RETURNED — warning cleared",
                         state.match_id, state.warning_team)
                self._clear_warning_db(state.match_id)
                state.phase        = _Phase.NORMAL
                state.warning_team = None
                state.warning_at   = None
                state.notified     = False
            return

        # ── Both gone ────────────────────────────────────────────────────────
        if not a_alive and not b_alive:
            if state.phase == _Phase.NORMAL:
                log.warning("disconnect_monitor: match=%s BOTH TEAMS SILENT — grace started",
                            state.match_id)
                self._enter_warning(state, "BOTH", now)
                self._notify_both_gone(state.match_id, by_team, cfg["grace"])
            elif state.phase == _Phase.WARNING and grace_expire and now >= grace_expire:
                log.warning("disconnect_monitor: match=%s grace expired BOTH gone → holding",
                            state.match_id)
                self._execute_holding(state.match_id, stake_currency, cfg["holding_wallet"])
                state.phase = _Phase.DONE
            return

        # ── One team gone ─────────────────────────────────────────────────────
        silent_team = "B" if a_alive else "A"
        alive_team  = "A" if a_alive else "B"

        if state.phase == _Phase.NORMAL:
            log.warning("disconnect_monitor: match=%s team_%s silent >%ds — WARNING",
                        state.match_id, silent_team, cfg["warn"])
            self._enter_warning(state, silent_team, now)
            self._notify_disconnect(
                state.match_id, by_team[silent_team], by_team[alive_team], cfg["grace"]
            )

        elif state.phase == _Phase.WARNING:
            if state.warning_team == "BOTH":
                # One team came back — switch to single-team warning
                returning_team = alive_team
                log.info("disconnect_monitor: match=%s team_%s returned from BOTH-gone state",
                         state.match_id, returning_team)
                state.warning_team = silent_team
                state.notified     = False
                return

            if state.warning_team != silent_team:
                # Different team went silent — switch
                log.warning("disconnect_monitor: match=%s silent team changed → resetting",
                            state.match_id)
                self._clear_warning_db(state.match_id)
                state.phase        = _Phase.NORMAL
                state.warning_team = None
                state.warning_at   = None
                state.notified     = False
                return

            if grace_expire and now >= grace_expire:
                log.warning("disconnect_monitor: match=%s grace expired team_%s → forfeit",
                            state.match_id, silent_team)
                winner_id = self._resolve_winner(state.match_id, by_team[alive_team])
                self._execute_forfeit(
                    state.match_id, stake_currency, winner_id, silent_team,
                    by_team[silent_team], by_team[alive_team]
                )
                state.phase = _Phase.DONE

    # ── DB reads ──────────────────────────────────────────────────────────────

    def _active_matches_with_players(self) -> list[tuple[str, str, list[dict]]]:
        try:
            with self._sf() as session:
                rows = session.execute(text("""
                    SELECT
                        m.id            AS match_id,
                        m.stake_currency,
                        mp.user_id,
                        mp.team,
                        cs.last_heartbeat
                    FROM matches m
                    JOIN match_players mp
                      ON mp.match_id     = m.id
                     AND mp.has_deposited = TRUE
                    LEFT JOIN client_sessions cs
                      ON cs.user_id         = mp.user_id
                     AND cs.disconnected_at IS NULL
                    WHERE m.status           = 'in_progress'
                      AND m.forfeit_committed = FALSE
                """)).fetchall()

            by_match: dict[str, tuple[str, list[dict]]] = {}
            for row in rows:
                mid, currency = str(row[0]), row[1]
                by_match.setdefault(mid, (currency, []))
                _, plist = by_match[mid]
                hb = row[4]
                if hb is not None and hb.tzinfo is None:
                    hb = hb.replace(tzinfo=timezone.utc)
                plist.append({"user_id": str(row[2]), "team": row[3], "last_heartbeat": hb})
                by_match[mid] = (currency, plist)

            return [(mid, curr, pl) for mid, (curr, pl) in by_match.items()]
        except Exception as exc:
            log.debug("disconnect_monitor: DB fetch error: %s", exc)
            return []

    def _resolve_winner(self, match_id: str, alive_players: list[dict]) -> str:
        """Use vision consensus winner if available; fall back to first alive player."""
        try:
            with self._sf() as session:
                row = session.execute(
                    text("SELECT winner_id FROM matches WHERE id = :mid AND winner_id IS NOT NULL"),
                    {"mid": match_id},
                ).fetchone()
                if row:
                    return str(row[0])
        except Exception:
            pass
        return alive_players[0]["user_id"]

    # ── DB writes ─────────────────────────────────────────────────────────────

    def _enter_warning(self, state: _MatchState, team: str, now: datetime) -> None:
        state.phase        = _Phase.WARNING
        state.warning_team = team
        state.warning_at   = now
        try:
            with self._sf() as session:
                session.execute(text("""
                    UPDATE matches
                    SET forfeit_warning_at   = :at,
                        forfeit_warning_team = :team
                    WHERE id = :mid AND status = 'in_progress'
                """), {"at": now, "team": team, "mid": state.match_id})
                session.commit()
        except Exception as exc:
            log.error("disconnect_monitor: _enter_warning DB failed: %s", exc)

    def _clear_warning_db(self, match_id: str) -> None:
        try:
            with self._sf() as session:
                session.execute(text("""
                    UPDATE matches
                    SET forfeit_warning_at   = NULL,
                        forfeit_warning_team = NULL
                    WHERE id = :mid
                """), {"mid": match_id})
                session.commit()
        except Exception as exc:
            log.error("disconnect_monitor: _clear_warning_db failed: %s", exc)

    def _notify_disconnect(
        self,
        match_id: str,
        silent_players: list[dict],
        alive_players: list[dict],
        grace_sec: int,
    ) -> None:
        grace_min = grace_sec // 60
        msgs = []
        for p in silent_players:
            msgs.append({
                "uid":   p["user_id"],
                "type":  "forfeit_warning",
                "title": "⚠️ Return to the game now!",
                "msg":   (
                    f"You left the game! Return within {grace_min} minute(s) "
                    "or the match will be forfeited."
                ),
                "meta":  json.dumps({"match_id": match_id, "grace_seconds": grace_sec}),
            })
        for p in alive_players:
            msgs.append({
                "uid":   p["user_id"],
                "type":  "opponent_disconnect",
                "title": "⏳ Opponent disconnected",
                "msg":   (
                    f"Your opponent left. They have {grace_min} minute(s) to return "
                    "or you win by forfeit."
                ),
                "meta":  json.dumps({"match_id": match_id, "grace_seconds": grace_sec}),
            })
        self._insert_notifications(msgs)

    def _notify_both_gone(
        self,
        match_id: str,
        by_team: dict[str, list[dict]],
        grace_sec: int,
    ) -> None:
        msgs = []
        for team_players in by_team.values():
            for p in team_players:
                msgs.append({
                    "uid":   p["user_id"],
                    "type":  "match_held_dispute",
                    "title": "⚖️ Connection issue detected",
                    "msg":   (
                        "Everyone disconnected. If this doesn't resolve within "
                        f"{grace_sec // 60} minute(s), the match will be sent for admin review."
                    ),
                    "meta":  json.dumps({"match_id": match_id}),
                })
        self._insert_notifications(msgs)

    def _notify_forfeit_result(
        self,
        match_id: str,
        winning_players: list[dict],
        losing_players: list[dict],
    ) -> None:
        msgs = []
        for p in winning_players:
            msgs.append({
                "uid":   p["user_id"],
                "type":  "match_forfeited_win",
                "title": "🏆 You win!",
                "msg":   "Your opponent forfeited. Check your balance.",
                "meta":  json.dumps({"match_id": match_id}),
            })
        for p in losing_players:
            msgs.append({
                "uid":   p["user_id"],
                "type":  "match_forfeited_loss",
                "title": "Match forfeited",
                "msg":   "You were absent too long. The match was forfeited.",
                "meta":  json.dumps({"match_id": match_id}),
            })
        self._insert_notifications(msgs)

    def _insert_notifications(self, msgs: list[dict]) -> None:
        if not msgs:
            return
        try:
            with self._sf() as session:
                for m in msgs:
                    session.execute(text("""
                        INSERT INTO notifications (user_id, type, title, message, metadata)
                        VALUES (:uid, :type, :title, :msg, :meta::jsonb)
                    """), m)
                session.commit()
        except Exception as exc:
            log.error("disconnect_monitor: notification insert failed: %s", exc)

    # ── Forfeit execution ─────────────────────────────────────────────────────

    def _execute_forfeit(
        self,
        match_id: str,
        stake_currency: str,
        winner_id: str,
        losing_team: str,
        losing_players: list[dict],
        winning_players: list[dict],
    ) -> None:
        log.warning(
            "disconnect_monitor: FORFEIT match=%s currency=%s winner=%s losing_team=%s",
            match_id, stake_currency, winner_id, losing_team,
        )
        try:
            with self._sf() as session:
                updated = session.execute(text("""
                    UPDATE matches
                    SET status            = 'completed',
                        winner_id         = :winner,
                        ended_at          = NOW(),
                        forfeit_committed  = TRUE
                    WHERE id = :mid AND status = 'in_progress'
                    RETURNING id
                """), {"winner": winner_id, "mid": match_id}).fetchone()
                session.commit()
            if not updated:
                log.warning("disconnect_monitor: forfeit skipped — match=%s not in_progress",
                            match_id)
                return
        except Exception as exc:
            log.error("disconnect_monitor: forfeit DB update failed match=%s: %s", match_id, exc)
            return

        if stake_currency == "AT":
            if self._settle_at:
                try:
                    self._settle_at(match_id, winner_id)
                except Exception as exc:
                    log.error("disconnect_monitor: AT settle failed match=%s: %s", match_id, exc)
        elif self._escrow:
            try:
                tx = self._escrow.declare_winner(match_id, winner_id)
                log.info("disconnect_monitor: on-chain forfeit match=%s tx=%s", match_id, tx)
            except Exception as exc:
                log.error(
                    "disconnect_monitor: on-chain declareWinner failed match=%s: %s — "
                    "players can recover via claimRefund() after 2h",
                    match_id, exc,
                )

        self._notify_forfeit_result(match_id, winning_players, losing_players)

    def _execute_holding(
        self,
        match_id: str,
        stake_currency: str,
        holding_wallet: str,
    ) -> None:
        log.warning(
            "disconnect_monitor: HOLDING match=%s currency=%s wallet=%s",
            match_id, stake_currency, holding_wallet or "(not configured)",
        )
        new_status = "disputed"
        try:
            with self._sf() as session:
                updated = session.execute(text("""
                    UPDATE matches
                    SET status           = :status,
                        ended_at         = NOW(),
                        forfeit_committed  = TRUE
                    WHERE id = :mid AND status = 'in_progress'
                    RETURNING id
                """), {"status": new_status, "mid": match_id}).fetchone()
                session.commit()
            if not updated:
                return
        except Exception as exc:
            log.error("disconnect_monitor: holding DB update failed match=%s: %s", match_id, exc)
            return

        if stake_currency == "AT":
            if self._refund_at:
                try:
                    self._refund_at(match_id)
                    log.info("disconnect_monitor: AT refund issued for disputed match=%s", match_id)
                except Exception as exc:
                    log.error("disconnect_monitor: AT refund failed match=%s: %s", match_id, exc)
        elif self._escrow:
            if not holding_wallet:
                log.error(
                    "disconnect_monitor: HOLDING_WALLET_ADDRESS not configured — "
                    "CRYPTO match=%s marked disputed, admin must resolve manually",
                    match_id,
                )
                return
            try:
                tx = self._escrow.transfer_to_holding(
                    match_id, holding_wallet, "both_disconnected"
                )
                log.info(
                    "disconnect_monitor: transfer_to_holding match=%s tx=%s", match_id, tx
                )
            except NotImplementedError:
                log.warning(
                    "disconnect_monitor: transfer_to_holding not yet deployed — "
                    "match=%s marked disputed, admin must resolve manually",
                    match_id,
                )
            except Exception as exc:
                log.error(
                    "disconnect_monitor: transfer_to_holding failed match=%s: %s — "
                    "admin must resolve manually",
                    match_id, exc,
                )


# ── Helper ────────────────────────────────────────────────────────────────────

def _team_alive(players: list[dict], cutoff: datetime) -> bool:
    for p in players:
        hb = p["last_heartbeat"]
        if hb is None:
            continue
        if hb.tzinfo is None:
            hb = hb.replace(tzinfo=timezone.utc)
        if hb > cutoff:
            return True
    return False
