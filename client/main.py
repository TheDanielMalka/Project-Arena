"""
ARENA Desktop Client - Main Entry Point
Runs as a system tray application that monitors CS2 matches,
captures screenshots, and sends them to the Engine API for OCR processing.

NOTE: All vision/OCR processing happens SERVER-SIDE.
The client only captures screenshots and uploads them.
"""

import sys
import os
import time
import json
import logging
import threading
from datetime import datetime
from logging.handlers import RotatingFileHandler

import httpx
import mss
import mss.tools
import pystray
from PIL import Image, ImageDraw
from pystray import MenuItem, Menu

# ── Config ────────────────────────────────────────────────────
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

DEFAULT_CONFIG = {
    "engine_url": "http://localhost:8000",
    "auth_token": "",
    "screenshot_interval": 5,
    "monitor": 1,
    "auto_start": True,
    "minimize_to_tray": True,
    # AUTO: client will auto-detect supported games (CS2 / Valorant / Fortnite / Apex)
    "game": "AUTO",
    "screenshot_dir": os.path.join(os.path.dirname(__file__), "screenshots"),
    "log_dir": os.path.join(os.path.dirname(__file__), "logs"),
}


def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            saved = json.load(f)
            return {**DEFAULT_CONFIG, **saved}
    return DEFAULT_CONFIG.copy()


def save_config(config: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


# ── Logging ───────────────────────────────────────────────────
config = load_config()
os.makedirs(config["log_dir"], exist_ok=True)
os.makedirs(config["screenshot_dir"], exist_ok=True)

logger = logging.getLogger("arena.client")
logger.setLevel(logging.DEBUG)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

file_handler = RotatingFileHandler(
    os.path.join(config["log_dir"], "client.log"),
    maxBytes=1_000_000,
    backupCount=5,
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

logger.addHandler(console_handler)
logger.addHandler(file_handler)


# ── Screenshot Capture (mss only, no cv2) ─────────────────────
def capture_screenshot(output_dir: str, monitor_num: int = 1, game_name: str | None = None) -> str | None:
    """Capture a screenshot using mss and save as PNG."""
    try:
        os.makedirs(output_dir, exist_ok=True)
        with mss.mss() as sct:
            monitors = sct.monitors
            if monitor_num >= len(monitors):
                monitor_num = 1
            monitor = monitors[monitor_num]

            screenshot = sct.grab(monitor)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            if game_name:
                safe_game_name = game_name.replace(" ", "_")
                filename = f"{safe_game_name}_{timestamp}.png"
            else:
                filename = f"capture_{timestamp}.png"
            filepath = os.path.join(output_dir, filename)
            mss.tools.to_png(screenshot.rgb, screenshot.size, output=filepath)

            logger.debug(f"Screenshot saved: {filepath}")
            return filepath
    except Exception as e:
        logger.error(f"Screenshot capture failed: {e}")
        return None


# ── Game Detection ────────────────────────────────────────────
def is_game_running(game: str = "CS2") -> bool:
    """Check if the target game process is running."""
    try:
        import psutil
        game_processes = {
            "CS2": ["cs2.exe", "csgo.exe"],
            "Valorant": ["VALORANT-Win64-Shipping.exe"],
            "Fortnite": ["FortniteClient-Win64-Shipping.exe"],
            "Apex Legends": ["r5apex.exe"],
        }
        target = game_processes.get(game, [])
        for proc in psutil.process_iter(["name"]):
            if proc.info["name"] and proc.info["name"].lower() in [p.lower() for p in target]:
                return True
    except ImportError:
        logger.warning("psutil not installed - skipping game detection")
    except Exception as e:
        logger.error(f"Error checking game process: {e}")
    return False

def detect_running_game() -> str | None:
    try:
        import psutil
        game_processes = {
            "CS2": ["cs2.exe", "csgo.exe"],
            "Valorant": ["VALORANT-Win64-Shipping.exe"],
            "Fortnite": ["FortniteClient-Win64-Shipping.exe"],
            "Apex Legends": ["r5apex.exe"],
        }
        for game, procs in game_processes.items():
            names = [p.lower() for p in procs]
            for proc in psutil.process_iter(["name"]):
                if proc.info["name"] and proc.info["name"].lower() in names:
                    return game
    except Exception as e:
        logger.error(f"Error detecting game: {e}")
    return None
    
# ── Engine API Client ─────────────────────────────────────────
class EngineClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.client = httpx.Client(timeout=30)

    def health(self) -> dict | None:
        try:
            r = self.client.get(f"{self.base_url}/health")
            return r.json()
        except Exception as e:
            logger.error(f"Engine health check failed: {e}")
            return None

    def upload_screenshot(self, match_id: str, filepath: str) -> dict | None:
        """Upload screenshot to Engine for server-side OCR processing."""
        try:
            with open(filepath, "rb") as f:
                r = self.client.post(
                    f"{self.base_url}/validate/screenshot",
                    params={"match_id": match_id},
                    files={"file": (os.path.basename(filepath), f, "image/png")},
                    headers={"Authorization": f"Bearer {self.token}"},
                )
            if r.status_code == 200:
                return r.json()
            logger.error(f"Upload failed: {r.status_code} - {r.text}")
        except Exception as e:
            logger.error(f"Failed to upload screenshot: {e}")
        return None


# ── Match Monitor ─────────────────────────────────────────────
class MatchMonitor:
    """
    Core monitoring loop:
    1. Detect if game is running
    2. Capture screenshots at interval
    3. Upload to Engine API for server-side OCR processing
    """

    def __init__(self, config: dict):
        self.config = config
        self.engine = EngineClient(config["engine_url"], config["auth_token"])
        self.running = False
        self.monitoring = False
        self.current_match_id: str | None = None
        self._thread: threading.Thread | None = None
        self._capture_count = 0

    def start(self):
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("Match monitor started")

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=10)
        logger.info("Match monitor stopped")

    def _loop(self):
        while self.running:
            try:
                # Added: auto-detect which supported game is currently running
                game = detect_running_game()

                if not game:
                    # No supported game is running right now – sleep and try again
                    time.sleep(self.config.get("screenshot_interval", 5))
                    continue

                if is_game_running(game):
                    if not self.monitoring:
                        logger.info(f"{game} detected - starting capture")
                        self.monitoring = True

                    game_output_dir = os.path.join(
                        self.config["screenshot_dir"],
                        game.replace(" ", "_"),
                    )

                    # Capture screenshot
                    filepath = capture_screenshot(
                        output_dir=game_output_dir,
                        monitor_num=self.config.get("monitor", 1),
                        game_name=game,
                    )

                    if filepath:
                        self._capture_count += 1
                        logger.info(f"Capture #{self._capture_count}: {os.path.basename(filepath)}")

                        # Upload to Engine API for processing
                        if self.current_match_id:
                            result = self.engine.upload_screenshot(
                                self.current_match_id, filepath
                            )
                            if result:
                                logger.info(f"Engine response: {result}")

                                # Clean up screenshot after successful upload
                                try:
                                    os.remove(filepath)
                                except OSError:
                                    pass
                            else:
                                logger.warning("Engine rejected or offline")
                        else:
                            logger.debug("No active match ID - screenshot saved locally")
                else:
                    if self.monitoring:
                        logger.info(f"{game} closed - pausing capture")
                        self.monitoring = False

            except Exception as e:
                logger.error(f"Monitor loop error: {e}")

            time.sleep(self.config.get("screenshot_interval", 5))

    def set_match_id(self, match_id: str):
        self.current_match_id = match_id
        logger.info(f"Active match set: {match_id}")


# ── System Tray ───────────────────────────────────────────────
class ArenaTray:
    """System tray application with Start/Stop/Settings controls."""

    def __init__(self):
        self.config = load_config()
        self.monitor = MatchMonitor(self.config)
        self.icon: pystray.Icon | None = None

    def create_icon_image(self, color: str = "green") -> Image.Image:
        """Create a simple tray icon."""
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        fill = (0, 200, 80) if color == "green" else (100, 100, 100)
        draw.rounded_rectangle([4, 4, 60, 60], radius=12, fill=fill)
        draw.text((16, 16), "A", fill=(255, 255, 255))
        return img

    def _on_start(self, icon, item):
        self.monitor.start()
        icon.icon = self.create_icon_image("green")
        icon.notify("Arena Client", "Monitoring started")
        logger.info("Tray: Start clicked")

    def _on_stop(self, icon, item):
        self.monitor.stop()
        icon.icon = self.create_icon_image("gray")
        icon.notify("Arena Client", "Monitoring stopped")
        logger.info("Tray: Stop clicked")

    def _on_status(self, icon, item):
        health = self.monitor.engine.health()
        if health and health.get("status") == "ok":
            icon.notify("Engine Status", f"Connected - DB: {health.get('db')}")
        else:
            icon.notify("Engine Status", "Engine offline")

    def _on_quit(self, icon, item):
        self.monitor.stop()
        icon.stop()
        logger.info("Tray: Quit")

    def run(self):
        menu = Menu(
            MenuItem("Start Monitoring", self._on_start),
            MenuItem("Stop Monitoring", self._on_stop),
            MenuItem("Check Engine", self._on_status),
            pystray.Menu.SEPARATOR,
            MenuItem(f"Game: {self.config.get('game', 'CS2')}", None, enabled=False),
            MenuItem(f"Interval: {self.config.get('screenshot_interval', 5)}s", None, enabled=False),
            pystray.Menu.SEPARATOR,
            MenuItem("Quit", self._on_quit),
        )

        self.icon = pystray.Icon(
            "Arena Client",
            self.create_icon_image("gray"),
            "Arena - Match Monitor",
            menu,
        )

        # Auto-start if configured
        if self.config.get("auto_start"):
            self.monitor.start()
            self.icon.icon = self.create_icon_image("green")

        logger.info("Arena Desktop Client started")
        self.icon.run()


# ── Entry Point ───────────────────────────────────────────────
if __name__ == "__main__":
    print("\n  ARENA Desktop Client v1.0.0\n  Match Monitor + Screenshot Capture\n")

    # Save default config if first run
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        logger.info("Created default config.json")

    app = ArenaTray()
    app.run()
