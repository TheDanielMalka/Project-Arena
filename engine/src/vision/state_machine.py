from __future__ import annotations
from enum import Enum
from typing import Optional
from src.vision.engine import VisionEngineOutput


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
            return self.state

        if output.result != self._last_result:
            self._last_result = output.result
            self._consecutive = 1
            self.state = MatchState.DETECTED
            return self.state

        self._consecutive += 1

        if self._consecutive >= self.confirmations_required:
            self.state = MatchState.CONFIRMED
            self.confirmed_output = output
        else:
            self.state = MatchState.DETECTED

        return self.state

    def mark_reported(self):
        self.state = MatchState.REPORTED

    def reset(self):
        self._reset()

    def _reset(self):
        self.state = MatchState.WAITING
        self._consecutive = 0
        self._last_result = None
        self.confirmed_output = None
