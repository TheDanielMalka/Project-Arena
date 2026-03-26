import pytest
from src.vision.state_machine import StateMachine, MatchState
from src.vision.engine import VisionEngineOutput


# ─── helpers ────────────────────────────────────────────────────────────────

def make_output(accepted: bool, result="victory", confidence=0.95) -> VisionEngineOutput:
    return VisionEngineOutput(
        result=result,
        confidence=confidence,
        players=["player1", "player2"],
        accepted=accepted,
    )


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def sm():
    return StateMachine(confirmations_required=3)


# ─── tests ───────────────────────────────────────────────────────────────────

class TestInitialState:

    def test_starts_at_waiting(self, sm):
        assert sm.state == MatchState.WAITING

    def test_no_confirmed_output_initially(self, sm):
        assert sm.confirmed_output is None


class TestDetected:

    def test_first_accepted_frame_moves_to_detected(self, sm):
        sm.update(make_output(accepted=True))
        assert sm.state == MatchState.DETECTED

    def test_two_consecutive_stays_detected(self, sm):
        sm.update(make_output(accepted=True))
        sm.update(make_output(accepted=True))
        assert sm.state == MatchState.DETECTED


class TestConfirmed:

    def test_three_consecutive_moves_to_confirmed(self, sm):
        for _ in range(3):
            sm.update(make_output(accepted=True))
        assert sm.state == MatchState.CONFIRMED

    def test_confirmed_output_is_set(self, sm):
        output = make_output(accepted=True)
        for _ in range(3):
            sm.update(output)
        assert sm.confirmed_output is not None
        assert sm.confirmed_output.result == "victory"


class TestReset:

    def test_low_confidence_resets_to_waiting(self, sm):
        sm.update(make_output(accepted=True))
        sm.update(make_output(accepted=False))
        assert sm.state == MatchState.WAITING

    def test_result_change_resets_counter(self, sm):
        sm.update(make_output(accepted=True, result="victory"))
        sm.update(make_output(accepted=True, result="victory"))
        sm.update(make_output(accepted=True, result="defeat"))  # result changed — resets to DETECTED
        assert sm.state == MatchState.DETECTED

    def test_manual_reset_returns_to_waiting(self, sm):
        for _ in range(3):
            sm.update(make_output(accepted=True))
        sm.reset()
        assert sm.state == MatchState.WAITING
        assert sm.confirmed_output is None


class TestReported:

    def test_mark_reported_after_confirmed(self, sm):
        for _ in range(3):
            sm.update(make_output(accepted=True))
        sm.mark_reported()
        assert sm.state == MatchState.REPORTED

    def test_reported_ignores_new_frames(self, sm):
        for _ in range(3):
            sm.update(make_output(accepted=True))
        sm.mark_reported()
        sm.update(make_output(accepted=True))
        assert sm.state == MatchState.REPORTED


class TestLogging:

    def test_logs_detected_on_first_accepted_frame(self, sm, caplog):
        caplog.set_level("INFO", logger="vision.state_machine")
        sm.update(make_output(accepted=True, result="victory"))
        assert "DETECTED" in caplog.text
        assert "victory" in caplog.text

    def test_logs_confirmed_after_three_consecutive(self, sm, caplog):
        caplog.set_level("INFO", logger="vision.state_machine")
        for _ in range(3):
            sm.update(make_output(accepted=True, result="victory"))
        assert "CONFIRMED" in caplog.text

    def test_logs_waiting_on_low_confidence(self, sm, caplog):
        caplog.set_level("INFO", logger="vision.state_machine")
        sm.update(make_output(accepted=True))
        sm.update(make_output(accepted=False))
        assert "WAITING" in caplog.text

    def test_logs_reported_on_mark_reported(self, sm, caplog):
        caplog.set_level("INFO", logger="vision.state_machine")
        for _ in range(3):
            sm.update(make_output(accepted=True))
        sm.mark_reported()
        assert "REPORTED" in caplog.text
