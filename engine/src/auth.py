"""
ARENA Engine — Auth utilities: password hashing, JWT issue/verify,
and game-account format validators.

DB-ready: tokens carry user_id (sub) + email for lookup in users table.
CONTRACT-ready: user_id will be cross-referenced with wallet_address for escrow ops.
"""
from __future__ import annotations

import random
import re
import string
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt

from src.config import API_SECRET

# ── Constants ─────────────────────────────────────────────────────────────────
_JWT_SECRET: str = API_SECRET
_JWT_ALGORITHM: str = "HS256"
_JWT_EXPIRY_HOURS: int = 24 * 7   # 7 days — refresh not needed at this stage
_JWT_2FA_PENDING_MINS: int = 5    # short-lived token after password OK, before TOTP


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*. Always store this — never the plaintext."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str | None) -> bool:
    """Return True if *plain* matches the stored *hashed* bcrypt password."""
    if not hashed:
        return False
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ── JWT helpers ───────────────────────────────────────────────────────────────

def issue_token(user_id: str, email: str, username: str = "") -> str:
    """
    Issue a signed JWT for the given user.

    Payload:
      sub        — user UUID (PK in users table)
      email      — for display / quick lookup
      username   — display name; included so the UI can show it immediately
                   on refresh before /auth/me finishes loading, preventing
                   the UUID flash where username briefly shows as the raw sub.
      token_use  — "access" (default) — required for protected routes
      iat        — issued-at timestamp
      exp        — expiry (7 days from now)
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub":        user_id,
        "email":      email,
        "username":   username,
        "token_use":  "access",
        "iat":        now,
        "exp":        now + timedelta(hours=_JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def issue_2fa_pending_token(user_id: str) -> str:
    """
    Short-lived JWT after password verification when totp_enabled is true.
    Must be exchanged via POST /auth/2fa/confirm for a full access token.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub":        user_id,
        "token_use":  "2fa_pending",
        "iat":        now,
        "exp":        now + timedelta(minutes=_JWT_2FA_PENDING_MINS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Decode and verify a JWT.

    Raises:
      jwt.ExpiredSignatureError  — token is expired
      jwt.InvalidTokenError      — signature invalid / malformed
    """
    data = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])
    # Legacy tokens issued before token_use was added — treat as full access
    if "token_use" not in data:
        data["token_use"] = "access"
    return data


# ── Game account format validators ───────────────────────────────────────────

# Steam64 IDs are always exactly 17 digits and start with 7656119
_STEAM_ID_RE = re.compile(r'^7656119\d{10}$')

# Riot ID: "Name#TAG"  —  3-16 non-# chars, then #, then 3-5 alphanumeric chars
_RIOT_ID_RE = re.compile(r'^[^#]{3,16}#[A-Za-z0-9]{3,5}$')


def validate_steam_id(steam_id: str) -> str | None:
    """
    Validate a Steam64 ID string.

    Returns an error message if the format is wrong, None if it is valid.
    Checks format only — does not verify account ownership (Steam OpenID needed
    for that; planned for a future phase).
    """
    if not _STEAM_ID_RE.match(steam_id.strip()):
        return (
            "Steam ID must be a 17-digit number starting with 7656119 "
            "(e.g. 76561198000000001)"
        )
    return None


def validate_riot_id(riot_id: str) -> str | None:
    """
    Validate a Riot ID string (Name#TAG format).

    Returns an error message if the format is wrong, None if it is valid.
    Checks format only — Riot API verification is planned for a future phase.
    """
    if not _RIOT_ID_RE.match(riot_id.strip()):
        return "Riot ID must be in the format Name#TAG (e.g. Player#1234)"
    return None


# ── Arena ID ──────────────────────────────────────────────────────────────────

def generate_arena_id() -> str:
    """
    Generate a candidate public Arena ID string: ARENA-XXXXXX.
    The DB trigger (trg_set_arena_id) also auto-generates this on INSERT,
    but we pass an explicit value so the response can include it immediately.
    Uniqueness is enforced by the UNIQUE constraint on users.arena_id.
    """
    chars = string.ascii_uppercase + string.digits
    suffix = "".join(random.choices(chars, k=6))
    return f"ARENA-{suffix}"
