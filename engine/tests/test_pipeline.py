"""
Integration tests for the full detection pipeline.

Tests the complete flow:
  image → VisionEngine.process_frame() → StateMachine.update() → CONFIRMED

Uses synthetic images (pure colour fills) that work in CI without real
game screenshots or Tesseract producing meaningful text.

Covers both CS2 and Valorant pipelines.
"""
import os
import cv2
import numpy as np
import pytest
from src.vision.engine import VisionEngine, VisionEngineConfig
from src.vision.state_machine import StateMachine, MatchState


# ── Synthetic image factory ───────────────────────────────────────────────────

def make_synthetic_image(color: str, path: str, size: tuple[int, int] = (300, 400)):
    """
    Create a solid-colour image and save to path.

    Supported colours and their detector mappings:
      "green"       → CS2 VICTORY   (BGR 0,200,0   — HSV H≈60, in CS2 green range 35-85)
      "red"         → CS2 DEFEAT    (BGR 0,0,200   — HSV H≈0, in CS2 red range 0-10)
      "teal"        → VAL VICTORY   (BGR 200,200,0 — HSV H≈90, in Valorant teal range 75-100)
      "blue_purple" → VAL DEFEAT    (BGR 200,0,0   — HSV H≈120, in Valorant range 110-145)
    """
    h, w = size
    img = np.zeros((h, w, 3), dtype=np.uint8)
    colour_map = {
        "green":       (0,   200, 0),    # CS2 VICTORY
        "red":         (0,   0,   200),  # CS2 DEFEAT
        "teal":        (200, 200, 0),    # Valorant VICTORY
        "blue_purple": (200, 0,   0),    # Valorant DEFEAT
    }
    img[:] = colour_map[color]
    cv2.imwrite(path, img)
    return path


# ── CS2 fixtures ──────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def victory_image(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("cs2") / "cs2_victory.png")
    return make_synthetic_image("green", path)


@pytest.fixture(scope="module")
def defeat_image(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("cs2") / "cs2_defeat.png")
    return make_synthetic_image("red", path)


@pytest.fixture
def engine():
    """CS2 engine — default game, confidence 0.8."""
    return VisionEngine(config=VisionEngineConfig(
        confidence_threshold=0.8,
        cooldown_seconds=0,
        game="CS2",
    ))


@pytest.fixture
def sm():
    return StateMachine(confirmations_required=3)


# ── Valorant fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def val_victory_image(tmp_path_factory):
    """
    800x400 teal image.  The Valorant detector crops y 3-25%, x 20-80%
    = img[12:100, 160:640] — which is entirely teal.
    """
    path = str(tmp_path_factory.mktemp("val") / "val_victory.png")
    return make_synthetic_image("teal", path, size=(400, 800))


@pytest.fixture(scope="module")
def val_defeat_image(tmp_path_factory):
    """800x400 blue-purple image for Valorant defeat detection."""
    path = str(tmp_path_factory.mktemp("val") / "val_defeat.png")
    return make_synthetic_image("blue_purple", path, size=(400, 800))


@pytest.fixture
def val_engine():
    """Valorant engine — game='Valorant', confidence 0.8."""
    return VisionEngine(config=VisionEngineConfig(
        confidence_threshold=0.8,
        cooldown_seconds=0,
        game="Valorant",
    ))


@pytest.fixture
def val_sm():
    return StateMachine(confirmations_required=3)


# ── CS2 pipeline tests (unchanged behaviour) ──────────────────────────────────

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

    # ── VisionEngineOutput new fields (Step 3) ────────────────────────────────

    def test_cs2_output_has_agents_empty(self, engine, victory_image):
        """CS2 engine must always return agents=[] (no agent names in CS2)."""
        output = engine.process_frame(victory_image)
        assert isinstance(output.agents, list)
        assert output.agents == []

    def test_cs2_output_game_field(self, engine, victory_image):
        """output.game must reflect the engine's configured game."""
        output = engine.process_frame(victory_image)
        assert output.game == "CS2"


# ── Valorant pipeline tests ───────────────────────────────────────────────────

class TestValorantPipeline:

    def test_valorant_victory_accepted_by_engine(self, val_engine, val_victory_image):
        """Teal image processed by Valorant engine → accepted victory."""
        output = val_engine.process_frame(val_victory_image)
        assert output.accepted is True
        assert output.result == "victory"
        assert output.confidence >= 0.8

    def test_valorant_defeat_accepted_by_engine(self, val_engine, val_defeat_image):
        """Blue-purple image processed by Valorant engine → accepted defeat."""
        output = val_engine.process_frame(val_defeat_image)
        assert output.accepted is True
        assert output.result == "defeat"
        assert output.confidence >= 0.8

    def test_valorant_output_game_field(self, val_engine, val_victory_image):
        """output.game must be 'Valorant' when the engine is configured for Valorant."""
        output = val_engine.process_frame(val_victory_image)
        assert output.game == "Valorant"

    def test_valorant_output_agents_is_list(self, val_engine, val_victory_image):
        """output.agents must always be a list for Valorant (may be empty in CI)."""
        output = val_engine.process_frame(val_victory_image)
        assert isinstance(output.agents, list)

    def test_valorant_output_players_is_list(self, val_engine, val_victory_image):
        """output.players must always be a list for Valorant."""
        output = val_engine.process_frame(val_victory_image)
        assert isinstance(output.players, list)

    def test_valorant_teal_not_detected_by_cs2_engine(self, engine, val_victory_image):
        """
        Valorant teal image passed to a CS2 engine must NOT be detected
        (colour spaces are intentionally separated).
        """
        output = engine.process_frame(val_victory_image)
        assert output.result is None
        assert output.accepted is False

    def test_three_valorant_victory_frames_reach_confirmed(
        self, val_engine, val_sm, val_victory_image
    ):
        """Full Valorant pipeline: 3 consecutive victories → CONFIRMED."""
        for _ in range(3):
            output = val_engine.process_frame(val_victory_image)
            val_sm.update(output)
        assert val_sm.state == MatchState.CONFIRMED
        assert val_sm.confirmed_output.result == "victory"
        assert val_sm.confirmed_output.game == "Valorant"

    def test_three_valorant_defeat_frames_reach_confirmed(
        self, val_engine, val_sm, val_defeat_image
    ):
        """Full Valorant pipeline: 3 consecutive defeats → CONFIRMED."""
        for _ in range(3):
            output = val_engine.process_frame(val_defeat_image)
            val_sm.update(output)
        assert val_sm.state == MatchState.CONFIRMED
        assert val_sm.confirmed_output.result == "defeat"

    def test_valorant_reported_ignores_further_frames(
        self, val_engine, val_sm, val_victory_image
    ):
        """Once REPORTED, Valorant engine ignores further frames."""
        for _ in range(3):
            val_sm.update(val_engine.process_frame(val_victory_image))
        val_sm.mark_reported()
        val_sm.update(val_engine.process_frame(val_victory_image))
        assert val_sm.state == MatchState.REPORTED
