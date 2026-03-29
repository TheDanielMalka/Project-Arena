"""
ARENA Desktop Client - Main Entry Point
Runs as a system tray application that monitors CS2 and Valorant matches,
captures screenshots, and sends them to the Engine API for OCR processing.

Active games (v1):  CS2, Valorant
Coming Soon:        Fortnite, Apex Legends, PUBG, COD, League of Legends
                    → process names kept as comments below as infrastructure.
                      Uncomment and add to ACTIVE_GAME_PROCESSES when supported.

NOTE: All vision/OCR processing happens SERVER-SIDE.
The client only captures screenshots and uploads them.
"""

import sys
import os
import time
import json
import random
import logging
import threading
from datetime import datetime
from logging.handlers import RotatingFileHandler

import signal
import httpx
import mss
import mss.tools
import pystray
from PIL import Image, ImageDraw
from pystray import MenuItem, Menu

# ── Per-game capture intervals (seconds) ──────────────────────
# Only active games listed — Coming Soon games excluded from detection.
# To enable a new game: add its interval here + add its process to ACTIVE_GAME_PROCESSES.
GAME_INTERVALS = {
    "AUTO":     5,   # fallback when auto-detecting
    "CS2":      3,   # fast-paced – capture more often
    "Valorant": 5,
    # Coming Soon — uncomment when Arena Client adds support:
    # "Fortnite":     5,
    # "Apex Legends": 5,
    # "PUBG":         5,
    # "COD":          5,
    # "League of Legends": 8,
}

# ── Config ────────────────────────────────────────────────────
# When running as a frozen exe (PyInstaller), use the exe's directory.
# When running as a script, use the script's directory.
if getattr(sys, "frozen", False):
    _BASE_DIR = os.path.dirname(sys.executable)
else:
    _BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CONFIG_FILE = os.path.join(_BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "engine_url": "http://localhost:8000",
    "auth_token": "",
    "screenshot_interval": 5,
    "monitor": 1,
    "auto_start": True,
    "minimize_to_tray": True,
    # AUTO: client will auto-detect active games (CS2 / Valorant).
    # Coming Soon games (Fortnite, Apex, PUBG, COD, LoL) not detected until enabled.
    "game": "AUTO",
    "screenshot_dir": os.path.join(_BASE_DIR, "screenshots"),
    "log_dir": os.path.join(_BASE_DIR, "logs"),
    # DB-ready: wallet_address synced from user account after login
    "wallet_address": "unknown",
    # Bumped on each EXE release; surfaced in GET /client/status
    "client_version": "1.0.0",
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
# ACTIVE_GAME_PROCESSES: only CS2 and Valorant detected in v1.
# Coming Soon processes kept as comments — uncomment when Arena Client adds support.
ACTIVE_GAME_PROCESSES: dict[str, list[str]] = {
    "CS2":      ["cs2.exe", "csgo.exe"],
    "Valorant": ["VALORANT-Win64-Shipping.exe"],
    # "Fortnite":           ["FortniteClient-Win64-Shipping.exe"],  # Coming Soon
    # "Apex Legends":       ["r5apex.exe"],                         # Coming Soon
    # "PUBG":               ["TslGame.exe"],                        # Coming Soon
    # "COD":                ["cod.exe", "BlackOpsColdWar.exe"],     # Coming Soon
    # "League of Legends":  ["League of Legends.exe"],              # Coming Soon
}

def is_game_running(game: str = "CS2") -> bool:
    """Check if the target game process is running. Only active games are checked."""
    try:
        import psutil
        target = ACTIVE_GAME_PROCESSES.get(game, [])
        for proc in psutil.process_iter(["name"]):
            if proc.info["name"] and proc.info["name"].lower() in [p.lower() for p in target]:
                return True
    except ImportError:
        logger.warning("psutil not installed - skipping game detection")
    except Exception as e:
        logger.error(f"Error checking game process: {e}")
    return False

def detect_running_game() -> str | None:
    """Auto-detect which active game is currently running. Coming Soon games are skipped."""
    try:
        import psutil
        for game, procs in ACTIVE_GAME_PROCESSES.items():
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

    def get_active_match(self, wallet_address: str) -> str | None:
        """
        Poll GET /client/match to check if there is an active match for this wallet.

        Returns the match_id string, or None if no active match exists or
        the engine is unreachable.

        DB-ready: engine queries matches table once available.
        """
        try:
            r = self.client.get(
                f"{self.base_url}/client/match",
                params={"wallet_address": wallet_address},
                timeout=5,
            )
            if r.status_code == 200:
                return r.json().get("match_id")
        except Exception as e:
            logger.debug(f"Active match poll failed (non-fatal): {e}")
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
    4. Send heartbeat to Engine so the web UI shows the client as connected
    """

    # Heartbeat interval in seconds — keep in sync with engine _CLIENT_TIMEOUT_SECONDS (30s)
    _HEARTBEAT_INTERVAL = 15

    def __init__(self, config: dict):
        self.config = config
        self.engine = EngineClient(config["engine_url"], config["auth_token"])
        self.running = False
        self.monitoring = False
        self.current_match_id: str | None = None
        self._thread: threading.Thread | None = None
        self._heartbeat_thread: threading.Thread | None = None
        self._capture_count = 0
        self._heartbeat_stop = threading.Event()

    def start(self):
        if self.running:
            return
        self.running = True
        self._heartbeat_stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, daemon=True, name="ArenaHeartbeat"
        )
        self._heartbeat_thread.start()
        logger.info("Match monitor started")

    def stop(self):
        self.running = False
        self._heartbeat_stop.set()
        if self._thread:
            self._thread.join(timeout=10)
        if self._heartbeat_thread:
            self._heartbeat_thread.join(timeout=5)
        logger.info("Match monitor stopped")

    def _loop(self):
        while self.running:
            try:
                # Added: auto-detect which supported game is currently running
                game = detect_running_game()

                if not game:
                    # No supported game is running right now – sleep and try again
                    base = self.config.get("screenshot_interval", 5)
                    time.sleep(base + random.uniform(-0.5, 0.5))
                    continue

                if is_game_running(game):
                    if not self.monitoring:
                        logger.info(f"{game} detected - starting capture")
                        self.monitoring = True

                    # Auto-fetch match_id from engine when game is running but
                    # no active match is set yet.
                    # DB-ready: engine returns real match_id once matches table exists.
                    if not self.current_match_id:
                        wallet = self.config.get("wallet_address", "unknown")
                        match_id_from_engine = self.engine.get_active_match(wallet)
                        if match_id_from_engine:
                            self.set_match_id(match_id_from_engine)
                            logger.info(f"Active match auto-detected: {match_id_from_engine}")

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
                        # Clear match_id so the next game session fetches a fresh one
                        self.current_match_id = None

            except Exception as e:
                logger.error(f"Monitor loop error: {e}")

            # In AUTO mode use the per-game interval; fall back to config value
            # when no game is detected or the game is manually selected.
            active_game = detect_running_game()
            base = GAME_INTERVALS.get(active_game, self.config.get("screenshot_interval", 5))
            time.sleep(base + random.uniform(-0.5, 0.5))

    def _heartbeat_loop(self):
        """
        Send a heartbeat to POST /client/heartbeat every _HEARTBEAT_INTERVAL
        seconds so the web UI can display the "Client Connected" badge.

        Non-fatal — a failed heartbeat never interrupts capture.
        """
        logger.debug(f"Heartbeat loop started (interval={self._HEARTBEAT_INTERVAL}s)")
        while not self._heartbeat_stop.wait(timeout=self._HEARTBEAT_INTERVAL):
            self._send_heartbeat()
        logger.debug("Heartbeat loop stopped")

    def _send_heartbeat(self):
        """POST /client/heartbeat — tells the engine (and web UI) this client is online."""
        try:
            game = detect_running_game()
            status = (
                "in_match" if self.current_match_id
                else ("in_game" if game else "idle")
            )
            payload = {
                "wallet_address": self.config.get("wallet_address", "unknown"),
                "client_version": self.config.get("client_version", "1.0.0"),
                "status": status,
                "game": game,
                "session_id": None,        # DB-ready: attach session UUID once client_sessions table exists
                "match_id": self.current_match_id,
            }
            resp = self.engine.client.post(
                f"{self.engine.base_url}/client/heartbeat",
                json=payload,
                timeout=5,
            )
            if resp.status_code == 200:
                logger.debug(f"Heartbeat OK | status={status} | game={game}")
            else:
                logger.warning(f"Heartbeat rejected: {resp.status_code}")
        except Exception as e:
            logger.debug(f"Heartbeat error (non-fatal): {e}")

    def set_match_id(self, match_id: str):
        self.current_match_id = match_id
        logger.info(f"Active match set: {match_id}")


# ── System Tray ───────────────────────────────────────────────
class ArenaTray:
    """System tray application with Arena branding, ON/OFF toggle, and game selector."""

    def __init__(self):
        self.config = load_config()
        self.monitor = MatchMonitor(self.config)
        self.icon: pystray.Icon | None = None
        self._monitoring_enabled = False
        self._selected_game = self.config.get("game", "AUTO")

    def create_icon_image(self, active: bool = True) -> Image.Image:
        """Create Arena-branded tray icon with stylized 'A' logo."""
        size = 128
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Dark circular background
        draw.ellipse([2, 2, size - 2, size - 2], fill=(12, 12, 18, 255))

        # Colored ring – green when active, gray when inactive
        ring_color = (0, 230, 118, 255) if active else (70, 70, 80, 255)
        draw.ellipse([2, 2, size - 2, size - 2], outline=ring_color, width=5)

        # Stylized "A" drawn as lines (no external font needed)
        lw = 8
        cx = size // 2
        text_color = (0, 230, 118, 255) if active else (100, 100, 110, 255)

        top  = (cx, 18)               # apex of the A
        bl   = (18, size - 18)        # bottom-left foot
        br   = (size - 18, size - 18) # bottom-right foot
        cb_l = (32, 76)               # crossbar left
        cb_r = (size - 32, 76)        # crossbar right

        draw.line([top, bl],    fill=text_color, width=lw)
        draw.line([top, br],    fill=text_color, width=lw)
        draw.line([cb_l, cb_r], fill=text_color, width=lw)

        # Status dot in the bottom-right corner
        dot_color = (0, 230, 118, 255) if active else (80, 80, 90, 255)
        draw.ellipse([size - 30, size - 30, size - 8, size - 8], fill=dot_color)

        return img

    # ── Game selection ────────────────────────────────────────
    def _set_game(self, game: str):
        """Select a game and lock its interval."""
        self._selected_game = game
        interval = GAME_INTERVALS.get(game, 5)
        self.config["game"] = game
        self.config["screenshot_interval"] = interval
        self.monitor.config["game"] = game
        self.monitor.config["screenshot_interval"] = interval
        save_config(self.config)
        logger.info(f"Game set to {game}, interval locked to {interval}s")
        if self.icon:
            self.icon.update_menu()

    def _make_game_item(self, game: str) -> MenuItem:
        label = f"{game}  ({GAME_INTERVALS[game]}s)" if game != "AUTO" else "AUTO (detect)"

        def _action(icon, item):       # exactly 2 args → pystray accepts it
            self._set_game(game)

        def _checked(item):            # exactly 1 arg  → pystray accepts it
            return self._selected_game == game

        return MenuItem(label, _action, checked=_checked)

    # ── Monitoring toggle ─────────────────────────────────────
    def _toggle_monitoring(self, icon, item):
        if self._monitoring_enabled:
            self.monitor.stop()
            self._monitoring_enabled = False
            icon.icon = self.create_icon_image(active=False)
            icon.notify("Arena Client", "Monitoring OFF")
            logger.info("Tray: Monitoring disabled")
        else:
            self.monitor.start()
            self._monitoring_enabled = True
            icon.icon = self.create_icon_image(active=True)
            icon.notify("Arena Client", "Monitoring ON")
            logger.info("Tray: Monitoring enabled")

    # ── Other actions ─────────────────────────────────────────
    def _on_status(self, icon, item):
        health = self.monitor.engine.health()
        if health and health.get("status") == "ok":
            icon.notify("Engine Status", f"Connected · DB: {health.get('db', 'ok')}")
        else:
            icon.notify("Engine Status", "Engine offline or unreachable")

    def _on_help(self, icon, item):
        import webbrowser
        webbrowser.open("https://github.com/TheDanielMalka/ProjectArena#readme")

    def _shutdown(self):
        """Cleanly stop monitor and exit the process."""
        logger.info("Arena Client shutting down...")
        self.monitor.stop()
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass
        os._exit(0)

    def _on_quit(self, icon, item):
        self._shutdown()

    # ── Run ───────────────────────────────────────────────────
    def run(self):
        self._monitoring_enabled = bool(self.config.get("auto_start", False))
        self._selected_game = self.config.get("game", "AUTO")

        menu = Menu(
            MenuItem("Arena Client", None, enabled=False),
            Menu.SEPARATOR,
            MenuItem(
                "Monitoring",
                self._toggle_monitoring,
                checked=lambda item: self._monitoring_enabled,
            ),
            MenuItem("Game", Menu(
                self._make_game_item("AUTO"),
                self._make_game_item("CS2"),
                self._make_game_item("Valorant"),
                # Coming Soon — uncomment when Arena Client adds support:
                # self._make_game_item("Fortnite"),
                # self._make_game_item("Apex Legends"),
                # self._make_game_item("PUBG"),
                # self._make_game_item("COD"),
                # self._make_game_item("League of Legends"),
            )),
            MenuItem("Check Engine", self._on_status),
            Menu.SEPARATOR,
            MenuItem("Help", self._on_help),
            MenuItem("Quit", self._on_quit),
        )

        self.icon = pystray.Icon(
            "Arena",
            self.create_icon_image(self._monitoring_enabled),
            "Arena - Match Monitor",
            menu,
        )

        if self._monitoring_enabled:
            self.monitor.start()

        # Handle Ctrl+C and SIGTERM gracefully
        def _signal_handler(sig, frame):
            self._shutdown()

        signal.signal(signal.SIGINT, _signal_handler)
        signal.signal(signal.SIGTERM, _signal_handler)

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
