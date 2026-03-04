import pytesseract
import cv2
import numpy as np
import os
import logging
import re


LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("vision.ocr")
logger.setLevel(logging.DEBUG)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)
console_handler.setFormatter(formatter)

file_handler = logging.FileHandler(os.path.join(LOG_DIR, "ocr.log"))
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

logger.addHandler(console_handler)
logger.addHandler(file_handler)


def preprocess_image(img):

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    logger.debug(f"converted to grayscale: {gray.shape}")

    scaled = cv2.resize(gray, (gray.shape[1] * 3, gray.shape[0] * 3))
    logger.debug(f"upscaled 3x: {scaled.shape}")

    inverted = cv2.bitwise_not(scaled)
    logger.debug("inverted colors")

    _, binary = cv2.threshold(inverted, 140, 255, cv2.THRESH_BINARY)
    logger.debug("applied binary threshold")

    return binary


def extract_text(image_path, region=None):

    logger.info(f"extracting text from: {image_path}")

    if not os.path.exists(image_path):
        logger.error(f"image file not found: {image_path}")
        return None

    img = cv2.imread(image_path)

    if region:
        x, y, w, h = region
        img = img[y:y+h, x:x+w]
        logger.info(f"cropped region: x={x}, y={y}, w={w}, h={h}")

    processed = preprocess_image(img)

    text = pytesseract.image_to_string(processed, config="--psm 6")
    logger.info(f"raw OCR output: {text.strip()}")

    return text.strip()


def extract_player_names(image_path, region=None):

    logger.info("extracting player names from scoreboard")

    raw_text = extract_text(image_path, region)

    if not raw_text:
        logger.warning("no text extracted from image")
        return []

    lines = raw_text.split("\n")
    names = []

    for line in lines:
        cleaned = line.strip()
        if len(cleaned) < 2:
            continue
        if cleaned.isdigit():
            continue
        names.append(cleaned)

    logger.info(f"extracted {len(names)} player names: {names}")
    return names


if __name__ == "__main__":
    result = extract_player_names("src/vision/templates/cs2/template.jpg")
    print(f"Players: {result}")