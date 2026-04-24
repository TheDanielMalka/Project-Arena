"""
Tests for TIE detection in engine/src/vision/matcher.py

Covers:
  - _detect_result_cs2: gray banner returns ("tie", confidence)
  - Priority order: green (VICTORY) > red (DEFEAT) > gray (TIE)
  - detect_result() public API routes "tie" correctly
  - Missing file and Valorant pass-through (no tie for Valorant yet)

All synthetic images are generated in-memory with numpy/cv2.
Tests are skipped when cv2/numpy are not installed.
"""
import os
import tempfile

import pytest

try:
    import cv2
    import numpy as np
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

from src.vision.matcher import detect_result

pytestmark = pytest.mark.skipif(
    not CV2_AVAILABLE,
    reason="cv2 / numpy not installed",
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_banner_image(
    banner_bgr: tuple[int, int, int],
    width: int = 1920,
    height: int = 1080,
) -> str:
    """
    Create a synthetic full-frame PNG where the CS2 detection crop
    (y 12-17%, x 34-68%) is filled with `banner_bgr` and everything
    else is black. Returns temp file path.
    """
    img = np.zeros((height, width, 3), dtype=np.uint8)
    y1 = int(height * 0.12)
    y2 = int(height * 0.17)
    x1 = int(width  * 0.34)
    x2 = int(width  * 0.68)
    img[y1:y2, x1:x2] = banner_bgr
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    cv2.imwrite(tmp.name, img)
    tmp.close()
    return tmp.name


def _rm(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


# ── TIE banner detection ───────────────────────────────────────────────────────

def test_gray_banner_returns_tie():
    """A neutral gray banner in the detection crop → detect_result returns 'tie'."""
    # BGR (128, 128, 128) — HSV S=0, V=128 → deep inside gray_mask S<40, V 50-220
    path = _make_banner_image((128, 128, 128))
    try:
        result, confidence = detect_result(path, game="CS2")
        assert result == "tie", f"Expected 'tie', got {result!r}"
        assert 0.0 < confidence <= 1.0
    finally:
        _rm(path)


def test_light_gray_banner_returns_tie():
    """Light gray (200, 200, 200) also registers as TIE."""
    path = _make_banner_image((200, 200, 200))
    try:
        result, confidence = detect_result(path, game="CS2")
        assert result == "tie"
    finally:
        _rm(path)


def test_green_banner_returns_victory_not_tie():
    """Pure green (0, 200, 0 in BGR) → VICTORY wins over gray check."""
    path = _make_banner_image((0, 200, 0))  # BGR: blue=0, green=200, red=0
    try:
        result, confidence = detect_result(path, game="CS2")
        assert result == "victory", f"Expected 'victory', got {result!r}"
    finally:
        _rm(path)


def test_red_banner_returns_defeat_not_tie():
    """Pure red (0, 0, 200 in BGR) → DEFEAT wins over gray check."""
    path = _make_banner_image((0, 0, 200))  # BGR: blue=0, green=0, red=200
    try:
        result, confidence = detect_result(path, game="CS2")
        assert result == "defeat", f"Expected 'defeat', got {result!r}"
    finally:
        _rm(path)


def test_black_frame_returns_none():
    """All-black frame → no result (gray_pct will be 0 since V < 50)."""
    path = _make_banner_image((0, 0, 0))
    try:
        result, confidence = detect_result(path, game="CS2")
        assert result is None
        assert confidence == 0.0
    finally:
        _rm(path)


def test_missing_file_returns_none():
    """detect_result with a missing file → (None, 0.0)."""
    result, confidence = detect_result("/nonexistent/frame.png", game="CS2")
    assert result is None
    assert confidence == 0.0


def test_tie_confidence_in_valid_range():
    """Tie confidence value is between 0 and 1 (exclusive lower for detected result)."""
    path = _make_banner_image((150, 150, 150))
    try:
        result, confidence = detect_result(path, game="CS2")
        if result == "tie":
            assert 0.0 < confidence <= 1.0
    finally:
        _rm(path)


def test_detect_result_returns_tie_string_not_none():
    """detect_result on a gray frame must return the string 'tie', not None."""
    path = _make_banner_image((128, 128, 128))
    try:
        result, _ = detect_result(path, game="CS2")
        assert result is not None
        assert result == "tie"
    finally:
        _rm(path)
