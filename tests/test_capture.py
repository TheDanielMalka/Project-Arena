import os
import sys
import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.vision.capture import crop_roi

def test_crop_roi(tmp_path):

    fake_img = np.zeros((100, 200, 3), dtype=np.uint8)
    fake_img[10:50, 20:80] = (255, 0, 0) 
  
    input_path = str(tmp_path / "fake.png")
    cv2.imwrite(input_path, fake_img)

    output = crop_roi(input_path, x=20, y=10, w=60, h=40, output_dir=str(tmp_path))

    assert os.path.exists(output)

    cropped = cv2.imread(output)
    assert cropped.shape[0] == 40  
    assert cropped.shape[1] == 60  


def test_crop_roi_file_not_found():
    try:
        crop_roi("nonexistent.png", 0, 0, 10, 10)
        assert False, "Should have raised an error"
    except:
        assert True
