"""
ARENA Desktop Client - Main Entry Point
Runs as a system tray application that monitors CS2 and Valorant matches,
captures screenshots, and sends them to the Engine API for OCR processing.

Active games (v1):  CS2, Valorant
Coming Soon:        Fortnite, Apex Legends, PUBG, COD, League of Legends

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

# ── Brand design tokens (keep in sync with Arena website) ─────────────────────
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
    "rank_gold":   "#FFD700",
    # PIL tuples for icon drawing
    "accent_pil":  (0, 230, 118, 255),
    "idle_pil":    (70, 70, 90, 255),
    "error_pil":   (255, 68, 68, 255),
    "match_pil":   (255, 184, 0, 255),
    "bg_pil":      (12, 12, 18, 255),
}

# ── Per-game capture intervals (seconds) ──────────────────────────────────────
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

# ── Config ─────────────────────────────────────────────────────────────────────
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
    # Phase 3: populated on login from /auth/login response
    "user_id":             None,
    "username":            None,
    "rank":                None,
    "xp":                  0,
    "avatar_url":          None,
    # Phase 4: stable UUID persisted per-install; sent in every heartbeat
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
    Return the stable install UUID. Created once, persisted forever.
    Phase 4: links all heartbeats from this machine to one client_sessions row.
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
    Phase 4: GET /version → compare CLIENT_VERSION against min_version.
    Stub: always compatible until endpoint exists.
    """
    # Phase 4:
    # result = engine_client.check_version(CLIENT_VERSION)
    # if result and result.get("min_version"):
    #     return CLIENT_VERSION >= result["min_version"]
    return True


# ── Logging ────────────────────────────────────────────────────────────────────
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
    maxBytes=1_000_000, backupCount=5,
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

logger.addHandler(console_handler)
logger.addHandler(file_handler)


# ── Auth Manager ───────────────────────────────────────────────────────────────
class AuthManager:
    """
    Bearer-token auth for the Arena desktop client.

    Desktop client = Bearer tokens stored locally.
    Website = httpOnly cookies (different flow, same backend users table).

    Phase 3-ready: login() / logout() / refresh() call real engine endpoints
    once /auth/login, /auth/logout, /auth/refresh exist.
    """

    def __init__(self, config: dict):
        self._config = config

    # ── Properties ────────────────────────────────────────────────────────────

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

    @property
    def rank(self) -> str | None:
        return self._config.get("rank")

    @property
    def xp(self) -> int:
        return int(self._config.get("xp") or 0)

    @property
    def avatar_url(self) -> str | None:
        return self._config.get("avatar_url")

    # ── Mutations ─────────────────────────────────────────────────────────────

    def set_token(self, token: str, user_id: str | None = None,
                  username: str | None = None, wallet_address: str | None = None,
                  rank: str | None = None, xp: int | None = None,
                  avatar_url: str | None = None):
        """Persist token + identity fields after successful login."""
        self._config["auth_token"] = token
        if user_id        is not None: self._config["user_id"]        = user_id
        if username       is not None: self._config["username"]       = username
        if wallet_address is not None: self._config["wallet_address"] = wallet_address
        if rank           is not None: self._config["rank"]           = rank
        if xp             is not None: self._config["xp"]             = xp
        if avatar_url     is not None: self._config["avatar_url"]     = avatar_url
        save_config(self._config)
        logger.info(f"Logged in as {username or user_id}")

    def clear(self):
        """Wipe all auth state."""
        for k in ("auth_token", "user_id", "username", "rank", "avatar_url"):
            self._config[k] = "" if k == "auth_token" else None
        self._config["xp"]             = 0
        self._config["wallet_address"] = "unknown"
        save_config(self._config)
        logger.info("Auth cleared (logged out)")

    # ── Phase 3 stubs ─────────────────────────────────────────────────────────

    def login(self, engine: "EngineClient", username: str, password: str) -> str | None:
        """
        Phase 3: POST /auth/login → Bearer token.
        Returns None + error string on failure, or None + None on success
        (use is_authenticated to confirm).
        Stub: always returns 'Engine not connected yet'.
        """
        result = engine.login(username, password)
        if result and result.get("token"):
            self.set_token(
                token=result["token"],
                user_id=result.get("user_id"),
                username=result.get("username", username),
                wallet_address=result.get("wallet_address"),
                rank=result.get("rank"),
                xp=result.get("xp"),
                avatar_url=result.get("avatar_url"),
            )
            return None           # success
        # Return engine error message or default
        if result and result.get("detail"):
            return result["detail"]
        return "Login endpoint not available yet — Phase 3"

    def logout(self):
        self.clear()

    def refresh(self, engine: "EngineClient") -> bool:
        """Phase 3: POST /auth/refresh. Stub: no-op."""
        return True


# ── Screenshot Capture ─────────────────────────────────────────────────────────
def capture_screenshot(output_dir: str, monitor_num: int = 1,
                       game_name: str | None = None) -> str | None:
    try:
        os.makedirs(output_dir, exist_ok=True)
        with mss.mss() as sct:
            monitors = sct.monitors
            if monitor_num >= len(monitors):
                monitor_num = 1
            monitor = monitors[monitor_num]
            screenshot = sct.grab(monitor)
            timestamp  = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename   = (
                f"{game_name.replace(' ', '_')}_{timestamp}.png"
                if game_name else f"capture_{timestamp}.png"
            )
            filepath = os.path.join(output_dir, filename)
            mss.tools.to_png(screenshot.rgb, screenshot.size, output=filepath)
            logger.debug(f"Screenshot saved: {filepath}")
            return filepath
    except Exception as e:
        logger.error(f"Screenshot capture failed: {e}")
        return None


# ── Game Detection ─────────────────────────────────────────────────────────────
ACTIVE_GAME_PROCESSES: dict[str, list[str]] = {
    "CS2":      ["cs2.exe", "csgo.exe"],
    "Valorant": ["VALORANT-Win64-Shipping.exe"],
    # "Fortnite":           ["FortniteClient-Win64-Shipping.exe"],
    # "Apex Legends":       ["r5apex.exe"],
    # "PUBG":               ["TslGame.exe"],
    # "COD":                ["cod.exe", "BlackOpsColdWar.exe"],
    # "League of Legends":  ["League of Legends.exe"],
}


def is_game_running(game: str = "CS2") -> bool:
    try:
        import psutil
        target = [p.lower() for p in ACTIVE_GAME_PROCESSES.get(game, [])]
        for proc in psutil.process_iter(["name"]):
            if proc.info["name"] and proc.info["name"].lower() in target:
                return True
    except ImportError:
        logger.warning("psutil not installed")
    except Exception as e:
        logger.error(f"Game check error: {e}")
    return False


def detect_running_game() -> str | None:
    try:
        import psutil
        for game, procs in ACTIVE_GAME_PROCESSES.items():
            names = [p.lower() for p in procs]
            for proc in psutil.process_iter(["name"]):
                if proc.info["name"] and proc.info["name"].lower() in names:
                    return game
    except Exception as e:
        logger.error(f"Game detect error: {e}")
    return None


# ── Engine API Client ──────────────────────────────────────────────────────────
class EngineClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token    = token
        self.client   = httpx.Client(timeout=30)

    def health(self) -> dict | None:
        try:
            r = self.client.get(f"{self.base_url}/health", timeout=4)
            return r.json()
        except Exception:
            return None

    def get_active_match(self, wallet_address: str) -> str | None:
        """GET /client/match — DB-ready: queries matches + match_players."""
        try:
            r = self.client.get(
                f"{self.base_url}/client/match",
                params={"wallet_address": wallet_address}, timeout=5,
            )
            if r.status_code == 200:
                return r.json().get("match_id")
        except Exception as e:
            logger.debug(f"Active match poll failed: {e}")
        return None

    def upload_screenshot(self, match_id: str, filepath: str) -> dict | None:
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
            logger.error(f"Upload failed: {r.status_code}")
        except Exception as e:
            logger.error(f"Upload error: {e}")
        return None

    def login(self, username: str, password: str) -> dict | None:
        """
        Phase 3: POST /auth/login
        Returns {token, user_id, username, wallet_address, rank, xp, avatar_url}
        or {detail: "error message"} on failure.
        DB-ready: validates against users table, creates auth_sessions row.
        """
        # Phase 3:
        # try:
        #     r = self.client.post(f"{self.base_url}/auth/login",
        #                          json={"username": username, "password": password},
        #                          timeout=10)
        #     return r.json()
        # except Exception as e:
        #     logger.error(f"Login request failed: {e}")
        return None

    def get_profile(self, token: str) -> dict | None:
        """
        Phase 3: GET /user/profile
        Returns {user_id, username, wallet_address, rank, xp, avatar_url, badge}.
        DB-ready: queries users + user_stats tables.
        """
        # Phase 3:
        # try:
        #     r = self.client.get(f"{self.base_url}/user/profile",
        #                         headers={"Authorization": f"Bearer {token}"}, timeout=5)
        #     if r.status_code == 200: return r.json()
        # except Exception as e:
        #     logger.error(f"Profile fetch failed: {e}")
        return None

    def get_active_events(self, token: str) -> list[dict]:
        """
        Phase 3: GET /events/active
        Returns [{id, name, description, xp_reward, claimed, ends_at}].
        DB-ready: queries events + event_claims tables.
        """
        # Phase 3:
        # try:
        #     r = self.client.get(f"{self.base_url}/events/active",
        #                         headers={"Authorization": f"Bearer {token}"}, timeout=5)
        #     if r.status_code == 200: return r.json().get("events", [])
        # except Exception as e:
        #     logger.error(f"Events fetch failed: {e}")
        return []

    def claim_event(self, event_id: str, token: str) -> bool:
        """
        Phase 3: POST /events/{event_id}/claim
        DB-ready: inserts into event_claims, updates user xp in user_stats.
        """
        # Phase 3:
        # try:
        #     r = self.client.post(f"{self.base_url}/events/{event_id}/claim",
        #                          headers={"Authorization": f"Bearer {token}"}, timeout=5)
        #     return r.status_code == 200
        # except Exception as e:
        #     logger.error(f"Claim failed: {e}")
        return False

    def check_version(self, client_version: str) -> dict | None:
        """Phase 4: GET /version → {min_version, latest}. Stub."""
        return None


# ── Match Monitor ──────────────────────────────────────────────────────────────
class MatchMonitor:
    """Core monitoring loop: detect game → capture → upload → heartbeat."""

    _HEARTBEAT_INTERVAL = 15   # must be < engine _CLIENT_TIMEOUT_SECONDS (30s)

    def __init__(self, config: dict):
        self.config            = config
        self.engine            = EngineClient(config["engine_url"], config["auth_token"])
        self.running           = False
        self.monitoring        = False
        self.current_match_id: str | None = None
        self._thread:           threading.Thread | None = None
        self._heartbeat_thread: threading.Thread | None = None
        self._capture_count    = 0
        self._heartbeat_stop   = threading.Event()
        self._session_id       = get_or_create_session_id(config)

    def start(self):
        if self.running:
            return
        self.running = True
        self._heartbeat_stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, daemon=True, name="ArenaHeartbeat")
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
                    time.sleep(self.config.get("screenshot_interval", 5))
                    continue

                if is_game_running(game):
                    if not self.monitoring:
                        logger.info(f"{game} detected — starting capture")
                        self.monitoring = True

                    if not self.current_match_id:
                        wallet = self.config.get("wallet_address", "unknown")
                        mid = self.engine.get_active_match(wallet)
                        if mid:
                            self.set_match_id(mid)

                    game_dir = os.path.join(
                        self.config["screenshot_dir"], game.replace(" ", "_"))
                    filepath = capture_screenshot(
                        output_dir=game_dir,
                        monitor_num=self.config.get("monitor", 1),
                        game_name=game,
                    )
                    if filepath:
                        self._capture_count += 1
                        if self.current_match_id:
                            result = self.engine.upload_screenshot(
                                self.current_match_id, filepath)
                            if result:
                                logger.info(f"Engine: {result}")
                                try: os.remove(filepath)
                                except OSError: pass
                        else:
                            logger.debug("No match ID — screenshot saved locally")
                else:
                    if self.monitoring:
                        logger.info(f"{game} closed — pausing")
                        self.monitoring = False
                        self.current_match_id = None

            except Exception as e:
                logger.error(f"Monitor loop error: {e}")

            active = detect_running_game()
            base = GAME_INTERVALS.get(active, self.config.get("screenshot_interval", 5))
            time.sleep(base + random.uniform(-0.5, 0.5))

    def _heartbeat_loop(self):
        while not self._heartbeat_stop.wait(timeout=self._HEARTBEAT_INTERVAL):
            self._send_heartbeat()

    def _send_heartbeat(self):
        try:
            game   = detect_running_game()
            status = (
                "in_match" if self.current_match_id
                else ("in_game" if game else "idle")
            )
            payload = {
                "wallet_address": self.config.get("wallet_address", "unknown"),
                "client_version": self.config.get("client_version", CLIENT_VERSION),
                "status":         status,
                "game":           game,
                "session_id":     self._session_id,   # Phase 4: client_sessions FK
                "match_id":       self.current_match_id,
            }
            resp = self.engine.client.post(
                f"{self.engine.base_url}/client/heartbeat", json=payload, timeout=5)
            if resp.status_code == 200:
                logger.debug(f"Heartbeat OK | {status} | {game}")
            else:
                logger.warning(f"Heartbeat {resp.status_code}")
        except Exception as e:
            logger.debug(f"Heartbeat error (non-fatal): {e}")

    def set_match_id(self, match_id: str):
        self.current_match_id = match_id
        logger.info(f"Active match: {match_id}")


# ── Icon Rendering ─────────────────────────────────────────────────────────────
def _draw_arena_icon(size: int = 128, state: str = "idle") -> Image.Image:
    """
    Arena 'A' tray icon. States:
      active → green ring + green A  (monitoring ON)
      match  → amber ring + amber A  (match in progress)
      error  → red ring + gray A     (engine offline)
      idle   → gray ring + gray A    (monitoring OFF)
    """
    colors = {
        "active": (BRAND["accent_pil"], BRAND["accent_pil"]),
        "match":  (BRAND["match_pil"],  BRAND["match_pil"]),
        "error":  (BRAND["error_pil"],  BRAND["idle_pil"]),
        "idle":   (BRAND["idle_pil"],   BRAND["idle_pil"]),
    }
    ring_color, glyph_color = colors.get(state, colors["idle"])

    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle
    draw.ellipse([2, 2, size - 2, size - 2], fill=BRAND["bg_pil"])
    # Colored ring
    lw_ring = max(4, size // 28)
    draw.ellipse([2, 2, size - 2, size - 2], outline=ring_color, width=lw_ring)

    # 'A' glyph
    lw  = max(6, size // 18)
    cx  = size // 2
    pad = int(size * 0.14)

    top  = (cx,         pad)
    bl   = (pad,        size - pad)
    br   = (size - pad, size - pad)
    cb_y = int(size * 0.52)                  # crossbar at 52% height
    ins  = int(size * 0.25)
    cb_l = (ins,        cb_y)
    cb_r = (size - ins, cb_y)

    draw.line([top, bl],    fill=glyph_color, width=lw)
    draw.line([top, br],    fill=glyph_color, width=lw)
    draw.line([cb_l, cb_r], fill=glyph_color, width=lw)

    # Status dot (bottom-right)
    dot_r = max(8, size // 10)
    dx = size - dot_r - int(size * 0.04)
    dy = size - dot_r - int(size * 0.04)
    draw.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=ring_color)

    return img


def generate_ico_file(path: str):
    """Save multi-resolution ICO (16→256 px) for exe + tray icon."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sizes  = [16, 24, 32, 48, 64, 128, 256]
    frames = [_draw_arena_icon(s, state="active").resize((s, s), Image.LANCZOS)
              for s in sizes]
    frames[0].save(path, format="ICO",
                   sizes=[(s, s) for s in sizes],
                   append_images=frames[1:])
    logger.info(f"ICO saved: {path}")


# ── Client Window ──────────────────────────────────────────────────────────────
# Global reference so tray can show/hide the window safely from its thread.
_window_instance = None


def _build_client_window(monitor: "MatchMonitor", auth: "AuthManager",
                         config: dict, ico_path: str | None = None) -> None:
    """
    Build and run the Arena Client window.
    MUST be called from the main thread (tkinter/Windows requirement).

    Thread safety rule: ALL widget updates go through win.after(ms, fn).
    Never call .configure() on a widget from a background thread.

    Tab structure:
      Overview — Engine status, Identity (login form / profile), Game + Monitoring
      Events   — Active events with Claim XP (Phase 3)
    """
    global _window_instance

    try:
        import customtkinter as ctk
    except ImportError:
        logger.error("customtkinter not installed. Run: pip install customtkinter")
        return

    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")

    win = ctk.CTk()
    win.title("Arena Client")
    win.geometry("380x580")
    win.resizable(False, False)
    win.configure(fg_color=BRAND["bg"])

    # Set window icon
    if ico_path and os.path.exists(ico_path):
        try:
            win.iconbitmap(ico_path)
        except Exception:
            pass

    _window_instance = win

    # Close = hide to tray, keep mainloop alive
    def _on_close():
        win.withdraw()

    win.protocol("WM_DELETE_WINDOW", _on_close)

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _card(parent, title: str) -> ctk.CTkFrame:
        outer = ctk.CTkFrame(parent, fg_color=BRAND["bg_card"], corner_radius=10)
        outer.pack(fill="x", padx=12, pady=(8, 0))
        ctk.CTkLabel(outer, text=title.upper(),
                     font=ctk.CTkFont(size=10, weight="bold"),
                     text_color=BRAND["text_muted"]).pack(anchor="w", padx=14, pady=(10, 2))
        return outer

    def _dot_label(parent, color: str = BRAND["text_muted"]) -> ctk.CTkLabel:
        return ctk.CTkLabel(parent, text="●", text_color=color,
                            font=ctk.CTkFont(size=10))

    # ── Header ────────────────────────────────────────────────────────────────
    header = ctk.CTkFrame(win, fg_color=BRAND["bg_card"], corner_radius=0, height=54)
    header.pack(fill="x")
    header.pack_propagate(False)

    ctk.CTkLabel(header, text="ARENA",
                 font=ctk.CTkFont(size=20, weight="bold"),
                 text_color=BRAND["accent"]).pack(side="left", padx=16, pady=14)

    # Engine status dot in header (live — updated via win.after)
    hdr_dot = ctk.CTkLabel(header, text="●", text_color=BRAND["text_muted"],
                            font=ctk.CTkFont(size=10))
    hdr_dot.pack(side="right", padx=6, pady=14)
    hdr_eng  = ctk.CTkLabel(header, text="Engine",
                             font=ctk.CTkFont(size=11),
                             text_color=BRAND["text_muted"])
    hdr_eng.pack(side="right", pady=14)

    ctk.CTkLabel(header, text=f"v{CLIENT_VERSION}",
                 font=ctk.CTkFont(size=11),
                 text_color=BRAND["text_muted"]).pack(side="right", padx=16, pady=14)

    # ── Tab view ──────────────────────────────────────────────────────────────
    tabview = ctk.CTkTabview(win, fg_color=BRAND["bg"], corner_radius=0,
                              segmented_button_fg_color=BRAND["bg_card"],
                              segmented_button_selected_color=BRAND["accent"],
                              segmented_button_selected_hover_color=BRAND["accent_dark"],
                              segmented_button_unselected_color=BRAND["bg_card"],
                              segmented_button_unselected_hover_color=BRAND["bg_hover"],
                              text_color=BRAND["text"],
                              text_color_disabled=BRAND["text_muted"])
    tabview.pack(fill="both", expand=True)
    tabview.add("Overview")
    tabview.add("Events")

    tab_overview = tabview.tab("Overview")
    tab_events   = tabview.tab("Events")

    # ── OVERVIEW TAB ──────────────────────────────────────────────────────────

    # Scrollable body inside overview
    ov_body = ctk.CTkScrollableFrame(tab_overview, fg_color=BRAND["bg"], corner_radius=0)
    ov_body.pack(fill="both", expand=True)

    # ── Engine card ───────────────────────────────────────────────────────────
    eng_card = _card(ov_body, "Engine")
    eng_row  = ctk.CTkFrame(eng_card, fg_color="transparent")
    eng_row.pack(fill="x", padx=14, pady=(0, 10))

    eng_dot   = _dot_label(eng_row, BRAND["text_muted"])
    eng_dot.pack(side="left")
    eng_label = ctk.CTkLabel(eng_row, text="Checking…",
                              font=ctk.CTkFont(size=13), text_color=BRAND["text"])
    eng_label.pack(side="left", padx=(6, 0))

    # ── Identity card ─────────────────────────────────────────────────────────
    id_card = _card(ov_body, "Identity")
    # Inner frame rebuilt on login/logout
    id_inner_ref: list[ctk.CTkFrame] = []

    def _rebuild_identity():
        """Rebuild identity card content. Must be called from main thread."""
        for w in id_inner_ref:
            try: w.destroy()
            except Exception: pass
        id_inner_ref.clear()

        inner = ctk.CTkFrame(id_card, fg_color="transparent")
        inner.pack(fill="x", padx=14, pady=(0, 12))
        id_inner_ref.append(inner)

        if auth.is_authenticated:
            _build_profile_view(inner)
        else:
            _build_login_form(inner)

    def _build_login_form(parent: ctk.CTkFrame):
        """Username + password form. Phase 3: calls /auth/login."""
        ctk.CTkLabel(parent, text="Sign in to Arena",
                     font=ctk.CTkFont(size=13, weight="bold"),
                     text_color=BRAND["text"]).pack(anchor="w", pady=(0, 8))

        user_entry = ctk.CTkEntry(parent, placeholder_text="Username",
                                   height=34, corner_radius=6,
                                   fg_color=BRAND["bg_hover"],
                                   border_color=BRAND["border"],
                                   text_color=BRAND["text"],
                                   font=ctk.CTkFont(size=13))
        user_entry.pack(fill="x", pady=(0, 6))

        pass_entry = ctk.CTkEntry(parent, placeholder_text="Password", show="*",
                                   height=34, corner_radius=6,
                                   fg_color=BRAND["bg_hover"],
                                   border_color=BRAND["border"],
                                   text_color=BRAND["text"],
                                   font=ctk.CTkFont(size=13))
        pass_entry.pack(fill="x", pady=(0, 6))

        err_label = ctk.CTkLabel(parent, text="",
                                  font=ctk.CTkFont(size=11),
                                  text_color=BRAND["error"])
        err_label.pack(anchor="w")

        def _do_login():
            uname = user_entry.get().strip()
            pwd   = pass_entry.get()
            if not uname or not pwd:
                err_label.configure(text="Please enter username and password")
                return
            err_label.configure(text="Signing in…", text_color=BRAND["text_muted"])
            login_btn.configure(state="disabled")

            def _login_thread():
                error = auth.login(monitor.engine, uname, pwd)
                # Update UI on main thread
                def _after():
                    login_btn.configure(state="normal")
                    if error:
                        err_label.configure(text=error, text_color=BRAND["error"])
                    else:
                        monitor.engine.token = auth.access_token or ""
                        _rebuild_identity()
                win.after(0, _after)

            threading.Thread(target=_login_thread, daemon=True).start()

        login_btn = ctk.CTkButton(parent, text="Sign In", height=34, corner_radius=6,
                                   fg_color=BRAND["accent"],
                                   hover_color=BRAND["accent_dark"],
                                   text_color=BRAND["bg"],
                                   font=ctk.CTkFont(size=13, weight="bold"),
                                   command=_do_login)
        login_btn.pack(fill="x", pady=(4, 0))

        # Bind Enter key
        pass_entry.bind("<Return>", lambda e: _do_login())

        sep = ctk.CTkLabel(parent, text="──── or ────",
                            font=ctk.CTkFont(size=10),
                            text_color=BRAND["text_muted"])
        sep.pack(pady=(8, 4))

        ctk.CTkButton(parent, text="Open Arena Website", height=30, corner_radius=6,
                       fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
                       text_color=BRAND["text_muted"], font=ctk.CTkFont(size=12),
                       command=_open_website).pack(fill="x")

    def _build_profile_view(parent: ctk.CTkFrame):
        """Profile display after auth. Phase 3: avatar, rank, XP synced from API."""
        # Avatar circle with initials
        uname   = auth.username or "?"
        initial = uname[0].upper()
        avatar_size = 48

        avatar_img = Image.new("RGBA", (avatar_size, avatar_size), (0, 0, 0, 0))
        ad = ImageDraw.Draw(avatar_img)
        ad.ellipse([0, 0, avatar_size, avatar_size], fill=(0, 230, 118, 40))
        ad.ellipse([0, 0, avatar_size, avatar_size], outline=BRAND["accent_pil"], width=2)
        ctk_avatar = ctk.CTkImage(light_image=avatar_img, dark_image=avatar_img,
                                   size=(avatar_size, avatar_size))

        row = ctk.CTkFrame(parent, fg_color="transparent")
        row.pack(fill="x", pady=(0, 8))

        ctk.CTkLabel(row, image=ctk_avatar, text=initial,
                     font=ctk.CTkFont(size=18, weight="bold"),
                     text_color=BRAND["accent"]).pack(side="left")

        info = ctk.CTkFrame(row, fg_color="transparent")
        info.pack(side="left", padx=(10, 0))

        ctk.CTkLabel(info, text=uname,
                     font=ctk.CTkFont(size=14, weight="bold"),
                     text_color=BRAND["accent"]).pack(anchor="w")

        # Wallet address (shortened)
        wallet = auth.wallet_address
        if wallet and wallet != "unknown":
            short = f"{wallet[:6]}…{wallet[-4:]}"
            ctk.CTkLabel(info, text=short,
                         font=ctk.CTkFont(size=11),
                         text_color=BRAND["text_muted"]).pack(anchor="w")

        # Rank badge (Phase 3: from profile API)
        rank = auth.rank
        rank_text = rank if rank else "Unranked"
        rank_color = BRAND["rank_gold"] if rank else BRAND["text_muted"]
        ctk.CTkLabel(info, text=f"Rank: {rank_text}",
                     font=ctk.CTkFont(size=11, weight="bold"),
                     text_color=rank_color).pack(anchor="w")

        # XP bar (Phase 3: from profile API)
        xp = auth.xp
        ctk.CTkLabel(parent, text=f"XP: {xp:,}",
                     font=ctk.CTkFont(size=11),
                     text_color=BRAND["text_muted"]).pack(anchor="w", pady=(0, 6))
        # DB-ready: replace 1.0 with xp / xp_to_next_level once API returns it
        ctk.CTkProgressBar(parent, height=6, corner_radius=3,
                            progress_color=BRAND["accent"],
                            fg_color=BRAND["bg_hover"]).set(0.0)  # Phase 3: real value

        def _do_logout():
            auth.logout()
            monitor.engine.token = ""
            win.after(0, _rebuild_identity)

        ctk.CTkButton(parent, text="Disconnect", height=30, corner_radius=6,
                       fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
                       text_color=BRAND["text_muted"], font=ctk.CTkFont(size=12),
                       command=_do_logout).pack(anchor="w", pady=(10, 0))

    _rebuild_identity()

    # ── Game status card ──────────────────────────────────────────────────────
    game_card  = _card(ov_body, "Game Status")
    game_row   = ctk.CTkFrame(game_card, fg_color="transparent")
    game_row.pack(fill="x", padx=14, pady=(0, 4))

    game_dot   = _dot_label(game_row, BRAND["text_muted"])
    game_dot.pack(side="left")
    game_label = ctk.CTkLabel(game_row, text="No game detected",
                               font=ctk.CTkFont(size=13), text_color=BRAND["text"])
    game_label.pack(side="left", padx=(6, 0))

    match_label = ctk.CTkLabel(game_card, text="",
                                font=ctk.CTkFont(size=11), text_color=BRAND["warning"])
    match_label.pack(anchor="w", padx=14, pady=(0, 10))

    # ── Monitoring toggle ─────────────────────────────────────────────────────
    mon_card  = _card(ov_body, "Monitoring")
    mon_row   = ctk.CTkFrame(mon_card, fg_color="transparent")
    mon_row.pack(fill="x", padx=14, pady=(0, 12))

    mon_var = ctk.BooleanVar(value=monitor.running)

    mon_lbl = ctk.CTkLabel(mon_row,
                            text="ON" if monitor.running else "OFF",
                            font=ctk.CTkFont(size=12, weight="bold"),
                            text_color=BRAND["accent"] if monitor.running else BRAND["text_muted"],
                            width=36)
    mon_lbl.pack(side="left")

    def _on_toggle():
        if mon_var.get():
            monitor.start()
            mon_lbl.configure(text="ON", text_color=BRAND["accent"])
        else:
            monitor.stop()
            mon_lbl.configure(text="OFF", text_color=BRAND["text_muted"])

    ctk.CTkSwitch(mon_row, text="Capture & upload screenshots",
                   variable=mon_var, onvalue=True, offvalue=False,
                   command=_on_toggle,
                   font=ctk.CTkFont(size=12), text_color=BRAND["text"],
                   button_color=BRAND["accent"],
                   button_hover_color=BRAND["accent_dark"],
                   progress_color=BRAND["accent_dark"]).pack(side="left", padx=(8, 0))

    # Spacing at bottom of overview
    ctk.CTkLabel(ov_body, text="", height=8).pack()

    # ── EVENTS TAB ────────────────────────────────────────────────────────────
    ev_body = ctk.CTkScrollableFrame(tab_events, fg_color=BRAND["bg"], corner_radius=0)
    ev_body.pack(fill="both", expand=True)

    ev_placeholder = ctk.CTkLabel(ev_body, text="",
                                   font=ctk.CTkFont(size=13),
                                   text_color=BRAND["text_muted"],
                                   wraplength=300)
    ev_placeholder.pack(pady=30)

    ev_list_frame = ctk.CTkFrame(ev_body, fg_color="transparent")
    ev_list_frame.pack(fill="x", padx=12)

    def _render_events(events: list[dict]):
        """Render event rows. Called on main thread via win.after."""
        for w in ev_list_frame.winfo_children():
            try: w.destroy()
            except Exception: pass

        if not auth.is_authenticated:
            ev_placeholder.configure(text="Sign in on the Overview tab to see active events.")
            return

        ev_placeholder.configure(text="")

        if not events:
            ctk.CTkLabel(ev_list_frame, text="No active events right now.",
                          font=ctk.CTkFont(size=13),
                          text_color=BRAND["text_muted"]).pack(pady=20)
            return

        for ev in events:
            row = ctk.CTkFrame(ev_list_frame, fg_color=BRAND["bg_card"], corner_radius=8)
            row.pack(fill="x", pady=(0, 8))

            ctk.CTkLabel(row, text=ev.get("name", "Event"),
                          font=ctk.CTkFont(size=13, weight="bold"),
                          text_color=BRAND["text"]).pack(anchor="w", padx=12, pady=(10, 0))

            desc = ev.get("description", "")
            if desc:
                ctk.CTkLabel(row, text=desc,
                              font=ctk.CTkFont(size=11), text_color=BRAND["text_muted"],
                              wraplength=300).pack(anchor="w", padx=12)

            btn_row = ctk.CTkFrame(row, fg_color="transparent")
            btn_row.pack(fill="x", padx=12, pady=(6, 10))

            xp_reward = ev.get("xp_reward", 0)
            claimed   = ev.get("claimed", False)
            ev_id     = ev.get("id", "")

            xp_lbl = ctk.CTkLabel(btn_row, text=f"+{xp_reward} XP",
                                   font=ctk.CTkFont(size=12, weight="bold"),
                                   text_color=BRAND["accent"])
            xp_lbl.pack(side="left")

            claim_btn = ctk.CTkButton(
                btn_row, text="Claimed" if claimed else "Claim XP",
                height=28, width=90, corner_radius=6,
                fg_color=BRAND["bg_hover"] if claimed else BRAND["accent"],
                hover_color=BRAND["border"] if claimed else BRAND["accent_dark"],
                text_color=BRAND["text_muted"] if claimed else BRAND["bg"],
                font=ctk.CTkFont(size=12, weight="bold"),
                state="disabled" if claimed else "normal",
            )
            claim_btn.pack(side="right")

            def _make_claim_handler(eid: str, btn: ctk.CTkButton):
                def _claim():
                    btn.configure(state="disabled", text="Claiming…")
                    def _do():
                        ok = monitor.engine.claim_event(eid, auth.access_token or "")
                        def _after():
                            if ok:
                                btn.configure(text="Claimed",
                                               fg_color=BRAND["bg_hover"],
                                               text_color=BRAND["text_muted"])
                            else:
                                btn.configure(state="normal", text="Claim XP")
                        win.after(0, _after)
                    threading.Thread(target=_do, daemon=True).start()
                return _claim

            if not claimed:
                claim_btn.configure(command=_make_claim_handler(ev_id, claim_btn))

    # ── Footer ─────────────────────────────────────────────────────────────────
    footer = ctk.CTkFrame(win, fg_color=BRAND["bg_card"], corner_radius=0, height=62)
    footer.pack(fill="x", side="bottom")
    footer.pack_propagate(False)

    btn_row = ctk.CTkFrame(footer, fg_color="transparent")
    btn_row.pack(expand=True)

    def _open_website():
        import webbrowser
        webbrowser.open("https://arena.gg")

    def _check_engine_btn():
        threading.Thread(target=_do_engine_check, daemon=True).start()

    def _quit_app():
        monitor.stop()
        win.destroy()
        os._exit(0)

    ctk.CTkButton(btn_row, text="Check Engine", width=104, height=32, corner_radius=6,
                   fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
                   text_color=BRAND["text"], font=ctk.CTkFont(size=12),
                   command=_check_engine_btn).pack(side="left", padx=4, pady=12)

    ctk.CTkButton(btn_row, text="Website", width=80, height=32, corner_radius=6,
                   fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
                   text_color=BRAND["text"], font=ctk.CTkFont(size=12),
                   command=_open_website).pack(side="left", padx=4, pady=12)

    ctk.CTkButton(btn_row, text="Quit", width=62, height=32, corner_radius=6,
                   fg_color=BRAND["error"], hover_color="#CC3333",
                   text_color=BRAND["text"], font=ctk.CTkFont(size=12),
                   command=_quit_app).pack(side="left", padx=4, pady=12)

    # ── Thread-safe polls via win.after() ─────────────────────────────────────
    # ALL widget updates happen here — never from background threads directly.

    def _do_engine_check():
        """Run in background thread, push result to main thread via win.after."""
        health = monitor.engine.health()
        def _apply():
            if health and health.get("status") == "ok":
                db = health.get("db", "?")
                eng_label.configure(text=f"Connected  ·  DB: {db}",
                                     text_color=BRAND["text"])
                eng_dot.configure(text_color=BRAND["accent"])
                hdr_dot.configure(text_color=BRAND["accent"])
                hdr_eng.configure(text_color=BRAND["accent"])
            else:
                eng_label.configure(text="Engine offline",
                                     text_color=BRAND["text_muted"])
                eng_dot.configure(text_color=BRAND["error"])
                hdr_dot.configure(text_color=BRAND["error"])
                hdr_eng.configure(text_color=BRAND["text_muted"])
        win.after(0, _apply)

    def _poll_engine():
        """Poll engine health every 10 s."""
        threading.Thread(target=_do_engine_check, daemon=True).start()
        win.after(10_000, _poll_engine)

    def _poll_game():
        """Poll game state every 3 s — update game card."""
        game = detect_running_game()
        if game:
            game_label.configure(text=game, text_color=BRAND["text"])
            game_dot.configure(text_color=BRAND["accent"])
        else:
            game_label.configure(text="No game detected", text_color=BRAND["text_muted"])
            game_dot.configure(text_color=BRAND["text_muted"])

        if monitor.current_match_id:
            short = monitor.current_match_id[:8]
            match_label.configure(text=f"Match #{short}…")
        else:
            match_label.configure(text="")

        win.after(3_000, _poll_game)

    def _poll_events():
        """
        Refresh events tab every 30 s.
        Phase 3: real data from GET /events/active.
        """
        if auth.is_authenticated:
            token  = auth.access_token or ""
            def _fetch():
                events = monitor.engine.get_active_events(token)
                win.after(0, lambda: _render_events(events))
            threading.Thread(target=_fetch, daemon=True).start()
        else:
            _render_events([])
        win.after(30_000, _poll_events)

    def _poll_profile_sync():
        """
        Phase 3: after login, sync latest rank/XP from /user/profile every 60 s.
        Rebuilds identity card if data changed.
        """
        if auth.is_authenticated:
            token = auth.access_token or ""
            def _fetch():
                profile = monitor.engine.get_profile(token)
                if profile:
                    changed = False
                    if profile.get("rank")   != auth.rank: changed = True
                    if profile.get("xp")     != auth.xp:   changed = True
                    if changed:
                        auth.set_token(
                            token=token,
                            rank=profile.get("rank"),
                            xp=profile.get("xp"),
                            avatar_url=profile.get("avatar_url"),
                        )
                        win.after(0, _rebuild_identity)
            threading.Thread(target=_fetch, daemon=True).start()
        win.after(60_000, _poll_profile_sync)

    # Start all polls
    win.after(500,    _poll_engine)       # first engine check after 0.5 s
    win.after(1_000,  _poll_game)
    win.after(2_000,  _poll_events)
    win.after(60_000, _poll_profile_sync)

    win.mainloop()


# ── System Tray ────────────────────────────────────────────────────────────────
class ArenaTray:
    """
    Architecture (Windows):
      pystray.run_detached() → background thread (tray icon + menu)
      tkinter mainloop       → main thread (window)
      win.withdraw/deiconify → hide/show window safely from tray callbacks
    """

    def __init__(self):
        self.config  = load_config()
        self.auth    = AuthManager(self.config)
        self.monitor = MatchMonitor(self.config)
        self.icon: pystray.Icon | None = None
        self._monitoring_enabled = False
        self._selected_game      = self.config.get("game", "AUTO")

    def _icon_state(self) -> str:
        if self.monitor.current_match_id: return "match"
        if self._monitoring_enabled:       return "active"
        return "idle"

    def _set_game(self, game: str):
        self._selected_game = game
        interval = GAME_INTERVALS.get(game, 5)
        self.config["game"] = game
        self.config["screenshot_interval"] = interval
        self.monitor.config["game"] = game
        self.monitor.config["screenshot_interval"] = interval
        save_config(self.config)
        if self.icon: self.icon.update_menu()

    def _make_game_item(self, game: str) -> MenuItem:
        label = f"{game}  ({GAME_INTERVALS[game]}s)" if game != "AUTO" else "AUTO (detect)"
        def _action(icon, item): self._set_game(game)
        def _checked(item):      return self._selected_game == game
        return MenuItem(label, _action, checked=_checked)

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

    def _on_open(self, icon, item):
        """Show/raise window from tray. Safe: uses win.after via deiconify."""
        win = _window_instance
        if win:
            try:
                win.after(0, lambda: (win.deiconify(), win.lift(), win.focus()))
            except Exception:
                pass

    def _on_status(self, icon, item):
        health = self.monitor.engine.health()
        if health and health.get("status") == "ok":
            icon.notify("Engine", f"Connected · DB: {health.get('db', 'ok')}")
        else:
            icon.notify("Engine", "Offline or unreachable")

    def _shutdown(self):
        logger.info("Shutting down…")
        self.monitor.stop()
        if self.icon:
            try: self.icon.stop()
            except Exception: pass
        os._exit(0)

    def _on_quit(self, icon, item):
        self._shutdown()

    def run(self, ico_path: str | None = None):
        self._monitoring_enabled = bool(self.config.get("auto_start", False))
        self._selected_game      = self.config.get("game", "AUTO")

        check_version_compat(self.monitor.engine)

        menu = Menu(
            MenuItem("Arena Client", None, enabled=False),
            Menu.SEPARATOR,
            MenuItem("Open Arena",    self._on_open),
            Menu.SEPARATOR,
            MenuItem("Monitoring", self._toggle_monitoring,
                     checked=lambda item: self._monitoring_enabled),
            MenuItem("Game", Menu(
                self._make_game_item("AUTO"),
                self._make_game_item("CS2"),
                self._make_game_item("Valorant"),
            )),
            MenuItem("Check Engine", self._on_status),
            Menu.SEPARATOR,
            MenuItem("Quit", self._on_quit),
        )

        self.icon = pystray.Icon(
            "Arena", _draw_arena_icon(128, state=self._icon_state()),
            "Arena - Match Monitor", menu,
        )

        if self._monitoring_enabled:
            self.monitor.start()

        def _sig(sig, frame): self._shutdown()
        signal.signal(signal.SIGINT,  _sig)
        signal.signal(signal.SIGTERM, _sig)

        # pystray in background — tkinter owns main thread
        self.icon.run_detached()
        logger.info("Arena Desktop Client started")

        _build_client_window(self.monitor, self.auth, self.config, ico_path=ico_path)


# ── Entry Point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"\n  ARENA Desktop Client v{CLIENT_VERSION}\n")

    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        logger.info("Created default config.json")

    ico_path = os.path.join(_BASE_DIR, "assets", "arena_icon.ico")
    if not os.path.exists(ico_path):
        try:
            generate_ico_file(ico_path)
        except Exception as e:
            logger.warning(f"ICO generation failed (non-fatal): {e}")
            ico_path = None

    app = ArenaTray()
    app.run(ico_path=ico_path)
