"""
ARENA Engine — Auth utilities: password hashing and JWT issue/verify.

DB-ready: tokens carry user_id (sub) + email for lookup in users table.
CONTRACT-ready: user_id will be cross-referenced with wallet_address for escrow ops.
"""
from __future__ import annotations

import random
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


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*. Always store this — never the plaintext."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches the stored *hashed* bcrypt password."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ── JWT helpers ───────────────────────────────────────────────────────────────

def issue_token(user_id: str, email: str) -> str:
    """
    Issue a signed JWT for the given user.

    Payload:
      sub   — user UUID (PK in users table)
      email — for display / quick lookup
      iat   — issued-at timestamp
      exp   — expiry (7 days from now)
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(hours=_JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Decode and verify a JWT.

    Raises:
      jwt.ExpiredSignatureError  — token is expired
      jwt.InvalidTokenError      — signature invalid / malformed
    """
    return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])


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
