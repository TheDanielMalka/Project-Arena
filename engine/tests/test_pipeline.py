"""
Integration tests for the full detection pipeline.
Tests the complete flow: image → VisionEngine.process_frame() → StateMachine.update() → CONFIRMED
Uses synthetic images (pure green / pure red) that work in CI without evidence files.
"""
import os
import cv2
import numpy as np
import pytest
from src.vision.engine import VisionEngine, VisionEngineConfig
from src.vision.state_machine import StateMachine, MatchState


def make_synthetic_image(color: str, path: str):
    """Create a 400x300 image filled with the given color and save to path."""
    img = np.zeros((300, 400, 3), dtype=np.uint8)
    if color == "green":
        img[:] = (0, 200, 0)   # BGR green — detected as victory
    elif color == "red":
        img[:] = (0, 0, 200)   # BGR red — detected as defeat
    cv2.imwrite(path, img)
    return path


@pytest.fixture(scope="module")
def victory_image(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("imgs") / "victory.png")
    return make_synthetic_image("green", path)


@pytest.fixture(scope="module")
def defeat_image(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("imgs") / "defeat.png")
    return make_synthetic_image("red", path)


@pytest.fixture
def engine():
    return VisionEngine(config=VisionEngineConfig(confidence_threshold=0.8, cooldown_seconds=0))


@pytest.fixture
def sm():
    return StateMachine(confirmations_required=3)


class TestFullPipeline:

    def test_victory_image_accepted_by_engine(self, engine, victory_image):
        result = engine.process_frame(victory_image)
        assert result.accepted == True
        assert result.result == "victory"
        assert result.confidence >= 0.8

    def test_defeat_image_accepted_by_engine(self, engine, defeat_image):
        result = engine.process_frame(defeat_image)
        assert result.accepted == True
        assert result.result == "defeat"
        assert result.confidence >= 0.8

    def test_three_victory_frames_reach_confirmed(self, engine, sm, victory_image):
        for _ in range(3):
            output = engine.process_frame(victory_image)
            sm.update(output)
        assert sm.state == MatchState.CONFIRMED
        assert sm.confirmed_output.result == "victory"

    def test_three_defeat_frames_reach_confirmed(self, engine, sm, defeat_image):
        for _ in range(3):
            output = engine.process_frame(defeat_image)
            sm.update(output)
        assert sm.state == MatchState.CONFIRMED
        assert sm.confirmed_output.result == "defeat"

    def test_mixed_frames_do_not_confirm(self, engine, sm, victory_image, defeat_image):
        sm.update(engine.process_frame(victory_image))
        sm.update(engine.process_frame(victory_image))
        sm.update(engine.process_frame(defeat_image))
        assert sm.state != MatchState.CONFIRMED

    def test_confirmed_then_reported(self, engine, sm, victory_image):
        for _ in range(3):
            sm.update(engine.process_frame(victory_image))
        sm.mark_reported()
        assert sm.state == MatchState.REPORTED

    def test_reported_ignores_further_frames(self, engine, sm, victory_image):
        for _ in range(3):
            sm.update(engine.process_frame(victory_image))
        sm.mark_reported()
        sm.update(engine.process_frame(victory_image))
        assert sm.state == MatchState.REPORTED
