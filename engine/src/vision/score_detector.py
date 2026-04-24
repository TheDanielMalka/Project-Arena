"""
CS2 live HUD score detector.

Reads the round score from the CS2 heads-up display during an active match
(not the end-screen).  The CS2 HUD always places the score at the very top
centre of the screen in the same proportional band regardless of map, game
mode (1v1 / 2v2 / 5v5), resolution, or platform (Valve/FaceIt).

Layout (calibrated from real 1920×1080 footage):
  ┌──────────────────────────────────────────────────────────────────────┐
  │  [CT score]   ●  [round timer]  ●   [T score]   ← y 1–4 %          │
  │  (x 41–47%)        (centre)         (x 53–59%)                      │
  └──────────────────────────────────────────────────────────────────────┘

CT score sits slightly left-of-centre; T score sits slightly right-of-centre.
The round timer (mm:ss) sits at the exact centre — we skip that column.

Detection approach:
  1. Crop the two narrow digit columns from the top strip.
  2. Upscale 4× (Tesseract works best with larger text).
  3. Run Tesseract in single-word mode (--psm 8) with digit-only whitelist.
  4. Parse and range-check the resulting integers.

This file is intentionally separate from matcher.py (end-screen) and
ocr.py (player names / agents) to keep each concern isolated.

Public API
----------
detect_live_score(image_path: str, game: str = "CS2")
    → dict[str, int] | None    {"ct": int, "t": int}

detect_round_start(image_path: str, game: str = "CS2")
    → bool                     True when score is exactly 0–0
"""

from __future__ import annotations

import logging
import os
import re

import cv2
import numpy as np
import pytesseract

logger = logging.getLogger("vision.score_detector")

# ── Tesseract path (Windows) ──────────────────────────────────────────────────

def _configure_tesseract() -> None:
    if os.name != "nt":
        return
    for path in (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ):
        if os.path.exists(path):
            pytesseract.pytesseract.tesseract_cmd = path
            return


_configure_tesseract()

# ── CS2 HUD region constants (relative to full frame) ────────────────────────
#
# Calibrated from real 1920×1080 CS2 screenshots across multiple maps and
# match formats.  All values are fractions of frame height/width so they
# scale to any resolution automatically.
#
#   CT side: left column,  x 41–47 %, y 0.5–4.5 %
#   T  side: right column, x 53–59 %, y 0.5–4.5 %
#
# These bands sit ABOVE the VICTORY/DEFEAT detection zone (y 12–17 %) so
# there is zero overlap — a single frame cannot trigger both detectors.

_HUD_Y_START  = 0.005   # top of HUD strip (0.5 % → avoids menu bar chrome)
_HUD_Y_END    = 0.045   # bottom of HUD strip (4.5 %)
_CT_X_START   = 0.41    # CT score column left edge
_CT_X_END     = 0.47    # CT score column right edge
_T_X_START    = 0.53    # T  score column left edge
_T_X_END      = 0.59    # T  score column right edge

_UPSCALE      = 4       # enlargement factor fed to Tesseract
_PSM          = "8"     # single-word mode — best for isolated digits
_WHITELIST    = "0123456789"
_MAX_SCORE    = 30      # sanity cap — no CS2 match reaches 30 rounds

# ── Preprocessing ─────────────────────────────────────────────────────────────

def _prep_digit_crop(crop: np.ndarray) -> np.ndarray:
    """
    Prepare a small BGR crop for digit OCR.

    Pipeline:
      1. Greyscale
      2. 4× upscale (Tesseract strongly prefers larger text)
      3. Bilateral filter (removes noise while keeping digit edges sharp)
      4. Binary threshold at 140 (CS2 score digits are bright on dark HUD)
    """
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    big  = cv2.resize(gray, (gray.shape[1] * _UPSCALE, gray.shape[0] * _UPSCALE),
                      interpolation=cv2.INTER_LANCZOS4)
    filt = cv2.bilateralFilter(big, d=5, sigmaColor=30, sigmaSpace=30)
    _, binary = cv2.threshold(filt, 140, 255, cv2.THRESH_BINARY)
    return binary


def _ocr_digit(binary: np.ndarray) -> int | None:
    """Run Tesseract on a preprocessed digit crop and return int or None."""
    raw = pytesseract.image_to_string(
        binary,
        config=f"--psm {_PSM} -c tessedit_char_whitelist={_WHITELIST}",
    ).strip()
    digits = re.findall(r"\d+", raw)
    if not digits:
        return None
    val = int(digits[0])
    return val if val <= _MAX_SCORE else None


# ── Public API ────────────────────────────────────────────────────────────────

def detect_live_score(image_path: str, game: str = "CS2") -> dict[str, int] | None:
    """
    Read the live round score from the CS2 HUD top strip.

    Returns {"ct": <int>, "t": <int>} when both digits are read
    successfully, or None when:
      - The image cannot be loaded.
      - Either digit column yields no recognisable number.
      - Detected values exceed _MAX_SCORE (likely OCR noise on non-HUD frame).

    Currently only CS2 is supported.  Valorant uses a different HUD layout
    (score at top-left corner) and is not yet implemented.
    """
    if game != "CS2":
        logger.debug("detect_live_score: game=%s not supported", game)
        return None

    if not os.path.exists(image_path):
        logger.error("detect_live_score: file not found: %s", image_path)
        return None

    img = cv2.imread(image_path)
    if img is None:
        logger.error("detect_live_score: cv2 could not read: %s", image_path)
        return None

    h, w = img.shape[:2]

    y1 = int(h * _HUD_Y_START)
    y2 = int(h * _HUD_Y_END)

    ct_crop = img[y1:y2, int(w * _CT_X_START): int(w * _CT_X_END)]
    t_crop  = img[y1:y2, int(w * _T_X_START):  int(w * _T_X_END)]

    ct_bin = _prep_digit_crop(ct_crop)
    t_bin  = _prep_digit_crop(t_crop)

    ct_val = _ocr_digit(ct_bin)
    t_val  = _ocr_digit(t_bin)

    if ct_val is None or t_val is None:
        logger.debug(
            "detect_live_score: could not parse both digits (ct=%s, t=%s) in %s",
            ct_val, t_val, os.path.basename(image_path),
        )
        return None

    score = {"ct": ct_val, "t": t_val}
    logger.info("detect_live_score: %s → ct=%d t=%d", os.path.basename(image_path), ct_val, t_val)
    return score


def detect_round_start(image_path: str, game: str = "CS2") -> bool:
    """
    Return True when the live HUD shows exactly 0-0 (both sides at zero).

    This is the earliest reliable signal that all players are inside the
    game (past warmup, buy phase of round 1 not yet complete).  The engine
    upserts match_live_state.round_confirmed = TRUE on first True result.
    """
    score = detect_live_score(image_path, game=game)
    if score is None:
        return False
    result = score["ct"] == 0 and score["t"] == 0
    if result:
        logger.info("detect_round_start: 0-0 confirmed in %s", os.path.basename(image_path))
    return result
