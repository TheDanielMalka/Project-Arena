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
import uuid
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

CLIENT_VERSION = "1.0.0"

# ── Brand design tokens (keep in sync with Arena website) ────────────────────
BRAND = {
    "bg":          "#0C0C12",
    "bg_card":     "#13131A",
    "bg_hover":    "#1A1A24",
    "accent":      "#00E676",
    "accent_dark": "#00B85C",
    "text":        "#FFFFFF",
    "text_muted":  "#8888AA",
    "border":      "#2A2A3A",
    "error":       "#FF4444",
    "warning":     "#FFB800",
    # PIL tuples for icon drawing
    "accent_pil":  (0, 230, 118, 255),
    "idle_pil":    (70, 70, 90, 255),
    "error_pil":   (255, 68, 68, 255),
    "match_pil":   (255, 184, 0, 255),
    "bg_pil":      (12, 12, 18, 255),
}

# ── Per-game capture intervals (seconds) ─────────────────────────────────────
GAME_INTERVALS = {
    "AUTO":     5,
    "CS2":      3,
    "Valorant": 5,
    # Coming Soon:
    # "Fortnite":           5,
    # "Apex Legends":       5,
    # "PUBG":               5,
    # "COD":                5,
    # "League of Legends":  8,
}

# ── Config ────────────────────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    _BASE_DIR = os.path.dirname(sys.executable)
else:
    _BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CONFIG_FILE = os.path.join(_BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "engine_url":          "http://localhost:8000",
    "auth_token":          "",
    "screenshot_interval": 5,
    "monitor":             1,
    "auto_start":          True,
    "minimize_to_tray":    True,
    "game":                "AUTO",
    "screenshot_dir":      os.path.join(_BASE_DIR, "screenshots"),
    "log_dir":             os.path.join(_BASE_DIR, "logs"),
    # DB-ready: synced from user account after login
    "wallet_address":      "unknown",
    "client_version":      CLIENT_VERSION,
    # Phase 3 auth fields — populated on login
    "user_id":             None,
    "username":            None,
    # Phase 4: stable UUID persisted across restarts; sent in every heartbeat
    "session_id":          None,
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


def get_or_create_session_id(config: dict) -> str:
    """
    Return the persisted session UUID for this installation.
    Creates and saves a new one if not present.

    Phase 4-ready: sent in every heartbeat so the engine can link
    multiple heartbeats from the same install to one client_sessions row.
    """
    existing = config.get("session_id")
    if existing:
        return existing
    new_id = str(uuid.uuid4())
    config["session_id"] = new_id
    save_config(config)
    return new_id


def check_version_compat(engine_client: "EngineClient") -> bool:
    """
    Phase 4-ready: compare CLIENT_VERSION against engine's /version endpoint.
    Returns True (always compatible) until the endpoint exists.
    """
    # Phase 4: result = engine_client.check_version(CLIENT_VERSION)
    return True


# ── Logging ───────────────────────────────────────────────────────────────────
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


# ── Auth Manager ──────────────────────────────────────────────────────────────
class AuthManager:
    """
    Manages Bearer token auth for the Arena desktop client.

    Desktop client uses Bearer tokens (not httpOnly cookies — those are for
    the web UI).  Tokens are stored in config.json and sent with every
    authenticated request via EngineClient.

    Phase 3-ready:
      - login() / logout() / refresh() stubs are here for Phase 3 wiring
      - Once /auth/login exists on the engine, replace the stubs with real calls
      - wallet_address / user_id / username are synced from the server on login
    """

    def __init__(self, config: dict):
        self._config = config

    # ── Read-only properties ──────────────────────────────────────────────────

    @property
    def is_authenticated(self) -> bool:
        return bool(self._config.get("auth_token"))

    @property
    def access_token(self) -> str | None:
        return self._config.get("auth_token") or None

    @property
    def user_id(self) -> str | None:
        return self._config.get("user_id")

    @property
    def username(self) -> str | None:
        return self._config.get("username")

    @property
    def wallet_address(self) -> str:
        return self._config.get("wallet_address", "unknown")

    # ── Mutations ─────────────────────────────────────────────────────────────

    def set_token(self, token: str, user_id: str | None = None,
                  username: str | None = None, wallet_address: str | None = None):
        """Persist token and identity fields after successful login."""
        self._config["auth_token"] = token
        if user_id:
            self._config["user_id"] = user_id
        if username:
            self._config["username"] = username
        if wallet_address:
            self._config["wallet_address"] = wallet_address
        save_config(self._config)
        logger.info("Auth token saved")

    def clear(self):
        """Wipe all auth state (logout)."""
        self._config["auth_token"] = ""
        self._config["user_id"] = None
        self._config["username"] = None
        self._config["wallet_address"] = "unknown"
        save_config(self._config)
        logger.info("Auth cleared")

    # ── Phase 3 stubs ─────────────────────────────────────────────────────────

    def login(self, engine_client: "EngineClient", username: str, password: str) -> bool:
        """
        Phase 3: POST /auth/login → receive Bearer token → call set_token().
        Returns True on success, False on failure.

        Stub: always returns False until the endpoint is implemented.
        """
        # Phase 3:
        # result = engine_client.login(username, password)
        # if result and result.get("token"):
        #     self.set_token(result["token"], result.get("user_id"),
        #                    result.get("username"), result.get("wallet_address"))
        #     return True
        return False

    def logout(self):
        """Phase 3: POST /auth/logout → clear local token."""
        self.clear()

    def refresh(self, engine_client: "EngineClient") -> bool:
        """
        Phase 3: POST /auth/refresh → update access_token.
        Stub: returns True (no-op) until the endpoint exists.
        """
        return True


# ── Screenshot Capture ────────────────────────────────────────────────────────
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


# ── Game Detection ────────────────────────────────────────────────────────────
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
    """Check if the target game process is running."""
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
    """Auto-detect which active game is currently running."""
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


# ── Engine API Client ─────────────────────────────────────────────────────────
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
        Poll GET /client/match — returns match_id or None.
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

    def login(self, username: str, password: str) -> dict | None:
        """
        Phase 3: POST /auth/login → {"token": "...", "user_id": "...", "username": "...", "wallet_address": "..."}
        Stub: returns None until endpoint exists.
        """
        # Phase 3:
        # try:
        #     r = self.client.post(f"{self.base_url}/auth/login",
        #                          json={"username": username, "password": password})
        #     if r.status_code == 200:
        #         return r.json()
        # except Exception as e:
        #     logger.error(f"Login failed: {e}")
        return None

    def check_version(self, client_version: str) -> dict | None:
        """
        Phase 4: GET /version → {"min_version": "...", "latest": "..."}
        Stub: returns None until endpoint exists.
        """
        return None


# ── Match Monitor ─────────────────────────────────────────────────────────────
class MatchMonitor:
    """
    Core monitoring loop:
    1. Detect if a supported game is running
    2. Capture screenshots at game-specific interval
    3. Upload to Engine API for server-side OCR
    4. Send heartbeat every _HEARTBEAT_INTERVAL seconds
    """

    _HEARTBEAT_INTERVAL = 15  # keep < engine _CLIENT_TIMEOUT_SECONDS (30s)

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
        self._session_id = get_or_create_session_id(config)

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
                game = detect_running_game()

                if not game:
                    base = self.config.get("screenshot_interval", 5)
                    time.sleep(base + random.uniform(-0.5, 0.5))
                    continue

                if is_game_running(game):
                    if not self.monitoring:
                        logger.info(f"{game} detected - starting capture")
                        self.monitoring = True

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

                    filepath = capture_screenshot(
                        output_dir=game_output_dir,
                        monitor_num=self.config.get("monitor", 1),
                        game_name=game,
                    )

                    if filepath:
                        self._capture_count += 1
                        logger.info(f"Capture #{self._capture_count}: {os.path.basename(filepath)}")

                        if self.current_match_id:
                            result = self.engine.upload_screenshot(self.current_match_id, filepath)
                            if result:
                                logger.info(f"Engine response: {result}")
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
                        self.current_match_id = None

            except Exception as e:
                logger.error(f"Monitor loop error: {e}")

            active_game = detect_running_game()
            base = GAME_INTERVALS.get(active_game, self.config.get("screenshot_interval", 5))
            time.sleep(base + random.uniform(-0.5, 0.5))

    def _heartbeat_loop(self):
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
                "wallet_address":  self.config.get("wallet_address", "unknown"),
                "client_version":  self.config.get("client_version", CLIENT_VERSION),
                "status":          status,
                "game":            game,
                # Phase 4-ready: stable UUID ties heartbeats to one client_sessions row
                "session_id":      self._session_id,
                "match_id":        self.current_match_id,
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


# ── Icon Rendering ────────────────────────────────────────────────────────────
def _draw_arena_icon(size: int = 128, active: bool = True,
                     state: str = "idle") -> Image.Image:
    """
    Draw the Arena 'A' tray icon.

    state:
      "active"  — green ring + green A  (monitoring ON, no game)
      "match"   — amber ring + amber A  (match in progress)
      "error"   — red ring + dim A      (engine unreachable)
      "idle"    — gray ring + gray A    (monitoring OFF)
    """
    state_colors = {
        "active": (BRAND["accent_pil"], BRAND["accent_pil"]),
        "match":  (BRAND["match_pil"],  BRAND["match_pil"]),
        "error":  (BRAND["error_pil"],  BRAND["idle_pil"]),
        "idle":   (BRAND["idle_pil"],   BRAND["idle_pil"]),
    }
    ring_color, glyph_color = state_colors.get(state, state_colors["idle"])

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Circular background
    draw.ellipse([2, 2, size - 2, size - 2], fill=BRAND["bg_pil"])
    # Colored ring
    draw.ellipse([2, 2, size - 2, size - 2], outline=ring_color, width=max(4, size // 28))

    # Stylized "A" glyph
    lw  = max(6, size // 18)
    cx  = size // 2
    pad = int(size * 0.14)

    top  = (cx, pad)
    bl   = (pad, size - pad)
    br   = (size - pad, size - pad)
    # Crossbar at 52% height gives a balanced look at all sizes
    cb_y = int(size * 0.52)
    inset = int(size * 0.25)
    cb_l = (inset, cb_y)
    cb_r = (size - inset, cb_y)

    draw.line([top, bl],    fill=glyph_color, width=lw)
    draw.line([top, br],    fill=glyph_color, width=lw)
    draw.line([cb_l, cb_r], fill=glyph_color, width=lw)

    # Status dot — bottom-right corner
    dot_r = max(8, size // 10)
    dot_x = size - dot_r - int(size * 0.04)
    dot_y = size - dot_r - int(size * 0.04)
    draw.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r],
                 fill=ring_color)

    return img


def generate_ico_file(path: str = "assets/arena_icon.ico"):
    """
    Generate a multi-resolution ICO file for use as the exe and tray icon.
    Sizes: 16, 24, 32, 48, 64, 128, 256 px — all in one .ico container.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [_draw_arena_icon(s, state="active").resize((s, s), Image.LANCZOS)
              for s in sizes]
    # PIL saves all frames as a single multi-size ICO when sizes= is specified
    frames[0].save(
        path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=frames[1:],
    )
    logger.info(f"ICO saved: {path} ({sizes}px)")


# ── Client Window (customtkinter) ─────────────────────────────────────────────
def _build_client_window(monitor: "MatchMonitor", auth: "AuthManager",
                         config: dict) -> None:
    """
    Build and show the Arena Client window using customtkinter.
    Must be called from the main thread (tkinter requirement on Windows).

    Layout:
      ┌─────────────────────────────┐
      │  ARENA  [badge]             │ ← header
      ├─────────────────────────────┤
      │  Engine status card         │
      │  Identity card (login/out)  │
      │  Game status card           │
      │  Monitoring toggle          │
      ├─────────────────────────────┤
      │  [Check Engine] [Website]   │ ← footer
      │  [Quit]                     │
      └─────────────────────────────┘
    """
    try:
        import customtkinter as ctk
    except ImportError:
        logger.error("customtkinter not installed — window unavailable. "
                     "Run: pip install customtkinter")
        return

    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")

    win = ctk.CTk()
    win.title("Arena Client")
    win.geometry("360x520")
    win.resizable(False, False)
    win.configure(fg_color=BRAND["bg"])
    win.attributes("-topmost", False)

    # ── Close → hide to tray (don't destroy) ─────────────────────────────────
    def _on_close():
        win.withdraw()

    win.protocol("WM_DELETE_WINDOW", _on_close)

    # ── Header ────────────────────────────────────────────────────────────────
    header = ctk.CTkFrame(win, fg_color=BRAND["bg_card"], corner_radius=0, height=56)
    header.pack(fill="x")
    header.pack_propagate(False)

    ctk.CTkLabel(
        header, text="ARENA", font=ctk.CTkFont(size=20, weight="bold"),
        text_color=BRAND["accent"],
    ).pack(side="left", padx=16, pady=14)

    version_label = ctk.CTkLabel(
        header, text=f"v{CLIENT_VERSION}",
        font=ctk.CTkFont(size=11),
        text_color=BRAND["text_muted"],
    )
    version_label.pack(side="right", padx=16, pady=14)

    # ── Scrollable body ───────────────────────────────────────────────────────
    body = ctk.CTkScrollableFrame(win, fg_color=BRAND["bg"], corner_radius=0)
    body.pack(fill="both", expand=True, padx=0, pady=0)

    def _card(parent, title: str) -> ctk.CTkFrame:
        outer = ctk.CTkFrame(parent, fg_color=BRAND["bg_card"], corner_radius=10)
        outer.pack(fill="x", padx=14, pady=(10, 0))
        ctk.CTkLabel(
            outer, text=title.upper(),
            font=ctk.CTkFont(size=10, weight="bold"),
            text_color=BRAND["text_muted"],
        ).pack(anchor="w", padx=14, pady=(10, 2))
        return outer

    def _dot(parent, color: str = BRAND["text_muted"]) -> ctk.CTkLabel:
        return ctk.CTkLabel(parent, text="●", text_color=color,
                            font=ctk.CTkFont(size=10))

    # ── Engine status card ────────────────────────────────────────────────────
    eng_card = _card(body, "Engine")
    eng_row  = ctk.CTkFrame(eng_card, fg_color="transparent")
    eng_row.pack(fill="x", padx=14, pady=(0, 12))

    eng_dot   = _dot(eng_row, BRAND["text_muted"])
    eng_dot.pack(side="left")
    eng_label = ctk.CTkLabel(eng_row, text="Checking…",
                             font=ctk.CTkFont(size=13),
                             text_color=BRAND["text"])
    eng_label.pack(side="left", padx=(6, 0))

    def _refresh_engine_status():
        health = monitor.engine.health()
        if health and health.get("status") == "ok":
            db_status = health.get("db", "?")
            eng_label.configure(text=f"Connected  ·  DB: {db_status}",
                                 text_color=BRAND["text"])
            eng_dot.configure(text_color=BRAND["accent"])
        else:
            eng_label.configure(text="Engine offline", text_color=BRAND["text_muted"])
            eng_dot.configure(text_color=BRAND["error"])

    threading.Thread(target=_refresh_engine_status, daemon=True).start()

    # ── Identity card ─────────────────────────────────────────────────────────
    id_card = _card(body, "Identity")

    def _build_identity_content():
        for w in id_card.winfo_children():
            if isinstance(w, ctk.CTkFrame) and w != id_card:
                w.destroy()

        id_inner = ctk.CTkFrame(id_card, fg_color="transparent")
        id_inner.pack(fill="x", padx=14, pady=(0, 12))

        if auth.is_authenticated:
            display = auth.username or auth.wallet_address
            ctk.CTkLabel(id_inner, text=display,
                          font=ctk.CTkFont(size=13, weight="bold"),
                          text_color=BRAND["accent"]).pack(anchor="w")
            if auth.wallet_address and auth.wallet_address != "unknown":
                short_wallet = f"{auth.wallet_address[:6]}…{auth.wallet_address[-4:]}"
                ctk.CTkLabel(id_inner, text=short_wallet,
                              font=ctk.CTkFont(size=11),
                              text_color=BRAND["text_muted"]).pack(anchor="w")
            ctk.CTkButton(
                id_inner, text="Disconnect", height=30, corner_radius=6,
                fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
                text_color=BRAND["text_muted"], font=ctk.CTkFont(size=12),
                command=_do_logout,
            ).pack(anchor="w", pady=(8, 0))
        else:
            ctk.CTkLabel(id_inner, text="Not connected",
                          font=ctk.CTkFont(size=13),
                          text_color=BRAND["text_muted"]).pack(anchor="w")
            ctk.CTkLabel(
                id_inner,
                text="Log in on arena.gg to link your account",
                font=ctk.CTkFont(size=11),
                text_color=BRAND["text_muted"],
                wraplength=290,
            ).pack(anchor="w", pady=(4, 0))
            # Phase 3: replace this label with a login form / OAuth button
            ctk.CTkButton(
                id_inner, text="Open Website", height=30, corner_radius=6,
                fg_color=BRAND["accent"], hover_color=BRAND["accent_dark"],
                text_color=BRAND["bg"], font=ctk.CTkFont(size=12, weight="bold"),
                command=_open_website,
            ).pack(anchor="w", pady=(8, 0))

    def _do_logout():
        auth.logout()
        config["auth_token"] = ""
        monitor.engine.token = ""
        _build_identity_content()

    _build_identity_content()

    # ── Game status card ──────────────────────────────────────────────────────
    game_card = _card(body, "Game Status")
    game_row  = ctk.CTkFrame(game_card, fg_color="transparent")
    game_row.pack(fill="x", padx=14, pady=(0, 12))

    game_dot   = _dot(game_row, BRAND["text_muted"])
    game_dot.pack(side="left")
    game_label = ctk.CTkLabel(game_row, text="No game detected",
                               font=ctk.CTkFont(size=13),
                               text_color=BRAND["text"])
    game_label.pack(side="left", padx=(6, 0))

    match_label = ctk.CTkLabel(game_card, text="",
                                font=ctk.CTkFont(size=11),
                                text_color=BRAND["text_muted"])
    match_label.pack(anchor="w", padx=14, pady=(0, 8))

    def _poll_game_status():
        while True:
            try:
                game = detect_running_game()
                if game:
                    game_label.configure(text=game, text_color=BRAND["text"])
                    game_dot.configure(text_color=BRAND["accent"])
                else:
                    game_label.configure(text="No game detected",
                                          text_color=BRAND["text_muted"])
                    game_dot.configure(text_color=BRAND["text_muted"])

                if monitor.current_match_id:
                    short_id = monitor.current_match_id[:8]
                    match_label.configure(text=f"Match #{short_id}…",
                                           text_color=BRAND["match_pil"][:3])
                else:
                    match_label.configure(text="")
            except Exception:
                pass
            time.sleep(4)

    threading.Thread(target=_poll_game_status, daemon=True).start()

    # ── Monitoring toggle ─────────────────────────────────────────────────────
    mon_card = _card(body, "Monitoring")
    mon_row  = ctk.CTkFrame(mon_card, fg_color="transparent")
    mon_row.pack(fill="x", padx=14, pady=(0, 12))

    mon_var = ctk.BooleanVar(value=monitor.running)

    mon_status_label = ctk.CTkLabel(
        mon_row, text="ON" if monitor.running else "OFF",
        font=ctk.CTkFont(size=12, weight="bold"),
        text_color=BRAND["accent"] if monitor.running else BRAND["text_muted"],
        width=36,
    )
    mon_status_label.pack(side="left")

    def _on_toggle():
        if mon_var.get():
            monitor.start()
            mon_status_label.configure(text="ON", text_color=BRAND["accent"])
        else:
            monitor.stop()
            mon_status_label.configure(text="OFF", text_color=BRAND["text_muted"])

    ctk.CTkSwitch(
        mon_row,
        text="Capture & upload screenshots",
        variable=mon_var,
        onvalue=True, offvalue=False,
        command=_on_toggle,
        font=ctk.CTkFont(size=12),
        text_color=BRAND["text"],
        button_color=BRAND["accent"],
        button_hover_color=BRAND["accent_dark"],
        progress_color=BRAND["accent_dark"],
    ).pack(side="left", padx=(8, 0))

    # ── Footer buttons ────────────────────────────────────────────────────────
    footer = ctk.CTkFrame(win, fg_color=BRAND["bg_card"], corner_radius=0, height=70)
    footer.pack(fill="x", side="bottom")
    footer.pack_propagate(False)

    btn_row = ctk.CTkFrame(footer, fg_color="transparent")
    btn_row.pack(expand=True)

    def _check_engine():
        threading.Thread(target=_refresh_engine_status, daemon=True).start()

    def _open_website():
        import webbrowser
        webbrowser.open("https://arena.gg")

    def _quit_app():
        monitor.stop()
        win.destroy()
        os._exit(0)

    ctk.CTkButton(
        btn_row, text="Check Engine", width=100, height=32, corner_radius=6,
        fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
        text_color=BRAND["text"], font=ctk.CTkFont(size=12),
        command=_check_engine,
    ).pack(side="left", padx=4, pady=12)

    ctk.CTkButton(
        btn_row, text="Open Website", width=100, height=32, corner_radius=6,
        fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
        text_color=BRAND["text"], font=ctk.CTkFont(size=12),
        command=_open_website,
    ).pack(side="left", padx=4, pady=12)

    ctk.CTkButton(
        btn_row, text="Quit", width=70, height=32, corner_radius=6,
        fg_color=BRAND["error"], hover_color="#CC3333",
        text_color=BRAND["text"], font=ctk.CTkFont(size=12),
        command=_quit_app,
    ).pack(side="left", padx=4, pady=12)

    win.mainloop()


# ── System Tray ───────────────────────────────────────────────────────────────
class ArenaTray:
    """
    System tray entry point.

    Architecture (Windows):
      - pystray runs in a background thread via icon.run_detached()
      - customtkinter ClientWindow owns the main thread (tkinter requirement)
      - Clicking "Open Arena" in tray menu shows/raises the window

    Phase 4-ready: version compat check wired here before window opens.
    """

    def __init__(self):
        self.config    = load_config()
        self.auth      = AuthManager(self.config)
        self.monitor   = MatchMonitor(self.config)
        self.icon: pystray.Icon | None = None
        self._monitoring_enabled = False
        self._selected_game = self.config.get("game", "AUTO")
        self._window_open  = False

    # ── Icon state helpers ────────────────────────────────────────────────────
    def _icon_state(self) -> str:
        if self.monitor.current_match_id:
            return "match"
        if self._monitoring_enabled:
            return "active"
        return "idle"

    def _get_icon_image(self) -> Image.Image:
        return _draw_arena_icon(128, state=self._icon_state())

    # ── Game selection ────────────────────────────────────────────────────────
    def _set_game(self, game: str):
        self._selected_game = game
        interval = GAME_INTERVALS.get(game, 5)
        self.config["game"] = game
        self.config["screenshot_interval"] = interval
        self.monitor.config["game"] = game
        self.monitor.config["screenshot_interval"] = interval
        save_config(self.config)
        logger.info(f"Game set to {game}, interval={interval}s")
        if self.icon:
            self.icon.update_menu()

    def _make_game_item(self, game: str) -> MenuItem:
        label = f"{game}  ({GAME_INTERVALS[game]}s)" if game != "AUTO" else "AUTO (detect)"

        def _action(icon, item):
            self._set_game(game)

        def _checked(item):
            return self._selected_game == game

        return MenuItem(label, _action, checked=_checked)

    # ── Monitoring toggle ─────────────────────────────────────────────────────
    def _toggle_monitoring(self, icon, item):
        if self._monitoring_enabled:
            self.monitor.stop()
            self._monitoring_enabled = False
            icon.icon = _draw_arena_icon(128, state="idle")
            icon.notify("Arena Client", "Monitoring OFF")
        else:
            self.monitor.start()
            self._monitoring_enabled = True
            icon.icon = _draw_arena_icon(128, state="active")
            icon.notify("Arena Client", "Monitoring ON")

    # ── Open window ───────────────────────────────────────────────────────────
    def _on_open(self, icon, item):
        """Open (or raise) the Arena Client window."""
        # Window must be built/shown from the main thread.
        # Signal the main thread loop to build it.
        self._window_requested = True

    # ── Status check ─────────────────────────────────────────────────────────
    def _on_status(self, icon, item):
        health = self.monitor.engine.health()
        if health and health.get("status") == "ok":
            icon.notify("Engine Status", f"Connected · DB: {health.get('db', 'ok')}")
        else:
            icon.notify("Engine Status", "Engine offline or unreachable")

    # ── Quit ─────────────────────────────────────────────────────────────────
    def _shutdown(self):
        logger.info("Arena Client shutting down…")
        self.monitor.stop()
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass
        os._exit(0)

    def _on_quit(self, icon, item):
        self._shutdown()

    # ── Run ───────────────────────────────────────────────────────────────────
    def run(self):
        self._monitoring_enabled = bool(self.config.get("auto_start", False))
        self._selected_game = self.config.get("game", "AUTO")
        self._window_requested = False

        # Phase 4: version compat check before anything else
        check_version_compat(self.monitor.engine)

        menu = Menu(
            MenuItem("Arena Client", None, enabled=False),
            Menu.SEPARATOR,
            MenuItem("Open Arena",    self._on_open),
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
                # Coming Soon:
                # self._make_game_item("Fortnite"),
                # self._make_game_item("Apex Legends"),
                # self._make_game_item("PUBG"),
                # self._make_game_item("COD"),
                # self._make_game_item("League of Legends"),
            )),
            MenuItem("Check Engine", self._on_status),
            Menu.SEPARATOR,
            MenuItem("Quit", self._on_quit),
        )

        self.icon = pystray.Icon(
            "Arena",
            self._get_icon_image(),
            "Arena - Match Monitor",
            menu,
        )

        if self._monitoring_enabled:
            self.monitor.start()

        # Signal handlers for Ctrl+C / SIGTERM
        def _signal_handler(sig, frame):
            self._shutdown()

        signal.signal(signal.SIGINT, _signal_handler)
        signal.signal(signal.SIGTERM, _signal_handler)

        # pystray runs in background so tkinter can own the main thread
        self.icon.run_detached()
        logger.info("Arena Desktop Client started (tray active)")

        # Main thread: open window immediately, then keep the process alive
        _build_client_window(self.monitor, self.auth, self.config)


# ── Entry Point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"\n  ARENA Desktop Client v{CLIENT_VERSION}\n  Match Monitor + Screenshot Capture\n")

    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        logger.info("Created default config.json")

    # Generate ICO on first run if it doesn't exist
    ico_path = os.path.join(_BASE_DIR, "assets", "arena_icon.ico")
    if not os.path.exists(ico_path):
        try:
            generate_ico_file(ico_path)
        except Exception as e:
            logger.warning(f"ICO generation failed (non-fatal): {e}")

    app = ArenaTray()
    app.run()
