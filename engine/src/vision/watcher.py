import time
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from src.vision.engine import VisionEngine


class ScreenshotHandler(FileSystemEventHandler):
    """נקרא אוטומטית כל פעם שנוצר קובץ חדש בתיקייה"""

    def __init__(self, engine: VisionEngine):
        self.engine = engine

    def on_created(self, event):
        # התעלם מתיקיות, רק קבצי PNG
        if event.is_directory or not event.src_path.endswith(".png"):
            return

        image_path = event.src_path
        print(f"תמונה חדשה: {os.path.basename(image_path)}")

        result = self.engine.process_frame(image_path)

        if result.accepted:
            print(f"תוצאה: {result.result} | ביטחון: {result.confidence:.0%}")
            print(f"שחקנים: {result.players}")
        else:
            print(f"לא זוהתה תוצאה ברורה (ביטחון: {result.confidence:.0%})")


def watch(game: str, screenshots_dir: str = "screenshots"):
    """
    game: שם המשחק (CS2 / Fortnite / Valorant וכו')
    screenshots_dir: תיקיית ה-screenshots הראשית
    """
    watch_path = os.path.join(screenshots_dir, game.replace(" ", "_"))
    os.makedirs(watch_path, exist_ok=True)

    engine = VisionEngine()
    handler = ScreenshotHandler(engine)

    observer = Observer()
    observer.schedule(handler, path=watch_path, recursive=False)
    observer.start()

    print(f"מאזין לתמונות חדשות ב: {watch_path}")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()

    observer.join()


if __name__ == "__main__":
    import sys
    game = sys.argv[1] if len(sys.argv) > 1 else "CS2"
    watch(game)
