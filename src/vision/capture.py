import mss
import cv2
import numpy as np
from datetime import datetime
import os
import time
import logging
from logging.handlers import RotatingFileHandler

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("vision.capture")
logger.setLevel(logging.DEBUG)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)
console_handler.setFormatter(formatter)

file_handler = RotatingFileHandler(
    os.path.join(LOG_DIR, "capture.log"),
    maxBytes=500000,
    backupCount=3
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

logger.addHandler(console_handler)
logger.addHandler(file_handler)

def capture_screen(output_dir="templates", monitor_num=1):

    os.makedirs(output_dir, exist_ok=True)
    logger.info(f"capturing screen from monitor {monitor_num}")

    with mss.mss() as sct:
        if monitor_num >= len(sct.monitors):
            logger.error(f"monitor {monitor_num} not found, available: {len(sct.monitors) - 1}")
            return None

        monitor = sct.monitors[monitor_num]
        screenshot = sct.grab(monitor)

        img = np.array(screenshot)
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = os.path.join(output_dir, f"capture_{timestamp}.png")

        cv2.imwrite(filepath, img)
        logger.info(f"screenshot saved: {filepath}")
        logger.debug(f"image size: {img.shape}, monitor: {monitor}")

        return filepath


def crop_roi(image_path, x, y, w, h, output_dir="screenshots"):

    logger.info(f"cropping roi from: {image_path}")

    if not os.path.exists(image_path):
        logger.error(f"image file not found: {image_path}")
        return None

    img = cv2.imread(image_path)
    cropped = img[y:y+h, x:x+w]

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(output_dir, f"roi_{timestamp}.png")

    cv2.imwrite(filepath, cropped)
    logger.info(f"roi saved: {filepath}")
    logger.debug(f"crop area: x={x}, y={y}, w={w}, h={h}")
    return filepath


def capture_loop(interval=5, roi=None, output_dir="screenshots"):

    logger.info(f"starting capture loop every {interval} seconds")
    try:
        while True:
            filepath = capture_screen(output_dir)
            if roi:
                x, y, w, h = roi
                crop_roi(filepath, x, y, w, h, output_dir)
            time.sleep(interval)
    except KeyboardInterrupt:
        logger.info("capture stopped by user")

if __name__ == "__main__":
    capture_loop()
