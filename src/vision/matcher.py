import cv2
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
    else:
        logger.warning(f"no match - confidence: {confidence}, threshold: {threshold}")

    return matched, confidence, max_loc

if __name__ == "__main__":
    matched, confidence, location = match_template(
        "templates/Full_Template.jpg",
        "templates/Victory.jpg"
    )
    print(f"Result: matched={matched}, confidence={confidence}, location={location}")