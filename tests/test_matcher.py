import os
import sys
import cv2
import numpy as np
from src.vision.matcher import match_template

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def test_missing_image():

    matched, confidence, location = match_template(
        "not_exists.jpg",
        "also_not_exists.jpg"
    )
    assert matched == False
    assert confidence == 0.0
    assert location is None

def test_match_found(tmp_path):

    big_img = np.zeros((200, 300), dtype=np.uint8)
    big_img[40:90, 80:130] = 255
    template = big_img[40:90, 80:130].copy()
    
    img_path = str(tmp_path / "big.png")
    tpl_path = str(tmp_path / "template.png")
    cv2.imwrite(img_path, big_img)
    cv2.imwrite(tpl_path, template)
    
    matched, confidence, location = match_template(img_path, tpl_path)
    
    assert matched == True
    assert confidence >= 0.95
    assert location is not None

def test_match_not_found(tmp_path):
    
    big_img = np.zeros((200, 300), dtype=np.uint8)
    big_img[10:30, 10:30] = 128

    template = np.zeros((50, 50), dtype=np.uint8)
    template[0:25, :] = 255
    template[25:50, :] = 100

    img_path = str(tmp_path / "image.png")
    tpl_path = str(tmp_path / "template.png")
    cv2.imwrite(img_path, big_img)
    cv2.imwrite(tpl_path, template)

    matched, confidence, location = match_template(img_path, tpl_path)

    assert matched == False
    assert confidence < 0.8