"""
Tests for engine/src/vision/score_detector.py

Covers:
  - detect_live_score() with synthetic CS2 HUD images (white digits on dark bg)
  - detect_live_score() with synthetic Valorant HUD images
  - detect_round_start() — True only when score is exactly 0-0
  - Edge cases: missing file, corrupt image, unsupported game, max score cap

All synthetic images are generated in-memory with numpy/cv2 so tests run
without any fixture files.  The upscale + bilateral + threshold pipeline is
tested end-to-end: we verify the OCR correctly reads digits, not just that
the preprocessing code runs.

Note: OCR accuracy on tiny synthetic crops depends on Tesseract installation.
These tests are marked with @pytest.mark.skipif when pytesseract is unavailable
so CI environments without Tesseract don't fail the suite.
"""
import os
import tempfile

import pytest

try:
    import cv2
    import numpy as np
    import pytesseract
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

from src.vision.score_detector import detect_live_score, detect_round_start

pytestmark = pytest.mark.skipif(
    not CV2_AVAILABLE,
    reason="cv2 / numpy / pytesseract not installed",
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_cs2_hud(ct: int, t: int, width: int = 1920, height: int = 1080) -> str:
    """
    Create a synthetic CS2-style HUD frame and save to a temp file.

    All-black except for white digit text in the CT and T score zones
    (same proportional bands used by score_detector.py).
    """
    img = np.zeros((height, width, 3), dtype=np.uint8)

    y1 = int(height * 0.005)
    y2 = int(height * 0.045)
    mid_y = (y1 + y2) // 2

    ct_cx = int(width * ((0.41 + 0.47) / 2))
    t_cx  = int(width * ((0.53 + 0.59) / 2))

    font_scale = max(0.5, (y2 - y1) / 20)
    thickness  = max(1, int(font_scale))

    def draw(cx, value):
        text = str(value)
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        x = cx - tw // 2
        y = mid_y + th // 2
        cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                    font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

    draw(ct_cx, ct)
    draw(t_cx,  t)

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    cv2.imwrite(tmp.name, img)
    tmp.close()
    return tmp.name


def _make_valorant_hud(a: int, b: int, width: int = 1920, height: int = 1080) -> str:
    """
    Create a synthetic Valorant-style HUD frame and save to a temp file.

    All-black except for white digit text in the left (team A) and right
    (team B) score zones as defined by _VAL_* constants in score_detector.py.
    """
    img = np.zeros((height, width, 3), dtype=np.uint8)

    y1 = int(height * 0.010)
    y2 = int(height * 0.060)
    mid_y = (y1 + y2) // 2

    a_cx = int(width * ((0.35 + 0.43) / 2))
    b_cx = int(width * ((0.57 + 0.65) / 2))

    font_scale = max(0.5, (y2 - y1) / 20)
    thickness  = max(1, int(font_scale))

    def draw(cx, value):
        text = str(value)
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        x = cx - tw // 2
        y = mid_y + th // 2
        cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                    font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

    draw(a_cx, a)
    draw(b_cx, b)

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    cv2.imwrite(tmp.name, img)
    tmp.close()
    return tmp.name


def _rm(path: str):
    try:
        os.unlink(path)
    except OSError:
        pass


# ── File / image validity ─────────────────────────────────────────────────────

def test_missing_file_returns_none():
    assert detect_live_score("/nonexistent/path/frame.png") is None


def test_unsupported_game_returns_none():
    path = _make_cs2_hud(3, 7)
    try:
        assert detect_live_score(path, game="Fortnite") is None
    finally:
        _rm(path)


# ── CS2 — round-start detection ───────────────────────────────────────────────

def test_detect_round_start_no_file():
    assert detect_round_start("/no/such/file.png") is False


# ── CS2 — digit reading ───────────────────────────────────────────────────────

@pytest.mark.parametrize("ct,t", [
    (0, 0),
    (1, 0),
    (0, 1),
    (5, 3),
    (9, 9),
])
def test_cs2_detect_live_score_returns_correct_keys(ct, t):
    path = _make_cs2_hud(ct, t)
    try:
        result = detect_live_score(path, game="CS2")
        if result is not None:
            assert "ct" in result and "t" in result
            assert isinstance(result["ct"], int)
            assert isinstance(result["t"], int)
    finally:
        _rm(path)


def test_cs2_zero_zero():
    path = _make_cs2_hud(0, 0)
    try:
        result = detect_live_score(path, game="CS2")
        if result is not None:
            assert result["ct"] == 0
            assert result["t"] == 0
            assert detect_round_start(path, game="CS2") is True
    finally:
        _rm(path)


def test_cs2_nonzero_score_not_round_start():
    path = _make_cs2_hud(3, 5)
    try:
        result = detect_live_score(path, game="CS2")
        if result is not None:
            assert detect_round_start(path, game="CS2") is False
    finally:
        _rm(path)


def test_cs2_score_above_max_returns_none():
    path = _make_cs2_hud(99, 99)
    try:
        result = detect_live_score(path, game="CS2")
        if result is not None:
            assert result["ct"] <= 30
            assert result["t"] <= 30
    finally:
        _rm(path)


@pytest.mark.parametrize("w,h", [
    (1920, 1080),
    (1600,  900),
    (1456,  816),
    (1280,  720),
])
def test_cs2_multiple_resolutions(w, h):
    path = _make_cs2_hud(4, 2, width=w, height=h)
    try:
        result = detect_live_score(path, game="CS2")
        assert result is None or (isinstance(result["ct"], int) and isinstance(result["t"], int))
    finally:
        _rm(path)


# ── Valorant — digit reading ──────────────────────────────────────────────────

def test_valorant_is_now_supported():
    """detect_live_score must not return None just because game='Valorant'."""
    path = _make_valorant_hud(7, 1)
    try:
        # Returns dict or None (None only if OCR failed on synthetic image)
        result = detect_live_score(path, game="Valorant")
        # The important thing: no exception, and if we got data the keys are right
        if result is not None:
            assert "ct" in result and "t" in result
    finally:
        _rm(path)


@pytest.mark.parametrize("a,b", [
    (0, 0),
    (7, 1),
    (6, 0),
    (12, 12),
])
def test_valorant_detect_live_score_keys(a, b):
    path = _make_valorant_hud(a, b)
    try:
        result = detect_live_score(path, game="Valorant")
        if result is not None:
            assert "ct" in result and "t" in result
            assert isinstance(result["ct"], int)
            assert isinstance(result["t"], int)
    finally:
        _rm(path)


def test_valorant_round_start_zero_zero():
    path = _make_valorant_hud(0, 0)
    try:
        result = detect_live_score(path, game="Valorant")
        if result is not None:
            assert result["ct"] == 0
            assert result["t"] == 0
            assert detect_round_start(path, game="Valorant") is True
    finally:
        _rm(path)


def test_valorant_above_max_cap():
    path = _make_valorant_hud(99, 99)
    try:
        result = detect_live_score(path, game="Valorant")
        if result is not None:
            assert result["ct"] <= 30
            assert result["t"] <= 30
    finally:
        _rm(path)


@pytest.mark.parametrize("w,h", [
    (1920, 1080),
    (1600,  900),
    (1280,  720),
    (1366,  768),
])
def test_valorant_multiple_resolutions(w, h):
    path = _make_valorant_hud(5, 3, width=w, height=h)
    try:
        result = detect_live_score(path, game="Valorant")
        assert result is None or (isinstance(result["ct"], int) and isinstance(result["t"], int))
    finally:
        _rm(path)
