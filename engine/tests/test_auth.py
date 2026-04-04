"""
Tests for Phase 3 Auth routes:
  POST /auth/register
  POST /auth/login
  GET  /auth/me

And Phase 4 Match-gating routes:
  POST /matches
  POST /matches/{match_id}/join

Strategy: mock SessionLocal so no real DB is needed.
All auth utility functions (hash_password, verify_password, issue_token,
decode_token, validate_steam_id, validate_riot_id) are tested independently
— no mocking needed there.
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


FAKE_UUID     = str(uuid.uuid4())
FAKE_ARENA_ID = "ARENA-TST001"

# Valid game account IDs used across tests
VALID_STEAM_ID = "76561198000000001"
VALID_RIOT_ID  = "Player#1234"


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

    # ── Game account format validators ────────────────────────────────────────

    def test_validate_steam_id_valid(self):
        assert auth.validate_steam_id("76561198000000001") is None
        assert auth.validate_steam_id("76561199000000001") is None

    def test_validate_steam_id_too_short(self):
        assert auth.validate_steam_id("123456") is not None

    def test_validate_steam_id_wrong_prefix(self):
        assert auth.validate_steam_id("12345678901234567") is not None  # 17 digits but wrong prefix

    def test_validate_steam_id_with_whitespace_passes(self):
        """Leading/trailing whitespace is stripped before validation."""
        assert auth.validate_steam_id("  76561198000000001  ") is None

    def test_validate_riot_id_valid(self):
        assert auth.validate_riot_id("Player#1234") is None
        assert auth.validate_riot_id("ABC#XY1") is None
        assert auth.validate_riot_id("LongName16Char#ABC") is None

    def test_validate_riot_id_missing_hash(self):
        assert auth.validate_riot_id("NoHashHere") is not None

    def test_validate_riot_id_tag_too_long(self):
        assert auth.validate_riot_id("Player#TOOLONG") is not None   # TAG > 5 chars

    def test_validate_riot_id_name_too_short(self):
        assert auth.validate_riot_id("AB#123") is not None   # name < 3 chars


# ─── POST /auth/register ──────────────────────────────────────────────────────

class TestRegister:
    def test_register_success_returns_201_and_token(self):
        ctx, session = _make_session_mock()
        # Flow: email check → username check → steam_id check → INSERT RETURNING
        session.execute.return_value.fetchone.side_effect = [
            None,   # email duplicate check
            None,   # username duplicate check
            None,   # steam_id duplicate check
            (FAKE_UUID, "newuser", "new@arena.gg", FAKE_ARENA_ID),  # INSERT RETURNING
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "newuser",
                "email": "new@arena.gg",
                "password": "password123",
                "steam_id": VALID_STEAM_ID,
            })
        assert resp.status_code == 201
        data = resp.json()
        assert "access_token" in data
        assert data["username"] == "newuser"
        assert data["email"] == "new@arena.gg"   # stored lowercase
        assert data["token_type"] == "bearer"

    def test_register_email_normalized_to_lowercase(self):
        """Email is always stored lowercase regardless of input case."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            None,   # email duplicate check
            None,   # username duplicate check
            None,   # steam_id duplicate check
            (FAKE_UUID, "user", "user@arena.gg", FAKE_ARENA_ID),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "user",
                "email": "User@Arena.GG",   # mixed case input
                "password": "password123",
                "steam_id": VALID_STEAM_ID,
            })
        assert resp.status_code == 201
        assert resp.json()["email"] == "user@arena.gg"

    def test_register_duplicate_email_returns_409(self):
        """Duplicate email → 409 with specific message."""
        ctx, session = _make_session_mock(fetchone_return=(FAKE_UUID,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "newname",
                "email": "taken@arena.gg",
                "password": "password123",
                "steam_id": VALID_STEAM_ID,
            })
        assert resp.status_code == 409
        assert "email" in resp.json()["detail"].lower()

    def test_register_duplicate_username_returns_409(self):
        """Duplicate username → 409 with specific message."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            None,          # email check passes
            (FAKE_UUID,),  # username already taken → 409 before steam check
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "takenname",
                "email": "new@arena.gg",
                "password": "password123",
                "steam_id": VALID_STEAM_ID,
            })
        assert resp.status_code == 409
        assert "username" in resp.json()["detail"].lower()

    def test_register_duplicate_steam_id_returns_409(self):
        """Duplicate steam_id → 409 with specific message."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            None,          # email check passes
            None,          # username check passes
            (FAKE_UUID,),  # steam_id already linked
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "newuser",
                "email": "new@arena.gg",
                "password": "password123",
                "steam_id": VALID_STEAM_ID,
            })
        assert resp.status_code == 409
        assert "steam" in resp.json()["detail"].lower()

    def test_register_duplicate_riot_id_returns_409(self):
        """Duplicate riot_id → 409 with specific message.
        steam_id not provided → its check is skipped → riot_id is the 3rd fetchone."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            None,          # email check passes
            None,          # username check passes
            # steam_id check SKIPPED (not in request)
            (FAKE_UUID,),  # riot_id already linked
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "newuser",
                "email": "new@arena.gg",
                "password": "password123",
                "riot_id": VALID_RIOT_ID,
            })
        assert resp.status_code == 409
        assert "riot" in resp.json()["detail"].lower()

    def test_register_duplicate_returns_409(self):
        """Legacy test — any duplicate returns 409."""
        ctx, session = _make_session_mock(
            fetchone_return=(FAKE_UUID,)  # email check hits immediately
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "existing",
                "email": "existing@arena.gg",
                "password": "password123",
                "steam_id": VALID_STEAM_ID,
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
                "steam_id": VALID_STEAM_ID,
            })
        assert resp.status_code == 500

    def test_register_missing_field_returns_422(self):
        """Missing required fields (email, password) → 422."""
        resp = client.post("/auth/register", json={"username": "nopass"})
        assert resp.status_code == 422

    # ── New: game account requirement ─────────────────────────────────────────

    def test_register_no_game_account_returns_422(self):
        """Registration without steam_id AND riot_id must return 422."""
        resp = client.post("/auth/register", json={
            "username": "newuser",
            "email": "new@arena.gg",
            "password": "password123",
            # intentionally omitting both steam_id and riot_id
        })
        assert resp.status_code == 422

    def test_register_invalid_steam_id_returns_422(self):
        """Invalid Steam ID format must be rejected before hitting the DB."""
        resp = client.post("/auth/register", json={
            "username": "newuser",
            "email": "new@arena.gg",
            "password": "password123",
            "steam_id": "12345",  # too short, wrong prefix
        })
        assert resp.status_code == 422

    def test_register_invalid_riot_id_returns_422(self):
        """Invalid Riot ID format (missing #TAG) must be rejected before hitting the DB."""
        resp = client.post("/auth/register", json={
            "username": "newuser",
            "email": "new@arena.gg",
            "password": "password123",
            "riot_id": "NoHashHere",
        })
        assert resp.status_code == 422

    def test_register_valid_riot_id_only_accepted(self):
        """riot_id alone (without steam_id) satisfies the game account requirement."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            None,   # email duplicate check
            None,   # username duplicate check
            None,   # riot_id duplicate check (steam_id check skipped)
            (FAKE_UUID, "user", "user@arena.gg", FAKE_ARENA_ID),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/register", json={
                "username": "user",
                "email": "user@arena.gg",
                "password": "password123",
                "riot_id": VALID_RIOT_ID,
            })
        assert resp.status_code == 201


    def test_register_insert_includes_at_balance_200(self):
        """
        The INSERT INTO users statement must include at_balance=200.
        We verify by inspecting the SQL string sent to the DB mock.
        """
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            None,   # email duplicate check
            None,   # username duplicate check
            None,   # steam_id duplicate check
            (FAKE_UUID, "newuser", "new@arena.gg", FAKE_ARENA_ID),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            client.post("/auth/register", json={
                "username": "newuser",
                "email": "new@arena.gg",
                "password": "password123",
                "steam_id": VALID_STEAM_ID,
            })
        # Find the INSERT call and assert it sets at_balance = 200
        insert_calls = [
            str(call_args[0][0])
            for call_args in session.execute.call_args_list
            if "INSERT INTO users" in str(call_args[0][0])
        ]
        assert insert_calls, "No INSERT INTO users call found"
        assert "at_balance" in insert_calls[0]
        assert "200" in insert_calls[0]


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

    def _db_profile_row(self, at_balance: int = 200):
        # Columns: id, username, email, arena_id, rank, wallet_address,
        #          steam_id, riot_id,
        #          xp, wins, losses, avatar, avatar_bg, equipped_badge_icon,
        #          forge_unlocked_item_ids, vip_expires_at, at_balance
        return (FAKE_UUID, "daniel", "daniel@arena.gg", FAKE_ARENA_ID,
                "Gold", "0xABC", None, None,
                1500, 42, 10,
                "preset:warrior", "red", "badge:champion",
                ["item-001", "item-002"], None, at_balance)

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

    def test_me_returns_at_balance(self):
        """GET /auth/me always includes at_balance (int)."""
        ctx, _ = _make_session_mock(fetchone_return=self._db_profile_row(at_balance=200))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/auth/me", headers=self._auth_header())
        assert resp.status_code == 200
        data = resp.json()
        assert "at_balance" in data
        assert data["at_balance"] == 200

    def test_me_at_balance_is_int(self):
        """at_balance must be an integer, never null."""
        ctx, _ = _make_session_mock(fetchone_return=self._db_profile_row(at_balance=0))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/auth/me", headers=self._auth_header())
        data = resp.json()
        assert type(data["at_balance"]) is int


# ─── PATCH /users/me ──────────────────────────────────────────────────────────

class TestPatchUserMe:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _db_profile_row(self):
        # id, username, email, arena_id, rank, wallet_address, steam_id, riot_id,
        # xp, wins, losses, avatar, avatar_bg, equipped_badge_icon,
        # forge_unlocked_item_ids, vip_expires_at, at_balance
        return (FAKE_UUID, "daniel", "daniel@arena.gg", FAKE_ARENA_ID,
                "Gold", "0xABC", None, None,
                10, 3, 1,
                "preset:warrior", "blue", "badge:pro",
                ["item-001"], None, 200)

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


# ─── POST /matches  &  POST /matches/{id}/join ────────────────────────────────

class TestMatchGating:
    """
    Game-account gate: CS2 requires steam_id, Valorant requires riot_id.
    All checks happen in the backend before any DB write.
    """

    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    # ── Helper user rows (steam_id, riot_id, wallet_address) ─────────────────
    def _user_steam(self):          return (VALID_STEAM_ID, None,           "0xABC")
    def _user_riot(self):           return (None,           VALID_RIOT_ID,  "0xABC")
    def _user_none(self):           return (None,           None,           "0xABC")
    def _user_steam_no_wallet(self):return (VALID_STEAM_ID, None,           None)

    # ── POST /matches ─────────────────────────────────────────────────────────

    def test_create_cs2_match_with_steam_returns_201(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_steam(),  # user lookup
            (match_id,),         # INSERT matches RETURNING id
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 201
        assert resp.json()["game"] == "CS2"
        assert resp.json()["status"] == "waiting"

    def test_create_cs2_match_without_steam_returns_403(self):
        ctx, session = _make_session_mock(fetchone_return=self._user_none())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 403
        assert "steam" in resp.json()["detail"].lower()

    def test_create_valorant_match_with_riot_returns_201(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_riot(),  # user lookup
            (match_id,),        # INSERT matches RETURNING id
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "Valorant"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 201
        assert resp.json()["game"] == "Valorant"

    def test_create_valorant_match_without_riot_returns_403(self):
        ctx, session = _make_session_mock(fetchone_return=self._user_none())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "Valorant"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 403
        assert "riot" in resp.json()["detail"].lower()

    def test_create_match_invalid_game_returns_400(self):
        ctx, session = _make_session_mock(fetchone_return=self._user_steam())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "Fortnite"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 400

    def test_create_match_no_token_returns_422(self):
        resp = client.post("/matches", json={"game": "CS2"})
        assert resp.status_code == 422

    # ── POST /matches/{match_id}/join ─────────────────────────────────────────

    def test_join_cs2_match_with_steam_returns_200(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting"),      # match lookup
            self._user_steam(),      # user lookup
            None,                    # already-joined check → not joined yet
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["joined"] is True

    def test_join_cs2_match_without_steam_returns_403(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting"),  # match lookup
            self._user_none(),   # user lookup → no steam_id → 403
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                headers=self._auth_header(),
            )
        assert resp.status_code == 403
        assert "steam" in resp.json()["detail"].lower()

    def test_join_valorant_match_without_riot_returns_403(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("Valorant", "waiting"),  # match lookup
            self._user_none(),         # user lookup → no riot_id → 403
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                headers=self._auth_header(),
            )
        assert resp.status_code == 403
        assert "riot" in resp.json()["detail"].lower()

    def test_join_match_not_found_returns_404(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_join_match_not_waiting_returns_409(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "in_progress"),  # match is already started → 409
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_join_match_already_joined_returns_409(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting"),   # match lookup
            self._user_steam(),   # user lookup
            (1,),                 # already-joined check → duplicate
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_join_match_no_token_returns_422(self):
        resp = client.post(f"/matches/{uuid.uuid4()}/join")
        assert resp.status_code == 422

    def test_join_without_wallet_returns_400(self):
        """Server rejects join when the user has no linked wallet_address."""
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting"),         # match lookup
            self._user_steam_no_wallet(),  # user has steam but no wallet
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                headers=self._auth_header(),
            )
        assert resp.status_code == 400
        assert "wallet" in resp.json()["detail"].lower()
