"""
ARENA Engine — Rage-Quit Detector (Issue #56)

Monitors active matches by checking last_heartbeat in client_sessions.
When one team goes silent for RAGE_QUIT_THRESHOLD seconds while the
opposing team remains alive → the engine (as oracle) calls declareWinner()
awarding the forfeit to the surviving team.

Distinguishes:
  rage-quit    — one team silent, opponent alive  → forfeit, surviving team wins
  server crash — ALL players on both teams silent → do NOT forfeit; wait for
                 the 2-hour on-chain claimRefund() timeout as the final backstop

Config (env vars):
  RAGE_QUIT_THRESHOLD_SECONDS      default 300  (5 min no heartbeat = rage-quit)
  RAGE_QUIT_CHECK_INTERVAL_SECONDS default 60   (scan every 60 s)

DB-ready:
  Reads:  matches (status='in_progress'), match_players (team, has_deposited),
          client_sessions (last_heartbeat, disconnected_at)
  Writes: matches SET status='completed', winner_id=..., ended_at=NOW()
  Then:   EscrowClient.declare_winner(match_id, winner_user_id) → on-chain tx
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from src.contract.escrow_client import EscrowClient

log = logging.getLogger("vision.rage_quit")

# ── Config ────────────────────────────────────────────────────────────────────

RAGE_QUIT_THRESHOLD = int(os.getenv("RAGE_QUIT_THRESHOLD_SECONDS", "300"))
CHECK_INTERVAL      = int(os.getenv("RAGE_QUIT_CHECK_INTERVAL_SECONDS", "60"))


# ── Detector ──────────────────────────────────────────────────────────────────

class RageQuitDetector:
    """
    Background loop that polls for rage-quits in ACTIVE matches.

    Usage (in FastAPI lifespan):
        detector = RageQuitDetector(SessionLocal, escrow_client)
        task = asyncio.create_task(detector.run())
        yield
        task.cancel()
    """

    def __init__(
        self,
        session_factory,
        escrow_client: Optional[EscrowClient] = None,
    ) -> None:
        self._session_factory = session_factory
        self._escrow_client   = escrow_client
        # Match IDs already forfeited this session — prevents double-forfeit.
        # On engine restart the set resets, but completed matches are filtered
        # by the DB query (status='in_progress') so they won't be picked up again.
        self._forfeited: set[str] = set()

    # ── Public ────────────────────────────────────────────────────────────────

    async def run(self) -> None:
        """
        Infinite async loop. Launched via asyncio.create_task() in lifespan.
        Runs _tick() in a thread so DB calls don't block the event loop.
        """
        log.info(
            "RageQuitDetector started | threshold=%ds check_interval=%ds",
            RAGE_QUIT_THRESHOLD, CHECK_INTERVAL,
        )
        while True:
            await asyncio.sleep(CHECK_INTERVAL)
            try:
                await asyncio.to_thread(self._tick)
            except asyncio.CancelledError:
                log.info("RageQuitDetector stopped")
                return
            except Exception as exc:
                log.error("rage_quit tick error: %s", exc)

    # ── Internal: scan ────────────────────────────────────────────────────────

    def _tick(self, _now: Optional[datetime] = None) -> None:
        """Scan all in_progress matches and forfeit confirmed rage-quits.
        _now is injectable for testing; defaults to datetime.now(timezone.utc).
        """
        now = _now or datetime.now(timezone.utc)
        for match_id in self._get_active_matches():
            if match_id in self._forfeited:
                continue
            result = self._check_match(match_id, now)
            if result is not None:
                winner_user_id, losing_team = result
                self._forfeit(match_id, winner_user_id, losing_team)
                self._forfeited.add(match_id)

    def _get_active_matches(self) -> list[str]:
        """Return UUIDs of all matches currently in_progress."""
        try:
            with self._session_factory() as session:
                rows = session.execute(
                    text("SELECT id FROM matches WHERE status = 'in_progress'")
                ).fetchall()
                return [str(row[0]) for row in rows]
        except Exception as exc:
            log.debug("rage_quit: DB unavailable for match list: %s", exc)
            return []

    def _check_match(
        self, match_id: str, now: datetime
    ) -> Optional[tuple[str, str]]:
        """
        Inspect heartbeats for all deposited players in a match.

        Returns (winner_user_id, losing_team_letter) if rage-quit is confirmed.
        Returns None when:
          - both teams alive          → match in progress, no action
          - both teams silent         → likely server crash, do NOT forfeit
          - incomplete player data    → skip (match not fully filled yet)
        """
        try:
            with self._session_factory() as session:
                rows = session.execute(
                    text("""
                        SELECT mp.user_id, mp.team, cs.last_heartbeat
                          FROM match_players mp
                          LEFT JOIN client_sessions cs
                            ON cs.user_id = mp.user_id
                           AND cs.disconnected_at IS NULL
                         WHERE mp.match_id = :mid
                           AND mp.has_deposited = TRUE
                    """),
                    {"mid": match_id},
                ).fetchall()
        except Exception as exc:
            log.debug("rage_quit: DB unavailable for match %s: %s", match_id, exc)
            return None

        if not rows:
            return None

        threshold = now - timedelta(seconds=RAGE_QUIT_THRESHOLD)

        # Group players by team
        team_players: dict[str, list[tuple[str, Optional[datetime]]]] = {"A": [], "B": []}
        for user_id, team, last_hb in rows:
            team_players.setdefault(team, []).append((str(user_id), last_hb))

        # Need both teams populated to make a forfeit decision
        if not team_players.get("A") or not team_players.get("B"):
            return None

        a_alive = self._team_alive(team_players["A"], threshold)
        b_alive = self._team_alive(team_players["B"], threshold)

        if a_alive and not b_alive:
            # Team B rage-quit → Team A wins
            winner_user_id = team_players["A"][0][0]
            log.warning(
                "rage_quit DETECTED | match=%s | team_B silent>%ds | winner=%s (teamA)",
                match_id, RAGE_QUIT_THRESHOLD, winner_user_id,
            )
            return winner_user_id, "B"

        if b_alive and not a_alive:
            # Team A rage-quit → Team B wins
            winner_user_id = team_players["B"][0][0]
            log.warning(
                "rage_quit DETECTED | match=%s | team_A silent>%ds | winner=%s (teamB)",
                match_id, RAGE_QUIT_THRESHOLD, winner_user_id,
            )
            return winner_user_id, "A"

        if not a_alive and not b_alive:
            # Both teams silent — server crash or network outage, not a rage-quit.
            # The 2-hour on-chain claimRefund() timeout is the safety net here.
            log.info(
                "rage_quit: match=%s both teams silent — server crash suspected, "
                "not forfeiting (claimRefund available after 2h)",
                match_id,
            )

        return None

    @staticmethod
    def _team_alive(
        players: list[tuple[str, Optional[datetime]]],
        threshold: datetime,
    ) -> bool:
        """Return True if at least one player has a heartbeat newer than threshold."""
        for _, hb in players:
            if hb is None:
                continue
            # Normalize to UTC if DB returns naive datetime
            if hb.tzinfo is None:
                hb = hb.replace(tzinfo=timezone.utc)
            if hb > threshold:
                return True
        return False

    # ── Internal: forfeit ─────────────────────────────────────────────────────

    def _forfeit(
        self, match_id: str, winner_user_id: str, losing_team: str
    ) -> None:
        """
        Execute the forfeit:
          1. Update DB: matches.status='completed', winner_id, ended_at
          2. Call EscrowClient.declare_winner() to release funds on-chain.
             If EscrowClient is unavailable, funds remain locked until the
             2-hour claimRefund() timeout on the contract.
        """
        log.warning(
            "rage_quit FORFEIT | match=%s | winner=%s | losing_team=%s",
            match_id, winner_user_id, losing_team,
        )

        # 1. Update DB — mark match completed before touching the contract (CEI)
        try:
            with self._session_factory() as session:
                session.execute(
                    text("""
                        UPDATE matches
                           SET status    = 'completed',
                               winner_id = :winner_id,
                               ended_at  = NOW()
                         WHERE id     = :mid
                           AND status = 'in_progress'
                    """),
                    {"winner_id": winner_user_id, "mid": match_id},
                )
                session.commit()
            log.info("rage_quit: DB updated | match=%s status=completed", match_id)
        except Exception as exc:
            log.error("rage_quit: DB update failed | match=%s | %s", match_id, exc)
            return  # Don't touch the contract if DB write failed

        # 2. On-chain: oracle calls declareWinner — releases funds to winning team
        if self._escrow_client is None:
            log.info(
                "rage_quit: EscrowClient not configured — on-chain declareWinner skipped. "
                "Winning players can recover via claimRefund() after 2h timeout.",
            )
            return

        try:
            tx_hash = self._escrow_client.declare_winner(match_id, winner_user_id)
            log.info(
                "rage_quit: declareWinner sent | match=%s tx=%s", match_id, tx_hash
            )
        except Exception as exc:
            log.error(
                "rage_quit: declareWinner failed | match=%s | %s | "
                "players can still recover via claimRefund() after 2h timeout",
                match_id, exc,
            )
