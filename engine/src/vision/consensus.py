"""
ARENA Engine — Match Consensus Validator
Collects VisionEngine results from all players in a match and decides
the official outcome. Flags any player whose reported result contradicts
the majority.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

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
    result: Optional[str]          # e.g. "CT_WIN", "T_WIN", None
    confidence: float
    players: list[str]
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
    def __init__(self, match_id: str, expected_players: int = 10):
        self.match_id = match_id
        self.expected_players = expected_players
        self._submissions: dict[str, PlayerSubmission] = {}  # wallet → submission
        log.info("consensus | match=%s expecting %d players", match_id, expected_players)

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    def submit(self, wallet_address: str, output: VisionEngineOutput) -> ConsensusStatus:
        """
        Called by watcher.py when a player's StateMachine reaches CONFIRMED.
        Returns current ConsensusStatus so the caller knows whether to wait.
        """
        if wallet_address in self._submissions:
            log.warning("consensus | match=%s duplicate submission from %s — ignored",
                        self.match_id, wallet_address)
            return self._current_status()

        sub = PlayerSubmission(
            wallet_address=wallet_address,
            result=output.result,
            confidence=output.confidence,
            players=output.players,
        )
        self._submissions[wallet_address] = sub
        log.info("consensus | match=%s player=%s result=%s confidence=%.0f%% (%d/%d received)",
                 self.match_id, wallet_address, output.result,
                 output.confidence * 100, len(self._submissions), self.expected_players)

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

        # Find the majority result
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
    #  Internal                                                            #
    # ------------------------------------------------------------------ #

    def _current_status(self) -> ConsensusStatus:
        if not self.is_complete():
            return ConsensusStatus.PENDING
        result = self.evaluate()
        return result.status
