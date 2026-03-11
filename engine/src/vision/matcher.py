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


def detect_result(image_path, region=None):

    logger.info(f"detecting match result: {image_path}")

    if not os.path.exists(image_path):
        logger.error(f"image file not found: {image_path}")
        return None, 0.0

    img = cv2.imread(image_path)

    if region:
        x, y, w, h = region
        crop = img[y:y+h, x:x+w]
        logger.info(f"cropped region: x={x}, y={y}, w={w}, h={h}")
    else:
        h, w = img.shape[:2]
        crop = img[int(h*0.12):int(h*0.17), int(w*0.34):int(w*0.68)]
        logger.info("using default region (top center)")

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    total_pixels = hsv.shape[0] * hsv.shape[1]

    green_mask = cv2.inRange(hsv, (35, 50, 50), (85, 255, 255))
    green_pct = np.sum(green_mask > 0) / total_pixels * 100

    red_mask1 = cv2.inRange(hsv, (0, 50, 50), (10, 255, 255))
    red_mask2 = cv2.inRange(hsv, (170, 50, 50), (180, 255, 255))
    red_pct = np.sum((red_mask1 | red_mask2) > 0) / total_pixels * 100

    logger.debug(f"green: {green_pct:.1f}%, red: {red_pct:.1f}%")

    if green_pct > 30:
        result = "victory"
        confidence = round(green_pct / 100, 4)
        logger.info(f"VICTORY detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    elif red_pct > 30:
        result = "defeat"
        confidence = round(red_pct / 100, 4)
        logger.info(f"DEFEAT detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    else:
        logger.warning(f"no result detected - green: {green_pct:.1f}%, red: {red_pct:.1f}%")
        return None, 0.0


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

    # Alternative matching on edge maps (shape-focused, less color/noise-sensitive)
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
    result, confidence = detect_result("src/vision/templates/cs2/template2.jpg")
    print(f"Result: {result}, Confidence: {confidence}")
    result, confidence = detect_result("src/vision/templates/cs2/temp3.webp")
    print(f"Result: {result}, Confidence: {confidence}")
    result, confidence = detect_result("src/vision/templates/cs2/temp4.jpg")
    print(f"Result: {result}, Confidence: {confidence}")