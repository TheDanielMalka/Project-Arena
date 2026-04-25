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
import re
import time
import json
import uuid
import random
import logging
import asyncio
import threading
import ctypes
from datetime import datetime, timezone, timedelta
from logging.handlers import RotatingFileHandler

import signal
import httpx
import websockets
import websockets.exceptions
import mss
import mss.tools
import pystray
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageTk
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
    # AAA HUD extensions — mirror tokens from src/index.css
    "hud_panel":   "#0F1115",
    "hud_panel_2": "#0B0D10",
    "hud_border":  "#2A2F3A",
    "hud_glow":    "#13C4E0",   # --arena-cyan  hsl(188 94% 42%)
    "hud_glow_2":  "#D93EE8",   # --arena-hud-magenta hsl(300 85% 55%)
    "hud_blue":    "#2A84FF",   # --arena-hud-blue hsl(210 100% 58%)
    "cyan":        "#13C4E0",
    "cyan_soft":   "#0d3340",
    "magenta":     "#D93EE8",
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
    "engine_url":          "https://project-arena.com/api",
    "frontend_url":        "https://project-arena.com",
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
    "xp_to_next_level":    1000,
    "avatar_url":          None,
    # Phase 4: stable UUID persisted per-install; sent in every heartbeat
    "session_id":          None,
    # Phase 5: identity cosmetics — synced from /auth/me after login
    "avatar_bg":           None,   # DB: users.avatar_bg
    "equipped_badge_icon": None,   # DB: users.equipped_badge_icon  e.g. "badge:champions"
    # Phase 5: user_settings.region from GET /auth/me (EU | NA | ASIA | SA | OCE | ME)
    "region":             None,
}


# ── Embedded fonts (bundled TTFs matching the Arena website) ──────────────────
# Fallback chain is used if AddFontResourceExW registration fails or the
# font files are missing (dev-mode before PyInstaller bundles them).
FONT_DISPLAY = "Orbitron"          # wordmarks, card titles, tactical headings
FONT_BODY    = "Inter"             # body text / buttons
FONT_MONO    = "Share Tech Mono"   # telemetry, chips, stat values, labels
FONT_HUD     = "Rajdhani"          # supporting HUD labels
FONT_ALT     = "Tektur"            # accent headings (optional)

def _assets_dir() -> str:
    """Locate the bundled 'assets/' dir (works under PyInstaller --onefile)."""
    # PyInstaller: _MEIPASS holds the temp unpack dir
    base = getattr(sys, "_MEIPASS", None)
    if base:
        cand = os.path.join(base, "assets")
        if os.path.isdir(cand):
            return cand
    # Dev-mode: sibling of this file
    here = os.path.dirname(os.path.abspath(__file__))
    cand = os.path.join(here, "assets")
    return cand

def _load_bundled_fonts() -> None:
    """
    Register every TTF under assets/fonts/ with GDI so Tk + PIL can resolve
    the family names (Orbitron, Inter, Rajdhani, Share Tech Mono, Tektur).
    Uses FR_PRIVATE (0x10) so the fonts live only for this process.
    Safe no-op on non-Windows or if files are missing.
    """
    try:
        if not sys.platform.startswith("win"):
            return
        fonts_dir = os.path.join(_assets_dir(), "fonts")
        if not os.path.isdir(fonts_dir):
            return
        FR_PRIVATE = 0x10
        # IMPORTANT: use a *private* WinDLL instance and DO NOT mutate
        # argtypes on the shared ctypes.windll.gdi32 — customtkinter also
        # calls AddFontResourceExW with a different signature and will
        # crash if we changed the shared attribute.
        _gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
        AddFont = _gdi32.AddFontResourceExW
        AddFont.argtypes = [ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_void_p]
        AddFont.restype  = ctypes.c_int
        loaded = 0
        for name in os.listdir(fonts_dir):
            if not name.lower().endswith((".ttf", ".otf")):
                continue
            path = os.path.join(fonts_dir, name)
            try:
                n = AddFont(ctypes.c_wchar_p(path), ctypes.c_uint(FR_PRIVATE), None)
                if n:
                    loaded += 1
            except Exception:
                pass
        # Broadcast WM_FONTCHANGE so the font cache picks them up.
        try:
            HWND_BROADCAST = 0xFFFF
            WM_FONTCHANGE  = 0x001D
            ctypes.windll.user32.SendMessageW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0)
        except Exception:
            pass
    except Exception:
        # Visuals fall back to system defaults; never block startup.
        pass



def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            saved = json.load(f)
        merged = {**DEFAULT_CONFIG, **saved}
        # Silent migration: older installs have the raw IP server address
        # (pre-domain). Rewrite to project-arena.com so WEBSITE button and
        # engine heartbeat target the new domain without forcing re-login.
        _legacy_markers = ("3.236.9.133", "localhost:3000",
                           "localhost:8000", "localhost:8001")
        migrated = False
        if any(m in (merged.get("engine_url") or "") for m in _legacy_markers):
            merged["engine_url"]   = DEFAULT_CONFIG["engine_url"]
            migrated = True
        if any(m in (merged.get("frontend_url") or "") for m in _legacy_markers):
            merged["frontend_url"] = DEFAULT_CONFIG["frontend_url"]
            migrated = True
        if migrated:
            try:
                with open(CONFIG_FILE, "w") as f:
                    json.dump(merged, f, indent=2)
            except OSError:
                pass
        return merged
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

# ── PII redaction for logs ────────────────────────────────────────────────────
# Audit finding: logs persisted user_id / wallet_address / session_id / tokens
# to client.log in plaintext.  A stolen laptop or a support-bundle upload
# would leak identifiers that directly map a machine to a user account.
# The filter runs on every LogRecord before any handler formats it, so the
# redaction applies to both the rotating file and the console stream.
_UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
_WALLET_RE = re.compile(r"\b0x[0-9a-fA-F]{40}\b")
_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9_\-\.]+", re.IGNORECASE)
_JWT_RE    = re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b")
_EMAIL_RE  = re.compile(r"\b([A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]*@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b")


def _redact(text: str) -> str:
    if not text:
        return text
    # JWT first — matches a looser pattern than Bearer and should not leak
    # through as a plain UUID/base64 chunk.
    text = _JWT_RE.sub("<redacted:jwt>", text)
    text = _BEARER_RE.sub(r"\1<redacted>", text)
    text = _WALLET_RE.sub(
        lambda m: f"{m.group(0)[:6]}…{m.group(0)[-4:]}", text
    )
    text = _UUID_RE.sub(lambda m: f"{m.group(0)[:8]}…", text)
    text = _EMAIL_RE.sub(r"\1***@\2", text)
    return text


class _RedactingFilter(logging.Filter):
    """Rewrites record.msg / record.args so PII never reaches any handler."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = _redact(record.msg)
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {
                        k: _redact(v) if isinstance(v, str) else v
                        for k, v in record.args.items()
                    }
                elif isinstance(record.args, tuple):
                    record.args = tuple(
                        _redact(a) if isinstance(a, str) else a
                        for a in record.args
                    )
        except Exception:
            # A filter must not raise — drop quietly rather than lose the log.
            pass
        return True


logger = logging.getLogger("arena.client")
logger.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

_redacting_filter = _RedactingFilter()

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)
console_handler.addFilter(_redacting_filter)

file_handler = RotatingFileHandler(
    os.path.join(config["log_dir"], "client.log"),
    maxBytes=1_000_000, backupCount=5,
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)
file_handler.addFilter(_redacting_filter)

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

    Login field: Email only — username is changeable in profile, email is the stable identity.
    DB-ready: users table has both email and username columns.
    """

    def __init__(self, config: dict):
        self._config               = config
        self._pending_2fa_token: str | None = None

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
    def xp_to_next_level(self) -> int:
        return max(int(self._config.get("xp_to_next_level") or 1000), 1)

    @property
    def avatar_url(self) -> str | None:
        return self._config.get("avatar_url")

    @property
    def avatar_bg(self) -> str | None:
        return self._config.get("avatar_bg")

    @property
    def equipped_badge_icon(self) -> str | None:
        return self._config.get("equipped_badge_icon")

    @property
    def region(self) -> str | None:
        return self._config.get("region")

    def set_token(self, token: str, user_id: str | None = None,
                  username: str | None = None, email: str | None = None,
                  wallet_address: str | None = None,
                  rank: str | None = None, xp: int | None = None,
                  xp_to_next_level: int | None = None,
                  avatar_url: str | None = None,
                  avatar_bg: str | None = None,
                  equipped_badge_icon: str | None = None,
                  region: str | None = None):
        self._config["auth_token"] = token
        if user_id             is not None: self._config["user_id"]             = user_id
        if username            is not None: self._config["username"]            = username
        if email               is not None: self._config["email"]               = email
        if wallet_address      is not None: self._config["wallet_address"]      = wallet_address
        if rank                is not None: self._config["rank"]                = rank
        if xp                  is not None: self._config["xp"]                  = xp
        if xp_to_next_level    is not None: self._config["xp_to_next_level"]    = xp_to_next_level
        if avatar_url          is not None: self._config["avatar_url"]          = avatar_url
        if avatar_bg           is not None: self._config["avatar_bg"]           = avatar_bg
        if equipped_badge_icon is not None: self._config["equipped_badge_icon"] = equipped_badge_icon
        if region              is not None: self._config["region"]              = region
        save_config(self._config)
        logger.info(f"Logged in: {username or email or user_id}")

    def clear(self):
        self._pending_2fa_token = None
        for k in ("auth_token", "user_id", "username", "email", "rank",
                  "avatar_url", "avatar_bg", "equipped_badge_icon"):
            self._config[k] = "" if k == "auth_token" else None
        self._config["xp"]                 = 0
        self._config["xp_to_next_level"]   = 1000
        self._config["wallet_address"]    = "unknown"
        self._config["region"]             = None
        save_config(self._config)
        logger.info("Auth cleared")

    def login(self, engine: "EngineClient", identifier: str, password: str,
              session_id: str | None = None) -> str | None:
        """
        POST /auth/login with {identifier, password}.
        identifier = email — backend also accepts username but email is
        preferred because username is user-changeable in the profile.
        Phase 5: after successful login, calls engine.bind_session() with the
        install's stable session_id so the website's GET /client/status returns
        user_id for this machine.

        Returns:
          None        — success (full session stored)
          "__2FA__"   — TOTP required; temp token stored internally for confirm_2fa()
          str         — error message
        """
        self._pending_2fa_token = None
        result = engine.login(identifier, password)
        if result and result.get("requires_2fa"):
            temp = result.get("temp_token")
            if not temp:
                return "Two-factor authentication required but server sent no token"
            self._pending_2fa_token = temp
            return "__2FA__"
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
                    xp_to_next_level=profile.get("xp_to_next_level"),
                    wallet_address=profile.get("wallet_address") or result.get("wallet_address"),
                    avatar_bg=profile.get("avatar_bg"),
                    equipped_badge_icon=profile.get("equipped_badge_icon"),
                    region=profile.get("region"),
                )
            # Phase 5: bind session so website can detect this client immediately
            if session_id:
                engine.bind_session(result["token"], session_id)
            engine.reset_401_guard()
            return None  # success
        if result and result.get("detail"):
            return result["detail"]
        return "Login failed — check Engine connection"

    def complete_2fa(self, engine: "EngineClient", code: str,
                       session_id: str | None = None) -> str | None:
        """
        POST /auth/2fa/confirm after login returned requires_2fa.
        Returns None on success, error string on failure.
        """
        temp = self._pending_2fa_token
        if not temp:
            return "No pending 2FA — sign in again"
        result = engine.confirm_2fa(temp, code)
        if result and result.get("token"):
            self._pending_2fa_token = None
            self.set_token(
                token=result["token"],
                user_id=result.get("user_id"),
                username=result.get("username"),
                email=result.get("email"),
                wallet_address=result.get("wallet_address"),
            )
            profile = engine.get_profile(result["token"])
            if profile:
                self.set_token(
                    token=result["token"],
                    rank=profile.get("rank"),
                    xp=profile.get("xp"),
                    xp_to_next_level=profile.get("xp_to_next_level"),
                    wallet_address=profile.get("wallet_address"),
                    avatar_bg=profile.get("avatar_bg"),
                    equipped_badge_icon=profile.get("equipped_badge_icon"),
                    region=profile.get("region"),
                )
            if session_id:
                engine.bind_session(result["token"], session_id)
            engine.reset_401_guard()
            return None
        if result and result.get("detail"):
            return result["detail"]
        return "Invalid verification code"

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
        self._on_unauthorized: "callable | None" = None
        self._401_fired = False
        self.client = httpx.Client(
            timeout=30,
            event_hooks={"response": [self._response_hook]},
        )

    def set_on_unauthorized(self, fn: "callable | None") -> None:
        """Callback invoked (e.g. on main thread via win.after) when any Bearer request gets 401."""
        self._on_unauthorized = fn

    def reset_401_guard(self) -> None:
        """Call after successful login so future 401s are handled again."""
        self._401_fired = False

    def _response_hook(self, response: httpx.Response) -> None:
        try:
            if response.status_code != 401:
                return
            url = str(response.request.url)
            if "/auth/login" in url or "/auth/2fa/confirm" in url:
                return
            auth_h = response.request.headers.get("Authorization") or ""
            if not auth_h.startswith("Bearer "):
                return
            if self._401_fired:
                return
            self._401_fired = True
            if self._on_unauthorized:
                self._on_unauthorized()
        except Exception:
            pass

    def health(self) -> dict | None:
        try:
            r = self.client.get(f"{self.base_url}/health", timeout=4)
            return r.json()
        except Exception:
            return None

    def get_match_active_payload(self, token: str) -> dict | None:
        """
        GET /match/active — full JSON body on 200.
        Returns None on network/HTTP error (caller must NOT clear lobby — transient).
        On 200, body always includes key 'match' (possibly null).
        """
        try:
            r = self.client.get(
                f"{self.base_url}/match/active",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.debug(f"Active match poll: {e}")
        return None

    def get_active_match(self, token: str) -> str | None:
        """
        GET /match/active — returns match_id only when server has a non-cancelled active room.
        None if no match, cancelled, or missing id. None on network error (do not treat as leave).
        """
        body = self.get_match_active_payload(token)
        if body is None:
            return None
        match = body.get("match")
        if match is None:
            return None
        st = (match.get("status") or "").strip().lower()
        if st == "cancelled":
            return None
        return match.get("match_id")

    def match_heartbeat(self, match_id: str, token: str) -> dict | None:
        """
        POST /matches/{match_id}/heartbeat — poll live match state.
        Body is always empty {}; match_id is path-param only.
        Returns: { in_match, match_id, status, game, mode, code, max_players,
                   max_per_team, host_id, type, bet_amount, stake_currency,
                   created_at, your_user_id, your_team, stale_removed, players[] }
        """
        try:
            r = self.client.post(
                f"{self.base_url}/matches/{match_id}/heartbeat",
                json={},
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.debug(f"Match heartbeat: {e}")
        return None

    def get_match_status(self, match_id: str, token: str) -> dict | None:
        """
        GET /match/{match_id}/status — fetch final match result after completion.
        # TODO(Claude): confirm exact response shape — need result/score fields
        # for displaying victory/defeat card in the lobby.
        """
        try:
            r = self.client.get(
                f"{self.base_url}/match/{match_id}/status",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.debug(f"Match status: {e}")
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
                if data.get("requires_2fa") and data.get("temp_token"):
                    return {
                        "requires_2fa": True,
                        "temp_token":   data["temp_token"],
                    }
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

    def confirm_2fa(self, temp_token: str, code: str) -> dict | None:
        """
        POST /auth/2fa/confirm — { temp_token, code } → full session (access_token, …).
        Returns same normalised shape as login() on success, or {detail} on error.
        """
        try:
            r = self.client.post(
                f"{self.base_url}/auth/2fa/confirm",
                json={"temp_token": temp_token.strip(), "code": code.strip().replace(" ", "")},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                return {
                    "token":          data.get("access_token"),
                    "user_id":        data.get("user_id"),
                    "username":       data.get("username"),
                    "email":          data.get("email"),
                    "arena_id":       data.get("arena_id"),
                    "wallet_address": data.get("wallet_address"),
                }
            try:
                detail = r.json().get("detail", "Verification failed")
            except Exception:
                detail = f"2FA failed ({r.status_code})"
            return {"detail": str(detail)}
        except Exception as e:
            logger.error(f"2FA confirm failed: {e}")
            return None

    def get_messages_unread_count(self, token: str) -> int | None:
        """GET /messages/unread/count → { count } (DM + inbox)."""
        try:
            r = self.client.get(
                f"{self.base_url}/messages/unread/count",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                return int(r.json().get("count", 0))
        except Exception as e:
            logger.debug(f"Unread messages count: {e}")
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

    # ── HUB — Friends Online + Quick Invite ───────────────────────────────────

    def get_online_friends(self, token: str) -> list[dict]:
        """GET /friends/online → [{user_id, username, arena_id, avatar, game, status}]"""
        try:
            r = self.client.get(
                f"{self.base_url}/friends/online",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                friends = r.json().get("friends", [])
                logger.info(f"get_online_friends: {len(friends)} accepted friend(s)")
                return friends
            logger.warning(f"get_online_friends: HTTP {r.status_code} — {r.text[:200]}")
        except Exception as e:
            logger.warning(f"get_online_friends error: {e}")
        return []

    def get_pending_hub_invites(self, token: str) -> list[dict]:
        """GET /hub/invites/pending → [{notification_id, match_id, inviter_username, ...}]"""
        try:
            r = self.client.get(
                f"{self.base_url}/hub/invites/pending",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if r.status_code == 200:
                return r.json().get("invites", [])
        except Exception as e:
            logger.debug(f"get_pending_hub_invites: {e}")
        return []

    def hub_quick_invite(self, token: str, to_user_id: str) -> dict | None:
        """POST /hub/quick-invite → {match_id, code, invite_url} or {detail} on error."""
        try:
            r = self.client.post(
                f"{self.base_url}/hub/quick-invite",
                json={"to_user_id": to_user_id},
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if r.status_code == 201:
                return r.json()
            try:
                return {"detail": r.json().get("detail", f"Error {r.status_code}")}
            except Exception:
                return {"detail": f"Error {r.status_code}"}
        except Exception as e:
            logger.debug(f"hub_quick_invite: {e}")
            return None

    def respond_to_notification(self, token: str, notification_id: str, action: str) -> dict | None:
        """POST /notifications/{id}/respond {action: accept|decline} → match details or {action: decline}."""
        try:
            r = self.client.post(
                f"{self.base_url}/notifications/{notification_id}/respond",
                json={"action": action},
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if r.status_code == 200:
                return r.json()
            try:
                return {"detail": r.json().get("detail", f"Error {r.status_code}")}
            except Exception:
                return {"detail": f"Error {r.status_code}"}
        except Exception as e:
            logger.debug(f"respond_to_notification: {e}")
            return None


# ── WS URL helper ─────────────────────────────────────────────────────────────

def _ws_url_from_engine_url(engine_url: str, token: str) -> str:
    """Convert engine HTTP URL to the /ws endpoint WebSocket URL."""
    base = engine_url.rstrip("/")
    if base.startswith("https://"):
        ws_base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        ws_base = "ws://" + base[len("http://"):]
    else:
        ws_base = "ws://" + base
    return f"{ws_base}/ws?token={token}"


# ── Client WebSocket thread ────────────────────────────────────────────────────

class ClientWsThread:
    """
    Long-lived WebSocket connection from the desktop client to the engine.
    Runs its own asyncio event loop in a daemon thread — never blocks the
    capture or heartbeat threads.

    Downlink only: HTTP POST/heartbeat remains the write path.
    Events handled:
      match:status_changed       → on_match_status(match_id, status, winner_id)
      match:forfeit_warning      → on_forfeit_warning(match_id, team, seconds_left)
      match:forfeit_warning_cleared → on_forfeit_cleared(match_id)
    """

    _BACKOFF_INIT = 1.0
    _BACKOFF_MAX  = 30.0
    _BACKOFF_MULT = 2.0

    def __init__(
        self,
        engine_url: str,
        token: str,
        on_match_status:    "Callable[[str, str, str | None], None] | None" = None,
        on_forfeit_warning: "Callable[[str, str, int], None] | None"        = None,
        on_forfeit_cleared: "Callable[[str], None] | None"                  = None,
    ) -> None:
        self._engine_url        = engine_url
        self._token             = token
        self._on_match_status   = on_match_status
        self._on_forfeit_warn   = on_forfeit_warning
        self._on_forfeit_clear  = on_forfeit_cleared
        self._stop_event        = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None

    # ── Public API ─────────────────────────────────────────────────────────

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name="ArenaWsClient")
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread:
            self._thread.join(timeout=5)

    def update_token(self, token: str) -> None:
        """Call after a token refresh — next reconnect picks up the new value."""
        self._token = token

    # ── Internal ───────────────────────────────────────────────────────────

    def _run_loop(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._connect_loop())
        except Exception as exc:
            logger.debug(f"[WS] event loop exited: {exc}")
        finally:
            self._loop.close()

    async def _connect_loop(self) -> None:
        backoff = self._BACKOFF_INIT
        while not self._stop_event.is_set():
            url = _ws_url_from_engine_url(self._engine_url, self._token)
            try:
                async with websockets.connect(url, open_timeout=10, ping_interval=20, ping_timeout=30) as ws:
                    logger.info("[WS] connected to engine")
                    backoff = self._BACKOFF_INIT
                    await self._listen(ws)
            except websockets.exceptions.InvalidStatus as exc:
                code = exc.response.status_code if hasattr(exc, "response") else 0
                if code == 4001 or code == 401:
                    logger.warning("[WS] auth rejected — not retrying")
                    return
                logger.debug(f"[WS] connection refused ({code}) — retry in {backoff}s")
            except (OSError, websockets.exceptions.WebSocketException) as exc:
                logger.debug(f"[WS] disconnected ({exc}) — retry in {backoff}s")
            except Exception as exc:
                logger.debug(f"[WS] unexpected error: {exc}")

            if self._stop_event.is_set():
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * self._BACKOFF_MULT, self._BACKOFF_MAX)

    async def _listen(self, ws) -> None:
        async for raw in ws:
            if self._stop_event.is_set():
                return
            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            event_type = msg.get("type", "")
            data       = msg.get("data", {})
            self._dispatch(event_type, data)

    def _dispatch(self, event_type: str, data: dict) -> None:
        try:
            if event_type == "match:status_changed":
                mid    = data.get("match_id")
                status = data.get("status")
                winner = data.get("winner_id")
                if mid and status and self._on_match_status:
                    logger.info(f"[WS] match:status_changed match={mid} status={status}")
                    self._on_match_status(mid, status, winner)

            elif event_type == "match:forfeit_warning":
                mid     = data.get("match_id")
                team    = (data.get("team") or "").upper()
                seconds = int(data.get("seconds_left") or 0)
                if mid and self._on_forfeit_warn:
                    logger.info(f"[WS] forfeit_warning match={mid} team={team} secs={seconds}")
                    self._on_forfeit_warn(mid, team, seconds)

            elif event_type == "match:forfeit_warning_cleared":
                mid = data.get("match_id")
                if mid and self._on_forfeit_clear:
                    logger.info(f"[WS] forfeit_warning_cleared match={mid}")
                    self._on_forfeit_clear(mid)

        except Exception as exc:
            logger.debug(f"[WS] dispatch error for {event_type}: {exc}")


# ── Match Monitor ──────────────────────────────────────────────────────────────
class MatchMonitor:
    _HEARTBEAT_INTERVAL = 4   # must be < engine _CLIENT_TIMEOUT_SECONDS (10s); fast disconnect detection

    def __init__(self, config: dict):
        self.config            = config
        self.engine            = EngineClient(config["engine_url"], config["auth_token"])
        self.running               = False
        self.monitoring            = False
        self.current_match_id:    str | None = None
        self.current_match_status: str | None = None
        self._thread:              threading.Thread | None = None
        self._heartbeat_thread:    threading.Thread | None = None
        self._capture_count        = 0
        self._last_screenshot:    str | None = None
        self._heartbeat_stop       = threading.Event()
        self._session_id           = get_or_create_session_id(config)
        self._ws: ClientWsThread | None = None

    def _on_ws_match_status(self, match_id: str, status: str, winner_id: str | None) -> None:
        if match_id != self.current_match_id:
            return
        self.current_match_status = status
        logger.info(f"[WS] match status → {status} (winner={winner_id})")

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
        token = self.config.get("auth_token", "")
        if token:
            self._ws = ClientWsThread(
                engine_url=self.config["engine_url"],
                token=token,
                on_match_status=self._on_ws_match_status,
            )
            self._ws.start()
        logger.info("Monitor started")

    def stop(self):
        self.running = False
        self._heartbeat_stop.set()
        if self._ws:
            self._ws.stop()
            self._ws = None
        if self._thread:           self._thread.join(timeout=10)
        if self._heartbeat_thread: self._heartbeat_thread.join(timeout=5)
        logger.info("Monitor stopped")

    def _loop(self):
        _match_status:       str | None = None
        _match_completed_at: float | None = None
        _last_status_poll:   float = 0
        _STATUS_POLL_INTERVAL = 10   # seconds between match-status polls
        _CAPTURE_COOLDOWN     = 60   # seconds to keep match visible after completed

        while self.running:
            try:
                # WS fast-path: if the server pushed a status change, apply it now
                # without waiting for the next HTTP poll cycle.
                if self.current_match_status and self.current_match_status != _match_status:
                    _match_status = self.current_match_status

                game = detect_running_game()
                if not game:
                    _match_status = None
                    time.sleep(self.config.get("screenshot_interval", 5))
                    continue

                if is_game_running(game):
                    if not self.monitoring:
                        logger.info(f"{game} detected — waiting for active match")
                        self.monitoring = True

                    token = self.config.get("auth_token", "")

                    # Acquire match_id when not yet in a room
                    if not self.current_match_id and token:
                        mid = self.engine.get_active_match(token)
                        if mid:
                            self.set_match_id(mid)
                            _match_status        = None
                            _match_completed_at  = None
                            _last_status_poll    = 0   # poll status immediately

                    # Poll match status every _STATUS_POLL_INTERVAL seconds
                    now = time.time()
                    if self.current_match_id and token and (now - _last_status_poll) >= _STATUS_POLL_INTERVAL:
                        hb = self.engine.match_heartbeat(self.current_match_id, token)
                        if hb:
                            _match_status              = hb.get("status")
                            self.current_match_status  = _match_status
                            logger.debug(f"Match status: {_match_status}")
                        _last_status_poll = now

                    # ── Completed / tied / cancelled — 60s cooldown then clear ──
                    if _match_status in ("completed", "cancelled", "tied"):
                        if _match_completed_at is None:
                            _match_completed_at = time.time()
                            logger.info(
                                f"Match {self.current_match_id} {_match_status} — "
                                f"capture ends in {_CAPTURE_COOLDOWN}s"
                            )
                        if time.time() - _match_completed_at >= _CAPTURE_COOLDOWN:
                            logger.info("Capture cooldown elapsed — ready for next match")
                            self.current_match_id     = None
                            self.current_match_status = None
                            _match_status             = None
                            _match_completed_at       = None

                    # ── Capture ONLY when match is live ───────────────────────
                    elif self.current_match_id and _match_status == "in_progress":
                        game_dir = os.path.join(
                            self.config["screenshot_dir"], game.replace(" ", "_"))
                        filepath = capture_screenshot(
                            output_dir=game_dir,
                            monitor_num=self.config.get("monitor", 1),
                            game_name=game,
                        )
                        if filepath:
                            self._capture_count += 1
                            self._last_screenshot = filepath
                            result = self.engine.upload_screenshot(
                                self.current_match_id, filepath)
                            if result:
                                logger.info(f"Engine: {result}")
                                try: os.remove(filepath)
                                except OSError: pass
                    else:
                        logger.debug(
                            f"Game open — idle "
                            f"(match={self.current_match_id}, status={_match_status})"
                        )

                else:
                    if self.monitoring:
                        logger.info(f"{game} closed")
                        self.monitoring            = False
                        self.current_match_id      = None
                        self.current_match_status  = None
                        _match_status              = None
                        _match_completed_at        = None

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
def _draw_arena_icon(size: int = 64, state: str = "idle",
                     badge_count: int = 0) -> Image.Image:
    """
    PROJECT ARENA HUD icon.
    Rounded dark panel, oversized neon A with triple-layer bloom,
    hot white core, scan-line texture, corner ticks.
    Drawn at 4× then downscaled for crisp edges at every size.

    States:
      active → red    (monitoring ON)
      match  → gold   (match in progress)
      error  → dim red (engine offline)
      idle   → gray   (monitoring OFF)
    """
    colors = {
        "active": BRAND["accent_pil"],
        "match":  BRAND["match_pil"],
        "error":  (220, 50, 50, 200),
        "idle":   BRAND["idle_pil"],
    }
    glyph_color = colors.get(state, colors["idle"])
    r, g, b, a = glyph_color

    draw_size = size * 4
    s = draw_size
    img  = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # ── Rounded dark panel ───────────────────────────────────────────────────
    rad = int(s * 0.18)
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=rad, fill=(5, 7, 13, 255))

    # Subtle scan-line texture
    for y in range(0, s, max(3, s // 80)):
        draw.line([(0, y), (s, y)], fill=(255, 255, 255, 6), width=1)

    # ── Geometric A — oversized, nearly full panel ────────────────────────────
    cx   = s // 2
    lw   = max(10, s // 10)
    top  = (cx,            int(s * 0.07))
    bl   = (int(s * 0.05), int(s * 0.93))
    br   = (int(s * 0.95), int(s * 0.93))
    cb_y = int(s * 0.57)
    ins  = int(s * 0.27)
    cb_l = (ins,      cb_y)
    cb_r = (s - ins,  cb_y)

    # Layer 1 — wide outer bloom
    b1  = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    b1d = ImageDraw.Draw(b1)
    b1d.line([top, bl],    fill=(r, g, b, 70), width=lw * 5)
    b1d.line([top, br],    fill=(r, g, b, 70), width=lw * 5)
    b1d.line([cb_l, cb_r], fill=(r, g, b, 70), width=lw * 4)
    b1 = b1.filter(ImageFilter.GaussianBlur(radius=max(6, s // 18)))
    img.alpha_composite(b1)

    # Layer 2 — medium glow
    b2  = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    b2d = ImageDraw.Draw(b2)
    b2d.line([top, bl],    fill=(r, g, b, 130), width=lw * 2)
    b2d.line([top, br],    fill=(r, g, b, 130), width=lw * 2)
    b2d.line([cb_l, cb_r], fill=(r, g, b, 130), width=lw + lw // 2)
    b2 = b2.filter(ImageFilter.GaussianBlur(radius=max(3, s // 36)))
    img.alpha_composite(b2)

    # Layer 3 — crisp neon stroke
    draw.line([top, bl],    fill=(r, g, b, 255), width=lw)
    draw.line([top, br],    fill=(r, g, b, 255), width=lw)
    draw.line([cb_l, cb_r], fill=(r, g, b, 255), width=max(7, s // 14))

    # Hot white core on main strokes
    core_lw = max(2, lw // 3)
    draw.line([top, bl], fill=(255, 210, 210, 160), width=core_lw)
    draw.line([top, br], fill=(255, 210, 210, 160), width=core_lw)

    # ── Border neon rim ───────────────────────────────────────────────────────
    rim = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rd  = ImageDraw.Draw(rim)
    rd.rounded_rectangle([0, 0, s - 1, s - 1], radius=rad,
                         outline=(r, g, b, 90), width=max(2, s // 40))
    rim = rim.filter(ImageFilter.GaussianBlur(radius=max(2, s // 55)))
    img.alpha_composite(rim)
    draw.rounded_rectangle([1, 1, s - 2, s - 2], radius=rad,
                           outline=(r, g, b, 130), width=max(1, s // 60))

    # ── Corner HUD ticks ─────────────────────────────────────────────────────
    tick  = int(s * 0.09)
    tk_lw = max(2, s // 70)
    tc    = (r, g, b, 160)
    m     = int(s * 0.04)
    draw.line([(m, m),     (m + tick, m)],     fill=tc, width=tk_lw)
    draw.line([(m, m),     (m, m + tick)],     fill=tc, width=tk_lw)
    draw.line([(s-m, m),   (s-m-tick, m)],     fill=tc, width=tk_lw)
    draw.line([(s-m, m),   (s-m, m+tick)],     fill=tc, width=tk_lw)
    draw.line([(m, s-m),   (m+tick, s-m)],     fill=tc, width=tk_lw)
    draw.line([(m, s-m),   (m, s-m-tick)],     fill=tc, width=tk_lw)
    draw.line([(s-m, s-m), (s-m-tick, s-m)],   fill=tc, width=tk_lw)
    draw.line([(s-m, s-m), (s-m, s-m-tick)],   fill=tc, width=tk_lw)

    img = img.resize((size, size), Image.LANCZOS)

    if badge_count and badge_count > 0:
        draw = ImageDraw.Draw(img)
        label = "9+" if badge_count > 9 else str(int(badge_count))
        br = max(size // 5, 10)
        cx, cy = size - br // 2 - 1, size - br // 2 - 1
        pad = max(1, br // 8)
        draw.ellipse(
            [cx - br // 2 + pad, cy - br // 2 + pad,
             cx + br // 2 - pad, cy + br // 2 - pad],
            fill=(239, 68, 68, 255),
        )
        try:
            windir = os.environ.get("WINDIR", r"C:\Windows")
            font_path = os.path.join(windir, "Fonts", "segoeui.ttf")
            font = ImageFont.truetype(font_path, size=max(7, size // 5))
        except OSError:
            font = ImageFont.load_default()
        draw.text((cx, cy), label, fill=(255, 255, 255, 255), font=font, anchor="mm")

    return img


# ── Neon glow cache ──────────────────────────────────────────────────────────
# Draws a blurred chamfered outline onto transparent RGBA. Cached per
# (w, h, cut, color, glow, alpha) and per-Tk-root so ImageTk.PhotoImage
# references aren't garbage-collected while the UI is live.
_NEON_CACHE: dict = {}

def _hex_to_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def make_neon_glow(root, w: int, h: int, cut: int, color_hex: str,
                   glow: int = 18, alpha: int = 170, inner_alpha: int = 230):
    """
    Returns an ImageTk.PhotoImage of a chamfered border with neon bloom.
    The image is WxH pixels; place it on a Canvas at (0,0) under the panel.
    """
    key = (id(root), w, h, cut, color_hex, glow, alpha, inner_alpha)
    hit = _NEON_CACHE.get(key)
    if hit is not None:
        return hit
    if w < 4 or h < 4:
        return None
    r, g, b = _hex_to_rgb(color_hex)
    pts = [
        (cut, 0), (w - 1, 0), (w - 1, h - 1 - cut),
        (w - 1 - cut, h - 1), (0, h - 1), (0, cut),
    ]
    # Outer blurred ring
    ring = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(ring).polygon(pts, outline=(r, g, b, alpha))
    # Thicken by drawing 3 offsets so the blur has body
    for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
        ImageDraw.Draw(ring).polygon(
            [(x + dx, y + dy) for x, y in pts], outline=(r, g, b, alpha))
    ring = ring.filter(ImageFilter.GaussianBlur(radius=glow))
    # Crisp inner line on top
    ImageDraw.Draw(ring).polygon(pts, outline=(r, g, b, inner_alpha))
    photo = ImageTk.PhotoImage(ring, master=root)
    _NEON_CACHE[key] = photo
    return photo


def generate_ico_file(path: str):
    """
    Save a Windows-compatible ICO for the window titlebar/taskbar.
    We save a multi-size ICO so Explorer/Taskbar can pick the best size.
    """
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sizes = (16, 24, 32, 48, 64, 128, 256)
    imgs: list[Image.Image] = []
    for s in sizes:
        rgba = _draw_arena_icon(s, state="active")
        bg = Image.new("RGBA", (s, s), (12, 12, 12, 255))
        bg.paste(rgba, mask=rgba.split()[3])
        imgs.append(bg.convert("RGBA"))
    imgs[0].save(path, format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[1:])
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
                         config: dict, ico_path: str | None = None,
                         notify_fn: "callable | None" = None,
                         tray_app: "ArenaTray | None" = None) -> None:
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
    win.title("PROJECT ARENA")
    # AAA HUD layout needs real space (wide, slightly taller)
    win.geometry("1400x690")
    win.minsize(1200, 660)
    win.resizable(True, True)
    win.configure(fg_color=BRAND["bg"])

    if ico_path and os.path.exists(ico_path):
        try: win.iconbitmap(ico_path)
        except Exception: pass

    _window_instance = win

    # ── AAA HUD backdrop (scanlines + subtle gradients) ───────────────────────
    # Pure visuals; safe to redraw on resize.
    try:
        import tkinter as tk  # stdlib
    except Exception:
        tk = None  # type: ignore

    if tk is not None:
        bg = tk.Canvas(win, highlightthickness=0, bd=0, relief="flat")
        bg.place(x=0, y=0, relwidth=1, relheight=1)

        _bg_redraw_job: list[str | None] = [None]

        def _hex_to_rgb(h: str) -> tuple[int, int, int]:
            h = h.lstrip("#")
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

        def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
            return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"

        def _lerp(a: int, b: int, t: float) -> int:
            return int(a + (b - a) * t)

        def _draw_backdrop() -> None:
            w = max(1, int(win.winfo_width()))
            h = max(1, int(win.winfo_height()))
            bg.delete("all")

            c0 = _hex_to_rgb(BRAND["bg"])
            c1 = _hex_to_rgb(BRAND["hud_panel"])

            # Vertical gradient base
            steps = min(220, h)
            for i in range(steps):
                t = i / max(1, steps - 1)
                col = (
                    _lerp(c0[0], c1[0], t),
                    _lerp(c0[1], c1[1], t),
                    _lerp(c0[2], c1[2], t),
                )
                y0 = int(i * h / steps)
                y1 = int((i + 1) * h / steps)
                bg.create_rectangle(0, y0, w, y1, outline="", fill=_rgb_to_hex(col))

            # Corner glows (cyan top-left + violet top-right + red bottom hint)
            bg.create_oval(-w * 0.38, -h * 0.60, w * 0.60, h * 0.38, outline="", fill="#0d3340", stipple="gray25")
            bg.create_oval(w * 0.42, -h * 0.48, w * 1.38, h * 0.42, outline="", fill="#2d1445", stipple="gray25")
            bg.create_oval(-w * 0.10, h * 0.62, w * 0.32, h * 1.35, outline="", fill="#1a0808", stipple="gray12")

            # Scanlines (every 4px for CRT feel)
            for y in range(0, h, 4):
                bg.create_line(0, y, w, y, fill="#000000", width=1)

            # Cyan accent line at very top
            bg.create_rectangle(0, 0, w, 1, outline="", fill=BRAND["hud_glow"])

        def _schedule_backdrop_redraw() -> None:
            job = _bg_redraw_job[0]
            if job:
                try:
                    win.after_cancel(job)
                except Exception:
                    pass
            _bg_redraw_job[0] = win.after(60, _draw_backdrop)

        win.bind("<Configure>", lambda _e: _schedule_backdrop_redraw(), add="+")
        win.after(0, _draw_backdrop)
        # tkinter.Canvas.lower() is for canvas items (needs args). Lower the widget itself.
        try:
            bg.tk.call("lower", bg._w)
        except Exception:
            pass

    def _on_close():
        win.withdraw()
    win.protocol("WM_DELETE_WINDOW", _on_close)

    # ── All shared actions defined first — before any closure references them ─
    def _open_website():
        import webbrowser
        url = config.get("frontend_url", "https://project-arena.com")
        webbrowser.open(url)

    def _quit_app():
        monitor.stop()
        win.destroy()
        os._exit(0)

    # ── Widget helpers ────────────────────────────────────────────────────────
    def _card(parent, title: str) -> ctk.CTkFrame:
        """
        AAA HUD card: neon-top strip + red left accent + tactical header pip.
        (Pure styling helper: no logic.)
        """
        outer = ctk.CTkFrame(
            parent,
            fg_color=BRAND["hud_panel"],
            corner_radius=8,
            border_width=1,
            border_color=BRAND["hud_border"],
        )
        outer.pack(fill="x", padx=14, pady=(10, 0))

        # Cyan neon strip at top of each card
        ctk.CTkFrame(outer, height=2, fg_color=BRAND["hud_glow"], corner_radius=0).pack(fill="x")

        # Header row: red left strip + header content
        header_row = ctk.CTkFrame(outer, fg_color="transparent")
        header_row.pack(fill="x")

        # Red left accent strip
        ctk.CTkFrame(header_row, width=3, fg_color=BRAND["accent"], corner_radius=0).pack(
            side="left", fill="y")

        header = ctk.CTkFrame(header_row, fg_color=BRAND["hud_panel_2"], corner_radius=0)
        header.pack(side="left", fill="x", expand=True)

        # Status pip
        pip = ctk.CTkFrame(header, width=7, height=7, fg_color=BRAND["hud_glow"], corner_radius=99)
        pip.pack(side="left", padx=(12, 7), pady=12)

        ctk.CTkLabel(
            header,
            text=title.upper(),
            font=ctk.CTkFont(family=FONT_DISPLAY, size=11, weight="bold"),
            text_color=BRAND["text"],
        ).pack(side="left", pady=10)

        # Right corner slash decoration
        ctk.CTkLabel(
            header, text="/// ",
            font=ctk.CTkFont(size=9),
            text_color=BRAND["hud_border"],
        ).pack(side="right", pady=10)

        ctk.CTkFrame(outer, height=1, fg_color=BRAND["hud_border"]).pack(fill="x")
        return outer

    def _hdivider(parent):
        ctk.CTkFrame(parent, height=1, fg_color=BRAND["hud_border"]).pack(
            fill="x", padx=14, pady=(4, 4))

    def _status_dot(parent) -> ctk.CTkLabel:
        return ctk.CTkLabel(parent, text="●", font=ctk.CTkFont(size=12),
                             text_color=BRAND["text_muted"], padx=2)

    # ── Header ────────────────────────────────────────────────────────────────
    # Minimal clean header matching the Support-ticket reference — no red
    # side-bar, no "TACTICAL CLIENT // HUD" subtitle. Just a compact wordmark
    # + status chips, with a subtle cyan underline.
    header = ctk.CTkFrame(win, fg_color=BRAND["hud_panel"], corner_radius=0,
                           height=52, border_width=0)
    header.pack(fill="x")
    header.pack_propagate(False)

    wordmark = ctk.CTkFrame(header, fg_color="transparent")
    wordmark.pack(side="left", padx=18, pady=8)
    ctk.CTkLabel(wordmark, text="PROJECT",
                 font=ctk.CTkFont(family=FONT_MONO, size=9, weight="bold"),
                 text_color=BRAND["cyan"]).pack(side="left", pady=(6, 0))
    ctk.CTkLabel(wordmark, text="  ARENA",
                 font=ctk.CTkFont(family=FONT_DISPLAY, size=20, weight="bold"),
                 text_color=BRAND["accent"]).pack(side="left")

    # Subtle cyan underline at bottom of header
    ctk.CTkFrame(header, height=1, fg_color=BRAND["hud_border"], corner_radius=0).pack(
        side="bottom", fill="x")

    # Status chips on right
    hdr_right = ctk.CTkFrame(header, fg_color="transparent")
    hdr_right.pack(side="right", padx=14, pady=12)

    def _chip(parent, text: str, dot_color: str | None = None) -> tuple[ctk.CTkFrame, ctk.CTkLabel | None]:
        chip = ctk.CTkFrame(
            parent,
            fg_color=BRAND["hud_panel_2"],
            corner_radius=4,
            border_width=1,
            border_color=BRAND["hud_border"],
        )
        chip.pack(side="right", padx=(8, 0))
        dot = None
        if dot_color:
            dot = ctk.CTkLabel(chip, text="●", font=ctk.CTkFont(size=11), text_color=dot_color)
            dot.pack(side="left", padx=(10, 4), pady=7)
        lbl = ctk.CTkLabel(chip, text=text,
                           font=ctk.CTkFont(family=FONT_MONO, size=10, weight="bold"),
                           text_color=BRAND["text"])
        lbl.pack(side="left", padx=(0 if dot_color else 12, 12), pady=7)
        return chip, dot

    _chip(hdr_right, f"v{CLIENT_VERSION}")
    _eng_chip, hdr_eng_dot = _chip(hdr_right, "ENGINE", dot_color=BRAND["text_muted"])

    # ── Tab view ──────────────────────────────────────────────────────────────
    tabview = ctk.CTkTabview(
        win,
        fg_color=BRAND["bg"],
        corner_radius=0,
        segmented_button_fg_color=BRAND["hud_panel"],
        segmented_button_selected_color=BRAND["accent"],
        segmented_button_selected_hover_color=BRAND["accent_dark"],
        segmented_button_unselected_color=BRAND["hud_panel"],
        segmented_button_unselected_hover_color=BRAND["hud_panel_2"],
        text_color=BRAND["text"],
        text_color_disabled=BRAND["text_muted"],
    )
    tabview.pack(fill="both", expand=True)
    tabview.add("Overview")
    tabview.add("Events")

    tab_ov = tabview.tab("Overview")
    tab_ev = tabview.tab("Events")

    # ── OVERVIEW TAB ──────────────────────────────────────────────────────────
    # Two-column AAA HUD layout (left: identity/match, right: game/monitor)

    ov_root = ctk.CTkFrame(tab_ov, fg_color=BRAND["bg"], corner_radius=0)
    ov_root.pack(fill="both", expand=True)
    ov_root.grid_columnconfigure(0, weight=1, uniform="ov")
    ov_root.grid_columnconfigure(1, weight=1, uniform="ov")
    ov_root.grid_rowconfigure(0, weight=1)

    ov_left = ctk.CTkScrollableFrame(ov_root, fg_color=BRAND["bg"], corner_radius=0)
    ov_left.grid(row=0, column=0, sticky="nsew", padx=(0, 6), pady=0)

    ov_right = ctk.CTkScrollableFrame(ov_root, fg_color=BRAND["bg"], corner_radius=0)
    ov_right.grid(row=0, column=1, sticky="nsew", padx=(6, 0), pady=0)

    # ── Compact chamfered status card helper (matches website tactical frame).
    # Draws: chamfered polygon background + cyan L-brackets (top-left and
    # bottom-right) + red left accent strip + text items. The dot + label
    # are canvas items wrapped in a small proxy so existing call sites like
    # `x_dot.configure(text_color=...)` / `x_lbl.configure(text=..., text_color=...)`
    # keep working unchanged. Height is ~40% of the old CTkFrame card and
    # width ~85% of the parent column (via asymmetric right padding).
    class _CanvasItemProxy:
        __slots__ = ("_c", "_id")
        def __init__(self, canvas, item_id):
            self._c, self._id = canvas, item_id
        def configure(self, **kw):
            m = {}
            if "text" in kw:        m["text"] = kw["text"]
            if "text_color" in kw:  m["fill"] = kw["text_color"]
            if m:
                try: self._c.itemconfig(self._id, **m)
                except Exception: pass

    def _make_chamfer_status(parent, title: str, initial_status: str = "Checking…",
                             width_shrink: int = 80, with_extra: bool = False):
        """
        Compact chamfered status card. Returns (dot_proxy, status_proxy[, extra_proxy]).
        `width_shrink` is the extra right padding (px) — ~80 gives the -15% look.
        `with_extra` adds a third text slot after the status (e.g. match id).
        """
        wrap = ctk.CTkFrame(parent, fg_color="transparent")
        wrap.pack(fill="x", padx=(14, 14 + width_shrink), pady=(10, 0))

        cvs = tk.Canvas(wrap, height=40, bg=BRAND["bg"],
                        highlightthickness=0, bd=0, relief="flat")
        cvs.pack(fill="x")

        ids: dict = {"frame": None, "strip": None,
                     "tl1": None, "tl2": None, "br1": None, "br2": None,
                     "dot": None, "title": None, "sep": None, "status": None,
                     "extra": None, "slash": None}

        def _redraw(_event=None):
            w = max(120, cvs.winfo_width())
            h = 40
            # Bigger chamfer to match _chamfer_panel and the Support-ticket
            # reference. Clean flat look — no L-brackets, no red stripe, no
            # /// decoration (those were earlier cyberpunk noise).
            cut = 14
            panel  = BRAND["hud_panel"]
            border = BRAND["hud_border"]

            pts = [
                cut, 0,
                w - 1, 0,
                w - 1, h - cut,
                w - 1 - cut, h - 1,
                0, h - 1,
                0, cut,
            ]
            # Neon cyan glow behind the frame — subtle bloom matching website HUD.
            glow_img = make_neon_glow(cvs, w, h, cut, BRAND["cyan"],
                                      glow=10, alpha=90, inner_alpha=200)
            if glow_img is not None:
                if ids.get("glow") is None:
                    ids["glow"] = cvs.create_image(0, 0, anchor="nw", image=glow_img)
                else:
                    cvs.itemconfig(ids["glow"], image=glow_img)
                    cvs.coords(ids["glow"], 0, 0)
                cvs._glow_ref = glow_img  # keep ref alive
            if ids["frame"] is None:
                ids["frame"] = cvs.create_polygon(pts, fill=panel, outline=border, width=1)
            else:
                cvs.coords(ids["frame"], *pts)
            # Ensure glow is below the frame polygon
            if ids.get("glow") is not None:
                try: cvs.tag_lower(ids["glow"], ids["frame"])
                except Exception: pass

            title_text = title.upper()

            if ids["dot"] is None:
                ids["dot"] = cvs.create_text(
                    20, h // 2, text="●", fill=BRAND["text_muted"],
                    font=(FONT_MONO, 11, "bold"), anchor="w",
                )
                ids["title"] = cvs.create_text(
                    34, h // 2, text=title_text, fill=BRAND["text"],
                    font=(FONT_DISPLAY, 12, "bold"), anchor="w",
                )
                try:
                    bb = cvs.bbox(ids["title"])
                    title_right = bb[2] if bb else 34 + 8 * len(title_text)
                except Exception:
                    title_right = 34 + 8 * len(title_text)
                stat_x = title_right + 14
                ids["status"] = cvs.create_text(
                    stat_x, h // 2, text=initial_status, fill=BRAND["text_muted"],
                    font=(FONT_MONO, 11), anchor="w",
                )
                if with_extra:
                    ids["extra"] = cvs.create_text(
                        w - 20, h // 2, text="", fill=BRAND["warning"],
                        font=(FONT_MONO, 10), anchor="e",
                    )
            else:
                if with_extra and ids["extra"] is not None:
                    cvs.coords(ids["extra"], w - 20, h // 2)

        cvs.bind("<Configure>", _redraw)
        cvs.after(0, _redraw)
        cvs.update_idletasks()
        _redraw()

        dot_proxy    = _CanvasItemProxy(cvs, ids["dot"])
        status_proxy = _CanvasItemProxy(cvs, ids["status"])
        if with_extra:
            extra_proxy = _CanvasItemProxy(cvs, ids["extra"])
            return dot_proxy, status_proxy, extra_proxy
        return dot_proxy, status_proxy

    # ENGINE card — compact chamfered tactical frame
    eng_dot, eng_lbl = _make_chamfer_status(ov_left, "Engine", "Checking…")

    # ── Large chamfered panel (Identity/Monitoring etc.) ──────────────────────
    # Unlike `_make_chamfer_status` which is a one-line compact strip, this
    # helper gives you an inner frame you can pack arbitrary widgets into.
    # Title is drawn at the very top edge of the chamfered frame (no extra
    # padding), matching the admin-support / match-room card style from the
    # website. Returns the inner content `ctk.CTkFrame`.
    def _chamfer_panel(parent, title: str, width_shrink: int = 40,
                       min_height: int = 70):
        holder = ctk.CTkFrame(parent, fg_color="transparent")
        holder.pack(fill="x", padx=(14, 14 + width_shrink), pady=(10, 0))

        cvs = tk.Canvas(holder, bg=BRAND["bg"], highlightthickness=0,
                        bd=0, height=min_height)
        cvs.pack(fill="x")

        inner = ctk.CTkFrame(cvs, fg_color=BRAND["hud_panel"], corner_radius=0)

        # Larger top padding because the title is now big+bold+white like the
        # reference ("TOPIC" / "DETAILS" labels on the Support-ticket popup).
        PAD_L, PAD_T, PAD_R, PAD_B = 16, 36, 14, 16
        state = {"h": min_height, "win": None}

        def _redraw():
            w = max(200, cvs.winfo_width())
            inner.update_idletasks()
            ch = max(1, inner.winfo_reqheight())
            total_h = max(min_height, ch + PAD_T + PAD_B)

            if total_h != state["h"]:
                cvs.config(height=total_h)
                state["h"] = total_h
            h = total_h
            # Pronounced chamfer (Support-ticket reference cuts ~18px).
            cut = 18
            cvs.delete("deco")

            # Neon cyan bloom behind the frame — gives the HUD its soul.
            glow_img = make_neon_glow(cvs, w, h, cut, BRAND["cyan"],
                                      glow=14, alpha=110, inner_alpha=220)
            if glow_img is not None:
                cvs.create_image(0, 0, anchor="nw", image=glow_img, tags="deco")
                cvs._glow_ref = glow_img

            # Clean chamfered border: thin subtle outline, TL + BR corner cuts.
            pts = [cut, 0, w - 1, 0, w - 1, h - cut,
                   w - 1 - cut, h - 1, 0, h - 1, 0, cut]
            cvs.create_polygon(pts, fill=BRAND["hud_panel"],
                               outline=BRAND["hud_border"], width=1, tags="deco")

            # Title at top-left — big, bold, white, uppercase, generous spacing.
            # Matches the "TOPIC" / "DETAILS" labels on the website popup.
            cvs.create_text(16, 16, text=title.upper(), fill=BRAND["text"],
                            font=(FONT_DISPLAY, 13, "bold"), anchor="w",
                            tags="deco")

            # Place / resize inner content window
            iw = max(100, w - PAD_L - PAD_R)
            if state["win"] is None:
                state["win"] = cvs.create_window(PAD_L, PAD_T, window=inner,
                                                 anchor="nw", width=iw)
            else:
                cvs.itemconfig(state["win"], width=iw)
                cvs.coords(state["win"], PAD_L, PAD_T)

        def _on_cfg(_e=None):
            cvs.after(15, _redraw)

        cvs.bind("<Configure>", _on_cfg)
        inner.bind("<Configure>", _on_cfg)
        cvs.after(50, _redraw)
        # Expose the outer holder so callers can pack_forget/pack the whole card
        # (the returned `inner` frame is embedded inside a Canvas via
        # create_window, so its own pack state is not visible in the layout).
        inner._chamfer_holder = holder  # type: ignore[attr-defined]
        return inner

    # ── Chamfered entry field (admin-support-dialog style) ────────────────────
    # Uppercase Share Tech Mono label above a bordered CTkEntry sitting inside
    # a small canvas that draws corner chamfers around the entry. Returns the
    # underlying CTkEntry so get/set/bind still work.
    def _hud_entry(parent, label: str, placeholder: str = "", show: str | None = None,
                   height: int = 38):
        box = ctk.CTkFrame(parent, fg_color="transparent")
        box.pack(fill="x", pady=(0, 8))

        ctk.CTkLabel(
            box, text=label.upper(),
            font=ctk.CTkFont(family=FONT_MONO, size=9, weight="bold"),
            text_color=BRAND["text_muted"],
        ).pack(anchor="w", pady=(0, 4))

        frame_cvs = tk.Canvas(box, bg=BRAND["hud_panel"], highlightthickness=0,
                              bd=0, height=height)
        frame_cvs.pack(fill="x")

        entry = ctk.CTkEntry(
            frame_cvs, placeholder_text=placeholder, show=show,
            height=height - 4, corner_radius=0,
            fg_color=BRAND["hud_panel_2"],
            border_color=BRAND["hud_border"],
            border_width=1,
            text_color=BRAND["text"],
            placeholder_text_color=BRAND["text_muted"],
            font=ctk.CTkFont(family=FONT_BODY, size=12),
        )

        entry_win = [None]
        def _redraw_entry(_e=None):
            w = max(80, frame_cvs.winfo_width())
            h = height
            cut = 6
            frame_cvs.delete("deco")
            # Chamfered polygon border around the input (TL+BR cuts), thin
            # hud_border — no cyan L-brackets on fields (Support-ticket style).
            pts = [cut, 0, w - 1, 0, w - 1, h - cut,
                   w - 1 - cut, h - 1, 0, h - 1, 0, cut]
            frame_cvs.create_polygon(pts, fill=BRAND["hud_panel_2"],
                                     outline=BRAND["hud_border"], width=1,
                                     tags="deco")
            if entry_win[0] is None:
                entry_win[0] = frame_cvs.create_window(
                    2, 2, window=entry, anchor="nw",
                    width=w - 4, height=h - 4,
                )
            else:
                frame_cvs.itemconfig(entry_win[0], width=w - 4, height=h - 4)
        frame_cvs.bind("<Configure>", lambda e: frame_cvs.after(10, _redraw_entry))
        frame_cvs.after(30, _redraw_entry)
        return entry

    # ── Chamfered HUD button — red/primary or ghost/secondary ─────────────────
    def _hud_button(parent, text: str, command=None, kind: str = "primary",
                    height: int = 44):
        fg  = BRAND["accent"]     if kind == "primary" else BRAND["hud_panel_2"]
        hov = BRAND["accent_dark"] if kind == "primary" else BRAND["hud_border"]
        tc  = "#FFFFFF"           if kind == "primary" else BRAND["text"]
        bc  = BRAND["accent"]     if kind == "primary" else BRAND["hud_border"]

        box = ctk.CTkFrame(parent, fg_color="transparent", height=height)
        box.pack(fill="x", pady=(0, 10))
        box.pack_propagate(False)

        cvs = tk.Canvas(box, bg=BRAND["hud_panel"], highlightthickness=0,
                        bd=0, height=height)
        cvs.pack(fill="both", expand=True)

        btn = ctk.CTkButton(
            cvs, text=text, height=height - 4, corner_radius=0,
            fg_color=fg, hover_color=hov, text_color=tc,
            border_width=1, border_color=bc,
            font=ctk.CTkFont(family=FONT_DISPLAY, size=13, weight="bold"),
            command=command,
        )
        btn_win = [None]
        def _redraw_btn(_e=None):
            w = max(80, cvs.winfo_width())
            h = height
            cut = 7
            cvs.delete("deco")
            # Chamfered polygon background (TL+BR). Primary = solid accent red;
            # secondary = panel fill with hud_border outline. Matches the
            # CANCEL / CONFIRM & SEND TICKET pair from the website.
            pts = [cut, 0, w - 1, 0, w - 1, h - cut,
                   w - 1 - cut, h - 1, 0, h - 1, 0, cut]
            cvs.create_polygon(pts, fill=fg, outline=bc, width=1, tags="deco")
            if btn_win[0] is None:
                btn_win[0] = cvs.create_window(2, 2, window=btn, anchor="nw",
                                               width=w - 4, height=h - 4)
            else:
                cvs.itemconfig(btn_win[0], width=w - 4, height=h - 4)
        cvs.bind("<Configure>", lambda e: cvs.after(10, _redraw_btn))
        cvs.after(30, _redraw_btn)
        return btn

    # Identity card — compact chamfered tactical panel (admin-dialog style).
    # Uses the same 80px right-shrink as the Engine / Game Status strips so
    # every card in the column ends on the same vertical line.
    id_card = _chamfer_panel(ov_left, "Identity", width_shrink=80, min_height=70)
    id_inner_ref: list = []

    def _rebuild_identity():
        for w in id_inner_ref:
            try: w.destroy()
            except Exception: pass
        id_inner_ref.clear()
        # No extra padding row — the chamfer helper already insets content.
        inner = ctk.CTkFrame(id_card, fg_color="transparent")
        inner.pack(fill="x", padx=0, pady=(0, 2))
        id_inner_ref.append(inner)
        if auth.is_authenticated:
            _build_profile(inner)
        else:
            _build_login_form(inner)

    def _build_login_form(parent: ctk.CTkFrame):
        """
        Login form — email only.
        DB-ready: /auth/login validates identifier against users.email.
                  Email is used because username is changeable in profile.
        """
        # Heading sits immediately under the IDENTITY title (no top padding).
        ctk.CTkLabel(parent, text="ENTER ARENA",
                     font=ctk.CTkFont(family=FONT_DISPLAY, size=15, weight="bold"),
                     text_color=BRAND["accent"]).pack(anchor="w", pady=(0, 1))
        ctk.CTkLabel(parent, text="Secure access · 2FA supported",
                     font=ctk.CTkFont(family=FONT_MONO, size=9, weight="bold"),
                     text_color=BRAND["hud_glow"]).pack(anchor="w", pady=(0, 10))

        id_entry = _hud_entry(parent, label="Email",    placeholder="you@domain.com")
        pw_entry = _hud_entry(parent, label="Password", placeholder="••••••••", show="*")

        err_lbl = ctk.CTkLabel(parent, text="",
                                font=ctk.CTkFont(family=FONT_MONO, size=10),
                                text_color=BRAND["error"])
        err_lbl.pack(anchor="w", pady=(0, 4))

        def _open_2fa_modal():
            """POST /auth/2fa/confirm after login returned requires_2fa + temp_token."""
            modal = ctk.CTkToplevel(win)
            modal.title("Two-factor authentication")
            modal.geometry("420x260")
            modal.resizable(False, False)
            modal.configure(fg_color=BRAND["bg"])
            modal.transient(win)
            modal.grab_set()

            ctk.CTkLabel(
                modal, text="TWO-FACTOR AUTH",
                font=ctk.CTkFont(family=FONT_MONO, size=15, weight="bold"),
                text_color=BRAND["text"],
            ).pack(pady=(18, 6))
            ctk.CTkLabel(
                modal, text="Check your authenticator app",
                font=ctk.CTkFont(size=11),
                text_color=BRAND["hud_glow"],
            ).pack(pady=(0, 14))

            code_entry = ctk.CTkEntry(
                modal, placeholder_text="6-digit code",
                height=48, corner_radius=10,
                fg_color=BRAND["hud_panel_2"],
                border_color=BRAND["hud_border"],
                border_width=1,
                text_color=BRAND["text"],
                placeholder_text_color=BRAND["text_muted"],
                font=ctk.CTkFont(size=18, weight="bold"),
            )
            code_entry.pack(fill="x", padx=22, pady=(0, 8))

            err_m = ctk.CTkLabel(
                modal, text="",
                font=ctk.CTkFont(size=11),
                text_color=BRAND["error"],
            )
            err_m.pack(anchor="w", padx=22, pady=(0, 8))

            verify_btn = ctk.CTkButton(
                modal, text="VERIFY", height=44, corner_radius=4,
                fg_color=BRAND["accent"], hover_color=BRAND["accent_dark"],
                text_color="#FFFFFF",
                font=ctk.CTkFont(family=FONT_MONO, size=13, weight="bold"),
            )

            def _submit_2fa():
                raw = code_entry.get().strip().replace(" ", "")
                if not raw.isdigit() or len(raw) != 6:
                    err_m.configure(text="Enter a valid 6-digit code")
                    return
                err_m.configure(text="")
                verify_btn.configure(state="disabled", text="Verifying…")

                def _t():
                    terr = auth.complete_2fa(
                        monitor.engine, raw, session_id=monitor._session_id)

                    def _af():
                        verify_btn.configure(state="normal", text="Verify")
                        if terr:
                            err_m.configure(text=terr)
                        else:
                            try:
                                modal.destroy()
                            except Exception:
                                pass
                            monitor.engine.token = auth.access_token or ""
                            if not monitor.running:
                                monitor.start()
                            elif monitor._ws:
                                monitor._ws.update_token(auth.access_token or "")
                            _rebuild_identity()
                            if tray_app is not None:
                                tray_app.request_unread_refresh()

                    win.after(0, _af)

                threading.Thread(target=_t, daemon=True).start()

            verify_btn.configure(command=_submit_2fa)
            verify_btn.pack(fill="x", padx=20, pady=(8, 16))
            code_entry.bind("<Return>", lambda e: _submit_2fa())
            code_entry.focus()
            modal.protocol("WM_DELETE_WINDOW", lambda: (modal.grab_release(), modal.destroy()))

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
                    if error == "__2FA__":
                        err_lbl.configure(text="")
                        _open_2fa_modal()
                    elif error:
                        err_lbl.configure(text=error, text_color=BRAND["error"])
                    else:
                        monitor.engine.token = auth.access_token or ""
                        # Re-start heartbeat if it was stopped by a prior sign-out
                        if not monitor.running:
                            monitor.start()
                        elif monitor._ws:
                            monitor._ws.update_token(auth.access_token or "")
                        _rebuild_identity()
                        if tray_app is not None:
                            tray_app.request_unread_refresh()
                win.after(0, _after)
            threading.Thread(target=_thread, daemon=True).start()

        login_btn = _hud_button(parent, text="ENTER ARENA",
                                command=_do_login, kind="primary", height=44)
        pw_entry.bind("<Return>", lambda e: _do_login())
        id_entry.bind("<Return>",  lambda e: pw_entry.focus())

        # Divider
        div_row = ctk.CTkFrame(parent, fg_color="transparent")
        div_row.pack(fill="x", pady=(2, 4))
        ctk.CTkFrame(div_row, height=1, fg_color=BRAND["border"]).pack(
            side="left", fill="x", expand=True, pady=6)
        ctk.CTkLabel(div_row, text="  OR  ",
                     font=ctk.CTkFont(family=FONT_MONO, size=9, weight="bold"),
                     text_color=BRAND["text_muted"]).pack(side="left")
        ctk.CTkFrame(div_row, height=1, fg_color=BRAND["border"]).pack(
            side="left", fill="x", expand=True, pady=6)

        _hud_button(parent, text="OPEN WEBSITE",
                    command=_open_website, kind="ghost", height=36)

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
        ctk.CTkLabel(name_row, text=uname.upper(),
                     font=ctk.CTkFont(family=FONT_MONO, size=13, weight="bold"),
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
            # TODO[VERIF]: show linked Steam/Riot IDs from API when keys exist in platform_config
            ctk.CTkLabel(info,
                         text=f"{wallet[:6]}…{wallet[-4:]}",
                         font=ctk.CTkFont(size=11),
                         text_color=BRAND["text_muted"]).pack(anchor="w")

        # Stat row — RANK / REGION / XP in one clean horizontal strip, all
        # same muted style (labels gray, values white). Matches the reference
        # pattern of `TOPIC` / `DETAILS` — uniform palette, no rainbow colors.
        rank = auth.rank or "Unranked"
        reg  = auth.region or "—"
        xp_to_next = auth.xp_to_next_level
        xp_ratio   = max(0.0, min(1.0, auth.xp / xp_to_next))

        stat_row = ctk.CTkFrame(parent, fg_color="transparent")
        stat_row.pack(fill="x", pady=(2, 6))

        def _stat(col_parent, label: str, value: str):
            cell = ctk.CTkFrame(col_parent, fg_color="transparent")
            cell.pack(side="left", padx=(0, 18))
            ctk.CTkLabel(cell, text=label.upper(),
                         font=ctk.CTkFont(family=FONT_MONO, size=9,
                                          weight="bold"),
                         text_color=BRAND["text_muted"]).pack(anchor="w")
            ctk.CTkLabel(cell, text=value,
                         font=ctk.CTkFont(family=FONT_MONO, size=12,
                                          weight="bold"),
                         text_color=BRAND["text"]).pack(anchor="w")

        _stat(stat_row, "Rank",   rank)
        _stat(stat_row, "Region", reg)
        _stat(stat_row, "XP",     f"{auth.xp:,} / {xp_to_next:,}")

        xp_bar = ctk.CTkProgressBar(parent, height=4, corner_radius=0,
                                     progress_color=BRAND["cyan"],
                                     fg_color=BRAND["hud_panel_2"])
        xp_bar.set(xp_ratio)
        xp_bar.pack(fill="x", pady=(0, 10))

        def _do_logout():
            # Stop heartbeat FIRST so no stale beat re-opens the disconnected session
            # before the engine logout call marks it as disconnected.
            monitor.stop()
            # Phase 5: tell engine to disconnect sessions before clearing local state
            auth.logout(engine=monitor.engine)
            monitor.engine.token = ""
            monitor.engine.reset_401_guard()
            if tray_app is not None:
                tray_app._tray_unread_count = 0
                tray_app._apply_tray_icon()
            win.after(0, _rebuild_identity)

        ctk.CTkButton(
            parent, text="SIGN OUT", height=32, corner_radius=4,
            fg_color=BRAND["hud_panel_2"], hover_color=BRAND["hud_border"],
            border_width=1, border_color=BRAND["hud_border"],
            text_color=BRAND["text_muted"],
            font=ctk.CTkFont(family=FONT_MONO, size=10, weight="bold"),
            command=_do_logout,
        ).pack(anchor="w")

    _rebuild_identity()

    # ── HUB Panel — Friends Online + Game Invites ─────────────────────────────
    # Feature flag: set ARENA_HUB_ENABLED=0 to skip the entire block at runtime.
    _hub_enabled = os.environ.get("ARENA_HUB_ENABLED", "1").lower() not in ("0", "false", "no")

    if _hub_enabled:
        hub_card = _chamfer_panel(ov_left, "Hub", width_shrink=80, min_height=60)
        _hub_body_refs: list = []
        _hub_invite_modal_open: list[bool] = [False]
        _hub_seen_invite_ids: set = set()

        def _hub_clear_body():
            for w in _hub_body_refs:
                try: w.destroy()
                except Exception: pass
            _hub_body_refs.clear()

        def _hub_rebuild(friends: list):
            _hub_clear_body()
            if not auth.is_authenticated:
                return

            if not friends:
                lbl = ctk.CTkLabel(
                    hub_card, text="No friends yet",
                    font=ctk.CTkFont(family=FONT_MONO, size=10),
                    text_color=BRAND["text_muted"],
                )
                lbl.pack(anchor="w", pady=(0, 4))
                _hub_body_refs.append(lbl)
                return

            for f in friends:
                uid           = f.get("user_id", "")
                disp_name     = (f.get("username") or "Player").upper()
                game_label    = f.get("game") or ""
                client_online = bool(f.get("client_online", False))

                row = ctk.CTkFrame(hub_card, fg_color="transparent")
                row.pack(fill="x", pady=(0, 5))
                _hub_body_refs.append(row)

                left = ctk.CTkFrame(row, fg_color="transparent")
                left.pack(side="left", fill="x", expand=True)

                # Green = client running; gray = website only
                dot_color = "#22c55e" if client_online else BRAND["text_muted"]
                ctk.CTkLabel(
                    left, text="●",
                    font=ctk.CTkFont(size=10),
                    text_color=dot_color,
                ).pack(side="left", padx=(0, 5))

                ctk.CTkLabel(
                    left, text=disp_name,
                    font=ctk.CTkFont(family=FONT_MONO, size=11, weight="bold"),
                    text_color=BRAND["text"],
                ).pack(side="left")

                if game_label:
                    ctk.CTkLabel(
                        left, text=f"  {game_label}",
                        font=ctk.CTkFont(family=FONT_MONO, size=9),
                        text_color=BRAND["text_muted"],
                    ).pack(side="left")
                elif not client_online:
                    ctk.CTkLabel(
                        left, text="  website",
                        font=ctk.CTkFont(family=FONT_MONO, size=9),
                        text_color=BRAND["text_muted"],
                    ).pack(side="left")

                # INVITE button only for friends who have the client running —
                # they'll get the pop-up modal. Website-only friends are shown
                # greyed out (they can still be invited via the website notification bell).
                if client_online:
                    inv_btn = ctk.CTkButton(
                        row, text="INVITE", width=62, height=24, corner_radius=3,
                        fg_color=BRAND["accent"], hover_color=BRAND["accent_dark"],
                        text_color="#FFFFFF",
                        font=ctk.CTkFont(family=FONT_MONO, size=9, weight="bold"),
                    )
                else:
                    inv_btn = ctk.CTkButton(
                        row, text="INVITE", width=62, height=24, corner_radius=3,
                        fg_color=BRAND["hud_panel_2"], hover_color=BRAND["hud_panel_2"],
                        text_color=BRAND["text_muted"],
                        font=ctk.CTkFont(family=FONT_MONO, size=9, weight="bold"),
                        state="disabled",
                    )
                inv_btn.pack(side="right")

                def _make_invite_cmd(target_uid=uid, target_name=disp_name, btn=inv_btn):
                    def _on_invite():
                        btn.configure(state="disabled", text="…")
                        token = auth.access_token or ""

                        def _t():
                            result = monitor.engine.hub_quick_invite(token, target_uid)

                            def _after():
                                btn.configure(state="normal", text="INVITE")
                                if result is None:
                                    if notify_fn:
                                        try: notify_fn("Network error — invite not sent")
                                        except Exception: pass
                                elif "detail" in result:
                                    detail = result["detail"]
                                    # 404 = no open room; show a clear actionable message
                                    if "website" in detail.lower() or "open" in detail.lower():
                                        if notify_fn:
                                            try: notify_fn("Open a room on project-arena.com first, then invite")
                                            except Exception: pass
                                    elif "already" in detail.lower():
                                        if notify_fn:
                                            try: notify_fn(f"Already invited {target_name} to this room")
                                            except Exception: pass
                                    else:
                                        if notify_fn:
                                            try: notify_fn(f"Invite failed: {detail}")
                                            except Exception: pass
                                else:
                                    code = result.get("code", "")
                                    msg  = f"Invite sent to {target_name}"
                                    if code:
                                        msg += f"  ·  Room: {code}"
                                    if notify_fn:
                                        try: notify_fn(msg)
                                        except Exception: pass

                            win.after(0, _after)

                        threading.Thread(target=_t, daemon=True).start()

                    return _on_invite

                inv_btn.configure(command=_make_invite_cmd())

        def _show_invite_modal(invite: dict):
            if _hub_invite_modal_open[0]:
                return
            _hub_invite_modal_open[0] = True

            notif_id     = invite.get("notification_id", "")
            inviter_name = invite.get("inviter_username") or "A player"
            game_name    = invite.get("game") or "—"
            room_code    = invite.get("code") or ""

            modal = ctk.CTkToplevel(win)
            modal.title("Game Invite")
            modal.geometry("420x260")
            modal.resizable(False, False)
            modal.configure(fg_color=BRAND["bg"])
            modal.transient(win)
            modal.grab_set()
            modal.lift()
            modal.focus()

            def _on_modal_close():
                _hub_invite_modal_open[0] = False
                try: modal.grab_release()
                except Exception: pass
                try: modal.destroy()
                except Exception: pass

            modal.protocol("WM_DELETE_WINDOW", _on_modal_close)

            ctk.CTkLabel(
                modal, text="GAME INVITE",
                font=ctk.CTkFont(family=FONT_DISPLAY, size=16, weight="bold"),
                text_color=BRAND["text"],
            ).pack(pady=(16, 2))

            ctk.CTkLabel(
                modal,
                text=f"{inviter_name.upper()} invited you to play {game_name}",
                font=ctk.CTkFont(family=FONT_MONO, size=11),
                text_color=BRAND["hud_glow"],
            ).pack(pady=(0, 6))

            if room_code:
                code_row = ctk.CTkFrame(modal, fg_color=BRAND["hud_panel_2"],
                                        corner_radius=4)
                code_row.pack(padx=22, fill="x", pady=(0, 10))
                ctk.CTkLabel(
                    code_row,
                    text=f"ROOM  {room_code}",
                    font=ctk.CTkFont(family=FONT_MONO, size=13, weight="bold"),
                    text_color=BRAND["cyan"],
                ).pack(pady=8)

            ctk.CTkLabel(
                modal,
                text="ACCEPT opens the match lobby in your browser.\nChoose your side, enter the room password, sign contract.",
                font=ctk.CTkFont(family=FONT_MONO, size=9),
                text_color=BRAND["text_muted"],
                justify="center",
            ).pack(pady=(0, 10))

            btn_row = ctk.CTkFrame(modal, fg_color="transparent")
            btn_row.pack(fill="x", padx=22)

            accept_btn  = ctk.CTkButton(btn_row, text="ACCEPT",  height=40, corner_radius=4,
                                         fg_color=BRAND["accent"], hover_color=BRAND["accent_dark"],
                                         text_color="#FFFFFF",
                                         font=ctk.CTkFont(family=FONT_MONO, size=13, weight="bold"))
            decline_btn = ctk.CTkButton(btn_row, text="DECLINE", height=40, corner_radius=4,
                                         fg_color=BRAND["hud_panel_2"], hover_color=BRAND["hud_border"],
                                         border_width=1, border_color=BRAND["hud_border"],
                                         text_color=BRAND["text_muted"],
                                         font=ctk.CTkFont(family=FONT_MONO, size=13, weight="bold"))
            accept_btn.pack(side="left",  fill="x", expand=True, padx=(0, 5))
            decline_btn.pack(side="right", fill="x", expand=True, padx=(5, 0))

            def _accept():
                accept_btn.configure(state="disabled", text="…")
                decline_btn.configure(state="disabled")
                token = auth.access_token or ""

                def _t():
                    result = monitor.engine.respond_to_notification(token, notif_id, "accept")

                    def _after():
                        _on_modal_close()
                        if result and "detail" not in result:
                            # Navigate to custom matches tab — user finds room by code,
                            # chooses side, enters password, signs contract on the website.
                            frontend = config.get("frontend_url", "https://project-arena.com")
                            import webbrowser
                            webbrowser.open(f"{frontend}/lobby?tab=custom")
                        elif result and result.get("detail"):
                            if notify_fn:
                                try: notify_fn(f"Room no longer available: {result['detail']}")
                                except Exception: pass

                    win.after(0, _after)

                threading.Thread(target=_t, daemon=True).start()

            def _decline():
                accept_btn.configure(state="disabled")
                decline_btn.configure(state="disabled", text="…")
                token = auth.access_token or ""

                def _t():
                    monitor.engine.respond_to_notification(token, notif_id, "decline")
                    win.after(0, _on_modal_close)

                threading.Thread(target=_t, daemon=True).start()

            accept_btn.configure(command=_accept)
            decline_btn.configure(command=_decline)

        # ── Poll loops ────────────────────────────────────────────────────────
        _HUB_FRIENDS_MS = 30_000
        _HUB_INVITES_MS =  5_000

        def _hub_friends_cycle():
            def _bg():
                if auth.is_authenticated:
                    token   = auth.access_token or ""
                    friends = monitor.engine.get_online_friends(token)
                    win.after(0, lambda f=friends: _hub_rebuild(f))
            threading.Thread(target=_bg, daemon=True).start()
            win.after(_HUB_FRIENDS_MS, _hub_friends_cycle)

        def _hub_invites_cycle():
            def _bg():
                if auth.is_authenticated:
                    token   = auth.access_token or ""
                    invites = monitor.engine.get_pending_hub_invites(token)
                    for inv in invites:
                        nid = inv.get("notification_id", "")
                        if nid and nid not in _hub_seen_invite_ids:
                            _hub_seen_invite_ids.add(nid)
                            win.after(0, lambda i=inv: _show_invite_modal(i))
                            break
            threading.Thread(target=_bg, daemon=True).start()
            win.after(_HUB_INVITES_MS, _hub_invites_cycle)

        # Trigger an immediate friends refresh after login/logout events
        # by wrapping _rebuild_identity with a hub refresh hook.
        _orig_rebuild_identity = _rebuild_identity

        def _rebuild_identity():
            _orig_rebuild_identity()
            # Kick a friends refresh 600ms later so identity renders first
            def _hub_after_auth():
                def _bg():
                    if auth.is_authenticated:
                        token   = auth.access_token or ""
                        friends = monitor.engine.get_online_friends(token)
                        win.after(0, lambda f=friends: _hub_rebuild(f))
                    else:
                        win.after(0, lambda: _hub_rebuild([]))
                threading.Thread(target=_bg, daemon=True).start()
            win.after(600, _hub_after_auth)

        # Delayed start so window is fully rendered
        win.after(1_500, _hub_friends_cycle)
        win.after(2_000, _hub_invites_cycle)
        _hub_rebuild([])   # empty placeholder until first poll

    def _handle_session_expired():
        """Any Bearer API returned 401 — clear local session and return to login."""
        try:
            monitor.stop()
        except Exception:
            pass
        auth.logout(engine=None)
        monitor.engine.token = ""
        monitor.engine.reset_401_guard()
        if tray_app is not None:
            tray_app._tray_unread_count = 0
            tray_app._apply_tray_icon()
        if notify_fn:
            try:
                notify_fn("Session expired — please sign in again")
            except Exception:
                pass
        _rebuild_identity()

    monitor.engine.set_on_unauthorized(lambda: win.after(0, _handle_session_expired))

    # Game status card — compact chamfered tactical frame (match id in the
    # right slot so the old `match_lbl` stays visible without a second row).
    game_dot, game_lbl, match_lbl = _make_chamfer_status(
        ov_right, "Game Status", "No game detected", with_extra=True,
    )

    # ── Match Lobby Card — hidden until monitor.current_match_id is set ───────
    # Always exists in layout (between game_card and mon_card); shown/hidden via pack.
    # Match Lobby moved to right column — fills the dead space under Monitoring
    # and makes the left column not need scrolling.
    lobby_container = ctk.CTkFrame(ov_right, fg_color="transparent")
    lobby_container.pack(fill="x")

    lobby_outer = _chamfer_panel(lobby_container, "Match Lobby", width_shrink=80, min_height=90)

    lobby_body_ref: list = []
    _lobby_result_cache: list[dict | None] = [None]
    _completed_clear_after: list[str | None] = [None]   # tkinter after() job id
    _completed_scheduled_for: list[str | None] = [None]  # match_id we already timed

    def _cancel_completed_clear_timer() -> None:
        job = _completed_clear_after[0]
        if job:
            try:
                win.after_cancel(job)
            except Exception:
                pass
            _completed_clear_after[0] = None
        _completed_scheduled_for[0] = None

    def _schedule_completed_lobby_clear(match_id_snapshot: str) -> None:
        """After completed match, hide lobby card and clear local match_id (5s, once per match)."""
        if _completed_scheduled_for[0] == match_id_snapshot:
            return
        job = _completed_clear_after[0]
        if job:
            try:
                win.after_cancel(job)
            except Exception:
                pass
            _completed_clear_after[0] = None
        _completed_scheduled_for[0] = match_id_snapshot

        def _fire():
            _completed_clear_after[0] = None
            _completed_scheduled_for[0] = None
            if monitor.current_match_id != match_id_snapshot:
                return
            monitor.current_match_id = None
            _lobby_result_cache[0] = None
            _rebuild_lobby_body(None)

        _completed_clear_after[0] = win.after(5000, _fire)

    def _rebuild_lobby_body(data: dict | None, result: dict | None = None):
        """Rebuild lobby card content. Always called on main thread via win.after."""
        for w in lobby_body_ref:
            try: w.destroy()
            except Exception: pass
        lobby_body_ref.clear()

        lobby_holder = lobby_outer._chamfer_holder  # type: ignore[attr-defined]
        if data is None:
            _cancel_completed_clear_timer()
            lobby_holder.pack_forget()
            return

        if not lobby_holder.winfo_ismapped():
            lobby_holder.pack(fill="x", padx=(14, 14 + 80), pady=(10, 0))

        code      = data.get("code") or "—"
        game_name = data.get("game") or "—"
        mode      = data.get("mode") or "—"
        your_team = (data.get("your_team") or "").lower()
        status    = data.get("status") or ""
        stake     = data.get("stake") or data.get("entry_fee") or ""

        status_colors = {
            "waiting":     BRAND["cyan"],
            "starting":    BRAND["warning"],
            "in_progress": BRAND["accent"],
            "completed":   BRAND["text_muted"],
            "tied":        BRAND["warning"],
        }
        status_color = status_colors.get(status, BRAND["text_muted"])
        status_text  = status.replace("_", " ").upper() + "  ·  PLAYERS"

        # ── Header row: "YOU'RE IN THE ROOM" + status chip ───────────────────
        hdr_row = ctk.CTkFrame(lobby_outer, fg_color="transparent")
        hdr_row.pack(fill="x", padx=0, pady=(0, 6))
        lobby_body_ref.append(hdr_row)
        ctx_map = {
            "waiting":     "YOU'RE IN THE ROOM",
            "starting":    "YOU'RE IN THE ROOM",
            "in_progress": "MATCH IN PROGRESS",
            "completed":   "MATCH ENDED",
            "tied":        "MATCH DRAW",
        }
        ctk.CTkLabel(
            hdr_row, text=ctx_map.get(status, "MATCH_SESSION · LIVE"),
            font=ctk.CTkFont(family=FONT_DISPLAY, size=15, weight="bold"),
            text_color=BRAND["text"],
        ).pack(side="left")
        # Status chip (right) — small chamfered pill with cyan border
        chip = tk.Canvas(hdr_row, bg=BRAND["hud_panel"], highlightthickness=0,
                         bd=0, height=22, width=160)
        chip.pack(side="right")
        def _draw_chip(_e=None):
            w = chip.winfo_width() or 160
            h = 22; cut = 5
            chip.delete("all")
            pts = [cut, 0, w - 1, 0, w - 1, h - cut,
                   w - 1 - cut, h - 1, 0, h - 1, 0, cut]
            chip.create_polygon(pts, fill=BRAND["hud_panel"],
                                outline=status_color, width=1)
            chip.create_text(w // 2, h // 2, text=status_text,
                             fill=status_color,
                             font=(FONT_MONO, 9, "bold"))
        chip.bind("<Configure>", lambda e: chip.after(5, _draw_chip))
        chip.after(20, _draw_chip)
        lobby_body_ref.append(chip)

        # ── Tag row: game · mode · stake · room code ─────────────────────────
        tag_row = ctk.CTkFrame(lobby_outer, fg_color="transparent")
        tag_row.pack(fill="x", padx=0, pady=(0, 10))
        lobby_body_ref.append(tag_row)

        def _mk_tag(parent, text: str, *, border_color: str, text_color: str,
                    fill: str | None = None, width: int = 0):
            t_len = max(width, len(text) * 8 + 14)
            c = tk.Canvas(parent, bg=BRAND["hud_panel"], highlightthickness=0,
                          bd=0, height=22, width=t_len)
            c.pack(side="left", padx=(0, 6))
            def _d(_e=None):
                w = c.winfo_width() or t_len
                h = 22; cut = 5
                c.delete("all")
                pts = [cut, 0, w - 1, 0, w - 1, h - cut,
                       w - 1 - cut, h - 1, 0, h - 1, 0, cut]
                c.create_polygon(pts, fill=fill or BRAND["hud_panel"],
                                 outline=border_color, width=1)
                c.create_text(w // 2, h // 2, text=text,
                              fill=text_color,
                              font=(FONT_MONO, 9, "bold"))
            c.bind("<Configure>", lambda e: c.after(5, _d))
            c.after(20, _d)
            return c

        _mk_tag(tag_row, game_name.upper(),
                border_color=BRAND["hud_border"], text_color=BRAND["text"])
        _mk_tag(tag_row, mode.upper(),
                border_color=BRAND["hud_border"], text_color=BRAND["text"])
        if stake:
            _mk_tag(tag_row, f"STK: {stake}",
                    border_color=BRAND["warning"],
                    text_color=BRAND["warning"])
        _mk_tag(tag_row, f"ARENA-{code}",
                border_color=BRAND["accent"], text_color=BRAND["accent"])

        # ── Teams grid: TEAM A | VS | TEAM B ─────────────────────────────────
        players = data.get("players") or []
        teams: dict[str, list[str]] = {"a": [], "b": []}
        for p in players:
            t = (p.get("team") or "").lower()
            if t in teams:
                teams[t].append(p.get("username")
                                or (p.get("user_id") or "?")[:8])
        slot_cap = 5 if (mode or "").lower().startswith("5v5") else \
                   (3 if (mode or "").lower().startswith("3v3") else \
                    (2 if (mode or "").lower().startswith("2v2") else 1))

        teams_grid = ctk.CTkFrame(lobby_outer, fg_color="transparent")
        teams_grid.pack(fill="x", padx=0, pady=(0, 8))
        lobby_body_ref.append(teams_grid)

        def _team_col(parent, label: str, members: list[str], *,
                       highlight_me: bool, side: str):
            col = ctk.CTkFrame(parent, fg_color="transparent")
            col.pack(side=side, fill="both", expand=True,
                      padx=(0, 4) if side == "left" else (4, 0))
            head = ctk.CTkLabel(
                col, text=f"○ {label.upper()} ({len(members)}/{slot_cap})",
                font=ctk.CTkFont(family=FONT_MONO, size=10, weight="bold"),
                text_color=BRAND["accent"])
            head.pack(anchor="w", pady=(0, 4))
            for i in range(slot_cap):
                name = members[i] if i < len(members) else None
                is_me = (highlight_me and name and
                         name == (auth.username or ""))
                row = tk.Canvas(col, bg=BRAND["hud_panel"],
                                 highlightthickness=0, bd=0, height=26)
                row.pack(fill="x", pady=(0, 3))
                _text = name or f"Slot {i+1}"
                _tc   = "#FFFFFF" if name else BRAND["text_muted"]
                _fill = BRAND["accent_dark"] if is_me else BRAND["hud_panel_2"]
                _bc   = BRAND["accent"] if is_me else BRAND["hud_border"]
                def _mk_draw(cvs, text=_text, tc=_tc, fill=_fill, bc=_bc,
                             has_name=bool(name), glow_me=is_me):
                    def _d(_e=None):
                        w = cvs.winfo_width() or 100
                        h = 26; cut = 4
                        cvs.delete("all")
                        # Red neon bloom for the active player's slot.
                        if glow_me:
                            gi = make_neon_glow(cvs, w, h, cut,
                                                BRAND["accent"],
                                                glow=10, alpha=160,
                                                inner_alpha=240)
                            if gi is not None:
                                cvs.create_image(0, 0, anchor="nw", image=gi)
                                cvs._glow_ref = gi
                        pts = [cut, 0, w - 1, 0, w - 1, h - cut,
                               w - 1 - cut, h - 1, 0, h - 1, 0, cut]
                        cvs.create_polygon(pts, fill=fill,
                                           outline=bc, width=1)
                        icon = "●" if has_name else "○"
                        cvs.create_text(10, h // 2, text=icon,
                                        fill=tc, font=(FONT_MONO, 9),
                                        anchor="w")
                        cvs.create_text(22, h // 2, text=text,
                                        fill=tc,
                                        font=(FONT_BODY, 11,
                                              "bold" if has_name else "normal"),
                                        anchor="w")
                    return _d
                drawer = _mk_draw(row)
                row.bind("<Configure>", lambda e, d=drawer: e.widget.after(5, d))
                row.after(20, drawer)

        _team_col(teams_grid, "Team A", teams["a"],
                   highlight_me=(your_team == "a"), side="left")
        vs_lbl = ctk.CTkLabel(
            teams_grid, text="V S", width=40,
            font=ctk.CTkFont(family=FONT_DISPLAY, size=14, weight="bold"),
            text_color=BRAND["accent"])
        vs_lbl.pack(side="left", padx=4)
        _team_col(teams_grid, "Team B", teams["b"],
                   highlight_me=(your_team == "b"), side="left")

        # Forfeit warning banner — DisconnectMonitor issued a 30s grace period warning
        warn_at   = data.get("forfeit_warning_at")
        warn_team = (data.get("forfeit_warning_team") or "").upper()
        if warn_at and warn_team and (
            warn_team == "BOTH" or warn_team == your_team.upper()
        ):
            try:
                deadline_dt = (
                    datetime.fromisoformat(warn_at.replace("Z", "+00:00"))
                    + timedelta(seconds=30)
                )
                secs_left = max(0, int(
                    (deadline_dt - datetime.now(timezone.utc)).total_seconds()
                ))
                warn_msg = f"\u26a0  FORFEIT WARNING \u2014 Return to game NOW!  {secs_left}s remaining"
            except Exception:
                warn_msg = "\u26a0  FORFEIT WARNING \u2014 Return to game NOW!"
            warn_banner = ctk.CTkLabel(
                lobby_outer,
                text=warn_msg,
                font=ctk.CTkFont(family=FONT_MONO, size=12, weight="bold"),
                text_color=BRAND["accent"],
                fg_color="#2A0000",
                corner_radius=4,
            )
            warn_banner.pack(fill="x", padx=0, pady=(0, 8))
            lobby_body_ref.append(warn_banner)

        # Result banner — shown when match completed and result was fetched
        # TODO(Claude): confirm GET /match/{id}/status response shape.
        # Need 'result' (victory/defeat) and 'score' fields to display the banner.
        # Once confirmed, remove this comment.
        if result:
            res_val   = (result.get("result") or "").upper()
            score_val = result.get("score") or ""
            res_color = (
                BRAND["warning"] if res_val == "VICTORY"
                else BRAND["warning"] if res_val == "TIE"
                else BRAND["accent"]
            )
            tail = f"{res_val}" + (f" ({score_val})" if score_val else "")
            res_text = f"Match ended — result: {tail}"
            res_banner = ctk.CTkLabel(lobby_outer, text=res_text,
                                      font=ctk.CTkFont(family=FONT_MONO, size=12, weight="bold"),
                                      text_color=res_color)
            res_banner.pack(anchor="w", padx=0, pady=(0, 10))
            lobby_body_ref.append(res_banner)
        elif status in ("completed", "tied"):
            wait_lbl = ctk.CTkLabel(
                lobby_outer,
                text="Match ended — fetching result…" if status == "completed" else "Draw — fetching result…",
                font=ctk.CTkFont(size=11),
                text_color=BRAND["text_muted"],
            )
            wait_lbl.pack(anchor="w", padx=0, pady=(0, 10))
            lobby_body_ref.append(wait_lbl)

    # Monitoring toggle card — chamfered tactical panel (admin-dialog style),
    # same 80px right-shrink as Identity/Engine so the column ends aligned.
    mon_card = _chamfer_panel(ov_right, "Monitoring", width_shrink=80, min_height=70)
    mon_row  = ctk.CTkFrame(mon_card, fg_color="transparent")
    mon_row.pack(fill="x", padx=0, pady=(0, 6))

    mon_var = ctk.BooleanVar(value=monitor.running)
    mon_lbl = ctk.CTkLabel(mon_row,
                            text="ON" if monitor.running else "OFF",
                            font=ctk.CTkFont(family=FONT_MONO, size=11, weight="bold"),
                            text_color=BRAND["accent"] if monitor.running else BRAND["text_muted"],
                            width=36)
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
        font=ctk.CTkFont(family=FONT_MONO, size=11), text_color=BRAND["text"],
        button_color=BRAND["accent"],
        button_hover_color=BRAND["accent_dark"],
        progress_color=BRAND["accent_dark"],
    ).pack(side="left", padx=(8, 0))

    def _ensure_monitor_for_live_match() -> None:
        """Server status in_progress — ensure watcher runs so match_id + /validate/screenshot work."""
        if not monitor.running:
            monitor.start()
            mon_var.set(True)
            mon_lbl.configure(text="ON", text_color=BRAND["accent"])

    cap_lbl = ctk.CTkLabel(mon_row, text="0 captures",
                            font=ctk.CTkFont(family=FONT_MONO, size=10),
                            text_color=BRAND["text_muted"])
    cap_lbl.pack(side="right")

    # Screenshot thumbnail row
    thumb_row = ctk.CTkFrame(mon_card, fg_color="transparent")
    thumb_row.pack(fill="x", padx=0, pady=(4, 0))
    thumb_img_lbl = ctk.CTkLabel(thumb_row, text="No screenshot yet",
                                  font=ctk.CTkFont(size=10),
                                  text_color=BRAND["text_muted"])
    thumb_img_lbl.pack(side="left")
    _last_shown_fp: list[str | None] = [None]

    ctk.CTkLabel(ov_left, text="", height=10).pack()

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

            ctk.CTkLabel(row, text=(evt.get("name", "Event") or "Event").upper(),
                          font=ctk.CTkFont(family=FONT_MONO, size=12, weight="bold"),
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
                          font=ctk.CTkFont(family=FONT_MONO, size=12, weight="bold"),
                          text_color=BRAND["warning"]).pack(side="left")

            cbtn = ctk.CTkButton(
                br, text="CLAIMED" if claimed else "CLAIM XP",
                height=30, width=100, corner_radius=4,
                fg_color=BRAND["hud_panel_2"] if claimed else BRAND["accent"],
                hover_color=BRAND["hud_border"] if claimed else BRAND["accent_dark"],
                border_width=1,
                border_color=BRAND["hud_border"] if claimed else BRAND["accent"],
                text_color=BRAND["text_muted"] if claimed else "#FFFFFF",
                font=ctk.CTkFont(family=FONT_MONO, size=10, weight="bold"),
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
                                    btn.configure(text="CLAIMED",
                                                   fg_color=BRAND["hud_panel_2"],
                                                   text_color=BRAND["text_muted"])
                                else:
                                    btn.configure(state="normal", text="CLAIM XP")
                            win.after(0, _after)
                        threading.Thread(target=_do, daemon=True).start()
                    return _claim
                cbtn.configure(command=_make_handler(ev_id, cbtn))

    # ── Footer ─────────────────────────────────────────────────────────────────
    footer = ctk.CTkFrame(win, fg_color=BRAND["hud_panel"], corner_radius=0,
                           height=62, border_width=0)
    footer.pack(fill="x", side="bottom")
    footer.pack_propagate(False)

    # Cyan accent line at top of footer
    ctk.CTkFrame(footer, height=2, fg_color=BRAND["hud_glow"], corner_radius=0).pack(
        fill="x", side="top")

    btn_row = ctk.CTkFrame(footer, fg_color="transparent")
    btn_row.pack(expand=True)

    def _check_engine_btn():
        threading.Thread(target=_do_engine_check, daemon=True).start()

    # Chamfered footer buttons (Support-ticket style): CANCEL-look for the
    # neutral actions, CONFIRM-look (solid red) for QUIT.
    def _footer_btn(parent, text: str, command, *, primary: bool,
                    width: int = 150, height: int = 38):
        fg  = BRAND["accent"]      if primary else BRAND["hud_panel_2"]
        hov = BRAND["accent_dark"] if primary else BRAND["hud_border"]
        tc  = "#FFFFFF"            if primary else BRAND["text"]
        bc  = BRAND["accent"]      if primary else BRAND["hud_border"]
        holder = ctk.CTkFrame(parent, fg_color="transparent",
                              width=width, height=height)
        holder.pack(side="left", padx=6, pady=10)
        holder.pack_propagate(False)
        cvs = tk.Canvas(holder, bg=BRAND["hud_panel"], highlightthickness=0,
                        bd=0, width=width, height=height)
        cvs.pack(fill="both", expand=True)
        btn = ctk.CTkButton(
            cvs, text=text, height=height - 4, corner_radius=0,
            fg_color=fg, hover_color=hov, text_color=tc,
            border_width=0,
            font=ctk.CTkFont(family=FONT_MONO, size=11, weight="bold"),
            command=command,
        )
        btn_win = [None]
        def _draw(_e=None):
            w = max(60, cvs.winfo_width())
            h = cvs.winfo_height() or height
            cut = 7
            cvs.delete("deco")
            pts = [cut, 0, w - 1, 0, w - 1, h - cut,
                   w - 1 - cut, h - 1, 0, h - 1, 0, cut]
            cvs.create_polygon(pts, fill=fg, outline=bc, width=1, tags="deco")
            if btn_win[0] is None:
                btn_win[0] = cvs.create_window(
                    2, 2, window=btn, anchor="nw",
                    width=w - 4, height=h - 4)
            else:
                cvs.itemconfig(btn_win[0], width=w - 4, height=h - 4)
        cvs.bind("<Configure>", lambda e: cvs.after(10, _draw))
        cvs.after(30, _draw)
        return btn

    _footer_btn(btn_row, "CHECK ENGINE", _check_engine_btn, primary=False, width=160)
    _footer_btn(btn_row, "WEBSITE",      _open_website,     primary=False, width=130)
    _footer_btn(btn_row, "QUIT",         _quit_app,         primary=True,  width=120)

    # ── Thread-safe polls — all via win.after() ────────────────────────────────

    def _do_engine_check():
        """Background: fetch health, apply to UI on main thread."""
        health = monitor.engine.health()
        def _apply():
            if health and health.get("status") == "ok":
                db = health.get("db", "?")
                eng_lbl.configure(text=f"Connected  ·  DB: {db}", text_color=BRAND["text"])
                eng_dot.configure(text_color="#22C55E")
                hdr_eng_dot.configure(text_color="#22C55E")
            else:
                eng_lbl.configure(text="Engine offline", text_color=BRAND["text_muted"])
                eng_dot.configure(text_color=BRAND["error"])
                hdr_eng_dot.configure(text_color=BRAND["error"])
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

        # Update capture count
        cap_lbl.configure(text=f"{monitor._capture_count} captures")

        # Update screenshot thumbnail when a new screenshot is available
        last_fp = monitor._last_screenshot
        if last_fp and last_fp != _last_shown_fp[0] and os.path.exists(last_fp):
            try:
                pil_img  = Image.open(last_fp).resize((60, 34), Image.LANCZOS)
                ctk_img  = ctk.CTkImage(light_image=pil_img, dark_image=pil_img,
                                        size=(60, 34))
                thumb_img_lbl.configure(image=ctk_img, text="")
                _last_shown_fp[0] = last_fp
            except Exception:
                pass

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
        """Phase 3: re-sync rank/XP/avatar/xp_to_next_level from /auth/me every 60s."""
        if auth.is_authenticated:
            token = auth.access_token or ""
            def _fetch():
                profile = monitor.engine.get_profile(token)
                if profile:
                    changed = (
                        profile.get("rank")                   != auth.rank
                        or profile.get("xp")                 != auth.xp
                        or profile.get("xp_to_next_level")   != auth.xp_to_next_level
                        or profile.get("avatar_bg")           != auth.avatar_bg
                        or profile.get("equipped_badge_icon") != auth.equipped_badge_icon
                        or profile.get("region")              != auth.region
                    )
                    if changed:
                        auth.set_token(
                            token=token,
                            rank=profile.get("rank"),
                            xp=profile.get("xp"),
                            xp_to_next_level=profile.get("xp_to_next_level"),
                            avatar_url=profile.get("avatar_url"),
                            avatar_bg=profile.get("avatar_bg"),
                            equipped_badge_icon=profile.get("equipped_badge_icon"),
                            region=profile.get("region"),
                        )
                        win.after(0, _rebuild_identity)
            threading.Thread(target=_fetch, daemon=True).start()
        win.after(60_000, _poll_profile_sync)

    def _do_lobby_poll():
        """
        Background thread: polls GET /match/active every 5s, then POST heartbeat on that id.
        Stays aligned with server: null match, cancelled, or in_match=false clears local state.
        Heartbeat runs at most every 5s while in a room (well under 30s keep-alive requirement).
        """
        token = auth.access_token or ""
        if not token:
            win.after(0, lambda: _rebuild_lobby_body(None))
            return

        body = monitor.engine.get_match_active_payload(token)
        if body is None:
            # Network / HTTP error — do not clear (avoid flashing stale UI away on blip)
            return

        match = body.get("match")
        if match is None:
            if monitor.current_match_id:
                monitor.current_match_id = None
                _lobby_result_cache[0] = None
            win.after(0, lambda: _rebuild_lobby_body(None))
            return

        st_active = (match.get("status") or "").strip().lower()
        if st_active == "cancelled":
            if monitor.current_match_id:
                monitor.current_match_id = None
                _lobby_result_cache[0] = None
            win.after(0, lambda: _rebuild_lobby_body(None))
            if notify_fn:
                try:
                    notify_fn("Match ended")
                except Exception:
                    pass
            return

        mid = match.get("match_id")
        if not mid:
            if monitor.current_match_id:
                monitor.current_match_id = None
                _lobby_result_cache[0] = None
            win.after(0, lambda: _rebuild_lobby_body(None))
            return

        if monitor.current_match_id and monitor.current_match_id != mid:
            _lobby_result_cache[0] = None
        if not monitor.current_match_id:
            monitor.set_match_id(mid)

        data = monitor.engine.match_heartbeat(mid, token)

        def _apply():
            if data is None:
                return  # network hiccup — keep previous state visible

            st_hb = (data.get("status") or "").strip().lower()
            if st_hb == "cancelled":
                _cancel_completed_clear_timer()
                monitor.current_match_id = None
                _lobby_result_cache[0] = None
                _rebuild_lobby_body(None)
                if notify_fn:
                    try:
                        notify_fn("Room cancelled")
                    except Exception:
                        pass
                return

            if not data.get("in_match", True):
                _cancel_completed_clear_timer()
                monitor.current_match_id = None
                _lobby_result_cache[0] = None
                _rebuild_lobby_body(None)
                if notify_fn:
                    try:
                        notify_fn("Removed from match")
                    except Exception:
                        pass
                return

            if st_hb == "in_progress":
                win.after(0, _ensure_monitor_for_live_match)

            _rebuild_lobby_body(data, _lobby_result_cache[0])

            clear_mid = data.get("match_id") or mid
            if st_hb in ("completed", "tied"):
                _schedule_completed_lobby_clear(clear_mid)

            if data.get("status") in ("completed", "tied") and _lobby_result_cache[0] is None:
                def _fetch_result():
                    res = monitor.engine.get_match_status(mid, token)
                    if res:
                        _lobby_result_cache[0] = res
                        win.after(0, lambda d=data, r=res: _rebuild_lobby_body(d, r))
                threading.Thread(target=_fetch_result, daemon=True).start()

        win.after(0, _apply)

    def _poll_lobby():
        threading.Thread(target=_do_lobby_poll, daemon=True).start()
        win.after(5_000, _poll_lobby)

    # Kick off all polls
    win.after(500,    _poll_engine)
    win.after(1_000,  _poll_game)
    win.after(2_000,  _poll_events)
    win.after(2_500,  _poll_lobby)
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
        self._tray_unread_count  = 0
        self._unread_stop        = threading.Event()
        self._unread_thread: threading.Thread | None = None

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

    def _apply_tray_icon(self) -> None:
        if not self.icon:
            return
        try:
            n = self._tray_unread_count if self.auth.is_authenticated else 0
            self.icon.icon = _draw_arena_icon(
                128, state=self._icon_state(), badge_count=n)
        except Exception as e:
            logger.debug(f"Tray icon update: {e}")

    def request_unread_refresh(self) -> None:
        """Poll unread count once (e.g. right after login)."""

        def _go():
            tok = self.auth.access_token
            if not tok:
                return
            c = self.monitor.engine.get_messages_unread_count(tok)
            if c is not None:
                self._tray_unread_count = c
                self._apply_tray_icon()

        threading.Thread(target=_go, daemon=True).start()

    def _unread_poll_loop(self) -> None:
        while not self._unread_stop.wait(30.0):
            if not self.auth.is_authenticated:
                continue
            tok = self.auth.access_token
            if not tok:
                continue
            c = self.monitor.engine.get_messages_unread_count(tok)
            if c is not None:
                self._tray_unread_count = c
                self._apply_tray_icon()

    def _on_messages(self, icon, item):
        import webbrowser
        base = (self.config.get("frontend_url") or "https://project-arena.com").rstrip("/")
        webbrowser.open(f"{base}/messages")
        self._tray_unread_count = 0
        self._apply_tray_icon()

    def _toggle_monitoring(self, icon, item):
        if self._monitoring_enabled:
            self.monitor.stop()
            self._monitoring_enabled = False
            self._apply_tray_icon()
            icon.notify("Arena Client", "Client Offline — monitoring stopped")
        else:
            self.monitor.start()
            self._monitoring_enabled = True
            self._apply_tray_icon()
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
        self._unread_stop.set()
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
            MenuItem("Messages",      self._on_messages),
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
            "Arena",
            _draw_arena_icon(128, state=self._icon_state(),
                             badge_count=self._tray_unread_count),
            "Arena - Match Monitor", menu,
        )

        if self._monitoring_enabled:
            self.monitor.start()

        self._unread_stop.clear()
        self._unread_thread = threading.Thread(
            target=self._unread_poll_loop, daemon=True, name="ArenaUnreadPoll")
        self._unread_thread.start()

        def _sig(sig, frame): self._shutdown()
        signal.signal(signal.SIGINT,  _sig)
        signal.signal(signal.SIGTERM, _sig)

        self.icon.run_detached()
        logger.info("Arena Desktop Client started")

        _build_client_window(
            self.monitor, self.auth, self.config, ico_path=ico_path,
            tray_app=self,
            notify_fn=lambda msg: (
                self.icon.notify("Arena Client", msg) if self.icon else None),
        )


# ── Entry Point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Single-instance guard — only one Arena Client may run at a time
    _mutex = ctypes.windll.kernel32.CreateMutexW(None, True, "ArenaClient_SingleInstance")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        ctypes.windll.user32.MessageBoxW(
            0,
            "Arena Client is already running.\nCheck your system tray.",
            "Arena Client",
            0x40,  # MB_ICONINFORMATION
        )
        sys.exit(0)

    print(f"\n  ARENA Desktop Client v{CLIENT_VERSION}\n")

    # Register bundled TTFs (Orbitron / Inter / Rajdhani / Share Tech Mono /
    # Tektur) so the HUD matches the website typography.
    _load_bundled_fonts()

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
