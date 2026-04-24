"""
ContractReconciler — background loop that monitors CRYPTO matches for
DB vs on-chain state divergence and logs anomalies.

Design constraints (critical):
  - The oracle wallet is NOT a depositor in any match.
  - cancelWaiting() requires msg.sender to be a depositor — oracle cannot call it.
  - This reconciler LOGS stuck matches but does NOT auto-cancel on-chain.
  - The "Rescue Funds" UI button lets the user call cancelWaiting() from their own wallet.
  - The reconciler also times out stale pending_leaves entries.

What it monitors:
  1. WAITING CRYPTO matches stuck past WAITING_TIMEOUT (1 hour) — logs and alerts.
  2. pending_leaves stuck past leave_confirmation_timeout_sec — marks as 'failed'.
  3. DB status='waiting' but on-chain state != WAITING — logs the mismatch.
     (This can happen if the event listener missed a MatchCancelled event.)
"""

import logging
import threading
import time
import uuid
from typing import Optional

from sqlalchemy import text

logger = logging.getLogger(__name__)

# MatchState enum values — mirror ArenaEscrow.sol
_STATE_WAITING   = 0
_STATE_ACTIVE    = 1
_STATE_FINISHED  = 2
_STATE_REFUNDED  = 3
_STATE_CANCELLED = 4
_STATE_TIED      = 5

# DB status corresponding to each on-chain state (for divergence detection)
_CHAIN_TO_DB_STATUS = {
    _STATE_WAITING:   "waiting",
    _STATE_ACTIVE:    "in_progress",
    _STATE_FINISHED:  "completed",
    _STATE_REFUNDED:  "cancelled",
    _STATE_CANCELLED: "cancelled",
    _STATE_TIED:      "tied",
}


class ContractReconciler:
    """
    Polls for DB vs on-chain state divergences and stuck WAITING matches.
    Intended to run in a background asyncio thread via asyncio.to_thread().

    Usage:
        reconciler = ContractReconciler(SessionLocal, escrow_client)
        asyncio.ensure_future(asyncio.to_thread(reconciler.run))
    """

    def __init__(self, session_factory, escrow_client) -> None:
        self._session_factory   = session_factory
        self._escrow_client     = escrow_client   # may be None if chain disabled
        self._stop              = threading.Event()

    def stop(self) -> None:
        """Signal the run() loop to exit at the next sleep boundary."""
        self._stop.set()

    def run(self, poll_interval: int = 300) -> None:
        """
        Main loop — runs until stop() is called, sleeping poll_interval seconds between passes.
        poll_interval is overridden by platform_config.reconciliation_interval_sec.
        Uses threading.Event.wait() instead of time.sleep() so stop() wakes the thread immediately.
        """
        logger.info("ContractReconciler started | default_interval=%ds", poll_interval)
        while not self._stop.is_set():
            try:
                interval = self._load_interval(poll_interval)
                self._run_once()
            except Exception as exc:
                logger.error("ContractReconciler loop error: %s", exc)
                interval = poll_interval
            self._stop.wait(timeout=interval)

    def _load_interval(self, default: int) -> int:
        try:
            with self._session_factory() as session:
                row = session.execute(
                    text("SELECT value FROM platform_config WHERE key = 'reconciliation_interval_sec'")
                ).fetchone()
                return int(row[0]) if row and row[0] else default
        except Exception:
            return default

    def _load_leave_timeout(self) -> int:
        try:
            with self._session_factory() as session:
                row = session.execute(
                    text("SELECT value FROM platform_config WHERE key = 'leave_confirmation_timeout_sec'")
                ).fetchone()
                return int(row[0]) if row and row[0] else 120
        except Exception:
            return 120

    def _run_once(self) -> None:
        self._check_stuck_waiting_matches()
        self._expire_stale_pending_leaves()
        if self._escrow_client is not None:
            self._check_state_divergences()

    # ── Check 1: WAITING matches past the 1-hour WAITING_TIMEOUT ────────────

    def _check_stuck_waiting_matches(self) -> None:
        """
        Finds CRYPTO WAITING matches where created_at + 1h < NOW().
        Logs each one to contract_reconciliation_log so ops can alert users.
        Does NOT call cancelWaiting() — oracle is not a depositor.
        """
        try:
            with self._session_factory() as session:
                rows = session.execute(
                    text("""
                        SELECT id, on_chain_match_id, created_at
                        FROM matches
                        WHERE status = 'waiting'
                          AND stake_currency = 'CRYPTO'
                          AND created_at < NOW() - INTERVAL '1 hour'
                          AND on_chain_match_id IS NOT NULL
                    """)
                ).fetchall()

                if not rows:
                    return

                for (db_id, on_chain_id, created_at) in rows:
                    db_id_str = str(db_id)
                    already_logged = session.execute(
                        text(
                            "SELECT 1 FROM contract_reconciliation_log "
                            "WHERE match_id = :mid AND issue = 'stuck_waiting_past_timeout' "
                            "AND checked_at > NOW() - INTERVAL '2 hours'"
                        ),
                        {"mid": db_id_str},
                    ).fetchone()
                    if already_logged:
                        continue

                    session.execute(
                        text("""
                            INSERT INTO contract_reconciliation_log
                                (match_id, on_chain_id, db_status, issue, action_taken)
                            VALUES (:mid, :oid, 'waiting', 'stuck_waiting_past_timeout',
                                    'logged_only: oracle cannot call cancelWaiting()')
                        """),
                        {"mid": db_id_str, "oid": on_chain_id},
                    )
                    logger.warning(
                        "ContractReconciler: match=%s on_chain=%s stuck in WAITING past 1h timeout "
                        "— user must call cancelWaiting() from their wallet",
                        db_id_str, on_chain_id,
                    )

                session.commit()
        except Exception as exc:
            logger.error("_check_stuck_waiting_matches error: %s", exc)

    # ── Check 2: expire stale pending_leaves ────────────────────────────────

    def _expire_stale_pending_leaves(self) -> None:
        """
        Marks pending_leaves entries as 'failed' if they have been pending
        longer than leave_confirmation_timeout_sec (default 120s).
        This unblocks the leave flow if a tx was submitted but never confirmed.
        """
        timeout = self._load_leave_timeout()
        try:
            with self._session_factory() as session:
                result = session.execute(
                    text("""
                        UPDATE pending_leaves
                        SET status = 'failed'
                        WHERE status = 'pending'
                          AND initiated_at < NOW() - INTERVAL '1 second' * :timeout
                        RETURNING id
                    """),
                    {"timeout": timeout},
                )
                expired = result.fetchall()
                if expired:
                    logger.info(
                        "ContractReconciler: expired %d stale pending_leaves (timeout=%ds)",
                        len(expired), timeout,
                    )
                session.commit()
        except Exception as exc:
            logger.error("_expire_stale_pending_leaves error: %s", exc)

    # ── Check 3: DB status vs on-chain state divergence ─────────────────────

    def _check_state_divergences(self) -> None:
        """
        Queries recent WAITING/in_progress CRYPTO matches and compares DB status
        to the on-chain MatchState. Logs any divergence to contract_reconciliation_log.

        Divergences can occur when the event listener misses events (listener restart,
        RPC downtime). The listener's resume-from-last-block logic should handle these
        eventually, but we surface them here for ops visibility.
        """
        try:
            with self._session_factory() as session:
                rows = session.execute(
                    text("""
                        SELECT id, on_chain_match_id, status
                        FROM matches
                        WHERE stake_currency = 'CRYPTO'
                          AND status IN ('waiting', 'in_progress')
                          AND on_chain_match_id IS NOT NULL
                          AND created_at > NOW() - INTERVAL '48 hours'
                        ORDER BY created_at DESC
                        LIMIT 50
                    """)
                ).fetchall()

                for (db_id, on_chain_id, db_status) in rows:
                    db_id_str = str(db_id)
                    try:
                        chain_state = self._escrow_client.read_match_state(int(on_chain_id))
                    except Exception as exc:
                        logger.debug(
                            "ContractReconciler: read_match_state failed for on_chain=%s: %s",
                            on_chain_id, exc,
                        )
                        continue

                    expected_db = _CHAIN_TO_DB_STATUS.get(chain_state)
                    if expected_db is None:
                        continue

                    if db_status != expected_db:
                        already_logged = session.execute(
                            text(
                                "SELECT 1 FROM contract_reconciliation_log "
                                "WHERE match_id = :mid AND issue = 'state_divergence' "
                                "AND chain_state = :cs "
                                "AND checked_at > NOW() - INTERVAL '1 hour'"
                            ),
                            {"mid": db_id_str, "cs": chain_state},
                        ).fetchone()
                        if already_logged:
                            continue

                        session.execute(
                            text("""
                                INSERT INTO contract_reconciliation_log
                                    (match_id, on_chain_id, db_status, chain_state, issue, action_taken)
                                VALUES (:mid, :oid, :dbs, :cs, 'state_divergence',
                                        'logged_only: listener should self-heal on next poll')
                            """),
                            {
                                "mid": db_id_str, "oid": on_chain_id,
                                "dbs": db_status, "cs": chain_state,
                            },
                        )
                        logger.warning(
                            "ContractReconciler: divergence match=%s db_status=%s chain_state=%d "
                            "(expected db=%s) — listener should heal on next block scan",
                            db_id_str, db_status, chain_state, expected_db,
                        )

                session.commit()
        except Exception as exc:
            logger.error("_check_state_divergences error: %s", exc)
