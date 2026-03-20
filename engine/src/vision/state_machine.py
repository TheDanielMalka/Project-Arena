from __future__ import annotations
import logging
from enum import Enum
from typing import Optional
from src.vision.engine import VisionEngineOutput

log = logging.getLogger("vision.state_machine")


class MatchState(Enum):
    WAITING   = "waiting"
    DETECTED  = "detected"
    CONFIRMED = "confirmed"
    REPORTED  = "reported"


class StateMachine:

    def __init__(self, confirmations_required: int = 3):
        self.state: MatchState = MatchState.WAITING
        self.confirmations_required = confirmations_required
        self._consecutive: int = 0
        self._last_result: Optional[str] = None
        self.confirmed_output: Optional[VisionEngineOutput] = None

    def update(self, output: VisionEngineOutput) -> MatchState:
        if self.state == MatchState.REPORTED:
            return self.state

        if not output.accepted:
            self._reset()
            log.info("state: WAITING (low confidence)")
            return self.state

        if output.result != self._last_result:
            self._last_result = output.result
            self._consecutive = 1
            self.state = MatchState.DETECTED
            log.info("state: DETECTED | result=%s confidence=%.0f%%", output.result, output.confidence * 100)
            return self.state

        self._consecutive += 1

        if self._consecutive >= self.confirmations_required:
            self.state = MatchState.CONFIRMED
            self.confirmed_output = output
            log.info("state: CONFIRMED | result=%s confidence=%.0f%% consecutive=%d",
                     output.result, output.confidence * 100, self._consecutive)
        else:
            self.state = MatchState.DETECTED
            log.info("state: DETECTED | result=%s consecutive=%d/%d",
                     output.result, self._consecutive, self.confirmations_required)

        return self.state

    def mark_reported(self):
        self.state = MatchState.REPORTED
        log.info("state: REPORTED")

    def reset(self):
        self._reset()

    def _reset(self):
        self.state = MatchState.WAITING
        self._consecutive = 0
        self._last_result = None
        self.confirmed_output = None
