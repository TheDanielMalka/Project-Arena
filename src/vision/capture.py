import mss
import cv2
import numpy as np
from datetime import datetime
import os


def capture_screen(output_dir="screenshots"):
    """
    Takes a screenshot and saves it as a file.
    Returns the file path.
    """
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Capture screen
    with mss.mss() as sct:
        monitor = sct.monitors[1]  # Primary monitor
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


if __name__ == "__main__":
    capture_screen()
