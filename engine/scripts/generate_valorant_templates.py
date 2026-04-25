"""
Generate Valorant end-screen templates at multiple standard resolutions.

Two modes:
  1. Synthetic (default) — creates calibrated colour+text images immediately.
     Correct for HSV detection tests.  Run with no source images.

  2. Source-resize       — resizes a real VICTORY and DEFEAT screenshot to
     every target resolution.  Produces high-fidelity templates that are
     ideal for OCR regression tests.

     python engine/scripts/generate_valorant_templates.py \\
         --victory path/to/victory.png \\
         --defeat  path/to/defeat.png

Output:
    engine/templates/valorant/valorant_{W}x{H}_victory.png
    engine/templates/valorant/valorant_{W}x{H}_defeat.png
"""

from __future__ import annotations

import argparse
import os
import sys

import cv2
import numpy as np

# ── Target resolutions ────────────────────────────────────────────────────────
RESOLUTIONS: list[tuple[int, int]] = [
    ( 800,  600),   # legacy 4:3
    (1024,  768),   # legacy 4:3
    (1280,  720),
    (1280,  960),   # stretched 4:3
    (1366,  768),
    (1440, 1080),   # stretched 4:3
    (1600,  900),
    (1600, 1024),   # stretched 4:3
    (1680, 1050),
    (1920, 1080),
    (2560, 1080),   # ultrawide
    (2560, 1440),
    (3840, 2160),   # 4K
]

# ── OCR region constants (must match ocr.py) ──────────────────────────────────
_AGENT_ROW_Y  = 0.42
_AGENT_ROW_H  = 0.09
_PLAYER_ROW_Y = 0.50
_PLAYER_ROW_H = 0.11
_SLOT_X_START = 0.02
_SLOT_X_END   = 0.96
_NUM_SLOTS    = 5
_SLOT_W       = (_SLOT_X_END - _SLOT_X_START) / _NUM_SLOTS   # ≈ 0.188

# Sample content used in synthetic templates
_VICTORY_AGENTS  = ["BRIMSTONE", "SAGE",       "JETT",       "OMEN",     "PHOENIX"]
_VICTORY_PLAYERS = ["DOMA",      "TSACK",      "BOASTER",    "MISTIC",   "PLAYER"]
_DEFEAT_TITLES   = ["BLOODHOUND","CLUTCH KING","EXECUTIONER","SHARP EDGE","DEAD EYE"]
_DEFEAT_PLAYERS  = ["RAZEPARTY", "SOVAMAIN",   "PLAYERNAME", "OMENGUY",  "SKYELOVE"]


# ── Colour helpers ────────────────────────────────────────────────────────────

def _bgr(h: int, s: int, v: int) -> tuple[int, int, int]:
    """Convert an OpenCV HSV triple to a BGR tuple."""
    arr = np.array([[[h, s, v]]], dtype=np.uint8)
    bgr = cv2.cvtColor(arr, cv2.COLOR_HSV2BGR)[0, 0]
    return int(bgr[0]), int(bgr[1]), int(bgr[2])


# ── Synthetic template builders ───────────────────────────────────────────────

def _put_text_scaled(img: np.ndarray, text: str,
                     x: int, y: int,
                     scale: float, color: tuple[int, int, int],
                     thickness: int = 1) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(img, text, (int(x), int(y)), font, float(scale),
                (int(color[0]), int(color[1]), int(color[2])),
                int(thickness), cv2.LINE_AA)


def create_victory_synthetic(w: int, h: int) -> np.ndarray:
    """
    Synthetic Valorant VICTORY end-screen at resolution (w × h).

    Colours calibrated from a real 1200×675 VICTORY screenshot:
      - Background     : teal/cyan-green  HSV(90, 200, 140)  — covers the full
                         detection crop (y 5-55%, x 10-90%) so HSV teal_pct ≫ 20 %
      - "VICTORY" text : slightly lighter teal
      - Scores         : "13" teal (left corner), "11" red (right corner)
      - 5 player cards : darker teal panels with white agent + player names
    """
    img = np.zeros((h, w, 3), dtype=np.uint8)

    # --- Background (teal) ---
    teal_bg   = _bgr(90, 200, 140)   # H=90 → centre of detection range 75-105
    img[:, :] = teal_bg

    # --- "VICTORY" text ---
    main_scale = max(0.8, w / 500.0)
    main_thick = max(1, int(w / 700))
    vtext = "VICTORY"
    ts = cv2.getTextSize(vtext, cv2.FONT_HERSHEY_SIMPLEX, main_scale, main_thick)[0]
    _put_text_scaled(img, vtext,
                     (w - ts[0]) // 2, int(h * 0.25),
                     main_scale, _bgr(90, 120, 220), main_thick)

    # --- Score numbers ---
    score_scale = max(0.5, w / 900.0)
    _put_text_scaled(img, "13",
                     int(w * 0.06), int(h * 0.11),
                     score_scale, _bgr(90, 150, 220), max(1, main_thick))
    _put_text_scaled(img, "11",
                     int(w * 0.88), int(h * 0.11),
                     score_scale, _bgr(0, 200, 210), max(1, main_thick))

    # --- Player cards ---
    card_color  = _bgr(90, 160,  55)   # darker teal panel
    agent_color = (230, 230, 230)
    name_color  = (255, 255, 255)

    card_scale  = max(0.25, (w * _SLOT_W) / 350.0)
    agent_thick = 1
    name_thick  = max(1, int(card_scale))

    for i in range(_NUM_SLOTS):
        cx1 = int(w * (_SLOT_X_START + i * _SLOT_W))
        cx2 = int(w * (_SLOT_X_START + (i + 1) * _SLOT_W)) - 2
        cy1 = int(h * 0.38)
        cy2 = int(h * 0.88)
        cv2.rectangle(img, (cx1, cy1), (cx2, cy2), card_color, -1)

        ay = int(h * (_AGENT_ROW_Y + _AGENT_ROW_H * 0.70))
        _put_text_scaled(img, _VICTORY_AGENTS[i],
                         cx1 + 3, ay, card_scale * 0.75, agent_color, agent_thick)

        py = int(h * (_PLAYER_ROW_Y + _PLAYER_ROW_H * 0.70))
        _put_text_scaled(img, _VICTORY_PLAYERS[i],
                         cx1 + 3, py, card_scale, name_color, name_thick)

    return img


def create_defeat_synthetic(w: int, h: int) -> np.ndarray:
    """
    Synthetic Valorant DEFEAT end-screen at resolution (w × h).

    Colours calibrated from a real DEFEAT screenshot:
      - Background : dark crimson/maroon  HSV(5, 150, 45)   — the DEFEAT screen
                     is significantly darker than VICTORY; V ≈ 25-80 throughout.
                     This drove the DEFEAT V-threshold fix in matcher.py (60→25).
      - "DEFEAT" text : bright red  HSV(5, 220, 220)
      - 5 player cards : near-black panels with white title + player names
    """
    img = np.zeros((h, w, 3), dtype=np.uint8)

    # --- Background (dark crimson) ---
    crimson_bg = _bgr(5, 150, 45)    # H=5 → centre of detection range 0-15
    img[:, :] = crimson_bg

    # Add slightly brighter mid-tone to make the background more realistic
    # (the real screen has gradients; this gives a hint of that)
    mid_band = _bgr(5, 140, 65)
    img[int(h*0.05):int(h*0.55), :] = mid_band

    # --- "DEFEAT" text ---
    main_scale = max(0.8, w / 500.0)
    main_thick = max(1, int(w / 700))
    dtext = "DEFEAT"
    ts = cv2.getTextSize(dtext, cv2.FONT_HERSHEY_SIMPLEX, main_scale, main_thick)[0]
    _put_text_scaled(img, dtext,
                     (w - ts[0]) // 2, int(h * 0.20),
                     main_scale, _bgr(5, 220, 220), main_thick)

    # --- Player cards ---
    card_color  = _bgr(5, 80, 28)
    title_color = (220, 220, 220)
    name_color  = (255, 255, 255)

    card_scale  = max(0.25, (w * _SLOT_W) / 350.0)
    title_thick = 1
    name_thick  = max(1, int(card_scale))

    for i in range(_NUM_SLOTS):
        cx1 = int(w * (_SLOT_X_START + i * _SLOT_W))
        cx2 = int(w * (_SLOT_X_START + (i + 1) * _SLOT_W)) - 2
        cy1 = int(h * 0.35)
        cy2 = int(h * 0.88)
        cv2.rectangle(img, (cx1, cy1), (cx2, cy2), card_color, -1)

        ay = int(h * (_AGENT_ROW_Y + _AGENT_ROW_H * 0.70))
        _put_text_scaled(img, _DEFEAT_TITLES[i],
                         cx1 + 3, ay, card_scale * 0.70, title_color, title_thick)

        py = int(h * (_PLAYER_ROW_Y + _PLAYER_ROW_H * 0.70))
        _put_text_scaled(img, _DEFEAT_PLAYERS[i],
                         cx1 + 3, py, card_scale, name_color, name_thick)

    return img


# ── Source-resize mode ────────────────────────────────────────────────────────

def resize_from_source(src_path: str, w: int, h: int) -> np.ndarray:
    img = cv2.imread(src_path)
    if img is None:
        raise FileNotFoundError(f"Cannot read source image: {src_path}")
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_LANCZOS4)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--victory", default=None,
                        help="Path to a real Valorant VICTORY screenshot "
                             "(optional — uses synthetic if omitted).")
    parser.add_argument("--defeat",  default=None,
                        help="Path to a real Valorant DEFEAT screenshot "
                             "(optional — uses synthetic if omitted).")
    parser.add_argument("--out", default=None,
                        help="Output directory (default: engine/templates/valorant/).")
    args = parser.parse_args()

    # Resolve output directory relative to repo root
    script_dir  = os.path.dirname(os.path.abspath(__file__))
    repo_root   = os.path.dirname(script_dir)
    default_out = os.path.join(repo_root, "templates", "valorant")
    out_dir     = args.out or default_out
    os.makedirs(out_dir, exist_ok=True)

    use_source = bool(args.victory or args.defeat)
    if use_source:
        if not args.victory or not args.defeat:
            print("ERROR: provide both --victory and --defeat when using source images.",
                  file=sys.stderr)
            sys.exit(1)
        print(f"Mode : source-resize  ({args.victory}, {args.defeat})")
    else:
        print("Mode : synthetic (calibrated colours — no source images provided)")

    generated = 0
    for (w, h) in RESOLUTIONS:
        for result in ("victory", "defeat"):
            out_path = os.path.join(out_dir, f"valorant_{w}x{h}_{result}.png")

            if use_source:
                src = args.victory if result == "victory" else args.defeat
                img = resize_from_source(src, w, h)
            else:
                if result == "victory":
                    img = create_victory_synthetic(w, h)
                else:
                    img = create_defeat_synthetic(w, h)

            cv2.imwrite(out_path, img)
            print(f"  OK  {os.path.basename(out_path)}")
            generated += 1

    print(f"\n{generated} templates written to: {out_dir}")
    if not use_source:
        print("\nTo replace with real screenshots, run:")
        print("  python engine/scripts/generate_valorant_templates.py \\")
        print("      --victory <path/to/victory.png> \\")
        print("      --defeat  <path/to/defeat.png>")


if __name__ == "__main__":
    main()
