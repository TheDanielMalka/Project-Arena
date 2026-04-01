"""
Tests for Phase 3 Auth routes:
  POST /auth/register
  POST /auth/login
  GET  /auth/me

Strategy: mock SessionLocal so no real DB is needed.
All auth utility functions (hash_password, verify_password, issue_token,
decode_token) are tested independently — no mocking needed there.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_session_mock(fetchone_return=None):
    """Return a context-manager-compatible SQLAlchemy session mock."""
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = fetchone_return
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx, session


FAKE_UUID = str(uuid.uuid4())
FAKE_ARENA_ID = "ARENA-TST001"


# ─── Unit tests: auth utilities ────────────────────────────────────────────────

class TestAuthUtils:
    def test_hash_and_verify_password(self):
        hashed = auth.hash_password("secret123")
        assert auth.verify_password("secret123", hashed) is True

    def test_wrong_password_fails(self):
        hashed = auth.hash_password("secret123")
        assert auth.verify_password("wrong", hashed) is False

    def test_issue_and_decode_token(self):
        token = auth.issue_token(FAKE_UUID, "test@arena.gg")
        payload = auth.decode_token(token)
        assert payload["sub"] == FAKE_UUID
        assert payload["email"] == "test@arena.gg"

    def test_expired_token_raises(self):
        import jwt
        from datetime import datetime, timezone, timedelta
        from src.config import API_SECRET
        expired_payload = {
            "sub": FAKE_UUID,
            "email": "x@x.com",
            "iat": datetime.now(timezone.utc) - timedelta(hours=200),
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        token = jwt.encode(expired_payload, API_SECRET, algorithm="HS256")
        with pytest.raises(jwt.ExpiredSignatureError):
            auth.decode_token(token)

    def test_generate_arena_id_format(self):
        arena_id = auth.generate_arena_id()
        assert arena_id.startswith("ARENA-")
        assert len(arena_id) == 12   # "ARENA-" (6) + 6 chars


# ─── POST /auth/register ──────────────────────────────────────────────────────

class TestRegister:
    def test_register_success_returns_201_and_token(self):
        ctx, session = _make_session_mock()
        # First call: duplicate check → None (no existing user)
        # Second call: INSERT RETURNING → fake row
        session.execute.return_value.fetchone.side_effect = [
            None,   # duplicate check
            (FAKE_UUID, "newuser", "new@arena.gg", FAKE_ARENA_ID),  # INSERT
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "newuser",
                "email": "new@arena.gg",
                "password": "password123",
            })
        assert resp.status_code == 201
        data = resp.json()
        assert "access_token" in data
        assert data["username"] == "newuser"
        assert data["email"] == "new@arena.gg"
        assert data["token_type"] == "bearer"

    def test_register_duplicate_returns_409(self):
        ctx, session = _make_session_mock(
            fetchone_return=(FAKE_UUID,)  # user already exists
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "existing",
                "email": "existing@arena.gg",
                "password": "password123",
            })
        assert resp.status_code == 409

    def test_register_db_error_returns_500(self):
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(side_effect=Exception("DB down"))
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "user",
                "email": "user@arena.gg",
                "password": "pass",
            })
        assert resp.status_code == 500

    def test_register_missing_field_returns_422(self):
        resp = client.post("/auth/register", json={"username": "nopass"})
        assert resp.status_code == 422


# ─── POST /auth/login ─────────────────────────────────────────────────────────

class TestLogin:
    def _db_user_row(self, password: str = "password123"):
        pw_hash = auth.hash_password(password)
        # Columns: id, username, email, password_hash, arena_id, wallet_address
        return (FAKE_UUID, "daniel", "daniel@arena.gg", pw_hash, FAKE_ARENA_ID, "0xDeAdBeEf")

    def test_login_by_email_success(self):
        ctx, session = _make_session_mock(fetchone_return=self._db_user_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/login", json={
                "identifier": "daniel@arena.gg",
                "password": "password123",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["username"] == "daniel"

    def test_login_by_username_success(self):
        ctx, session = _make_session_mock(fetchone_return=self._db_user_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/login", json={
                "identifier": "daniel",
                "password": "password123",
            })
        assert resp.status_code == 200

    def test_login_wrong_password_returns_401(self):
        ctx, _ = _make_session_mock(fetchone_return=self._db_user_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/login", json={
                "identifier": "daniel@arena.gg",
                "password": "wrongpass",
            })
        assert resp.status_code == 401

    def test_login_unknown_user_returns_401(self):
        ctx, _ = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/login", json={
                "identifier": "ghost@arena.gg",
                "password": "pass",
            })
        assert resp.status_code == 401


# ─── GET /auth/me ─────────────────────────────────────────────────────────────

class TestMe:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _db_profile_row(self):
        # Columns: id, username, email, arena_id, rank, wallet_address,
        #          xp, wins, losses, avatar, avatar_bg, equipped_badge_icon,
        #          forge_unlocked_item_ids, vip_expires_at
        return (FAKE_UUID, "daniel", "daniel@arena.gg", FAKE_ARENA_ID,
                "Gold", "0xABC", 1500, 42, 10,
                "preset:warrior", "red", "badge:champion",
                ["item-001", "item-002"], None)

    def test_me_returns_profile(self):
        ctx, _ = _make_session_mock(fetchone_return=self._db_profile_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/auth/me", headers=self._auth_header())
        assert resp.status_code == 200
        data = resp.json()
        assert data["username"] == "daniel"
        assert data["xp"] == 1500
        assert data["wins"] == 42
        assert data["avatar"] == "preset:warrior"
        assert data["equipped_badge_icon"] == "badge:champion"
        assert data["forge_unlocked_item_ids"] == ["item-001", "item-002"]
        assert data["vip_expires_at"] is None

    def test_me_no_token_returns_422(self):
        resp = client.get("/auth/me")
        assert resp.status_code == 422

    def test_me_invalid_token_returns_401(self):
        resp = client.get("/auth/me", headers={"Authorization": "Bearer badtoken"})
        assert resp.status_code == 401

    def test_me_user_not_found_returns_404(self):
        ctx, _ = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/auth/me", headers=self._auth_header())
        assert resp.status_code == 404


# ─── PATCH /users/me ──────────────────────────────────────────────────────────

class TestPatchUserMe:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _db_profile_row(self):
        return (FAKE_UUID, "daniel", "daniel@arena.gg", FAKE_ARENA_ID,
                "Gold", "0xABC", 10, 3, 1,
                "preset:warrior", "blue", "badge:pro",
                ["item-001"], None)

    def test_patch_avatar_returns_200(self):
        ctx, session = _make_session_mock(fetchone_return=self._db_profile_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                "/users/me",
                json={"avatar": "preset:ninja"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        # UPDATE was called
        assert session.execute.call_count >= 1

    def test_patch_badge_returns_200(self):
        ctx, _ = _make_session_mock(fetchone_return=self._db_profile_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                "/users/me",
                json={"equipped_badge_icon": "badge:legend"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200

    def test_patch_forge_items_returns_200(self):
        ctx, _ = _make_session_mock(fetchone_return=self._db_profile_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                "/users/me",
                json={"forge_unlocked_item_ids": ["item-001", "item-005"]},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200

    def test_patch_empty_body_returns_200(self):
        """Empty patch is valid — returns current profile without DB write."""
        ctx, session = _make_session_mock(fetchone_return=self._db_profile_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch("/users/me", json={}, headers=self._auth_header())
        assert resp.status_code == 200

    def test_patch_no_token_returns_422(self):
        resp = client.patch("/users/me", json={"avatar": "preset:ninja"})
        assert resp.status_code == 422


# ─── POST /match/result ───────────────────────────────────────────────────────

class TestSubmitResult:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _result_payload(self) -> dict:
        return {
            "match_id": str(uuid.uuid4()),
            "winner_id": str(uuid.uuid4()),
            "game": "CS2",
            "players_detected": ["player1", "player2"],
            "agents_detected": [],
            "ocr_confidence": 0.95,
            "score": "13-7",
        }

    def test_submit_result_returns_accepted(self):
        ctx, _ = _make_session_mock()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/match/result",
                json=self._result_payload(),
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["accepted"] is True
        assert data["message"] == "Result recorded"

    def test_submit_result_db_error_still_returns_accepted(self):
        """DB failure is non-fatal — client should not retry endlessly."""
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(side_effect=Exception("db down"))
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/match/result",
                json=self._result_payload(),
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["accepted"] is True

    def test_submit_result_no_token_returns_422(self):
        resp = client.post("/match/result", json=self._result_payload())
        assert resp.status_code == 422
