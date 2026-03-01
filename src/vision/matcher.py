import cv2
import os
from datetime import datetime


def match_template(image_path, template_path, threshold=0.8):
    """
    Compares an image to a template.
    Returns (matched, confidence, location).
    """
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    template = cv2.imread(template_path, cv2.IMREAD_GRAYSCALE)

    result = cv2.matchTemplate(img, template, cv2.TM_CCOEFF_NORMED)
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

    matched = max_val >= threshold
    return matched, round(max_val, 4), max_loc
