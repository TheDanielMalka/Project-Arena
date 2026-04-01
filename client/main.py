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

# ── Brand design tokens — exact match to Arena website (index.css) ────────────
#
#   Website palette:
#     background : hsl(0 0% 4%)       → #0A0A0A
#     card       : hsl(0 0% 8%)       → #141414
#     secondary  : hsl(0 0% 14%)      → #242424
#     border     : hsl(0 0% 16%)      → #292929
#     primary    : hsl(355 78% 52%)   → #E42535  ← RED
#     muted-fg   : hsl(0 0% 60%)      → #999999
#     gold       : hsl(45 93% 47%)    → #E9A80A
#
BRAND = {
    "bg":          "#0A0A0A",   # hsl(0 0% 4%)
    "bg_card":     "#141414",   # hsl(0 0% 8%)
    "bg_hover":    "#242424",   # hsl(0 0% 14%)
    "accent":      "#E42535",   # hsl(355 78% 52%) — Arena red
    "accent_dark": "#B81E2A",   # darker red for hover
    "text":        "#FAFAFA",
    "text_muted":  "#999999",   # hsl(0 0% 60%)
    "border":      "#292929",   # hsl(0 0% 16%)
    "error":       "#EF4444",
    "warning":     "#E9A80A",   # arena-gold
    "rank_gold":   "#E9A80A",
    # PIL tuples for icon drawing
    "accent_pil":  (228, 37, 53, 255),    # #E42535
    "idle_pil":    (80, 80, 80, 255),
    "error_pil":   (239, 68, 68, 255),
    "match_pil":   (233, 168, 10, 255),   # gold
    "bg_pil":      (10, 10, 10, 255),     # #0A0A0A
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
    "engine_url":          "http://localhost:8001",
    "frontend_url":        "http://localhost:3000",
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
    "email":               None,
    "rank":                None,
    "xp":                  0,
    "avatar_url":          None,
    # Phase 4: stable UUID persisted per-install; sent in every heartbeat
    "session_id":          None,
    # Phase 5: identity cosmetics — synced from /auth/me after login
    "avatar_bg":           None,   # DB: users.avatar_bg
    "equipped_badge_icon": None,   # DB: users.equipped_badge_icon  e.g. "badge:champions"
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
    """Phase 4: compare CLIENT_VERSION against /version endpoint. Stub."""
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

    Desktop client = Bearer tokens stored in config.json.
    Website        = httpOnly cookies (same backend users table, different flow).

    Phase 3-ready: login() / logout() / refresh() call real engine endpoints
    once /auth/login, /auth/logout, /auth/refresh exist.

    Login field: "Email or Username" — backend accepts either (matches website).
    DB-ready: users table has both email and username columns.
    """

    def __init__(self, config: dict):
        self._config = config

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
    def email(self) -> str | None:
        return self._config.get("email")

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

    @property
    def avatar_bg(self) -> str | None:
        return self._config.get("avatar_bg")

    @property
    def equipped_badge_icon(self) -> str | None:
        return self._config.get("equipped_badge_icon")

    def set_token(self, token: str, user_id: str | None = None,
                  username: str | None = None, email: str | None = None,
                  wallet_address: str | None = None,
                  rank: str | None = None, xp: int | None = None,
                  avatar_url: str | None = None,
                  avatar_bg: str | None = None,
                  equipped_badge_icon: str | None = None):
        self._config["auth_token"] = token
        if user_id             is not None: self._config["user_id"]             = user_id
        if username            is not None: self._config["username"]            = username
        if email               is not None: self._config["email"]               = email
        if wallet_address      is not None: self._config["wallet_address"]      = wallet_address
        if rank                is not None: self._config["rank"]                = rank
        if xp                  is not None: self._config["xp"]                  = xp
        if avatar_url          is not None: self._config["avatar_url"]          = avatar_url
        if avatar_bg           is not None: self._config["avatar_bg"]           = avatar_bg
        if equipped_badge_icon is not None: self._config["equipped_badge_icon"] = equipped_badge_icon
        save_config(self._config)
        logger.info(f"Logged in: {username or email or user_id}")

    def clear(self):
        for k in ("auth_token", "user_id", "username", "email", "rank",
                  "avatar_url", "avatar_bg", "equipped_badge_icon"):
            self._config[k] = "" if k == "auth_token" else None
        self._config["xp"]             = 0
        self._config["wallet_address"] = "unknown"
        save_config(self._config)
        logger.info("Auth cleared")

    def login(self, engine: "EngineClient", identifier: str, password: str,
              session_id: str | None = None) -> str | None:
        """
        POST /auth/login with {identifier, password}.
        identifier = email — backend also accepts username but email is
        preferred because username is user-changeable in the profile.
        Returns None on success, error string on failure.

        Phase 5: after successful login, calls engine.bind_session() with the
        install's stable session_id so the website's GET /client/status returns
        user_id for this machine.
        """
        result = engine.login(identifier, password)
        if result and result.get("token"):
            self.set_token(
                token=result["token"],
                user_id=result.get("user_id"),
                username=result.get("username"),
                email=result.get("email"),
                wallet_address=result.get("wallet_address"),
                rank=result.get("rank"),
                xp=result.get("xp"),
                avatar_url=result.get("avatar_url"),
            )
            # Fetch full profile immediately so avatar_bg / badge appear at first paint,
            # not after the 60-second poll cycle. Non-fatal if /auth/me is unavailable.
            profile = engine.get_profile(result["token"])
            if profile:
                self.set_token(
                    token=result["token"],
                    rank=profile.get("rank") or result.get("rank"),
                    xp=profile.get("xp") or result.get("xp"),
                    avatar_bg=profile.get("avatar_bg"),
                    equipped_badge_icon=profile.get("equipped_badge_icon"),
                )
            # Phase 5: bind session so website can detect this client immediately
            if session_id:
                engine.bind_session(result["token"], session_id)
            return None  # success
        if result and result.get("detail"):
            return result["detail"]
        return "Login failed — check Engine connection"

    def logout(self, engine: "EngineClient | None" = None):
        """
        Phase 5: tell engine to disconnect sessions before clearing local state.
        engine param is optional for backward compat (e.g. ArenaTray shutdown).
        """
        token = self._config.get("auth_token", "")
        if engine and token:
            engine.logout_from_engine(token)
        self.clear()

    def refresh(self, engine: "EngineClient") -> bool:
        """Phase 6: POST /auth/refresh. Stub: no-op."""
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
            monitor  = monitors[monitor_num]
            shot     = sct.grab(monitor)
            ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = (f"{game_name.replace(' ', '_')}_{ts}.png"
                        if game_name else f"capture_{ts}.png")
            filepath = os.path.join(output_dir, filename)
            mss.tools.to_png(shot.rgb, shot.size, output=filepath)
            logger.debug(f"Screenshot: {filepath}")
            return filepath
    except Exception as e:
        logger.error(f"Screenshot failed: {e}")
        return None


# ── Game Detection ─────────────────────────────────────────────────────────────
ACTIVE_GAME_PROCESSES: dict[str, list[str]] = {
    "CS2":      ["cs2.exe", "csgo.exe"],
    "Valorant": ["VALORANT-Win64-Shipping.exe"],
    # Coming Soon:
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
            logger.debug(f"Active match poll: {e}")
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
        except Exception as e:
            logger.error(f"Upload error: {e}")
        return None

    def login(self, identifier: str, password: str) -> dict | None:
        """
        POST /auth/login → {access_token, token_type, user_id, username, email, arena_id}
        identifier = email OR username — backend accepts both.
        Returns normalised dict with key 'token' for AuthManager.set_token().
        Returns {'detail': '...'} on 401/403, None on network error.
        """
        try:
            r = self.client.post(
                f"{self.base_url}/auth/login",
                json={"identifier": identifier, "password": password},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                # Normalise access_token → token so AuthManager.set_token() works
                return {
                    "token":          data.get("access_token"),
                    "user_id":        data.get("user_id"),
                    "username":       data.get("username"),
                    "email":          data.get("email"),
                    "arena_id":       data.get("arena_id"),
                    "wallet_address": data.get("wallet_address"),
                }
            try:
                detail = r.json().get("detail", "Invalid credentials")
            except Exception:
                detail = f"Login failed ({r.status_code})"
            return {"detail": detail}
        except Exception as e:
            logger.error(f"Login failed: {e}")
            return None

    def get_profile(self, token: str) -> dict | None:
        """
        GET /auth/me → {user_id, username, email, arena_id, rank, wallet_address, xp, wins, losses}
        Used by _poll_profile_sync() to keep rank/XP fresh every 60s.
        """
        try:
            r = self.client.get(
                f"{self.base_url}/auth/me",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.error(f"Profile fetch: {e}")
        return None

    def bind_session(self, token: str, session_id: str) -> bool:
        """
        POST /client/bind — links this install's session_id to the authenticated user.
        Called automatically after login so GET /client/status returns user_id.
        Non-fatal: bind failure is logged but does not block the UI.
        """
        try:
            r = self.client.post(
                f"{self.base_url}/client/bind",
                json={"session_id": session_id},
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                logger.info("Session bound to user")
                return True
            logger.warning(f"Bind session returned {r.status_code}")
        except Exception as e:
            logger.debug(f"Bind session failed (non-fatal): {e}")
        return False

    def logout_from_engine(self, token: str) -> None:
        """
        POST /auth/logout — tells engine to disconnect client_sessions for this user.
        Best-effort: network failure is silent (local clear still happens).
        """
        try:
            self.client.post(
                f"{self.base_url}/auth/logout",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            logger.info("Engine logout OK")
        except Exception as e:
            logger.debug(f"Engine logout failed (non-fatal): {e}")

    def get_active_events(self, token: str) -> list[dict]:
        """
        Phase 6: GET /events/active → [{id, name, description, xp_reward, claimed, ends_at}]
        DB-ready: events + event_claims tables.
        """
        # Phase 6 stub:
        return []

    def claim_event(self, event_id: str, token: str) -> bool:
        """
        Phase 6: POST /events/{event_id}/claim
        DB-ready: inserts event_claims row, updates user_stats.xp.
        """
        # Phase 6 stub:
        return False

    def check_version(self, client_version: str) -> dict | None:
        """Phase 6: GET /version. Stub."""
        return None


# ── Match Monitor ──────────────────────────────────────────────────────────────
class MatchMonitor:
    _HEARTBEAT_INTERVAL = 4   # must be < engine _CLIENT_TIMEOUT_SECONDS (10s); fast disconnect detection

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
        logger.info("Monitor started")

    def stop(self):
        self.running = False
        self._heartbeat_stop.set()
        if self._thread:           self._thread.join(timeout=10)
        if self._heartbeat_thread: self._heartbeat_thread.join(timeout=5)
        logger.info("Monitor stopped")

    def _loop(self):
        while self.running:
            try:
                game = detect_running_game()
                if not game:
                    time.sleep(self.config.get("screenshot_interval", 5))
                    continue

                if is_game_running(game):
                    if not self.monitoring:
                        logger.info(f"{game} detected")
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
                            logger.debug("No match ID — saved locally")
                else:
                    if self.monitoring:
                        logger.info(f"{game} closed")
                        self.monitoring         = False
                        self.current_match_id   = None

            except Exception as e:
                logger.error(f"Monitor error: {e}")

            active = detect_running_game()
            base   = GAME_INTERVALS.get(active, self.config.get("screenshot_interval", 5))
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
                "session_id":     self._session_id,  # Phase 4: client_sessions FK
                "match_id":       self.current_match_id,
                "user_id":        self.config.get("user_id"),  # set after login; binds session to user
            }
            resp = self.engine.client.post(
                f"{self.engine.base_url}/client/heartbeat", json=payload, timeout=5)
            if resp.status_code == 200:
                logger.debug(f"Heartbeat OK | {status} | {game}")
        except Exception as e:
            logger.debug(f"Heartbeat (non-fatal): {e}")

    def set_match_id(self, match_id: str):
        self.current_match_id = match_id
        logger.info(f"Match: {match_id}")


# ── Icon Rendering ─────────────────────────────────────────────────────────────
def _draw_arena_icon(size: int = 64, state: str = "idle") -> Image.Image:
    """
    Arena 'A' tray icon.
    Drawn at 4× resolution then downscaled for smooth anti-aliasing at small sizes.

    States:
      active → red 'A'   (monitoring ON)
      match  → gold 'A'  (match in progress)
      error  → dim red   (engine offline)
      idle   → gray 'A'  (monitoring OFF)

    Background is transparent so Windows tray colour shows through cleanly.
    A small filled circle behind the glyph ensures the 'A' is always legible.
    """
    colors = {
        "active": BRAND["accent_pil"],
        "match":  BRAND["match_pil"],
        "error":  (180, 30, 40, 200),
        "idle":   BRAND["idle_pil"],
    }
    glyph_color = colors.get(state, colors["idle"])

    # Draw at 4× then downscale → smooth edges at any size
    draw_size = size * 4
    img  = Image.new("RGBA", (draw_size, draw_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    s = draw_size
    cx = s // 2

    # Dark pill background — just behind the glyph area, not full square
    pad_bg = int(s * 0.08)
    draw.ellipse([pad_bg, pad_bg, s - pad_bg, s - pad_bg],
                 fill=(15, 15, 15, 230))

    # Thin ring
    lw_ring = max(2, s // 40)
    draw.ellipse([pad_bg, pad_bg, s - pad_bg, s - pad_bg],
                 outline=glyph_color, width=lw_ring)

    # 'A' glyph — thick, bold, centred
    lw  = max(8, s // 12)
    pad = int(s * 0.18)

    top  = (cx,          int(s * 0.12))
    bl   = (int(s * 0.1), int(s * 0.88))
    br   = (int(s * 0.9), int(s * 0.88))
    cb_y = int(s * 0.55)
    ins  = int(s * 0.28)
    cb_l = (ins,     cb_y)
    cb_r = (s - ins, cb_y)

    draw.line([top, bl],    fill=glyph_color, width=lw)
    draw.line([top, br],    fill=glyph_color, width=lw)
    draw.line([cb_l, cb_r], fill=glyph_color, width=max(6, s // 16))

    # Downscale with LANCZOS for smooth anti-aliasing
    return img.resize((size, size), Image.LANCZOS)


def generate_ico_file(path: str):
    """
    Save a Windows-compatible ICO for the window titlebar/taskbar.
    PIL's ICO writer only stores one size reliably; we save 32×32 which
    Windows scales for titlebar use. The tray icon uses PIL RGBA directly.
    """
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    # Draw at 256, composite onto dark bg, save as 32x32 ICO
    # (PIL multi-size ICO is unreliable; single 32px ICO works on all Windows)
    rgba = _draw_arena_icon(256, state="active")
    bg   = Image.new("RGBA", (256, 256), (15, 15, 15, 255))
    bg.paste(rgba, mask=rgba.split()[3])
    icon = bg.resize((32, 32), Image.LANCZOS).convert("RGBA")
    icon.save(path, format="ICO")
    logger.info(f"ICO saved: {path} ({os.path.getsize(path)} bytes)")


# ── Client Window ──────────────────────────────────────────────────────────────
_window_instance = None   # global ref so tray can deiconify safely

# ── Avatar cosmetics ──────────────────────────────────────────────────────────
# Mirrors avatarBgs.ts `accent` hex values → RGB tuple for Pillow drawing.
_AVATAR_BG_COLORS: dict[str, tuple[int, int, int]] = {
    "default":  (239, 68,  68),   # Crimson Core
    "blue":     (59,  130, 246),  # Ion Blue
    "purple":   (168, 85,  247),  # Void Violet
    "cyan":     (34,  211, 238),  # Neon Azure
    "green":    (34,  197, 94),   # Toxic Matrix
    "orange":   (249, 115, 22),   # Solar Flare
    "fire":     (249, 115, 22),   # Inferno Season
    "ice":      (125, 211, 252),  # Sub-Zero Crown
    "electric": (250, 204, 21),   # Storm Surge
    "void":     (124, 58,  237),  # Abyss Prime
    "gold":     (234, 179, 8),    # Sovereign Gold
    "rainbow":  (236, 72,  153),  # Chroma Luxe
    "aurora":   (52,  211, 153),  # Northern Pulse
    "lava":     (220, 38,  38),   # Magma Elite
}

# Maps badge ID (after stripping "badge:") → emoji shown in the client profile card.
_BADGE_EMOJI: dict[str, str] = {
    "founders":        "🏛",
    "champions":       "🏆",
    "veterans":        "⚔",
    "arena_ring":      "💠",
    "sun_god":         "☀",
    "neon_hunter":     "🎯",
    "shadow_ronin":    "🥷",
    "black_mage":      "🔮",
    "desert_prince":   "👑",
    "storm_swordsman": "⚡",
    "crimson_core":    "💢",
    "void_warden":     "🌑",
    "iron_command":    "🛡",
}


def _resolve_avatar_color(bg_id: str | None) -> tuple[int, int, int]:
    """Return RGB tuple for the given avatar_bg id; falls back to default red."""
    return _AVATAR_BG_COLORS.get(bg_id or "default", _AVATAR_BG_COLORS["default"])


def _resolve_badge_emoji(equipped_badge_icon: str | None) -> str | None:
    """Return emoji for a 'badge:<id>' string, or None if not set / unrecognised."""
    if not equipped_badge_icon or not equipped_badge_icon.startswith("badge:"):
        return None
    return _BADGE_EMOJI.get(equipped_badge_icon[len("badge:"):])


def _build_client_window(monitor: "MatchMonitor", auth: "AuthManager",
                         config: dict, ico_path: str | None = None) -> None:
    """
    Arena Client window — dark gaming aesthetic matching the website.

    Thread-safety rule: ALL widget updates go through win.after(ms, fn).
    Never call .configure() on a tkinter widget from a background thread.

    Tabs:
      Overview — Engine status · Identity (login / profile) · Game · Monitoring
      Events   — Active events with Claim XP
    """
    global _window_instance

    try:
        import customtkinter as ctk
    except ImportError:
        logger.error("customtkinter not installed")
        return

    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")

    win = ctk.CTk()
    win.title("Arena Client")
    win.geometry("400x600")
    win.resizable(False, False)
    win.configure(fg_color=BRAND["bg"])

    if ico_path and os.path.exists(ico_path):
        try: win.iconbitmap(ico_path)
        except Exception: pass

    _window_instance = win

    def _on_close():
        win.withdraw()
    win.protocol("WM_DELETE_WINDOW", _on_close)

    # ── All shared actions defined first — before any closure references them ─
    def _open_website():
        import webbrowser
        url = config.get("frontend_url", "http://localhost:3000")
        webbrowser.open(url)

    def _quit_app():
        monitor.stop()
        win.destroy()
        os._exit(0)

    # ── Widget helpers ────────────────────────────────────────────────────────
    def _card(parent, title: str) -> ctk.CTkFrame:
        outer = ctk.CTkFrame(parent, fg_color=BRAND["bg_card"], corner_radius=8,
                              border_width=1, border_color=BRAND["border"])
        outer.pack(fill="x", padx=14, pady=(8, 0))
        ctk.CTkLabel(outer, text=title.upper(),
                     font=ctk.CTkFont(size=9, weight="bold"),
                     text_color=BRAND["text_muted"]).pack(anchor="w", padx=14, pady=(10, 2))
        return outer

    def _hdivider(parent):
        ctk.CTkFrame(parent, height=1, fg_color=BRAND["border"]).pack(
            fill="x", padx=14, pady=(0, 4))

    def _status_dot(parent) -> ctk.CTkLabel:
        return ctk.CTkLabel(parent, text="●", font=ctk.CTkFont(size=9),
                             text_color=BRAND["text_muted"])

    # ── Header ────────────────────────────────────────────────────────────────
    header = ctk.CTkFrame(win, fg_color=BRAND["bg_card"], corner_radius=0,
                           height=52, border_width=0)
    header.pack(fill="x")
    header.pack_propagate(False)

    # Red left accent bar
    ctk.CTkFrame(header, width=3, fg_color=BRAND["accent"], corner_radius=0).pack(
        side="left", fill="y")

    ctk.CTkLabel(header, text="ARENA",
                 font=ctk.CTkFont(size=18, weight="bold"),
                 text_color=BRAND["accent"]).pack(side="left", padx=14, pady=14)

    # Version + engine dot on right
    hdr_right = ctk.CTkFrame(header, fg_color="transparent")
    hdr_right.pack(side="right", padx=12, pady=14)

    hdr_eng_dot = ctk.CTkLabel(hdr_right, text="●", font=ctk.CTkFont(size=9),
                                text_color=BRAND["text_muted"])
    hdr_eng_dot.pack(side="right", padx=(4, 0))
    hdr_eng_lbl = ctk.CTkLabel(hdr_right, text="Engine",
                                font=ctk.CTkFont(size=11),
                                text_color=BRAND["text_muted"])
    hdr_eng_lbl.pack(side="right")
    ctk.CTkLabel(hdr_right, text=f"v{CLIENT_VERSION}  ",
                 font=ctk.CTkFont(size=11),
                 text_color=BRAND["text_muted"]).pack(side="right")

    # ── Tab view ──────────────────────────────────────────────────────────────
    tabview = ctk.CTkTabview(
        win,
        fg_color=BRAND["bg"],
        corner_radius=0,
        segmented_button_fg_color=BRAND["bg_card"],
        segmented_button_selected_color=BRAND["accent"],
        segmented_button_selected_hover_color=BRAND["accent_dark"],
        segmented_button_unselected_color=BRAND["bg_card"],
        segmented_button_unselected_hover_color=BRAND["bg_hover"],
        text_color=BRAND["text"],
        text_color_disabled=BRAND["text_muted"],
    )
    tabview.pack(fill="both", expand=True)
    tabview.add("Overview")
    tabview.add("Events")

    tab_ov = tabview.tab("Overview")
    tab_ev = tabview.tab("Events")

    # ── OVERVIEW TAB ──────────────────────────────────────────────────────────
    ov = ctk.CTkScrollableFrame(tab_ov, fg_color=BRAND["bg"], corner_radius=0)
    ov.pack(fill="both", expand=True)

    # Engine card
    eng_card = _card(ov, "Engine")
    eng_row  = ctk.CTkFrame(eng_card, fg_color="transparent")
    eng_row.pack(fill="x", padx=14, pady=(0, 12))
    eng_dot  = _status_dot(eng_row)
    eng_dot.pack(side="left")
    eng_lbl  = ctk.CTkLabel(eng_row, text="Checking…",
                              font=ctk.CTkFont(size=13), text_color=BRAND["text"])
    eng_lbl.pack(side="left", padx=(6, 0))

    # Identity card
    id_card     = _card(ov, "Identity")
    id_inner_ref: list = []

    def _rebuild_identity():
        for w in id_inner_ref:
            try: w.destroy()
            except Exception: pass
        id_inner_ref.clear()
        inner = ctk.CTkFrame(id_card, fg_color="transparent")
        inner.pack(fill="x", padx=14, pady=(0, 12))
        id_inner_ref.append(inner)
        if auth.is_authenticated:
            _build_profile(inner)
        else:
            _build_login_form(inner)

    def _build_login_form(parent: ctk.CTkFrame):
        """
        Login form — accepts email OR username (backend handles both).
        DB-ready: /auth/login validates identifier against users.email.
                  Email is used (not username) because username is changeable in profile.
        """
        ctk.CTkLabel(parent, text="Sign in to Arena",
                     font=ctk.CTkFont(size=14, weight="bold"),
                     text_color=BRAND["text"]).pack(anchor="w", pady=(0, 10))

        id_entry = ctk.CTkEntry(
            parent, placeholder_text="Email",
            height=36, corner_radius=6,
            fg_color=BRAND["bg_hover"],
            border_color=BRAND["border"],
            border_width=1,
            text_color=BRAND["text"],
            placeholder_text_color=BRAND["text_muted"],
            font=ctk.CTkFont(size=13),
        )
        id_entry.pack(fill="x", pady=(0, 6))

        pw_entry = ctk.CTkEntry(
            parent, placeholder_text="Password", show="*",
            height=36, corner_radius=6,
            fg_color=BRAND["bg_hover"],
            border_color=BRAND["border"],
            border_width=1,
            text_color=BRAND["text"],
            placeholder_text_color=BRAND["text_muted"],
            font=ctk.CTkFont(size=13),
        )
        pw_entry.pack(fill="x", pady=(0, 8))

        err_lbl = ctk.CTkLabel(parent, text="",
                                font=ctk.CTkFont(size=11),
                                text_color=BRAND["error"])
        err_lbl.pack(anchor="w", pady=(0, 4))

        def _do_login():
            ident = id_entry.get().strip()
            pwd   = pw_entry.get()
            if not ident or not pwd:
                err_lbl.configure(text="Please fill in all fields.")
                return
            err_lbl.configure(text="Signing in…", text_color=BRAND["text_muted"])
            login_btn.configure(state="disabled", text="Signing in…")

            def _thread():
                # Phase 5: pass session_id so bind_session() is called on success
                error = auth.login(monitor.engine, ident, pwd,
                                   session_id=monitor._session_id)
                def _after():
                    login_btn.configure(state="normal", text="Sign In")
                    if error:
                        err_lbl.configure(text=error, text_color=BRAND["error"])
                    else:
                        monitor.engine.token = auth.access_token or ""
                        _rebuild_identity()
                win.after(0, _after)
            threading.Thread(target=_thread, daemon=True).start()

        login_btn = ctk.CTkButton(
            parent, text="Sign In", height=36, corner_radius=6,
            fg_color=BRAND["accent"], hover_color=BRAND["accent_dark"],
            text_color="#FFFFFF", font=ctk.CTkFont(size=13, weight="bold"),
            command=_do_login,
        )
        login_btn.pack(fill="x", pady=(0, 10))
        pw_entry.bind("<Return>", lambda e: _do_login())
        id_entry.bind("<Return>",  lambda e: pw_entry.focus())

        # Divider
        div_row = ctk.CTkFrame(parent, fg_color="transparent")
        div_row.pack(fill="x", pady=(0, 6))
        ctk.CTkFrame(div_row, height=1, fg_color=BRAND["border"]).pack(
            side="left", fill="x", expand=True, pady=6)
        ctk.CTkLabel(div_row, text="  or  ",
                     font=ctk.CTkFont(size=10),
                     text_color=BRAND["text_muted"]).pack(side="left")
        ctk.CTkFrame(div_row, height=1, fg_color=BRAND["border"]).pack(
            side="left", fill="x", expand=True, pady=6)

        ctk.CTkButton(
            parent, text="Open Arena Website", height=32, corner_radius=6,
            fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
            border_width=1, border_color=BRAND["border"],
            text_color=BRAND["text_muted"], font=ctk.CTkFont(size=12),
            command=_open_website,
        ).pack(fill="x")

    def _build_profile(parent: ctk.CTkFrame):
        """Profile card shown after successful auth."""
        uname   = auth.username or auth.email or "Player"
        initial = uname[0].upper()
        av_size = 44

        # Avatar — circle color matches the user's avatar_bg setting on the website
        bg_rgb  = _resolve_avatar_color(auth.avatar_bg)
        av_img  = Image.new("RGBA", (av_size, av_size), (0, 0, 0, 0))
        av_d    = ImageDraw.Draw(av_img)
        av_d.ellipse([0, 0, av_size, av_size], fill=(*bg_rgb, 35))
        av_d.ellipse([0, 0, av_size, av_size], outline=(*bg_rgb, 255), width=2)
        ctk_av  = ctk.CTkImage(light_image=av_img, dark_image=av_img,
                                size=(av_size, av_size))

        # Badge emoji (equipped_badge_icon = "badge:<id>")
        badge_emoji = _resolve_badge_emoji(auth.equipped_badge_icon)
        av_hex      = "#{:02x}{:02x}{:02x}".format(*bg_rgb)

        row = ctk.CTkFrame(parent, fg_color="transparent")
        row.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(row, image=ctk_av, text=initial,
                     font=ctk.CTkFont(size=16, weight="bold"),
                     text_color=av_hex).pack(side="left")

        info = ctk.CTkFrame(row, fg_color="transparent")
        info.pack(side="left", padx=(10, 0))

        # Username + optional badge chip on the same line
        name_row = ctk.CTkFrame(info, fg_color="transparent")
        name_row.pack(anchor="w")
        ctk.CTkLabel(name_row, text=uname,
                     font=ctk.CTkFont(size=14, weight="bold"),
                     text_color=BRAND["text"]).pack(side="left")
        if badge_emoji:
            ctk.CTkLabel(name_row, text=f" {badge_emoji}",
                         font=ctk.CTkFont(size=13),
                         text_color=av_hex).pack(side="left")

        if auth.email:
            ctk.CTkLabel(info, text=auth.email,
                         font=ctk.CTkFont(size=11),
                         text_color=BRAND["text_muted"]).pack(anchor="w")

        wallet = auth.wallet_address
        if wallet and wallet != "unknown":
            ctk.CTkLabel(info,
                         text=f"{wallet[:6]}…{wallet[-4:]}",
                         font=ctk.CTkFont(size=11),
                         text_color=BRAND["text_muted"]).pack(anchor="w")

        # Rank + XP
        rank       = auth.rank or "Unranked"
        rank_color = BRAND["rank_gold"] if auth.rank else BRAND["text_muted"]
        ctk.CTkLabel(parent, text=f"Rank: {rank}",
                     font=ctk.CTkFont(size=12, weight="bold"),
                     text_color=rank_color).pack(anchor="w", pady=(0, 4))

        ctk.CTkLabel(parent, text=f"XP: {auth.xp:,}",
                     font=ctk.CTkFont(size=11),
                     text_color=BRAND["text_muted"]).pack(anchor="w", pady=(0, 4))
        # Phase 3: set real xp / xp_to_next_level ratio once profile API returns it
        xp_bar = ctk.CTkProgressBar(parent, height=5, corner_radius=3,
                                     progress_color=BRAND["accent"],
                                     fg_color=BRAND["bg_hover"])
        xp_bar.set(0.0)
        xp_bar.pack(fill="x", pady=(0, 10))

        def _do_logout():
            # Phase 5: tell engine to disconnect sessions before clearing local state
            auth.logout(engine=monitor.engine)
            monitor.engine.token = ""
            win.after(0, _rebuild_identity)

        ctk.CTkButton(
            parent, text="Sign Out", height=30, corner_radius=6,
            fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
            border_width=1, border_color=BRAND["border"],
            text_color=BRAND["text_muted"], font=ctk.CTkFont(size=12),
            command=_do_logout,
        ).pack(anchor="w")

    _rebuild_identity()

    # Game status card
    game_card  = _card(ov, "Game Status")
    game_row   = ctk.CTkFrame(game_card, fg_color="transparent")
    game_row.pack(fill="x", padx=14, pady=(0, 4))
    game_dot   = _status_dot(game_row)
    game_dot.pack(side="left")
    game_lbl   = ctk.CTkLabel(game_row, text="No game detected",
                               font=ctk.CTkFont(size=13), text_color=BRAND["text"])
    game_lbl.pack(side="left", padx=(6, 0))
    match_lbl  = ctk.CTkLabel(game_card, text="",
                               font=ctk.CTkFont(size=11), text_color=BRAND["warning"])
    match_lbl.pack(anchor="w", padx=14, pady=(0, 10))

    # Monitoring toggle card
    mon_card = _card(ov, "Monitoring")
    mon_row  = ctk.CTkFrame(mon_card, fg_color="transparent")
    mon_row.pack(fill="x", padx=14, pady=(0, 12))

    mon_var = ctk.BooleanVar(value=monitor.running)
    mon_lbl = ctk.CTkLabel(mon_row,
                            text="ON" if monitor.running else "OFF",
                            font=ctk.CTkFont(size=11, weight="bold"),
                            text_color=BRAND["accent"] if monitor.running else BRAND["text_muted"],
                            width=32)
    mon_lbl.pack(side="left")

    def _on_toggle():
        if mon_var.get():
            monitor.start()
            mon_lbl.configure(text="ON",  text_color=BRAND["accent"])
        else:
            monitor.stop()
            mon_lbl.configure(text="OFF", text_color=BRAND["text_muted"])

    ctk.CTkSwitch(
        mon_row, text="Capture & upload screenshots",
        variable=mon_var, onvalue=True, offvalue=False,
        command=_on_toggle,
        font=ctk.CTkFont(size=12), text_color=BRAND["text"],
        button_color=BRAND["accent"],
        button_hover_color=BRAND["accent_dark"],
        progress_color=BRAND["accent_dark"],
    ).pack(side="left", padx=(8, 0))

    ctk.CTkLabel(ov, text="", height=10).pack()

    # ── EVENTS TAB ────────────────────────────────────────────────────────────
    ev = ctk.CTkScrollableFrame(tab_ev, fg_color=BRAND["bg"], corner_radius=0)
    ev.pack(fill="both", expand=True)

    ev_status = ctk.CTkLabel(ev, text="",
                              font=ctk.CTkFont(size=13),
                              text_color=BRAND["text_muted"], wraplength=320)
    ev_status.pack(pady=20)

    ev_list = ctk.CTkFrame(ev, fg_color="transparent")
    ev_list.pack(fill="x", padx=12)

    def _render_events(events: list[dict]):
        """Render event cards. Called on main thread via win.after."""
        for w in ev_list.winfo_children():
            try: w.destroy()
            except Exception: pass

        if not auth.is_authenticated:
            ev_status.configure(text="Sign in on the Overview tab to see active events.")
            return
        ev_status.configure(text="")

        if not events:
            ctk.CTkLabel(ev_list, text="No active events right now.",
                          font=ctk.CTkFont(size=13),
                          text_color=BRAND["text_muted"]).pack(pady=20)
            return

        for evt in events:
            row = ctk.CTkFrame(ev_list, fg_color=BRAND["bg_card"], corner_radius=8,
                                border_width=1, border_color=BRAND["border"])
            row.pack(fill="x", pady=(0, 8))

            ctk.CTkLabel(row, text=evt.get("name", "Event"),
                          font=ctk.CTkFont(size=13, weight="bold"),
                          text_color=BRAND["text"]).pack(anchor="w", padx=12, pady=(10, 0))

            desc = evt.get("description", "")
            if desc:
                ctk.CTkLabel(row, text=desc,
                              font=ctk.CTkFont(size=11),
                              text_color=BRAND["text_muted"],
                              wraplength=320).pack(anchor="w", padx=12)

            br = ctk.CTkFrame(row, fg_color="transparent")
            br.pack(fill="x", padx=12, pady=(6, 10))

            xp_reward = evt.get("xp_reward", 0)
            claimed   = evt.get("claimed", False)
            ev_id     = evt.get("id", "")

            ctk.CTkLabel(br, text=f"+{xp_reward} XP",
                          font=ctk.CTkFont(size=12, weight="bold"),
                          text_color=BRAND["warning"]).pack(side="left")

            cbtn = ctk.CTkButton(
                br, text="Claimed" if claimed else "Claim XP",
                height=28, width=90, corner_radius=6,
                fg_color=BRAND["bg_hover"] if claimed else BRAND["accent"],
                hover_color=BRAND["border"] if claimed else BRAND["accent_dark"],
                text_color=BRAND["text_muted"] if claimed else "#FFFFFF",
                font=ctk.CTkFont(size=12, weight="bold"),
                state="disabled" if claimed else "normal",
            )
            cbtn.pack(side="right")

            if not claimed:
                def _make_handler(eid: str, btn: ctk.CTkButton):
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
                cbtn.configure(command=_make_handler(ev_id, cbtn))

    # ── Footer ─────────────────────────────────────────────────────────────────
    footer = ctk.CTkFrame(win, fg_color=BRAND["bg_card"], corner_radius=0,
                           height=58, border_width=0)
    footer.pack(fill="x", side="bottom")
    footer.pack_propagate(False)

    # Top border line on footer
    ctk.CTkFrame(footer, height=1, fg_color=BRAND["border"], corner_radius=0).pack(
        fill="x", side="top")

    btn_row = ctk.CTkFrame(footer, fg_color="transparent")
    btn_row.pack(expand=True)

    def _check_engine_btn():
        threading.Thread(target=_do_engine_check, daemon=True).start()

    for text, cmd, fg, hv, tc in [
        ("Check Engine", _check_engine_btn, BRAND["bg_hover"], BRAND["border"], BRAND["text"]),
        ("Website",      _open_website,     BRAND["bg_hover"], BRAND["border"], BRAND["text"]),
        ("Quit",         _quit_app,         BRAND["accent"],   BRAND["accent_dark"], "#FFFFFF"),
    ]:
        ctk.CTkButton(btn_row, text=text, height=30, corner_radius=6,
                       fg_color=fg, hover_color=hv,
                       text_color=tc, font=ctk.CTkFont(size=12),
                       command=cmd).pack(side="left", padx=4, pady=10)

    # ── Thread-safe polls — all via win.after() ────────────────────────────────

    def _do_engine_check():
        """Background: fetch health, apply to UI on main thread."""
        health = monitor.engine.health()
        def _apply():
            if health and health.get("status") == "ok":
                db = health.get("db", "?")
                eng_lbl.configure(text=f"Connected  ·  DB: {db}", text_color=BRAND["text"])
                eng_dot.configure(text_color=BRAND["accent"])
                hdr_eng_dot.configure(text_color=BRAND["accent"])
                hdr_eng_lbl.configure(text_color=BRAND["accent"])
            else:
                eng_lbl.configure(text="Engine offline", text_color=BRAND["text_muted"])
                eng_dot.configure(text_color=BRAND["error"])
                hdr_eng_dot.configure(text_color=BRAND["error"])
                hdr_eng_lbl.configure(text_color=BRAND["text_muted"])
        win.after(0, _apply)

    def _poll_engine():
        threading.Thread(target=_do_engine_check, daemon=True).start()
        win.after(10_000, _poll_engine)

    def _poll_game():
        game = detect_running_game()
        if game:
            game_lbl.configure(text=game, text_color=BRAND["text"])
            game_dot.configure(text_color=BRAND["accent"])
        else:
            game_lbl.configure(text="No game detected", text_color=BRAND["text_muted"])
            game_dot.configure(text_color=BRAND["text_muted"])
        if monitor.current_match_id:
            match_lbl.configure(text=f"Match #{monitor.current_match_id[:8]}…")
        else:
            match_lbl.configure(text="")
        win.after(3_000, _poll_game)

    def _poll_events():
        if auth.is_authenticated:
            token = auth.access_token or ""
            def _fetch():
                evts = monitor.engine.get_active_events(token)
                win.after(0, lambda: _render_events(evts))
            threading.Thread(target=_fetch, daemon=True).start()
        else:
            _render_events([])
        win.after(30_000, _poll_events)

    def _poll_profile_sync():
        """Phase 3: re-sync rank/XP/avatar from /auth/me every 60s."""
        if auth.is_authenticated:
            token = auth.access_token or ""
            def _fetch():
                profile = monitor.engine.get_profile(token)
                if profile:
                    changed = (
                        profile.get("rank")                != auth.rank
                        or profile.get("xp")              != auth.xp
                        or profile.get("avatar_bg")        != auth.avatar_bg
                        or profile.get("equipped_badge_icon") != auth.equipped_badge_icon
                    )
                    if changed:
                        auth.set_token(
                            token=token,
                            rank=profile.get("rank"),
                            xp=profile.get("xp"),
                            avatar_url=profile.get("avatar_url"),
                            avatar_bg=profile.get("avatar_bg"),
                        )
                        # equipped_badge_icon can be None (badge removed) — update directly
                        auth._config["equipped_badge_icon"] = profile.get("equipped_badge_icon")
                        win.after(0, _rebuild_identity)
            threading.Thread(target=_fetch, daemon=True).start()
        win.after(60_000, _poll_profile_sync)

    # Kick off all polls
    win.after(500,    _poll_engine)
    win.after(1_000,  _poll_game)
    win.after(2_000,  _poll_events)
    win.after(60_000, _poll_profile_sync)

    win.mainloop()


# ── System Tray ────────────────────────────────────────────────────────────────
class ArenaTray:
    def __init__(self):
        self.config  = load_config()
        self.auth    = AuthManager(self.config)
        self.monitor = MatchMonitor(self.config)
        self.icon:   pystray.Icon | None = None
        self._monitoring_enabled = False
        self._selected_game      = self.config.get("game", "AUTO")

    def _icon_state(self) -> str:
        if self.monitor.current_match_id: return "match"
        if self._monitoring_enabled:       return "active"
        return "idle"

    def _set_game(self, game: str):
        self._selected_game = game
        interval = GAME_INTERVALS.get(game, 5)
        self.config["game"]                    = game
        self.config["screenshot_interval"]     = interval
        self.monitor.config["game"]            = game
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
            icon.notify("Arena Client", "Client Offline — monitoring stopped")
        else:
            self.monitor.start()
            self._monitoring_enabled = True
            icon.icon = _draw_arena_icon(128, state="active")
            icon.notify("Arena Client", "Client Ready — monitoring started")

    def _on_open(self, icon, item):
        win = _window_instance
        if win:
            try: win.after(0, lambda: (win.deiconify(), win.lift(), win.focus()))
            except Exception: pass

    def _on_status(self, icon, item):
        health = self.monitor.engine.health()
        game   = detect_running_game()
        if health and health.get("status") == "ok":
            # Status language matches website: "Client Ready" / "In CS2" / "In Match"
            if self.monitor.current_match_id:
                client_state = "In Match"
            elif game:
                client_state = f"In {game}"
            elif self._monitoring_enabled:
                client_state = "Client Ready"
            else:
                client_state = "Client Offline"
            icon.notify("Arena Client", f"{client_state} · Engine connected")
        else:
            icon.notify("Arena Client", "Engine offline or unreachable")

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
            MenuItem("Open Arena",    self._on_open, default=True),
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
            logger.warning(f"ICO generation failed: {e}")
            ico_path = None

    app = ArenaTray()
    app.run(ico_path=ico_path)
