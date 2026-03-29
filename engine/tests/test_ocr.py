import os
import sys
import cv2
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.vision.ocr import extract_text, extract_player_names, extract_agents, extract_score


def test_missing_image():

    result = extract_text("not_exists.jpg")
    assert result is None


def test_extract_text_clean_image(tmp_path):

    img = np.ones((200, 600, 3), dtype=np.uint8) * 255
    cv2.putText(img, "FOSTER", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
    cv2.putText(img, "nezzik", (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)

    img_path = str(tmp_path / "clean.png")
    cv2.imwrite(img_path, img)

    result = extract_text(img_path, region=(0, 0, 600, 200))
    assert result is not None
    assert len(result) > 0


def test_extract_player_names_clean(tmp_path):

    img = np.ones((200, 600, 3), dtype=np.uint8) * 255
    cv2.putText(img, "FOSTER", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
    cv2.putText(img, "nezzik", (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)

    img_path = str(tmp_path / "players.png")
    cv2.imwrite(img_path, img)

    names = extract_player_names(img_path, region=(0, 0, 600, 200))
    assert len(names) >= 1


def test_extract_text_logs_elapsed_for_missing_image(caplog):
    caplog.set_level("INFO", logger="vision.ocr")

    result = extract_text("not_exists.jpg")

    assert result is None
    assert "extract_text elapsed:" in caplog.text


# ── extract_player_names dispatcher tests ─────────────────────────────────────

def test_extract_player_names_defaults_to_cs2(tmp_path):
    """
    Calling extract_player_names() with no `game` arg must behave identically
    to game='CS2' — returns a list (possibly empty on synthetic image).
    """
    img = np.ones((200, 600, 3), dtype=np.uint8) * 255
    cv2.putText(img, "PLAYER1", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
    img_path = str(tmp_path / "cs2_default.png")
    cv2.imwrite(img_path, img)

    result_default  = extract_player_names(img_path, region=(0, 0, 600, 200))
    result_explicit = extract_player_names(img_path, region=(0, 0, 600, 200), game="CS2")

    assert isinstance(result_default, list)
    assert result_default == result_explicit


def test_extract_player_names_valorant_returns_list(tmp_path):
    """
    extract_player_names(..., game='Valorant') must always return a list
    (possibly empty) — never None or raise.
    Uses a synthetic white-text-on-dark image in the Valorant player-row
    region (50-61 % of height).
    """
    # 1080p-like dimensions so percentage regions are meaningful
    h, w = 400, 800
    img = np.zeros((h, w, 3), dtype=np.uint8)  # dark background
    # Place white text roughly at y 50-61 % of 400 = y 200-244
    cv2.putText(img, "BOASTER DOMA TSACK", (10, 230),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    img_path = str(tmp_path / "val_players.png")
    cv2.imwrite(img_path, img)

    result = extract_player_names(img_path, game="Valorant")

    assert isinstance(result, list)


def test_extract_player_names_valorant_missing_file():
    """extract_player_names with game='Valorant' on a missing file -> []."""
    result = extract_player_names("not_exists.png", game="Valorant")
    assert result == []


# ── extract_agents tests ──────────────────────────────────────────────────────

def test_extract_agents_returns_list(tmp_path):
    """
    extract_agents() must always return a list — never None or raise.
    Uses a synthetic white-text image in the Valorant agent-row region
    (42-51 % of height).
    """
    h, w = 400, 800
    img = np.zeros((h, w, 3), dtype=np.uint8)
    # y 42-51 % of 400 = y 168-204
    cv2.putText(img, "JETT SAGE BRIMSTONE OMEN PHOENIX", (10, 190),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    img_path = str(tmp_path / "val_agents.png")
    cv2.imwrite(img_path, img)

    result = extract_agents(img_path)

    assert isinstance(result, list)


def test_extract_agents_missing_file():
    """extract_agents on a missing file must return [] without raising."""
    result = extract_agents("not_exists.png")
    assert result == []


def test_extract_agents_accepts_custom_region(tmp_path):
    """extract_agents respects a caller-supplied region crop."""
    img = np.ones((200, 600, 3), dtype=np.uint8) * 255
    cv2.putText(img, "JETT", (30, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
    img_path = str(tmp_path / "val_agents_region.png")
    cv2.imwrite(img_path, img)

    # Passing an explicit region must not raise and must return a list
    result = extract_agents(img_path, region=(0, 0, 600, 200))
    assert isinstance(result, list)


# ── extract_score dispatcher tests ───────────────────────────────────────────

def test_extract_score_defaults_to_cs2(tmp_path):
    """
    extract_score() with no `game` arg must behave identically to game='CS2'.
    Both calls on the same image must return the same value.
    """
    img = np.ones((200, 600, 3), dtype=np.uint8) * 255
    cv2.putText(img, "13-11", (200, 100), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 3)
    img_path = str(tmp_path / "score_cs2.png")
    cv2.imwrite(img_path, img)

    result_default  = extract_score(img_path, region=(0, 0, 600, 200))
    result_explicit = extract_score(img_path, region=(0, 0, 600, 200), game="CS2")

    # Both should agree (value may be None if Tesseract not installed in CI)
    assert result_default == result_explicit


def test_extract_score_valorant_missing_file():
    """extract_score with game='Valorant' on a missing file -> None."""
    result = extract_score("not_exists.png", game="Valorant")
    assert result is None


def test_extract_score_valorant_returns_string_or_none(tmp_path):
    """
    extract_score(..., game='Valorant') must return either a string (score)
    or None — never raise on a valid image file.
    """
    h, w = 300, 800
    img = np.zeros((h, w, 3), dtype=np.uint8)
    # Draw "13" at left corner (~x 4-18 %, y 2-13 % of 300 = y 6-39)
    cv2.putText(img, "13", (35, 35), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    # Draw "11" at right corner (~x 82-96 %, y same)
    cv2.putText(img, "11", (660, 35), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    img_path = str(tmp_path / "val_score.png")
    cv2.imwrite(img_path, img)

    result = extract_score(img_path, game="Valorant")

    assert result is None or isinstance(result, str)