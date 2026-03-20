"""
Integration tests for the full detection pipeline.
Tests the complete flow: image → VisionEngine.process_frame() → StateMachine.update() → CONFIRMED
No mocks — runs on real evidence images.
"""
import os
import pytest
from src.vision.engine import VisionEngine, VisionEngineConfig
from src.vision.state_machine import StateMachine, MatchState

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "evidence")
VICTORY_IMAGE = os.path.join(EVIDENCE_DIR, "2026-03-09_175550_victory_1.0.png")
DEFEAT_IMAGE  = os.path.join(EVIDENCE_DIR, "2026-03-09_175550_defeat_1.0.png")


@pytest.fixture
def engine():
    return VisionEngine(config=VisionEngineConfig(confidence_threshold=0.8, cooldown_seconds=0))


@pytest.fixture
def sm():
    return StateMachine(confirmations_required=3)


class TestFullPipeline:

    def test_victory_image_accepted_by_engine(self, engine):
        result = engine.process_frame(VICTORY_IMAGE)
        assert result.accepted == True
        assert result.result == "victory"
        assert result.confidence >= 0.8

    def test_defeat_image_accepted_by_engine(self, engine):
        result = engine.process_frame(DEFEAT_IMAGE)
        assert result.accepted == True
        assert result.result == "defeat"
        assert result.confidence >= 0.8

    def test_three_victory_frames_reach_confirmed(self, engine, sm):
        for _ in range(3):
            output = engine.process_frame(VICTORY_IMAGE)
            sm.update(output)
        assert sm.state == MatchState.CONFIRMED
        assert sm.confirmed_output.result == "victory"

    def test_three_defeat_frames_reach_confirmed(self, engine, sm):
        for _ in range(3):
            output = engine.process_frame(DEFEAT_IMAGE)
            sm.update(output)
        assert sm.state == MatchState.CONFIRMED
        assert sm.confirmed_output.result == "defeat"

    def test_mixed_frames_do_not_confirm(self, engine, sm):
        sm.update(engine.process_frame(VICTORY_IMAGE))
        sm.update(engine.process_frame(VICTORY_IMAGE))
        sm.update(engine.process_frame(DEFEAT_IMAGE))
        assert sm.state != MatchState.CONFIRMED

    def test_confirmed_then_reported(self, engine, sm):
        for _ in range(3):
            sm.update(engine.process_frame(VICTORY_IMAGE))
        sm.mark_reported()
        assert sm.state == MatchState.REPORTED

    def test_reported_ignores_further_frames(self, engine, sm):
        for _ in range(3):
            sm.update(engine.process_frame(VICTORY_IMAGE))
        sm.mark_reported()
        sm.update(engine.process_frame(VICTORY_IMAGE))
        assert sm.state == MatchState.REPORTED
