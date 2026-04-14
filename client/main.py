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
import ctypes
from datetime import datetime
from logging.handlers import RotatingFileHandler

import signal
import httpx
import mss
import mss.tools
import pystray
from PIL import Image, ImageDraw, ImageFont, ImageFilter
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
    # AAA HUD extensions
    "hud_panel":   "#0F1115",
    "hud_panel_2": "#0B0D10",
    "hud_border":  "#2A2F3A",
    "hud_glow":    "#22D3EE",
    "hud_glow_2":  "#A78BFA",
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
    "engine_url":          "http://3.236.9.133/api",
    "frontend_url":        "http://3.236.9.133",
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
        self._capture_count      = 0
        self._last_screenshot: str | None = None
        self._heartbeat_stop     = threading.Event()
        self._session_id         = get_or_create_session_id(config)

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
                        token = self.config.get("auth_token", "")
                        if token:
                            mid = self.engine.get_active_match(token)
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
                        self._last_screenshot = filepath
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
def _draw_arena_icon(size: int = 64, state: str = "idle",
                     badge_count: int = 0) -> Image.Image:
    """
    Arena 'A' tray icon.
    Drawn at 4× resolution then downscaled for smooth anti-aliasing at small sizes.

    States:
      active → red 'A'   (monitoring ON)
      match  → gold 'A'  (match in progress)
      error  → dim red   (engine offline)
      idle   → gray 'A'  (monitoring OFF)

    badge_count: unread messages — red dot with digit (1–9, 9+) bottom-right.

    Background is transparent so Windows tray colour shows through cleanly.
    A small filled circle behind the glyph ensures the 'A' is always legible.
    """
    colors = {
        "active": BRAND["accent_pil"],
        "match":  BRAND["match_pil"],
        "error":  (239, 68, 68, 220),
        "idle":   BRAND["idle_pil"],
    }
    glyph_color = colors.get(state, colors["idle"])

    # Draw at 4× then downscale → smooth edges at any size
    draw_size = size * 4
    img  = Image.new("RGBA", (draw_size, draw_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    s = draw_size
    cx = s // 2

    # AAA icon base: matte panel + neon ring glow
    pad_bg = int(s * 0.08)
    ring_box = [pad_bg, pad_bg, s - pad_bg, s - pad_bg]
    draw.ellipse(ring_box, fill=(12, 12, 12, 235))

    lw_ring = max(2, s // 44)

    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse(ring_box, outline=(34, 211, 238, 110), width=lw_ring * 3)
    gdraw.ellipse(ring_box, outline=(167, 139, 250, 80), width=lw_ring * 2)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(2, s // 120)))
    img.alpha_composite(glow)

    draw.ellipse(ring_box, outline=glyph_color, width=lw_ring)

    # 'A' glyph — thick, bold, centred with subtle shadow
    lw  = max(8, s // 12)
    pad = int(s * 0.18)

    top  = (cx,          int(s * 0.12))
    bl   = (int(s * 0.1), int(s * 0.88))
    br   = (int(s * 0.9), int(s * 0.88))
    cb_y = int(s * 0.55)
    ins  = int(s * 0.28)
    cb_l = (ins,     cb_y)
    cb_r = (s - ins, cb_y)

    sh = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    shd = ImageDraw.Draw(sh)
    shadow = (0, 0, 0, 160)
    off = max(2, s // 120)
    shd.line([(top[0] + off, top[1] + off), (bl[0] + off, bl[1] + off)], fill=shadow, width=lw)
    shd.line([(top[0] + off, top[1] + off), (br[0] + off, br[1] + off)], fill=shadow, width=lw)
    shd.line([(cb_l[0] + off, cb_l[1] + off), (cb_r[0] + off, cb_r[1] + off)], fill=shadow, width=max(6, s // 16))
    sh = sh.filter(ImageFilter.GaussianBlur(radius=max(1, s // 200)))
    img.alpha_composite(sh)

    draw.line([top, bl],    fill=glyph_color, width=lw)
    draw.line([top, br],    fill=glyph_color, width=lw)
    draw.line([cb_l, cb_r], fill=glyph_color, width=max(6, s // 16))

    # Downscale with LANCZOS for smooth anti-aliasing
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
    win.title("Arena Client")
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

            # Corner glows (cyan + violet) as translucent ovals
            bg.create_oval(-w * 0.35, -h * 0.55, w * 0.55, h * 0.35, outline="", fill="#0b2a33", stipple="gray25")
            bg.create_oval(w * 0.45, -h * 0.45, w * 1.35, h * 0.40, outline="", fill="#241136", stipple="gray25")

            # Scanlines
            for y in range(0, h, 4):
                bg.create_line(0, y, w, y, fill="#000000", width=1)

            # Soft top divider
            bg.create_rectangle(0, 0, w, 2, outline="", fill=BRAND["hud_border"])

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
        url = config.get("frontend_url", "http://localhost:3000")
        webbrowser.open(url)

    def _quit_app():
        monitor.stop()
        win.destroy()
        os._exit(0)

    # ── Widget helpers ────────────────────────────────────────────────────────
    def _card(parent, title: str) -> ctk.CTkFrame:
        """
        AAA HUD card: matte panel + neon edge + header pip.
        (Pure styling helper: no logic.)
        """
        outer = ctk.CTkFrame(
            parent,
            fg_color=BRAND["hud_panel"],
            corner_radius=12,
            border_width=1,
            border_color=BRAND["hud_border"],
        )
        outer.pack(fill="x", padx=14, pady=(10, 0))

        header = ctk.CTkFrame(outer, fg_color=BRAND["hud_panel_2"], corner_radius=10)
        header.pack(fill="x", padx=10, pady=(10, 6))

        pip = ctk.CTkFrame(header, width=8, height=8, fg_color=BRAND["hud_glow"], corner_radius=99)
        pip.pack(side="left", padx=(10, 8), pady=10)

        ctk.CTkLabel(
            header,
            text=title.upper(),
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color=BRAND["text"],
        ).pack(side="left", pady=8)

        ctk.CTkFrame(outer, height=1, fg_color=BRAND["hud_border"]).pack(fill="x", padx=10, pady=(0, 6))
        return outer

    def _hud_button(parent, text: str, command, *,
                    variant: str = "neutral",
                    height: int = 44,
                    font_size: int = 13,
                    min_width: int = 140) -> ctk.CTkButton:
        """
        AAA HUD button with cut corners + neon edge + hover glow.
        Uses a Pillow-drawn background image so it feels like the website UI.
        """
        # Keep image refs alive (tk will drop them otherwise)
        if not hasattr(win, "_hud_btn_imgs"):
            win._hud_btn_imgs = []  # type: ignore[attr-defined]

        colors = {
            "neutral": {"fill": BRAND["hud_panel_2"], "edge": BRAND["hud_border"], "glow": BRAND["hud_glow"], "text": BRAND["text"]},
            "primary": {"fill": BRAND["accent_dark"], "edge": BRAND["accent"], "glow": BRAND["accent"], "text": "#FFFFFF"},
            "danger":  {"fill": BRAND["accent"], "edge": BRAND["accent"], "glow": BRAND["hud_glow_2"], "text": "#FFFFFF"},
        }.get(variant, None)
        if colors is None:
            colors = {"fill": BRAND["hud_panel_2"], "edge": BRAND["hud_border"], "glow": BRAND["hud_glow"], "text": BRAND["text"]}

        def _hex_to_rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
            h = h.lstrip("#")
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a

        def _make_bg(w: int, h: int, glow_alpha: int) -> Image.Image:
            scale = 3
            W, H = w * scale, h * scale
            img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

            edge = _hex_to_rgba(colors["edge"], 255)
            fill = _hex_to_rgba(colors["fill"], 255)
            glow = _hex_to_rgba(colors["glow"], glow_alpha)

            cut = max(10, int(H * 0.26))
            pad = 4 * scale
            x0, y0, x1, y1 = pad, pad, W - pad, H - pad

            poly = [
                (x0 + cut, y0),
                (x1 - cut, y0),
                (x1, y0 + cut),
                (x1, y1 - cut),
                (x1 - cut, y1),
                (x0 + cut, y1),
                (x0, y1 - cut),
                (x0, y0 + cut),
            ]

            # Glow
            g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            gd = ImageDraw.Draw(g)
            gd.polygon(poly, outline=glow, width=max(3, 3 * scale))
            g = g.filter(ImageFilter.GaussianBlur(radius=4 * scale))
            img.alpha_composite(g)

            d = ImageDraw.Draw(img)
            d.polygon(poly, fill=fill)
            d.polygon(poly, outline=edge, width=max(2, 2 * scale))

            # Subtle top sheen
            sheen_h = int(H * 0.42)
            sheen = Image.new("RGBA", (W, sheen_h), (255, 255, 255, 0))
            sd = ImageDraw.Draw(sheen)
            for i in range(sheen_h):
                a = int(48 * (1 - i / max(1, sheen_h - 1)))
                sd.line([(0, i), (W, i)], fill=(255, 255, 255, a))
            img.alpha_composite(sheen, dest=(0, 0))

            return img.resize((w, h), Image.LANCZOS)

        w = max(min_width, 10 + len(text) * 9)
        normal_img = _make_bg(w, height, glow_alpha=50)
        hover_img  = _make_bg(w, height, glow_alpha=95)
        n = ctk.CTkImage(light_image=normal_img, dark_image=normal_img, size=(w, height))
        himg = ctk.CTkImage(light_image=hover_img, dark_image=hover_img, size=(w, height))
        win._hud_btn_imgs.extend([n, himg])  # type: ignore[attr-defined]

        btn = ctk.CTkButton(
            parent,
            text=text,
            command=command,
            height=height,
            width=w,
            fg_color="transparent",
            hover=False,  # we handle hover via image swap
            text_color=colors["text"],
            font=ctk.CTkFont(size=font_size, weight="bold"),
            image=n,
            compound="center",
        )

        def _on_enter(_e=None):
            try:
                btn.configure(image=himg)
            except Exception:
                pass

        def _on_leave(_e=None):
            try:
                btn.configure(image=n)
            except Exception:
                pass

        btn.bind("<Enter>", _on_enter)
        btn.bind("<Leave>", _on_leave)
        return btn

    def _hdivider(parent):
        ctk.CTkFrame(parent, height=1, fg_color=BRAND["border"]).pack(
            fill="x", padx=14, pady=(0, 4))

    def _status_dot(parent) -> ctk.CTkLabel:
        return ctk.CTkLabel(parent, text="●", font=ctk.CTkFont(size=9),
                             text_color=BRAND["text_muted"])

    # Use grid for stable layout: Header / Content / Footer
    win.grid_rowconfigure(0, weight=0)
    win.grid_rowconfigure(1, weight=1)
    win.grid_rowconfigure(2, weight=0)
    win.grid_columnconfigure(0, weight=1)

    # ── Header ────────────────────────────────────────────────────────────────
    header = ctk.CTkFrame(win, fg_color=BRAND["hud_panel"], corner_radius=0,
                           height=66, border_width=0)
    header.grid(row=0, column=0, sticky="ew")
    header.grid_propagate(False)

    # Red left accent bar
    ctk.CTkFrame(header, width=3, fg_color=BRAND["accent"], corner_radius=0).pack(
        side="left", fill="y")

    wordmark = ctk.CTkFrame(header, fg_color="transparent")
    wordmark.pack(side="left", padx=14, pady=10)
    ctk.CTkLabel(wordmark, text="ARENA",
                 font=ctk.CTkFont(size=22, weight="bold"),
                 text_color=BRAND["accent"]).pack(anchor="w")
    ctk.CTkLabel(wordmark, text="CLIENT HUD",
                 font=ctk.CTkFont(size=10, weight="bold"),
                 text_color=BRAND["text_muted"]).pack(anchor="w", pady=(0, 0))

    # Status chips on right
    hdr_right = ctk.CTkFrame(header, fg_color="transparent")
    hdr_right.pack(side="right", padx=12, pady=12)

    def _chip(parent, text: str, dot_color: str | None = None) -> tuple[ctk.CTkFrame, ctk.CTkLabel | None]:
        chip = ctk.CTkFrame(
            parent,
            fg_color=BRAND["hud_panel_2"],
            corner_radius=999,
            border_width=1,
            border_color=BRAND["hud_border"],
        )
        chip.pack(side="right", padx=(8, 0))
        dot = None
        if dot_color:
            dot = ctk.CTkLabel(chip, text="●", font=ctk.CTkFont(size=10), text_color=dot_color)
            dot.pack(side="left", padx=(10, 4), pady=6)
        lbl = ctk.CTkLabel(chip, text=text, font=ctk.CTkFont(size=11, weight="bold"), text_color=BRAND["text"])
        lbl.pack(side="left", padx=(0 if dot_color else 12, 12), pady=6)
        return chip, dot

    _chip(hdr_right, f"v{CLIENT_VERSION}")
    _eng_chip, hdr_eng_dot = _chip(hdr_right, "ENGINE", dot_color=BRAND["text_muted"])

    # ── Footer ────────────────────────────────────────────────────────────────
    footer = ctk.CTkFrame(win, fg_color=BRAND["bg_card"], corner_radius=0,
                           height=58, border_width=0)
    footer.grid(row=2, column=0, sticky="ew")
    footer.grid_propagate(False)

    # Top border line on footer
    ctk.CTkFrame(footer, height=1, fg_color=BRAND["border"], corner_radius=0).pack(
        fill="x", side="top")

    btn_row = ctk.CTkFrame(footer, fg_color="transparent")
    btn_row.pack(expand=True)

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
    tabview.grid(row=1, column=0, sticky="nsew")
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

    ov_left = ctk.CTkFrame(ov_root, fg_color="transparent", corner_radius=0)
    ov_left.grid(row=0, column=0, sticky="nsew", padx=(0, 6), pady=0)
    ov_left.grid_columnconfigure(0, weight=1)

    ov_right = ctk.CTkFrame(ov_root, fg_color="transparent", corner_radius=0)
    ov_right.grid(row=0, column=1, sticky="nsew", padx=(6, 0), pady=0)
    ov_right.grid_columnconfigure(0, weight=1)

    # Engine card
    eng_card = _card(ov_left, "Engine")
    eng_row  = ctk.CTkFrame(eng_card, fg_color="transparent")
    eng_row.pack(fill="x", padx=14, pady=(0, 12))
    eng_dot  = _status_dot(eng_row)
    eng_dot.pack(side="left")
    eng_lbl  = ctk.CTkLabel(eng_row, text="Checking…",
                              font=ctk.CTkFont(size=13), text_color=BRAND["text"])
    eng_lbl.pack(side="left", padx=(6, 0))

    # Identity card
    id_card     = _card(ov_left, "Identity")
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
        Login form — email only.
        DB-ready: /auth/login validates identifier against users.email.
                  Email is used because username is changeable in profile.
        """
        ctk.CTkLabel(parent, text="Sign in",
                     font=ctk.CTkFont(size=18, weight="bold"),
                     text_color=BRAND["text"]).pack(anchor="w", pady=(4, 8))
        ctk.CTkLabel(parent, text="Secure access · 2FA supported",
                     font=ctk.CTkFont(size=12),
                     text_color=BRAND["text_muted"]).pack(anchor="w", pady=(0, 14))

        entry_h = 46
        entry_r = 10
        entry_border = BRAND["hud_border"]
        entry_bg = BRAND["hud_panel_2"]

        id_entry = ctk.CTkEntry(
            parent, placeholder_text="Email",
            height=entry_h, corner_radius=entry_r,
            fg_color=entry_bg,
            border_color=entry_border,
            border_width=1,
            text_color=BRAND["text"],
            placeholder_text_color=BRAND["text_muted"],
            font=ctk.CTkFont(size=14),
        )
        id_entry.pack(fill="x", pady=(0, 10))

        pw_entry = ctk.CTkEntry(
            parent, placeholder_text="Password", show="*",
            height=entry_h, corner_radius=entry_r,
            fg_color=entry_bg,
            border_color=entry_border,
            border_width=1,
            text_color=BRAND["text"],
            placeholder_text_color=BRAND["text_muted"],
            font=ctk.CTkFont(size=14),
        )
        pw_entry.pack(fill="x", pady=(0, 12))

        err_lbl = ctk.CTkLabel(parent, text="",
                                font=ctk.CTkFont(size=11),
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
                modal, text="Enter your 2FA code",
                font=ctk.CTkFont(size=18, weight="bold"),
                text_color=BRAND["text"],
            ).pack(pady=(18, 6))
            ctk.CTkLabel(
                modal, text="Check your authenticator app",
                font=ctk.CTkFont(size=12),
                text_color=BRAND["text_muted"],
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

            verify_btn = _hud_button(modal, "VERIFY", lambda: None, variant="primary", height=46, min_width=200)

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
                        verify_btn.configure(state="normal", text="VERIFY")
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
                    login_btn.configure(state="normal", text="SIGN IN")
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
                        _rebuild_identity()
                        if tray_app is not None:
                            tray_app.request_unread_refresh()
                win.after(0, _after)
            threading.Thread(target=_thread, daemon=True).start()

        login_btn = ctk.CTkButton(
            parent, text="SIGN IN", height=46, corner_radius=12,
            fg_color=BRAND["accent"], hover_color=BRAND["accent_dark"],
            text_color="#FFFFFF", font=ctk.CTkFont(size=14, weight="bold"),
            command=_do_login,
        )
        login_btn.pack(fill="x", pady=(0, 14))
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

        # TODO[GOOGLE]: wire Google sign-in to POST /auth/google when Client ID is set
        ctk.CTkButton(
            parent, text="OPEN WEBSITE", height=40, corner_radius=12,
            fg_color=BRAND["hud_panel_2"], hover_color=BRAND["hud_border"],
            border_width=1, border_color=BRAND["hud_border"],
            text_color=BRAND["text_muted"], font=ctk.CTkFont(size=13, weight="bold"),
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
            # TODO[VERIF]: show linked Steam/Riot IDs from API when keys exist in platform_config
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

        reg = auth.region
        if reg:
            ctk.CTkLabel(
                parent, text=f"Region: {reg}",
                font=ctk.CTkFont(size=10, weight="bold"),
                text_color=BRAND["warning"],
            ).pack(anchor="w", pady=(0, 4))

        # TODO(Claude): confirm /auth/me returns xp_to_next_level field.
        # Currently reading it from profile; falls back to 1000 if not present.
        # Once Claude confirms the field name, remove this comment.
        xp_to_next = auth.xp_to_next_level
        xp_ratio   = max(0.0, min(1.0, auth.xp / xp_to_next))
        ctk.CTkLabel(parent, text=f"XP: {auth.xp:,} / {xp_to_next:,}",
                     font=ctk.CTkFont(size=11),
                     text_color=BRAND["text_muted"]).pack(anchor="w", pady=(0, 4))
        xp_bar = ctk.CTkProgressBar(parent, height=5, corner_radius=3,
                                     progress_color=BRAND["accent"],
                                     fg_color=BRAND["bg_hover"])
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
            parent, text="Sign Out", height=30, corner_radius=6,
            fg_color=BRAND["bg_hover"], hover_color=BRAND["border"],
            border_width=1, border_color=BRAND["border"],
            text_color=BRAND["text_muted"], font=ctk.CTkFont(size=12),
            command=_do_logout,
        ).pack(anchor="w")

    _rebuild_identity()

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

    # Game status card
    game_card  = _card(ov_right, "Game Status")
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

    # ── Match Lobby Card — hidden until monitor.current_match_id is set ───────
    # Always exists in layout (between game_card and mon_card); shown/hidden via pack.
    lobby_container = ctk.CTkFrame(ov_left, fg_color="transparent")
    lobby_container.pack(fill="x")

    lobby_outer = _card(lobby_container, "Match Lobby")

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

        if data is None:
            _cancel_completed_clear_timer()
            lobby_outer.pack_forget()
            return

        if not lobby_outer.winfo_ismapped():
            lobby_outer.pack(fill="x", padx=14, pady=(8, 0))

        code      = data.get("code") or "—"
        game_name = data.get("game") or "—"
        mode      = data.get("mode") or "—"
        your_team = (data.get("your_team") or "—").capitalize()
        status    = data.get("status") or ""

        # Info row
        info_row = ctk.CTkFrame(lobby_outer, fg_color="transparent")
        info_row.pack(fill="x", padx=14, pady=(0, 4))
        lobby_body_ref.append(info_row)

        ctk.CTkLabel(info_row,
                     text=f"Code: {code}  ·  {game_name}  ·  {mode}",
                     font=ctk.CTkFont(size=12, weight="bold"),
                     text_color=BRAND["text"]).pack(side="left")
        ctk.CTkLabel(info_row,
                     text=f"Team: {your_team}",
                     font=ctk.CTkFont(size=11),
                     text_color=BRAND["warning"]).pack(side="right")

        # Status chip
        status_colors = {
            "waiting":     BRAND["text_muted"],
            "starting":    BRAND["warning"],
            "in_progress": BRAND["accent"],
            "completed":   BRAND["text_muted"],
        }
        status_lbl = ctk.CTkLabel(lobby_outer,
                                   text=status.replace("_", " ").upper(),
                                   font=ctk.CTkFont(size=10),
                                   text_color=status_colors.get(status, BRAND["text_muted"]))
        status_lbl.pack(anchor="w", padx=14, pady=(0, 6))
        lobby_body_ref.append(status_lbl)

        # Human-readable state (match lifecycle — keep in sync with GET /match/active + heartbeat)
        ctx_map = {
            "waiting":     "Waiting for opponent",
            "starting":    "Waiting for opponent",
            "in_progress": "Match in progress — Arena is watching",
        }
        ctx = ctx_map.get(status, "")
        if ctx:
            ctx_lbl = ctk.CTkLabel(
                lobby_outer, text=ctx,
                font=ctk.CTkFont(size=11),
                text_color=BRAND["text"],
            )
            ctx_lbl.pack(anchor="w", padx=14, pady=(0, 6))
            lobby_body_ref.append(ctx_lbl)

        # Players split by team
        players = data.get("players") or []
        teams: dict[str, list[str]] = {}
        for p in players:
            t = (p.get("team") or "none").capitalize()
            teams.setdefault(t, []).append(
                p.get("username") or (p.get("user_id") or "?")[:8])

        if teams:
            teams_row = ctk.CTkFrame(lobby_outer, fg_color="transparent")
            teams_row.pack(fill="x", padx=14, pady=(0, 8))
            lobby_body_ref.append(teams_row)
            for team_name, members in teams.items():
                col = ctk.CTkFrame(teams_row, fg_color=BRAND["bg_hover"], corner_radius=4)
                col.pack(side="left", fill="x", expand=True, padx=(0, 4))
                ctk.CTkLabel(col, text=team_name,
                             font=ctk.CTkFont(size=10, weight="bold"),
                             text_color=BRAND["text_muted"]).pack(anchor="w", padx=8, pady=(4, 2))
                for m in members:
                    ctk.CTkLabel(col, text=f"· {m}",
                                 font=ctk.CTkFont(size=11),
                                 text_color=BRAND["text"]).pack(anchor="w", padx=8, pady=(0, 2))
                ctk.CTkLabel(col, text="").pack(pady=(0, 4))

        # Result banner — shown when match completed and result was fetched
        # TODO(Claude): confirm GET /match/{id}/status response shape.
        # Need 'result' (victory/defeat) and 'score' fields to display the banner.
        # Once confirmed, remove this comment.
        if result:
            res_val   = (result.get("result") or "").upper()
            score_val = result.get("score") or ""
            res_color = BRAND["warning"] if res_val == "VICTORY" else BRAND["accent"]
            tail = f"{res_val}" + (f" ({score_val})" if score_val else "")
            res_text = f"Match ended — result: {tail}"
            res_banner = ctk.CTkLabel(lobby_outer, text=res_text,
                                      font=ctk.CTkFont(size=13, weight="bold"),
                                      text_color=res_color)
            res_banner.pack(anchor="w", padx=14, pady=(0, 10))
            lobby_body_ref.append(res_banner)
        elif status == "completed":
            wait_lbl = ctk.CTkLabel(lobby_outer, text="Match ended — fetching result…",
                                     font=ctk.CTkFont(size=11),
                                     text_color=BRAND["text_muted"])
            wait_lbl.pack(anchor="w", padx=14, pady=(0, 10))
            lobby_body_ref.append(wait_lbl)

    # Monitoring toggle card
    mon_card = _card(ov_right, "Monitoring")
    mon_row  = ctk.CTkFrame(mon_card, fg_color="transparent")
    mon_row.pack(fill="x", padx=14, pady=(0, 6))

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

    def _ensure_monitor_for_live_match() -> None:
        """Server status in_progress — ensure watcher runs so match_id + /validate/screenshot work."""
        if not monitor.running:
            monitor.start()
            mon_var.set(True)
            mon_lbl.configure(text="ON", text_color=BRAND["accent"])

    cap_lbl = ctk.CTkLabel(mon_row, text="0 captures",
                            font=ctk.CTkFont(size=10),
                            text_color=BRAND["text_muted"])
    cap_lbl.pack(side="right")

    # Screenshot thumbnail row
    thumb_row = ctk.CTkFrame(mon_card, fg_color="transparent")
    thumb_row.pack(fill="x", padx=14, pady=(0, 12))
    thumb_img_lbl = ctk.CTkLabel(thumb_row, text="No screenshot yet",
                                  font=ctk.CTkFont(size=10),
                                  text_color=BRAND["text_muted"])
    thumb_img_lbl.pack(side="left")
    _last_shown_fp: list[str | None] = [None]

    ctk.CTkLabel(ov_left, text="", height=10).pack()

    # ── EVENTS TAB ────────────────────────────────────────────────────────────
    ev = ctk.CTkFrame(tab_ev, fg_color="transparent", corner_radius=0)
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

    def _check_engine_btn():
        threading.Thread(target=_do_engine_check, daemon=True).start()

    _hud_button(btn_row, "CHECK ENGINE", _check_engine_btn, variant="neutral", height=40, min_width=160).pack(side="left", padx=8, pady=10)
    _hud_button(btn_row, "WEBSITE", _open_website, variant="neutral", height=40, min_width=140).pack(side="left", padx=8, pady=10)
    _hud_button(btn_row, "QUIT", _quit_app, variant="danger", height=40, min_width=140).pack(side="left", padx=8, pady=10)

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
            if st_hb == "completed":
                _schedule_completed_lobby_clear(clear_mid)

            if data.get("status") == "completed" and _lobby_result_cache[0] is None:
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
        base = (self.config.get("frontend_url") or "http://localhost:3000").rstrip("/")
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
