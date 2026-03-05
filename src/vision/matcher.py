import cv2
import numpy as np
import os
import logging
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

    avg_h = np.mean(hsv[:,:,0])
    avg_s = np.mean(hsv[:,:,1])
    avg_v = np.mean(hsv[:,:,2])

    logger.debug(f"average HSV: H={avg_h:.1f}, S={avg_s:.1f}, V={avg_v:.1f}")

    if 35 <= avg_h <= 85 and avg_s > 50:
        result = "victory"
        confidence = round(avg_s / 255, 4)
        logger.info(f"VICTORY detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    elif (avg_h <= 10 or avg_h >= 170) and avg_s > 50:
        result = "defeat"
        confidence = round(avg_s / 255, 4)
        logger.info(f"DEFEAT detected - confidence: {confidence}")
        save_evidence(image_path, result, confidence)
        return result, confidence

    else:
        logger.warning(f"no result detected - H={avg_h:.1f}, S={avg_s:.1f}")
        return None, 0.0


def match_template(image_path, template_path, threshold=0.8):

    logger.info(f"starting match: image={image_path}, template={template_path}")

    if not os.path.exists(image_path):
        logger.error(f"image file not found: {image_path}")
        return False, 0.0, None

    if not os.path.exists(template_path):
        logger.error(f"template file not found: {template_path}")
        return False, 0.0, None

    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    template = cv2.imread(template_path, cv2.IMREAD_GRAYSCALE)

    logger.debug(f"image size: {img.shape}, template size: {template.shape}")

    result = cv2.matchTemplate(img, template, cv2.TM_CCOEFF_NORMED)
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

    matched = max_val >= threshold
    confidence = round(max_val, 4)

    if matched:
        logger.info(f"MATCH FOUND - confidence: {confidence}, location: {max_loc}")
        save_evidence(image_path, "victory", confidence)
    else:
        logger.warning(f"no match - confidence: {confidence}, threshold: {threshold}")

    return matched, confidence, max_loc


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
