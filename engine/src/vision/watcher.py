import time
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from src.vision.engine import VisionEngine, VisionEngineConfig
from typing import Optional


class ScreenshotHandler(FileSystemEventHandler):

    def __init__(self, engine: VisionEngine):
        self.engine = engine
        self.last_processed_time: float = 0

    def on_created(self, event):

        if event.is_directory or not event.src_path.endswith(".png"):
            return

        now = time.time()
        elapsed = now - self.last_processed_time
        if elapsed < self.engine.config.cooldown_seconds:
            remaining = self.engine.config.cooldown_seconds - elapsed
            print(f"cooldown: skipping (wait {remaining:.1f}s)")
            return

        time.sleep(0.3)
        image_path = event.src_path
        print(f"New Photo: {os.path.basename(image_path)}")

        try:
            result = self.engine.process_frame(image_path)
        except Exception as e:
            print(f"Proccesing Error: {e}")
            return

        self.last_processed_time = time.time()

        if result.accepted:
            print(f"result: {result.result} | confidence: {result.confidence:.0%}")
            print(f"players: {result.players}")
        else:
            print(f"no confidence: {result.confidence:.0%})")


def watch(game: str, screenshots_dir: str = "screenshots", config: Optional[VisionEngineConfig] = None):

    watch_path = os.path.join(screenshots_dir, game.replace(" ", "_"))
    os.makedirs(watch_path, exist_ok=True)

    engine = VisionEngine(config=config)
    handler = ScreenshotHandler(engine)

    observer = Observer()
    observer.schedule(handler, path=watch_path, recursive=False)
    observer.start()

    print(f"waiting for new photos: {watch_path}")
    print(f"confidence threshold: {engine.config.confidence_threshold:.0%} | cooldown: {engine.config.cooldown_seconds}s")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()

    observer.join()


if __name__ == "__main__":
    import sys
    game = sys.argv[1] if len(sys.argv) > 1 else "CS2"
    screenshots_dir = sys.argv[2] if len(sys.argv) > 2 else "screenshots"
    watch(game, screenshots_dir)
