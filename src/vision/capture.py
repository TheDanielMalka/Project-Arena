import mss
import cv2
import numpy as np
from datetime import datetime
import os
import time


def capture_screen(output_dir="screenshots", monitor_num=1):

    """
    Takes a screenshot and saves it as a file.
    Returns the file path.
    """
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Capture screen
    with mss.mss() as sct:
        monitor = sct.monitors[monitor_num]
        screenshot = sct.grab(monitor)

        # Convert to numpy array (OpenCV format)
        img = np.array(screenshot)

        # Convert BGRA to BGR (remove alpha channel)
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = os.path.join(output_dir, f"capture_{timestamp}.png")

        # Save
        cv2.imwrite(filepath, img)
        print(f"Screenshot saved: {filepath}")

        return filepath

def crop_roi(image_path, x, y, w, h, output_dir="screenshots"):
    """
    Crops a region of interest from an image.
    x, y = top-left corner
    w, h = width and height of the region
    """
    img = cv2.imread(image_path)
    cropped = img[y:y+h, x:x+w]
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(output_dir, f"roi_{timestamp}.png")
    
    cv2.imwrite(filepath, cropped)
    print(f"ROI saved: {filepath}")
    return filepath
   
def capture_loop(interval=5, roi=None, output_dir="screenshots"):
    """
    Captures screen every X seconds.
    roi = (x, y, w, h) to crop, or None for full screen.
    Press Ctrl+C to stop.
    """
    print(f"Starting capture every {interval} seconds. Press Ctrl+C to stop.")
    try:
        while True:
            filepath = capture_screen(output_dir)
            if roi:
                x, y, w, h = roi
                crop_roi(filepath, x, y, w, h, output_dir)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("Capture stopped.")

if __name__ == "__main__":
    capture_loop()

