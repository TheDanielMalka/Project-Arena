"""
ARENA Engine — Match Consensus Validator
Collects VisionEngine results from all players in a match and decides
the official outcome.

Cross-team validation (primary path):
  When team_a_wallets and team_b_wallets are provided, consensus is reached
  when the majority of each team reports what they should:
    - majority(Team A) == "victory" AND majority(Team B) == "defeat"  → Team A wins
    - majority(Team A) == "defeat"  AND majority(Team B) == "victory" → Team B wins
  This eliminates the 50/50 deadlock in 1v1, 2v2, and 5v5 formats.

Majority fallback (when team wallets not provided):
  Falls back to CONSENSUS_THRESHOLD across all submissions.

DB persistence:
  Pass session_factory=SessionLocal to persist every submission.
  __init__ restores existing votes so engine restarts are safe.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Callable, Any

from src.vision.engine import VisionEngineOutput

log = logging.getLogger("vision.consensus")

# Fallback threshold used when team wallets are not configured.
# 75 % ensures at least 3 of 4 agree in a 2v2 (or 4 of 5 in 5v5-only),
# while the cross-team path makes this irrelevant for normal matches.
CONSENSUS_THRESHOLD = 0.75


class ConsensusStatus(Enum):
    PENDING   = "pending"    # still waiting for more submissions
    REACHED   = "reached"    # outcome confirmed
    FAILED    = "failed"     # not enough agreement (timeout / contradictions)


@dataclass
class PlayerSubmission:
    wallet_address: str
    result:         Optional[str]       # "victory" | "defeat" | "tie" | None
    confidence:     float
    players:        list[str]
    agents:         list[str]           = field(default_factory=list)
    score:          Optional[str]       = None
    screen_type:    str                 = "unknown"
    submitted_at:   datetime            = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class ConsensusResult:
    status:           ConsensusStatus
    agreed_result:    Optional[str]     # "victory" (Team A) | "defeat" (Team A) | "tie" | None
    winning_team:     Optional[str]     # "team_a" | "team_b" | None
    is_cross_validated: bool            # True when both teams confirmed the outcome
    total_players:    int
    agreeing_players: int
    flagged_wallets:  list[str]
    submissions:      list[PlayerSubmission]


class MatchConsensus:
    """
    Collects and evaluates VisionEngine results for one match.

    Parameters
    ----------
    match_id : str
    expected_players : int
    team_a_wallets : list[str] | None
        Lower-cased wallet addresses for Team A.  When provided, enables
        cross-team validation (strongly preferred over the majority fallback).
    team_b_wallets : list[str] | None
        Lower-cased wallet addresses for Team B.
    session_factory : callable | None
        SQLAlchemy session factory for DB persistence.
    """

    def __init__(
        self,
        match_id: str,
        expected_players: int = 10,
        team_a_wallets: Optional[list[str]] = None,
        team_b_wallets: Optional[list[str]] = None,
        session_factory: Optional[Callable[[], Any]] = None,
    ):
        self.match_id         = match_id
        self.expected_players = expected_players
        self._team_a: frozenset[str] = frozenset(w.lower() for w in (team_a_wallets or []))
        self._team_b: frozenset[str] = frozenset(w.lower() for w in (team_b_wallets or []))
        self._session_factory         = session_factory
        self._submissions: dict[str, PlayerSubmission] = {}

        mode = "cross-team" if (self._team_a and self._team_b) else "majority-fallback"
        log.info(
            "consensus | match=%s expecting=%d mode=%s teamA=%d teamB=%d",
            match_id, expected_players, mode, len(self._team_a), len(self._team_b),
        )

        if self._session_factory is not None:
            self._restore_from_db()

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    def submit(self, wallet_address: str, output: VisionEngineOutput) -> ConsensusStatus:
        """
        Record one player's VisionEngine result.  Duplicate wallets are ignored.
        Returns the current ConsensusStatus after this submission.
        """
        wallet = wallet_address.lower()

        if wallet in self._submissions:
            log.warning(
                "consensus | match=%s duplicate submission from %s — ignored",
                self.match_id, wallet,
            )
            return self._current_status()

        sub = PlayerSubmission(
            wallet_address=wallet,
            result=output.result,
            confidence=output.confidence,
            players=output.players,
            agents=getattr(output, "agents", []),
            score=getattr(output, "score", None),
            screen_type=getattr(output, "screen_type", "unknown"),
        )
        self._submissions[wallet] = sub

        log.info(
            "consensus | match=%s player=%s result=%s screen_type=%s "
            "confidence=%.0f%% (%d/%d received)",
            self.match_id, wallet, output.result,
            sub.screen_type,
            output.confidence * 100,
            len(self._submissions), self.expected_players,
        )

        if self._session_factory is not None:
            self._persist_submission(sub)

        return self._current_status()

    def evaluate(self) -> ConsensusResult:
        """
        Evaluate all submissions collected so far and return the final verdict.
        Prefer cross-team validation; fall back to majority if team wallets absent.
        """
        submissions = list(self._submissions.values())
        total = len(submissions)

        if total == 0:
            return ConsensusResult(
                status=ConsensusStatus.FAILED,
                agreed_result=None,
                winning_team=None,
                is_cross_validated=False,
                total_players=0,
                agreeing_players=0,
                flagged_wallets=[],
                submissions=[],
            )

        if self._team_a and self._team_b:
            return self._evaluate_cross_team(submissions)

        return self._evaluate_majority(submissions)

    def received_count(self) -> int:
        return len(self._submissions)

    def is_complete(self) -> bool:
        return len(self._submissions) >= self.expected_players

    # ------------------------------------------------------------------ #
    #  Cross-team validation (primary algorithm)                          #
    # ------------------------------------------------------------------ #

    def _evaluate_cross_team(self, submissions: list[PlayerSubmission]) -> ConsensusResult:
        """
        Confirm outcome when the majority of each team reports their expected result.

        Win condition for Team A:
          - strict majority of Team A submissions == "victory"
          - strict majority of Team B submissions == "defeat"
            (if Team B has not yet submitted, Team A majority alone is accepted
             once all expected Team A members have submitted — anti-cheat is
             weaker in that case, so we flag Team B wallets as non-submitters)

        Win condition for Team B: mirror of the above.

        "Strict majority" means > 50 % of submitted votes for that team.
        For a 1v1, 1/1 = 100 % satisfies this.
        For a 2v2, 1/2 = 50 % does NOT — both must agree.
        For a 5v5, 3/5 = 60 % satisfies this.
        """
        a_subs = [s for s in submissions if s.wallet_address in self._team_a]
        b_subs = [s for s in submissions if s.wallet_address in self._team_b]

        a_victory = sum(1 for s in a_subs if s.result == "victory")
        a_defeat  = sum(1 for s in a_subs if s.result == "defeat")
        a_tie     = sum(1 for s in a_subs if s.result == "tie")
        b_victory = sum(1 for s in b_subs if s.result == "victory")
        b_defeat  = sum(1 for s in b_subs if s.result == "defeat")
        b_tie     = sum(1 for s in b_subs if s.result == "tie")

        a_total = len(a_subs) or 1   # avoid div/0
        b_total = len(b_subs) or 1

        a_maj_victory = a_victory / a_total > 0.5
        a_maj_defeat  = a_defeat  / a_total > 0.5
        a_maj_tie     = a_tie     / a_total > 0.5
        b_maj_victory = b_victory / b_total > 0.5
        b_maj_defeat  = b_defeat  / b_total > 0.5
        b_maj_tie     = b_tie     / b_total > 0.5

        # Both teams reported a draw — cross-validated tie
        if a_maj_tie and b_maj_tie:
            flagged = [
                s.wallet_address for s in submissions
                if s.result != "tie"
            ]
            log.info(
                "consensus | match=%s REACHED (cross-validated) TIE "
                "a_tie=%d/%d b_tie=%d/%d flagged=%s",
                self.match_id, a_tie, len(a_subs), b_tie, len(b_subs), flagged,
            )
            return ConsensusResult(
                status=ConsensusStatus.REACHED,
                agreed_result="tie",
                winning_team=None,
                is_cross_validated=True,
                total_players=len(submissions),
                agreeing_players=a_tie + b_tie,
                flagged_wallets=flagged,
                submissions=submissions,
            )

        # Both teams confirmed — strongest signal
        if a_maj_victory and b_maj_defeat:
            flagged = [
                s.wallet_address for s in submissions
                if s.wallet_address in self._team_a and s.result != "victory"
            ] + [
                s.wallet_address for s in submissions
                if s.wallet_address in self._team_b and s.result != "defeat"
            ]
            log.info(
                "consensus | match=%s REACHED (cross-validated) team_a wins "
                "a_victory=%d/%d b_defeat=%d/%d flagged=%s",
                self.match_id, a_victory, len(a_subs), b_defeat, len(b_subs), flagged,
            )
            return ConsensusResult(
                status=ConsensusStatus.REACHED,
                agreed_result="victory",
                winning_team="team_a",
                is_cross_validated=True,
                total_players=len(submissions),
                agreeing_players=a_victory + b_defeat,
                flagged_wallets=flagged,
                submissions=submissions,
            )

        if a_maj_defeat and b_maj_victory:
            flagged = [
                s.wallet_address for s in submissions
                if s.wallet_address in self._team_a and s.result != "defeat"
            ] + [
                s.wallet_address for s in submissions
                if s.wallet_address in self._team_b and s.result != "victory"
            ]
            log.info(
                "consensus | match=%s REACHED (cross-validated) team_b wins "
                "a_defeat=%d/%d b_victory=%d/%d flagged=%s",
                self.match_id, a_defeat, len(a_subs), b_victory, len(b_subs), flagged,
            )
            return ConsensusResult(
                status=ConsensusStatus.REACHED,
                agreed_result="defeat",
                winning_team="team_b",
                is_cross_validated=True,
                total_players=len(submissions),
                agreeing_players=a_defeat + b_victory,
                flagged_wallets=flagged,
                submissions=submissions,
            )

        # Single-team fallback: losing team never submitted
        # Accept once ALL of the winning team's expected seats are filled.
        expected_per_team = self.expected_players // 2 or 1

        if a_maj_victory and len(a_subs) >= expected_per_team and len(b_subs) == 0:
            log.warning(
                "consensus | match=%s REACHED (team_a only — team_b never submitted)",
                self.match_id,
            )
            return ConsensusResult(
                status=ConsensusStatus.REACHED,
                agreed_result="victory",
                winning_team="team_a",
                is_cross_validated=False,
                total_players=len(submissions),
                agreeing_players=a_victory,
                flagged_wallets=[],
                submissions=submissions,
            )

        if b_maj_victory and len(b_subs) >= expected_per_team and len(a_subs) == 0:
            log.warning(
                "consensus | match=%s REACHED (team_b only — team_a never submitted)",
                self.match_id,
            )
            return ConsensusResult(
                status=ConsensusStatus.REACHED,
                agreed_result="victory",
                winning_team="team_b",
                is_cross_validated=False,
                total_players=len(submissions),
                agreeing_players=b_victory,
                flagged_wallets=[],
                submissions=submissions,
            )

        log.debug(
            "consensus | match=%s PENDING cross-team "
            "a_victory=%d a_defeat=%d b_victory=%d b_defeat=%d",
            self.match_id, a_victory, a_defeat, b_victory, b_defeat,
        )
        return ConsensusResult(
            status=ConsensusStatus.PENDING,
            agreed_result=None,
            winning_team=None,
            is_cross_validated=False,
            total_players=len(submissions),
            agreeing_players=0,
            flagged_wallets=[],
            submissions=submissions,
        )

    # ------------------------------------------------------------------ #
    #  Majority fallback (no team wallets configured)                     #
    # ------------------------------------------------------------------ #

    def _evaluate_majority(self, submissions: list[PlayerSubmission]) -> ConsensusResult:
        """
        75 % majority across all submissions.  Used only when team wallets are
        not available — e.g. legacy callers or unit tests without team info.
        """
        total = len(submissions)
        vote_counts: dict[str, int] = {}
        for sub in submissions:
            key = sub.result or "unknown"
            vote_counts[key] = vote_counts.get(key, 0) + 1

        majority_result = max(vote_counts, key=lambda k: vote_counts[k])
        majority_count  = vote_counts[majority_result]
        fraction        = majority_count / total

        if fraction >= CONSENSUS_THRESHOLD:
            flagged = [
                s.wallet_address for s in submissions
                if (s.result or "unknown") != majority_result
            ]
            agreed = majority_result if majority_result != "unknown" else None
            log.info(
                "consensus | match=%s REACHED (majority) result=%s %d/%d flagged=%s",
                self.match_id, agreed, majority_count, total, flagged,
            )
            return ConsensusResult(
                status=ConsensusStatus.REACHED,
                agreed_result=agreed,
                winning_team=None,       # team unknown without wallet sets
                is_cross_validated=False,
                total_players=total,
                agreeing_players=majority_count,
                flagged_wallets=flagged,
                submissions=submissions,
            )

        log.warning(
            "consensus | match=%s FAILED majority result=%s %d/%d (need %.0f%%)",
            self.match_id, majority_result, majority_count, total,
            CONSENSUS_THRESHOLD * 100,
        )
        return ConsensusResult(
            status=ConsensusStatus.FAILED,
            agreed_result=None,
            winning_team=None,
            is_cross_validated=False,
            total_players=total,
            agreeing_players=majority_count,
            flagged_wallets=[],
            submissions=submissions,
        )

    # ------------------------------------------------------------------ #
    #  DB persistence                                                      #
    # ------------------------------------------------------------------ #

    def _persist_submission(self, sub: PlayerSubmission) -> None:
        try:
            from sqlalchemy import text as _text
            import uuid as _uuid

            with self._session_factory() as session:
                # Acquire a pg_advisory_xact_lock keyed on the match_id hash so
                # concurrent submissions for the same match serialise here rather
                # than at the ON CONFLICT clause.  This prevents a race where two
                # threads both pass evaluate() before either has committed.
                # The lock is released automatically when the transaction ends.
                session.execute(
                    _text("SELECT pg_advisory_xact_lock(hashtext(:mid))"),
                    {"mid": self.match_id},
                )
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
                    "consensus | persisted: match=%s wallet=%s result=%s",
                    self.match_id, sub.wallet_address, sub.result,
                )
        except Exception as exc:
            log.error(
                "consensus | DB persist failed (non-fatal): match=%s wallet=%s error=%s",
                self.match_id, sub.wallet_address, exc,
            )

    def _restore_from_db(self) -> None:
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
                    continue
                self._submissions[wallet] = PlayerSubmission(
                    wallet_address=wallet,
                    result=result,
                    confidence=float(confidence),
                    players=list(players) if players else [],
                    agents=list(agents)   if agents  else [],
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
                "consensus | DB restore failed (non-fatal): match=%s error=%s",
                self.match_id, exc,
            )

    # ------------------------------------------------------------------ #
    #  Internal helpers                                                    #
    # ------------------------------------------------------------------ #

    def _current_status(self) -> ConsensusStatus:
        """
        In cross-team mode: evaluate eagerly on every submission — we may
        reach consensus before all players have submitted (e.g. if the losing
        team submits defeat screenshots faster than the winning team).
        In majority mode: wait until expected_players have submitted.
        """
        if self._team_a and self._team_b:
            return self.evaluate().status

        if not self.is_complete():
            return ConsensusStatus.PENDING
        return self.evaluate().status
