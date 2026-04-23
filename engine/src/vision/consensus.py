"""
ARENA Engine — Match Consensus Validator
Collects VisionEngine results from all players in a match and decides
the official outcome. Flags any player whose reported result contradicts
the majority.

DB persistence (Step 3):
  Pass session_factory=SessionLocal to the constructor to enable transparent
  DB-backed persistence.  Every call to submit() writes to match_consensus
  table; __init__ restores any existing votes so engine restarts are safe.
  All existing callers that omit session_factory continue to work in-memory.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Callable, Any

from src.vision.engine import VisionEngineOutput

log = logging.getLogger("vision.consensus")

# Minimum fraction of players that must agree for a result to be accepted
CONSENSUS_THRESHOLD = 0.6   # 60% → e.g. 6 out of 10


class ConsensusStatus(Enum):
    PENDING   = "pending"    # still waiting for more submissions
    REACHED   = "reached"    # majority agreed on a result
    FAILED    = "failed"     # not enough agreement (timeout / contradictions)


@dataclass
class PlayerSubmission:
    wallet_address: str
    result: Optional[str]          # e.g. "CT_WIN", "T_WIN", "victory", "defeat", None
    confidence: float
    players: list[str]
    agents: list[str] = field(default_factory=list)   # Valorant only; [] for CS2
    score: Optional[str] = None                        # e.g. "13-11"
    submitted_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class ConsensusResult:
    status: ConsensusStatus
    agreed_result: Optional[str]   # the official outcome, None if FAILED
    total_players: int
    agreeing_players: int
    flagged_wallets: list[str]      # players whose result contradicted majority
    submissions: list[PlayerSubmission]


class MatchConsensus:
    """
    Collects and evaluates VisionEngine results from all players in a match.

    Parameters
    ----------
    match_id : str
        UUID of the match being tracked.
    expected_players : int
        Total number of players expected to submit (determines PENDING vs complete).
    session_factory : callable | None
        Optional SQLAlchemy session factory (e.g. SessionLocal from main.py).
        When provided:
          - __init__ calls _restore_from_db() to re-load any existing votes.
          - submit() calls _persist_submission() to write each new vote to DB.
        When None (default): purely in-memory — backward compatible with all
        existing tests and watcher.py usage.

    DB-ready: match_consensus table (013-match-consensus.sql)
    """

    def __init__(
        self,
        match_id: str,
        expected_players: int = 10,
        session_factory: Optional[Callable[[], Any]] = None,
    ):
        self.match_id = match_id
        self.expected_players = expected_players
        self._session_factory = session_factory
        self._submissions: dict[str, PlayerSubmission] = {}  # wallet → submission

        log.info("consensus | match=%s expecting %d players", match_id, expected_players)

        # Restore any votes that were persisted before a potential engine restart
        if self._session_factory is not None:
            self._restore_from_db()

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    def submit(self, wallet_address: str, output: VisionEngineOutput) -> ConsensusStatus:
        """
        Called by watcher.py when a player's StateMachine reaches CONFIRMED,
        and by POST /validate/screenshot after evidence is persisted to DB.

        Returns current ConsensusStatus so the caller knows whether to wait.
        Duplicate submissions (same wallet) are silently ignored.
        """
        if wallet_address in self._submissions:
            log.warning(
                "consensus | match=%s duplicate submission from %s — ignored",
                self.match_id, wallet_address,
            )
            return self._current_status()

        sub = PlayerSubmission(
            wallet_address=wallet_address,
            result=output.result,
            confidence=output.confidence,
            players=output.players,
            agents=getattr(output, "agents", []),
            score=getattr(output, "score", None),
        )
        self._submissions[wallet_address] = sub

        log.info(
            "consensus | match=%s player=%s result=%s confidence=%.0f%% (%d/%d received)",
            self.match_id, wallet_address, output.result,
            output.confidence * 100, len(self._submissions), self.expected_players,
        )

        # Persist to DB (non-fatal — in-memory state is the authoritative source
        # during this engine session; DB is the durable backup for restarts)
        if self._session_factory is not None:
            self._persist_submission(sub)

        return self._current_status()

    def evaluate(self) -> ConsensusResult:
        """
        Evaluate all submissions collected so far and return the final verdict.
        Can be called at any time; call after all players have submitted for
        the authoritative result.
        """
        submissions = list(self._submissions.values())
        total = len(submissions)

        if total == 0:
            return ConsensusResult(
                status=ConsensusStatus.FAILED,
                agreed_result=None,
                total_players=total,
                agreeing_players=0,
                flagged_wallets=[],
                submissions=submissions,
            )

        # Count votes per result
        vote_counts: dict[str, int] = {}
        for sub in submissions:
            key = sub.result or "unknown"
            vote_counts[key] = vote_counts.get(key, 0) + 1

        # CS2 complementary-pair fast path.
        # "victory" and "defeat" are opposite perspectives of the same event —
        # winning-team players report "victory", losing-team players report "defeat".
        # An exact 50/50 split is the NORMAL outcome for any equal-team format
        # (1v1, 2v2, 5v5) and must NOT be treated as a disagreement.
        # Only apply when ALL expected votes are in and the split is perfectly even;
        # any asymmetry falls through to the standard majority check so cheaters
        # (who submit "victory" when they should submit "defeat") are still flagged.
        _v = vote_counts.get("victory", 0)
        _d = vote_counts.get("defeat",  0)
        if (
            frozenset(vote_counts.keys()) <= {"victory", "defeat"}
            and _v > 0
            and _d > 0
            and _v == _d
            and total == self.expected_players
        ):
            log.info(
                "consensus | match=%s REACHED (complementary pair) — "
                "victory=%d defeat=%d",
                self.match_id, _v, _d,
            )
            return ConsensusResult(
                status=ConsensusStatus.REACHED,
                agreed_result="victory",
                total_players=total,
                agreeing_players=_v,
                flagged_wallets=[],
                submissions=submissions,
            )

        # Standard majority check (handles non-CS2 games and cheat detection).
        majority_result = max(vote_counts, key=lambda k: vote_counts[k])
        majority_count = vote_counts[majority_result]
        majority_fraction = majority_count / total

        if majority_fraction >= CONSENSUS_THRESHOLD:
            status = ConsensusStatus.REACHED
            agreed_result = majority_result if majority_result != "unknown" else None
            flagged_wallets = [
                sub.wallet_address
                for sub in submissions
                if (sub.result or "unknown") != majority_result
            ]
            log.info(
                "consensus | match=%s REACHED — result=%s votes=%d/%d flagged=%s",
                self.match_id, agreed_result, majority_count, total, flagged_wallets,
            )
        else:
            status = ConsensusStatus.FAILED
            agreed_result = None
            flagged_wallets = []
            log.warning(
                "consensus | match=%s FAILED — no majority (best=%s %d/%d)",
                self.match_id, majority_result, majority_count, total,
            )

        return ConsensusResult(
            status=status,
            agreed_result=agreed_result,
            total_players=total,
            agreeing_players=majority_count,
            flagged_wallets=flagged_wallets,
            submissions=submissions,
        )

    def received_count(self) -> int:
        return len(self._submissions)

    def is_complete(self) -> bool:
        """True once all expected players have submitted."""
        return len(self._submissions) >= self.expected_players

    # ------------------------------------------------------------------ #
    #  DB persistence (session_factory must be non-None)                  #
    # ------------------------------------------------------------------ #

    def _persist_submission(self, sub: PlayerSubmission) -> None:
        """
        Write a single PlayerSubmission to the match_consensus table.
        Uses ON CONFLICT DO NOTHING so duplicate calls (e.g. after restart
        if the in-memory check somehow fails) are harmless.

        Non-fatal: any DB error is logged and swallowed so the in-memory
        consensus continues to function even if the DB is momentarily down.

        DB-ready: match_consensus table (013-match-consensus.sql)
        """
        try:
            from sqlalchemy import text as _text
            import uuid as _uuid

            with self._session_factory() as session:
                session.execute(
                    _text("""
                        INSERT INTO match_consensus
                            (id, match_id, wallet_address, result, confidence,
                             players, agents, score, submitted_at)
                        VALUES
                            (:id, :mid, :wallet, :result, :confidence,
                             :players, :agents, :score, :submitted_at)
                        ON CONFLICT (match_id, wallet_address) DO NOTHING
                    """),
                    {
                        "id":           str(_uuid.uuid4()),
                        "mid":          self.match_id,
                        "wallet":       sub.wallet_address,
                        "result":       sub.result,
                        "confidence":   float(sub.confidence),
                        "players":      sub.players,
                        "agents":       sub.agents,
                        "score":        sub.score,
                        "submitted_at": sub.submitted_at,
                    },
                )
                session.commit()
                log.debug(
                    "consensus | persisted submission: match=%s wallet=%s result=%s",
                    self.match_id, sub.wallet_address, sub.result,
                )
        except Exception as exc:
            log.error(
                "consensus | DB persist failed (non-fatal): match=%s wallet=%s error=%s",
                self.match_id, sub.wallet_address, exc,
            )

    def _restore_from_db(self) -> None:
        """
        On __init__, reload any previously-persisted submissions from DB so
        that a restarted engine continues from where it left off.

        Rows are read from match_consensus for this match_id and turned back
        into PlayerSubmission objects.  If a wallet already appears in
        self._submissions (shouldn't happen at init time) it is skipped.

        Non-fatal: if DB is down we start with an empty in-memory state and
        accept submissions fresh (the lost votes would need re-submission).

        DB-ready: match_consensus table (013-match-consensus.sql)
        """
        try:
            from sqlalchemy import text as _text

            with self._session_factory() as session:
                rows = session.execute(
                    _text("""
                        SELECT wallet_address, result, confidence,
                               players, agents, score, submitted_at
                        FROM   match_consensus
                        WHERE  match_id = :mid
                        ORDER  BY submitted_at
                    """),
                    {"mid": self.match_id},
                ).fetchall()

            restored = 0
            for row in rows:
                wallet, result, confidence, players, agents, score, submitted_at = row
                if wallet in self._submissions:
                    continue   # already in memory (shouldn't happen at init)
                self._submissions[wallet] = PlayerSubmission(
                    wallet_address=wallet,
                    result=result,
                    confidence=float(confidence),
                    players=list(players) if players else [],
                    agents=list(agents) if agents else [],
                    score=score,
                    submitted_at=submitted_at or datetime.now(timezone.utc),
                )
                restored += 1

            if restored:
                log.info(
                    "consensus | restored %d submission(s) from DB: match=%s (%d/%d)",
                    restored, self.match_id, len(self._submissions), self.expected_players,
                )
        except Exception as exc:
            log.warning(
                "consensus | DB restore failed (non-fatal, starting empty): match=%s error=%s",
                self.match_id, exc,
            )

    # ------------------------------------------------------------------ #
    #  Internal                                                            #
    # ------------------------------------------------------------------ #

    def _current_status(self) -> ConsensusStatus:
        if not self.is_complete():
            return ConsensusStatus.PENDING
        result = self.evaluate()
        return result.status
