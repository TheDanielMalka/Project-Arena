import cv2
import numpy as np
import os
import logging
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler


LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("vision.matcher")
logger.setLevel(logging.DEBUG)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)
console_handler.setFormatter(formatter)

file_handler = RotatingFileHandler(
    os.path.join(LOG_DIR, "matcher.log"),
    maxBytes=500000,
    backupCount=3
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

logger.addHandler(console_handler)
logger.addHandler(file_handler)


# ── CS2 ───────────────────────────────────────────────────────────────────────

def _detect_result_cs2(image_path: str, region=None):
    """
    CS2 end-screen result detection.

    VICTORY : green banner  — HSV H 35-85  (pure green glow)
    DEFEAT  : red banner    — HSV H 0-10 / 170-180  (red glow, wraps around)
    TIE     : gray banner   — S < 40, V 50-220  (neutral/metallic glow, Wingman 8-8 / Competitive 12-12)

    Default crop: y 12-17%, x 34-68% of the frame.
    That window sits over the CS2 "VICTORY / DEFEAT / DRAW" text in the top-centre.
    """
    img = cv2.imread(image_path)

    if region:
        x, y, w, h = region
        crop = img[y:y + h, x:x + w]
        logger.info(f"[CS2] cropped region: x={x}, y={y}, w={w}, h={h}")
    else:
        h, w = img.shape[:2]
        crop = img[int(h * 0.12):int(h * 0.17), int(w * 0.34):int(w * 0.68)]
        logger.info("[CS2] using default region (top centre)")

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    total_pixels = hsv.shape[0] * hsv.shape[1]

    green_mask = cv2.inRange(hsv, (35, 50, 50), (85, 255, 255))
    green_pct = np.sum(green_mask > 0) / total_pixels * 100

    red_mask1 = cv2.inRange(hsv, (0, 50, 50), (10, 255, 255))
    red_mask2 = cv2.inRange(hsv, (170, 50, 50), (180, 255, 255))
    red_pct = np.sum((red_mask1 | red_mask2) > 0) / total_pixels * 100

    gray_mask = cv2.inRange(hsv, (0, 0, 50), (180, 40, 220))
    gray_pct = np.sum(gray_mask > 0) / total_pixels * 100

    logger.debug(f"[CS2] green: {green_pct:.1f}%, red: {red_pct:.1f}%, gray: {gray_pct:.1f}%")

    if green_pct > 30:
        result = "victory"
        confidence = round(green_pct / 100, 4)
        logger.info(f"[CS2] VICTORY detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    if red_pct > 30:
        result = "defeat"
        confidence = round(red_pct / 100, 4)
        logger.info(f"[CS2] DEFEAT detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    if gray_pct > 30:
        result = "tie"
        confidence = round(gray_pct / 100, 4)
        logger.info(f"[CS2] TIE detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    logger.warning(f"[CS2] no result - green: {green_pct:.1f}%, red: {red_pct:.1f}%, gray: {gray_pct:.1f}%")
    return None, 0.0


# ── Valorant ──────────────────────────────────────────────────────────────────

def _detect_result_valorant(image_path: str, region=None):
    """
    Valorant end-screen result detection.
    Calibrated from real VICTORY and DEFEAT screenshots (1200×675 reference).

    VICTORY : teal/cyan-green background — HSV H 75-105
              The large "VICTORY" text + full-screen teal glow is unmistakable.
              Teal covers ~40-60 % of the detection crop, threshold > 20 %.

    DEFEAT  : dark crimson/maroon background — HSV H 0-15 | H 165-180
              Critical calibration note: the Valorant DEFEAT screen is DARK.
              Background V ≈ 25-80 (much lower than "bright red").  The old
              V ≥ 60 threshold only caught the bright "DEFEAT" text (~5 % of
              crop) and reliably missed the background, causing false negatives.
              Fix: V ≥ 25 catches the full dark crimson area (≈ 35-55 %).

    Default crop: y 5-55%, x 10-90% of the frame.
      - Captures the coloured background + large text.
      - Excludes top-corner score numbers (x 0-8%, x 92-100%).
      - Excludes dark player-card area below 55%.

    Cross-game safety: this function is only called when game="Valorant"
    so the expanded H/V ranges for DEFEAT do not risk CS2 false positives.
    """
    img = cv2.imread(image_path)
    if img is None:
        logger.error(f"[Valorant] image file not found: {image_path}")
        return None, 0.0

    if region:
        x, y, w, h = region
        crop = img[y:y + h, x:x + w]
        logger.info(f"[Valorant] cropped region: x={x}, y={y}, w={w}, h={h}")
    else:
        h, w = img.shape[:2]
        crop = img[int(h * 0.05):int(h * 0.55), int(w * 0.10):int(w * 0.90)]
        logger.info("[Valorant] using default region (y 5-55%, x 10-90%)")

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    total_pixels = hsv.shape[0] * hsv.shape[1]

    # VICTORY: teal/cyan-green — calibrated from real VICTORY screenshot.
    # H 75-105 covers the Valorant brand teal (peak ≈ H 88-92 in OpenCV).
    teal_mask = cv2.inRange(hsv, (75, 60, 60), (105, 255, 255))
    teal_pct  = np.sum(teal_mask > 0) / total_pixels * 100

    # DEFEAT: red/crimson — calibrated from real DEFEAT screenshot.
    # V ≥ 25 (not 60) catches the dark maroon background that fills most of
    # the screen; H broadened to 0-15 / 165-180 to cover full crimson range.
    red_mask1 = cv2.inRange(hsv, (0,   50, 25), (15,  255, 255))
    red_mask2 = cv2.inRange(hsv, (165, 50, 25), (180, 255, 255))
    red_pct   = np.sum((red_mask1 | red_mask2) > 0) / total_pixels * 100

    logger.debug(f"[Valorant] teal: {teal_pct:.1f}%, red: {red_pct:.1f}%")

    if teal_pct > 20:
        result = "victory"
        confidence = round(teal_pct / 100, 4)
        logger.info(f"[Valorant] VICTORY detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    if red_pct > 15:
        result = "defeat"
        confidence = round(red_pct / 100, 4)
        logger.info(f"[Valorant] DEFEAT detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    logger.warning(f"[Valorant] no result — teal: {teal_pct:.1f}%, red: {red_pct:.1f}%")
    return None, 0.0


# ── Public API ────────────────────────────────────────────────────────────────

def detect_result(image_path: str, region=None, game: str = "CS2"):
    """
    Unified win/loss detector. Routes to the correct game-specific
    implementation based on `game`.

    Args:
        image_path : Path to the end-screen screenshot.
        region     : Optional (x, y, w, h) crop override. When None each
                     game uses its own calibrated default region.
        game       : "CS2" | "Valorant"   (default: "CS2")

    Returns:
        (result, confidence)
          result     - "victory" | "defeat" | "tie" | None
          confidence - float in [0, 1]; 0.0 when nothing is detected.
    """
    logger.info(f"detect_result: game={game}, image={image_path}")

    if not os.path.exists(image_path):
        logger.error(f"image file not found: {image_path}")
        return None, 0.0

    if game == "Valorant":
        return _detect_result_valorant(image_path, region)

    # Default -> CS2
    return _detect_result_cs2(image_path, region)


def match_template(image_path, template_path, threshold=0.8):

    logger.info(f"starting match: image={image_path}, template={template_path}")
    start_time = time.perf_counter()

    if not os.path.exists(image_path):
        logger.error(f"image file not found: {image_path}")
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"match_template elapsed: {elapsed_ms:.2f}ms (image missing)")
        return False, 0.0, None

    if not os.path.exists(template_path):
        logger.error(f"template file not found: {template_path}")
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"match_template elapsed: {elapsed_ms:.2f}ms (template missing)")
        return False, 0.0, None

    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    template = cv2.imread(template_path, cv2.IMREAD_GRAYSCALE)

    img = cv2.GaussianBlur(img, (3, 3), 0)
    template = cv2.GaussianBlur(template, (3, 3), 0)

    logger.debug(f"image size: {img.shape}, template size: {template.shape}")

    # Base matching on grayscale images
    result = cv2.matchTemplate(img, template, cv2.TM_CCOEFF_NORMED)
    _, base_max_val, _, base_max_loc = cv2.minMaxLoc(result)

    # Edge-map matching - shape-focused, less sensitive to colour / noise
    img_edges = cv2.Canny(img, 50, 150)
    template_edges = cv2.Canny(template, 50, 150)
    edge_result = cv2.matchTemplate(img_edges, template_edges, cv2.TM_CCOEFF_NORMED)
    _, edge_max_val, _, edge_max_loc = cv2.minMaxLoc(edge_result)

    # Use the stronger signal between base and edge matching
    if edge_max_val > base_max_val:
        best_score = edge_max_val
        best_loc = edge_max_loc
        best_mode = "edge"
    else:
        best_score = base_max_val
        best_loc = base_max_loc
        best_mode = "base"

    logger.debug(f"base score: {base_max_val:.4f}, edge score: {edge_max_val:.4f}, mode: {best_mode}")

    matched = best_score >= threshold
    confidence = round(best_score, 4)

    if matched:
        logger.info(f"MATCH FOUND - confidence: {confidence}, location: {best_loc}, mode: {best_mode}")
        save_evidence(image_path, "victory", confidence)
    else:
        logger.warning(f"no match - confidence: {confidence}, threshold: {threshold}")

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    logger.info(f"match_template elapsed: {elapsed_ms:.2f}ms")

    return matched, confidence, best_loc


def save_evidence(image_path, result, confidence):
    evidence_dir = "evidence"
    os.makedirs(evidence_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"{timestamp}_{result}_{confidence}.png"
    dest = os.path.join(evidence_dir, filename)

    img = cv2.imread(image_path)
    if img is None:
        logger.error(f"cannot read image for evidence: {image_path}")
        return None

    cv2.imwrite(dest, img)
    logger.info(f"evidence saved: {dest}")
    return dest


if __name__ == "__main__":
    # CS2 quick-test
    for path in [
        "src/vision/templates/cs2/template2.jpg",
        "src/vision/templates/cs2/temp3.webp",
        "src/vision/templates/cs2/temp4.jpg",
    ]:
        result, confidence = detect_result(path, game="CS2")
        print(f"[CS2]      {path} -> result={result}, confidence={confidence}")

    # Valorant quick-test
    for path in [
        "templates/valorant/valorant_1920x1080_victory.png",
        "templates/valorant/valorant_1920x1080_defeat.png",
    ]:
        result, confidence = detect_result(path, game="Valorant")
        print(f"[Valorant] {path} -> result={result}, confidence={confidence}")
