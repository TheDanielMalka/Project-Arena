import os
import sys
import cv2
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.vision.ocr import extract_text, extract_player_names


def test_missing_image():

    result = extract_text("not_exists.jpg")
    assert result is None


def test_extract_text_clean_image(tmp_path):

    img = np.ones((200, 600, 3), dtype=np.uint8) * 255
    cv2.putText(img, "FOSTER", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
    cv2.putText(img, "nezzik", (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)

    img_path = str(tmp_path / "clean.png")
    cv2.imwrite(img_path, img)

    result = extract_text(img_path, region=(0, 0, 600, 200))
    assert result is not None
    assert len(result) > 0


def test_extract_player_names_clean(tmp_path):

    img = np.ones((200, 600, 3), dtype=np.uint8) * 255
    cv2.putText(img, "FOSTER", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
    cv2.putText(img, "nezzik", (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)

    img_path = str(tmp_path / "players.png")
    cv2.imwrite(img_path, img)

    names = extract_player_names(img_path, region=(0, 0, 600, 200))
    assert len(names) >= 1


def test_extract_text_logs_elapsed_for_missing_image(caplog):
    caplog.set_level("INFO", logger="vision.ocr")

    result = extract_text("not_exists.jpg")

    assert result is None
    assert "extract_text elapsed:" in caplog.text