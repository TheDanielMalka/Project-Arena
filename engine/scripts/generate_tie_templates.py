"""
Generate tie screenshots at all CS2 resolutions from the 1920x1080 source images.
"""
import cv2
import os

RESOLUTIONS = [
    (800, 600),
    (1024, 768),
    (1280, 720),
    (1280, 960),
    (1366, 768),
    (1440, 1080),
    (1600, 1024),
    (1680, 1050),
    (2560, 1440),
]

SOURCES = [
    "cs2_1920x1080_tie_wingman_1.png",
    "cs2_1920x1080_tie_wingman_2.png",
    "cs2_1920x1080_tie_5v5.png",
    "cs2_1920x1080_victory_2v2_1.png",
    "cs2_1920x1080_victory_2v2_2.png",
]

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "templates", "cs2")


def main():
    for src_name in SOURCES:
        src_path = os.path.join(TEMPLATES_DIR, src_name)
        img = cv2.imread(src_path)
        if img is None:
            print(f"SKIP (not found): {src_name}")
            continue

        base = src_name.replace("cs2_1920x1080_", "").replace(".png", "")

        for w, h in RESOLUTIONS:
            resized = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
            out_name = f"cs2_{w}x{h}_{base}.png"
            out_path = os.path.join(TEMPLATES_DIR, out_name)
            cv2.imwrite(out_path, resized)
            print(f"created: {out_name}")

    print("done.")


if __name__ == "__main__":
    main()
