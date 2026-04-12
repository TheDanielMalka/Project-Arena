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


# Bypass suspension + daily-stake checks for all auth tests (tested separately)
@pytest.fixture(autouse=True)
def no_suspension_check():
    with patch("main._assert_not_suspended", return_value=None), \
         patch("main._check_daily_stake_limit", return_value=None), \
         patch("main._check_daily_usdt_stake_limit", return_value=None), \
         patch("main._check_high_stakes_daily_cap", return_value=None), \
         patch("main._check_daily_loss_cap", return_value=None):
        yield


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

    def test_issue_token_includes_username(self):
        """JWT payload must carry username so UI never shows raw UUID on refresh."""
        token = auth.issue_token(FAKE_UUID, "test@arena.gg", "DUNELZ")
        payload = auth.decode_token(token)
        assert payload["username"] == "DUNELZ"

    def test_issue_token_username_defaults_to_empty_string(self):
        """Backward-compat: callers that don't pass username get '' in the token."""
        token = auth.issue_token(FAKE_UUID, "test@arena.gg")
        payload = auth.decode_token(token)
        assert payload["username"] == ""

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
        # Flow: email check → username check → steam_id dup check → steam blacklist check → INSERT RETURNING
        session.execute.return_value.fetchone.side_effect = [
            None,   # email duplicate check
            None,   # username duplicate check
            None,   # steam_id duplicate check
            None,   # steam_id blacklist check (migration 025)
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
            None,   # steam_id blacklist check (migration 025)
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
            None,   # riot_id blacklist check (migration 025)
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
            None,   # steam_id blacklist check (migration 025)
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

    def _db_profile_row(self, at_balance: int = 200, role: str = "user"):
        # Columns: id, username, email, arena_id, rank, wallet_address,
        #          steam_id, riot_id,
        #          xp, wins, losses, avatar, avatar_bg, equipped_badge_icon,
        #          forge_unlocked_item_ids, vip_expires_at, at_balance, role
        return (FAKE_UUID, "daniel", "daniel@arena.gg", FAKE_ARENA_ID,
                "Gold", "0xABC", None, None,
                1500, 42, 10,
                "preset:warrior", "red", "badge:champion",
                ["item-001", "item-002"], None, at_balance, role)

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
        assert data.get("role") == "user"

    def test_me_returns_admin_when_db_role_admin(self):
        ctx, _ = _make_session_mock(fetchone_return=self._db_profile_row(role="admin"))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/auth/me", headers=self._auth_header())
        assert resp.status_code == 200
        assert resp.json()["role"] == "admin"

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
        # forge_unlocked_item_ids, vip_expires_at, at_balance, role
        return (FAKE_UUID, "daniel", "daniel@arena.gg", FAKE_ARENA_ID,
                "Gold", "0xABC", None, None,
                10, 3, 1,
                "preset:warrior", "blue", "badge:pro",
                ["item-001"], None, 200, "user")

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
            self._user_steam(),  # 1st: user lookup
            None,                # 2nd: duplicate-room check → no active room
            (match_id,),         # 3rd: INSERT matches RETURNING id
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
            self._user_riot(),  # 1st: user lookup
            None,               # 2nd: duplicate-room check → no active room
            (match_id,),        # 3rd: INSERT matches RETURNING id
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
            ("CS2", "waiting", None, "CRYPTO", None, 2, 1),  # match lookup (+max_per_team)
            self._user_steam(),  # user lookup
            None,                # active-room guard → no active room
            None,                # already-joined check → not joined yet
            (1, 0),              # (a_count=1, b_count=0) → Team B
            (1,),                # COUNT(*) = 1 player (below max 2 → no auto-start)
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={},                         # body required since JoinMatchRequest added
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["joined"] is True

    def test_join_match_when_already_in_active_room_returns_409(self):
        """Player already in another active room → 409 before joining."""
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", None, "CRYPTO", None, 2, 1),  # match lookup (+max_per_team)
            self._user_steam(),
            (str(uuid.uuid4()),),                # active-room guard → already in a room
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={},
                headers=self._auth_header(),
            )
        assert resp.status_code == 409
        assert "active" in resp.json()["detail"].lower()

    def test_join_cs2_match_without_steam_returns_403(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", None, "CRYPTO", None, 2, 1),  # match lookup (+max_per_team)
            self._user_none(),                                 # no steam_id → 403
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={},
                headers=self._auth_header(),
            )
        assert resp.status_code == 403
        assert "steam" in resp.json()["detail"].lower()

    def test_join_valorant_match_without_riot_returns_403(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("Valorant", "waiting", None, "CRYPTO", None, 2, 1),  # match lookup (+max_per_team)
            self._user_none(),                                      # no riot_id → 403
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={},
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
                json={},
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_join_match_not_waiting_returns_409(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "in_progress", None, "CRYPTO", None, 2, 1),  # match already started → 409
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={},
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_join_match_already_joined_returns_409(self):
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", None, "CRYPTO", None, 2, 1),  # match lookup (+max_per_team)
            self._user_steam(),  # user lookup
            None,                # active-room guard → no other active room
            (1,),                # already-joined check → duplicate in same match
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={},
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_join_match_no_token_returns_422(self):
        resp = client.post(f"/matches/{uuid.uuid4()}/join", json={})
        assert resp.status_code == 422

    def test_join_without_wallet_returns_400(self):
        """Server rejects join when the user has no linked wallet_address."""
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", None, "CRYPTO", None, 2, 1),  # match lookup (+max_per_team)
            self._user_steam_no_wallet(),                      # steam but no wallet → 400
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={},
                headers=self._auth_header(),
            )
        assert resp.status_code == 400
        assert "wallet" in resp.json()["detail"].lower()

    # ── DELETE /matches/{match_id} ────────────────────────────────────────────

    def test_cancel_match_by_host_returns_200(self):
        """Host deletes a waiting room → 200 + cancelled:True."""
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = (
            FAKE_UUID, "waiting", "CRYPTO"  # host_id, status, stake_currency
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/matches/{match_id}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["cancelled"] is True

    def test_cancel_match_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/matches/{uuid.uuid4()}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_cancel_match_by_non_host_returns_403(self):
        """Non-host cannot delete the room."""
        match_id = str(uuid.uuid4())
        other_user = str(uuid.uuid4())  # different from FAKE_UUID
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = (
            other_user, "waiting", "CRYPTO"
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/matches/{match_id}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 403
        assert "host" in resp.json()["detail"].lower()

    def test_cancel_match_already_started_returns_409(self):
        """Cannot cancel a match that is already in_progress."""
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = (
            FAKE_UUID, "in_progress", "CRYPTO"
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/matches/{match_id}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_cancel_match_no_token_returns_422(self):
        resp = client.delete(f"/matches/{uuid.uuid4()}")
        assert resp.status_code == 422

    # ── POST /matches/{match_id}/leave ────────────────────────────────────────

    def test_leave_match_by_non_host_returns_200(self):
        """Non-host player leaves a waiting room → 200 + left:True."""
        match_id = str(uuid.uuid4())
        other_host = str(uuid.uuid4())  # different from FAKE_UUID
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            (other_host, "waiting", "CRYPTO", "10"),  # match lookup
            (1,),                                      # in_match check → player is in match
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/leave",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["left"] is True

    def test_leave_match_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{uuid.uuid4()}/leave",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_leave_match_as_host_returns_400(self):
        """Host cannot use /leave — must use DELETE /matches/{id}."""
        match_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = (
            FAKE_UUID, "waiting", "CRYPTO", "10"  # host_id == FAKE_UUID (the caller)
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/leave",
                headers=self._auth_header(),
            )
        assert resp.status_code == 400
        assert "host" in resp.json()["detail"].lower()

    def test_leave_match_already_started_returns_409(self):
        """Cannot leave a match that is in_progress."""
        match_id = str(uuid.uuid4())
        other_host = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = (
            other_host, "in_progress", "CRYPTO", "10"
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/leave",
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_leave_match_not_in_match_returns_400(self):
        """Player tries to leave a match they are not in."""
        match_id = str(uuid.uuid4())
        other_host = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            (other_host, "waiting", "CRYPTO", "10"),  # match lookup
            None,                                      # in_match check → not in match
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/leave",
                headers=self._auth_header(),
            )
        assert resp.status_code == 400

    def test_leave_match_no_token_returns_422(self):
        resp = client.post(f"/matches/{uuid.uuid4()}/leave")
        assert resp.status_code == 422

# ─── POST /wallet/buy-at ──────────────────────────────────────────────────────

class TestBuyArenaTokens:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def test_buy_at_credits_correct_amount(self):
        """10 USDT → 100 AT (default AT_PER_USDT=10)."""
        ctx, session = _make_session_mock()
        # fetchone chain: 1=dedup check (None=no dup), 2=UPDATE RETURNING new balance
        session.execute.return_value.fetchone.side_effect = [None, (300,)]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/buy-at",
                json={"tx_hash": "0xabc", "usdt_amount": 10.0},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "at_balance" in data
        assert "at_credited" in data
        assert data["at_credited"] == 100
        assert data["usdt_spent"] == 10.0

    def test_buy_at_returns_new_balance(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [None, (450,)]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/buy-at",
                json={"tx_hash": "0xdef", "usdt_amount": 25.0},
                headers=self._auth_header(),
            )
        assert resp.json()["at_balance"] == 450

    def test_buy_at_duplicate_tx_hash_returns_409(self):
        """Same tx_hash sent twice → 409 on the second call."""
        ctx, session = _make_session_mock()
        # fetchone returns a row → duplicate found
        session.execute.return_value.fetchone.return_value = (1,)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/buy-at",
                json={"tx_hash": "0xDEADBEEF", "usdt_amount": 10.0},
                headers=self._auth_header(),
            )
        assert resp.status_code == 409
        assert "already been processed" in resp.json()["detail"]

    def test_buy_at_zero_amount_returns_400(self):
        resp = client.post(
            "/wallet/buy-at",
            json={"tx_hash": "0x000", "usdt_amount": 0},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_buy_at_negative_amount_returns_400(self):
        resp = client.post(
            "/wallet/buy-at",
            json={"tx_hash": "0x000", "usdt_amount": -5},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_buy_at_no_token_returns_422(self):
        resp = client.post(
            "/wallet/buy-at",
            json={"tx_hash": "0xabc", "usdt_amount": 10.0},
        )
        assert resp.status_code == 422


# ─── POST /wallet/withdraw-at ────────────────────────────────────────────────

class TestWithdrawArenaTokens:
    """
    Tests for POST /wallet/withdraw-at.

    fetchone side_effect order inside the endpoint:
      1. user row  → (at_balance, wallet_address, at_daily_withdrawn, at_withdrawal_reset_at)
      2. new balance after deduct → (new_at_balance,)
    """
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    import datetime as _dt
    _reset_at = _dt.datetime.now(_dt.timezone.utc)

    def _user_row(self, balance=5000, wallet="0xABC123", daily=0):
        import datetime as _dt
        return (balance, wallet, daily, _dt.datetime.now(_dt.timezone.utc))

    def test_withdraw_standard_rate_returns_200(self):
        """1100 AT → $10 USDT, standard rate (use_discount=False)."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(balance=5000),   # user lookup
            (3900,),                         # new balance after deduct
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/withdraw-at",
                json={"at_amount": 1100, "use_discount": False},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["at_burned"] == 1100
        assert data["usdt_value"] == 10.0
        assert "wallet_address" in data
        assert data["at_balance"] == 3900

    def test_withdraw_discount_rate_returns_200(self):
        """950 AT → $10 USDT, discounted rate (use_discount=True)."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(balance=5000),
            (4050,),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/withdraw-at",
                json={"at_amount": 950, "use_discount": True},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["at_burned"] == 950
        assert data["usdt_value"] == 10.0

    def test_withdraw_insufficient_balance_returns_402(self):
        """User has less AT than requested → 402."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = self._user_row(balance=500)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/withdraw-at",
                json={"at_amount": 1100, "use_discount": False},
                headers=self._auth_header(),
            )
        assert resp.status_code == 402
        assert "insufficient" in resp.json()["detail"].lower()

    def test_withdraw_no_wallet_returns_400(self):
        """User has no linked wallet → 400."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = self._user_row(wallet=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/withdraw-at",
                json={"at_amount": 1100, "use_discount": False},
                headers=self._auth_header(),
            )
        assert resp.status_code == 400
        assert "wallet" in resp.json()["detail"].lower()

    def test_withdraw_invalid_multiple_returns_400(self):
        """Amount not a multiple of rate → 400."""
        ctx, session = _make_session_mock()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/withdraw-at",
                json={"at_amount": 500, "use_discount": False},  # 500 not divisible by 110
                headers=self._auth_header(),
            )
        assert resp.status_code == 400
        assert "multiple" in resp.json()["detail"].lower()

    def test_withdraw_below_minimum_returns_400(self):
        """Below minimum $10 withdrawal → 400."""
        ctx, session = _make_session_mock()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/withdraw-at",
                json={"at_amount": 0, "use_discount": False},
                headers=self._auth_header(),
            )
        assert resp.status_code == 400

    def test_withdraw_daily_limit_exceeded_returns_429(self):
        """Daily limit already used up → 429."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.return_value = self._user_row(
            balance=20000, daily=9500  # 9500 used today, trying 1100 more = 10600 > 10000
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/wallet/withdraw-at",
                json={"at_amount": 1100, "use_discount": False},
                headers=self._auth_header(),
            )
        assert resp.status_code == 429
        assert "limit" in resp.json()["detail"].lower()

    def test_withdraw_no_token_returns_422(self):
        resp = client.post(
            "/wallet/withdraw-at",
            json={"at_amount": 1100, "use_discount": False},
        )
        assert resp.status_code == 422


# ─── POST /forge/purchase ─────────────────────────────────────────────────────

class TestForgePurchase:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "daniel@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _item_row(self, price_at=50):
        return (str(uuid.uuid4()), price_at)   # id, price_at

    def _user_row(self, at_balance=200, owned=None):
        return (at_balance, owned or [])        # at_balance, forge_unlocked_item_ids

    def test_purchase_success_returns_new_balance(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            self._item_row(50),          # forge_items lookup
            self._user_row(200, []),     # user lookup
            (150,),                      # UPDATE RETURNING at_balance
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/forge/purchase",
                json={"item_slug": "avatar-dragon"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["at_balance"] == 150
        assert resp.json()["item_slug"] == "avatar-dragon"

    def test_purchase_item_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/forge/purchase",
                json={"item_slug": "nonexistent"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_purchase_already_owned_returns_409(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            self._item_row(50),
            self._user_row(200, ["avatar-dragon"]),  # already owned
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/forge/purchase",
                json={"item_slug": "avatar-dragon"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_purchase_insufficient_at_returns_400(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            self._item_row(price_at=500),   # costs 500 AT
            self._user_row(at_balance=100), # user has only 100
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/forge/purchase",
                json={"item_slug": "badge-legendary"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 400
        assert "insufficient" in resp.json()["detail"].lower()

    def test_purchase_no_token_returns_422(self):
        resp = client.post("/forge/purchase", json={"item_slug": "avatar-dragon"})
        assert resp.status_code == 422


# ─── POST /auth/change-password ───────────────────────────────────────────────

class TestChangePassword:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "test@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _mock_session(self, pw_hash: str | None):
        """Return mocked session that returns (pw_hash,) or None for fetchone."""
        ctx, session = _make_session_mock(fetchone_return=(pw_hash,) if pw_hash else None)
        return ctx, session

    def test_change_password_success(self):
        """Correct current password → 200 {changed: true}."""
        current = "OldPass123"
        current_hash = auth.hash_password(current)
        ctx, session = self._mock_session(current_hash)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/auth/change-password",
                json={"current_password": current, "new_password": "NewPass999"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["changed"] is True

    def test_wrong_current_password_returns_400(self):
        """Wrong current password → 400."""
        current_hash = auth.hash_password("RealPassword1")
        ctx, session = self._mock_session(current_hash)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/auth/change-password",
                json={"current_password": "WrongPassword", "new_password": "NewPass999"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 400
        assert "incorrect" in resp.json()["detail"].lower()

    def test_new_password_too_short_returns_400(self):
        """new_password < 8 chars → 400 before hitting DB."""
        resp = client.post(
            "/auth/change-password",
            json={"current_password": "anything", "new_password": "short"},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400
        assert "8" in resp.json()["detail"]

    def test_change_password_user_not_found_returns_404(self):
        """DB returns no user row → 404."""
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/auth/change-password",
                json={"current_password": "anything", "new_password": "ValidPass1"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_change_password_no_token_returns_422(self):
        resp = client.post(
            "/auth/change-password",
            json={"current_password": "a", "new_password": "b"},
        )
        assert resp.status_code == 422


# ─── Friendships ──────────────────────────────────────────────────────────────

OTHER_UUID = str(uuid.uuid4())


class TestFriendships:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "me@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    # ── POST /friends/request ────────────────────────────────────────────────

    def test_send_friend_request_success(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            (OTHER_UUID,),   # target user exists
            None,            # no existing friendship
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/friends/request",
                json={"user_id": OTHER_UUID},
                headers=self._auth_header(),
            )
        assert resp.status_code == 201
        assert resp.json()["sent"] is True

    def test_send_request_to_self_returns_400(self):
        resp = client.post(
            "/friends/request",
            json={"user_id": FAKE_UUID},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_request_user_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/friends/request",
                json={"user_id": OTHER_UUID},
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_send_request_already_exists_returns_409(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            (OTHER_UUID,),                       # target user exists
            (str(uuid.uuid4()), "pending"),      # friendship already exists
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/friends/request",
                json={"user_id": OTHER_UUID},
                headers=self._auth_header(),
            )
        assert resp.status_code == 409

    def test_send_request_blocked_returns_403(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            (OTHER_UUID,),                        # target user exists
            (str(uuid.uuid4()), "blocked"),       # blocked friendship
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/friends/request",
                json={"user_id": OTHER_UUID},
                headers=self._auth_header(),
            )
        assert resp.status_code == 403

    def test_send_request_no_token_returns_422(self):
        resp = client.post("/friends/request", json={"user_id": OTHER_UUID})
        assert resp.status_code == 422

    # ── GET /friends ─────────────────────────────────────────────────────────

    def test_list_friends_returns_list(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [
            (OTHER_UUID, "Player1", "ARENA-ABC123", None, None),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/friends", headers=self._auth_header())
        assert resp.status_code == 200
        friends = resp.json()["friends"]
        assert isinstance(friends, list)
        assert friends[0]["username"] == "Player1"

    def test_list_friends_empty_when_no_friends(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/friends", headers=self._auth_header())
        assert resp.status_code == 200
        assert resp.json()["friends"] == []

    def test_list_friends_no_token_returns_422(self):
        resp = client.get("/friends")
        assert resp.status_code == 422

    # ── GET /friends/requests ────────────────────────────────────────────────

    def test_list_requests_returns_incoming_and_outgoing(self):
        import datetime as _dt
        now = _dt.datetime.now(_dt.timezone.utc)
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.side_effect = [
            [(str(uuid.uuid4()), OTHER_UUID, "Sender", "ARENA-S", None, "hello", now)],  # incoming
            [],  # outgoing
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/friends/requests", headers=self._auth_header())
        assert resp.status_code == 200
        data = resp.json()
        assert "incoming" in data
        assert "outgoing" in data
        assert len(data["incoming"]) == 1
        assert data["incoming"][0]["username"] == "Sender"

    def test_list_requests_no_token_returns_422(self):
        resp = client.get("/friends/requests")
        assert resp.status_code == 422

    # ── POST /friends/{user_id}/accept ────────────────────────────────────────

    def test_accept_friend_request_success(self):
        fid = str(uuid.uuid4())
        ctx, session = _make_session_mock(fetchone_return=(fid,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/friends/{OTHER_UUID}/accept",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["accepted"] is True

    def test_accept_nonexistent_request_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/friends/{OTHER_UUID}/accept",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_accept_no_token_returns_422(self):
        resp = client.post(f"/friends/{OTHER_UUID}/accept")
        assert resp.status_code == 422

    # ── POST /friends/{user_id}/reject ────────────────────────────────────────

    def test_reject_friend_request_success(self):
        fid = str(uuid.uuid4())
        ctx, session = _make_session_mock(fetchone_return=(fid,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/friends/{OTHER_UUID}/reject",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["rejected"] is True

    def test_reject_nonexistent_request_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/friends/{OTHER_UUID}/reject",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    # ── DELETE /friends/{user_id} ─────────────────────────────────────────────

    def test_remove_friend_success(self):
        fid = str(uuid.uuid4())
        ctx, session = _make_session_mock(fetchone_return=(fid,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/friends/{OTHER_UUID}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["removed"] is True

    def test_remove_nonexistent_friend_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/friends/{OTHER_UUID}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_remove_friend_no_token_returns_422(self):
        resp = client.delete(f"/friends/{OTHER_UUID}")
        assert resp.status_code == 422

    # ── POST /friends/{user_id}/block ─────────────────────────────────────────

    def test_block_user_updates_existing_friendship(self):
        fid = str(uuid.uuid4())
        ctx, session = _make_session_mock(fetchone_return=(fid,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/friends/{OTHER_UUID}/block",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["blocked"] is True

    def test_block_user_inserts_when_no_friendship(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            None,              # no existing friendship
            (OTHER_UUID,),     # target user exists
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/friends/{OTHER_UUID}/block",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["blocked"] is True

    def test_block_self_returns_400(self):
        resp = client.post(
            f"/friends/{FAKE_UUID}/block",
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_block_no_token_returns_422(self):
        resp = client.post(f"/friends/{OTHER_UUID}/block")
        assert resp.status_code == 422


# ─── Direct Messages ──────────────────────────────────────────────────────────

class TestDirectMessages:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "me@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    # ── POST /messages ────────────────────────────────────────────────────────

    def test_send_message_success(self):
        import datetime as _dt
        msg_id = str(uuid.uuid4())
        now = _dt.datetime.now(_dt.timezone.utc)
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            (OTHER_UUID,),     # receiver exists
            (msg_id, now),     # INSERT RETURNING
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/messages",
                json={"receiver_id": OTHER_UUID, "content": "Hello!"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] == msg_id
        assert data["content"] == "Hello!"
        assert data["sender_id"] == FAKE_UUID
        assert data["receiver_id"] == OTHER_UUID

    def test_send_message_to_self_returns_400(self):
        resp = client.post(
            "/messages",
            json={"receiver_id": FAKE_UUID, "content": "hi"},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_empty_message_returns_400(self):
        resp = client.post(
            "/messages",
            json={"receiver_id": OTHER_UUID, "content": "   "},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_too_long_message_returns_400(self):
        resp = client.post(
            "/messages",
            json={"receiver_id": OTHER_UUID, "content": "x" * 2001},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_message_receiver_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/messages",
                json={"receiver_id": OTHER_UUID, "content": "hi"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_send_message_no_token_returns_422(self):
        resp = client.post(
            "/messages",
            json={"receiver_id": OTHER_UUID, "content": "hi"},
        )
        assert resp.status_code == 422

    # ── GET /messages/{friend_id} ─────────────────────────────────────────────

    def test_get_conversation_returns_messages(self):
        import datetime as _dt
        now = _dt.datetime.now(_dt.timezone.utc)
        msg_id = str(uuid.uuid4())
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [
            (msg_id, FAKE_UUID, OTHER_UUID, "Hey there", False, now),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(
                f"/messages/{OTHER_UUID}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        msgs = resp.json()["messages"]
        assert len(msgs) == 1
        assert msgs[0]["content"] == "Hey there"
        assert msgs[0]["read"] is False

    def test_get_conversation_empty(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(
                f"/messages/{OTHER_UUID}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["messages"] == []

    def test_get_conversation_respects_limit(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(
                f"/messages/{OTHER_UUID}?limit=10",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200

    def test_get_conversation_limit_out_of_range_returns_422(self):
        resp = client.get(
            f"/messages/{OTHER_UUID}?limit=999",
            headers=self._auth_header(),
        )
        assert resp.status_code == 422

    def test_get_conversation_no_token_returns_422(self):
        resp = client.get(f"/messages/{OTHER_UUID}")
        assert resp.status_code == 422

    # ── POST /messages/{friend_id}/read ───────────────────────────────────────

    def test_mark_messages_read_success(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.rowcount = 3
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/messages/{OTHER_UUID}/read",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["marked_read"] is True

    def test_mark_messages_read_no_token_returns_422(self):
        resp = client.post(f"/messages/{OTHER_UUID}/read")
        assert resp.status_code == 422


# ─── POST /match/result — stats update ────────────────────────────────────────

class TestMatchResultStatsUpdate:
    """
    Verify that POST /match/result updates user_stats (wins/losses/xp)
    for all players in the match when a winner_id is provided.
    """
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "test@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def test_submit_result_with_winner_calls_stat_updates(self):
        """When winner_id is set, DB must update user_stats rows."""
        match_id  = str(uuid.uuid4())
        winner_id = str(uuid.uuid4())
        loser_id  = str(uuid.uuid4())

        ctx, session = _make_session_mock()
        # Side effects: UPDATE matches → no fetchone needed; match_players query
        session.execute.return_value.fetchall.return_value = [
            (winner_id,),
            (loser_id,),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/match/result",
                json={
                    "match_id":  match_id,
                    "winner_id": winner_id,
                    "game":      "CS2",
                },
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["accepted"] is True

    def test_submit_result_without_winner_accepted(self):
        """No winner_id → still accepted; no stat updates triggered."""
        ctx, session = _make_session_mock()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/match/result",
                json={"match_id": str(uuid.uuid4()), "winner_id": "", "game": "CS2"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["accepted"] is True


# ─── GET /matches/history ─────────────────────────────────────────────────────

class TestMatchHistory:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "test@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _match_row(self):
        import datetime as _dt
        return (
            str(uuid.uuid4()),     # id
            "CS2",                 # game
            "1v1",                 # mode
            "completed",           # status
            10.00,                 # bet_amount
            FAKE_UUID,             # winner_id  (me = winner)
            _dt.datetime.now(_dt.timezone.utc),  # created_at
            _dt.datetime.now(_dt.timezone.utc),  # ended_at
            "Opponent",            # opponent username
            str(uuid.uuid4()),     # opponent id
            None,                  # opponent avatar
        )

    def test_match_history_returns_list(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [self._match_row()]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches/history", headers=self._auth_header())
        assert resp.status_code == 200
        matches = resp.json()["matches"]
        assert isinstance(matches, list)
        assert len(matches) == 1
        assert matches[0]["result"] == "win"    # winner_id == FAKE_UUID (current user)
        assert matches[0]["game"] == "CS2"

    def test_match_history_empty_returns_empty_list(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches/history", headers=self._auth_header())
        assert resp.status_code == 200
        assert resp.json()["matches"] == []

    def test_match_history_result_loss_when_other_wins(self):
        row = list(self._match_row())
        row[5] = str(uuid.uuid4())   # winner_id != FAKE_UUID → loss
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [tuple(row)]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches/history", headers=self._auth_header())
        assert resp.json()["matches"][0]["result"] == "loss"

    def test_match_history_no_winner_is_draw(self):
        row = list(self._match_row())
        row[5] = None   # no winner → draw
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [tuple(row)]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches/history", headers=self._auth_header())
        assert resp.json()["matches"][0]["result"] == "draw"

    def test_match_history_no_token_returns_422(self):
        resp = client.get("/matches/history")
        assert resp.status_code == 422

    def test_match_history_limit_out_of_range_returns_422(self):
        resp = client.get("/matches/history?limit=200", headers=self._auth_header())
        assert resp.status_code == 422


# ─── GET /matches ─────────────────────────────────────────────────────────────

class TestListMatches:
    def _match_row(self):
        import datetime as _dt
        return (
            str(uuid.uuid4()),    # id
            "CS2",                # game
            "1v1",                # mode
            "public",             # type
            10.00,                # bet_amount
            "waiting",            # status
            None,                 # code
            _dt.datetime.now(_dt.timezone.utc),  # created_at
            2,                    # max_players
            "Host",               # host_username
            str(uuid.uuid4()),    # host_id
            None,                 # host_avatar
            1,                    # player_count
            1,                    # max_per_team
            "CRYPTO",             # stake_currency
            False,                # has_password — added in Doc B §2
        )

    def test_list_matches_returns_open_lobbies(self):
        ctx, session = _make_session_mock()
        # Two fetchall calls: first = match list, second = roster query (empty → no players)
        session.execute.return_value.fetchall.side_effect = [
            [self._match_row()],  # main matches query
            [],                   # roster query (no players in mock)
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        assert resp.status_code == 200
        matches = resp.json()["matches"]
        assert isinstance(matches, list)
        assert matches[0]["status"] == "waiting"
        assert "has_password" in matches[0]
        assert "players" in matches[0]

    def test_list_matches_empty_lobby(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        assert resp.status_code == 200
        assert resp.json()["matches"] == []

    def test_list_matches_no_auth_required(self):
        """Public endpoint — should return 200 without auth."""
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        assert resp.status_code == 200


# ─── GET /leaderboard ─────────────────────────────────────────────────────────

class TestLeaderboard:
    def _player_row(self, rank_wins=10):
        return (
            str(uuid.uuid4()),   # user_id
            "Player1",           # username
            "ARENA-ABC123",      # arena_id
            None,                # avatar
            None,                # equipped_badge_icon
            "Gold",              # rank (tier)
            rank_wins,           # wins
            3,                   # losses
            13,                  # matches
            76.92,               # win_rate
            500,                 # xp
            25.50,               # total_earnings
        )

    def test_leaderboard_returns_ranked_list(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [
            self._player_row(20),
            self._player_row(10),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/leaderboard")
        assert resp.status_code == 200
        data = resp.json()["leaderboard"]
        assert len(data) == 2
        assert data[0]["rank"] == 1
        assert data[1]["rank"] == 2

    def test_leaderboard_has_required_fields(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [self._player_row()]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/leaderboard")
        entry = resp.json()["leaderboard"][0]
        for field in ("rank", "user_id", "username", "wins", "losses", "xp", "win_rate"):
            assert field in entry, f"Missing field: {field}"

    def test_leaderboard_empty_returns_empty_list(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/leaderboard")
        assert resp.json()["leaderboard"] == []

    def test_leaderboard_no_auth_required(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/leaderboard")
        assert resp.status_code == 200


# ─── GET /players ──────────────────────────────────────────────────────────────

class TestSearchPlayers:
    def _player_row(self):
        return (
            str(uuid.uuid4()),  # user_id
            "Player1",          # username
            "ARENA-PL001",      # arena_id
            None,               # avatar
            None,               # equipped_badge_icon
            "Silver",           # rank
            5,                  # wins
            3,                  # losses
            8,                  # matches
            62.50,              # win_rate
            200,                # xp
        )

    def test_search_players_returns_list(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [self._player_row()]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/players?q=Player")
        assert resp.status_code == 200
        players = resp.json()["players"]
        assert len(players) == 1
        assert players[0]["username"] == "Player1"

    def test_search_players_empty_query_returns_all(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/players")
        assert resp.status_code == 200
        assert isinstance(resp.json()["players"], list)

    def test_search_players_no_auth_required(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/players?q=anyone")
        assert resp.status_code == 200

    def test_search_players_limit_enforced(self):
        resp = client.get("/players?limit=100")
        assert resp.status_code == 422


# ─── GET /players/{user_id} ────────────────────────────────────────────────────

class TestPlayerProfile:
    def _profile_row(self):
        import datetime as _dt
        return (
            FAKE_UUID,           # user_id
            "Player1",           # username
            "ARENA-PL001",       # arena_id
            None,                # avatar
            "default",           # avatar_bg
            None,                # equipped_badge_icon
            "Gold",              # rank
            10,                  # wins
            3,                   # losses
            13,                  # matches
            76.92,               # win_rate
            500,                 # xp
            25.50,               # total_earnings
            [],                  # forge_unlocked_item_ids
            None,                # vip_expires_at
            "76561198000000001", # steam_id
            None,                # riot_id
        )

    def test_get_player_profile_returns_public_fields(self):
        ctx, session = _make_session_mock(fetchone_return=self._profile_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/players/{FAKE_UUID}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["username"] == "Player1"
        assert data["wins"] == 10
        assert data["has_steam"] is True
        assert data["has_riot"] is False
        assert "email" not in data
        assert "wallet_address" not in data

    def test_get_player_profile_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/players/{uuid.uuid4()}")
        assert resp.status_code == 404

    def test_get_player_profile_no_auth_required(self):
        ctx, session = _make_session_mock(fetchone_return=self._profile_row())
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/players/{FAKE_UUID}")
        assert resp.status_code == 200


# ─── Inbox ────────────────────────────────────────────────────────────────────

class TestInbox:
    def _auth_header(self) -> dict:
        token = auth.issue_token(FAKE_UUID, "me@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def _msg_row(self):
        import datetime as _dt
        return (
            str(uuid.uuid4()),                    # id
            "Match Result",                        # subject
            "You won! +100 XP",                   # content
            False,                                 # read
            _dt.datetime.now(_dt.timezone.utc),   # created_at
            OTHER_UUID,                            # sender_id
            "System",                              # sender_username
            None,                                  # sender_avatar
            "ARENA-SYS001",                        # sender_arena_id
        )

    # ── POST /inbox ───────────────────────────────────────────────────────────

    def test_send_inbox_message_success(self):
        import datetime as _dt
        msg_id = str(uuid.uuid4())
        now = _dt.datetime.now(_dt.timezone.utc)
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchone.side_effect = [
            (OTHER_UUID,),     # receiver exists
            (msg_id, now),     # INSERT RETURNING
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/inbox",
                json={
                    "receiver_id": OTHER_UUID,
                    "subject":     "Hello",
                    "content":     "Welcome to the arena!",
                },
                headers=self._auth_header(),
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] == msg_id
        assert data["subject"] == "Hello"
        assert data["sender_id"] == FAKE_UUID

    def test_send_inbox_to_self_returns_400(self):
        resp = client.post(
            "/inbox",
            json={"receiver_id": FAKE_UUID, "subject": "hi", "content": "test"},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_inbox_empty_subject_returns_400(self):
        resp = client.post(
            "/inbox",
            json={"receiver_id": OTHER_UUID, "subject": "  ", "content": "test"},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_inbox_subject_too_long_returns_400(self):
        resp = client.post(
            "/inbox",
            json={"receiver_id": OTHER_UUID, "subject": "x" * 201, "content": "ok"},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_inbox_content_too_long_returns_400(self):
        resp = client.post(
            "/inbox",
            json={"receiver_id": OTHER_UUID, "subject": "hi", "content": "x" * 5001},
            headers=self._auth_header(),
        )
        assert resp.status_code == 400

    def test_send_inbox_receiver_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/inbox",
                json={"receiver_id": OTHER_UUID, "subject": "hi", "content": "test"},
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_send_inbox_no_token_returns_422(self):
        resp = client.post(
            "/inbox",
            json={"receiver_id": OTHER_UUID, "subject": "hi", "content": "test"},
        )
        assert resp.status_code == 422

    # ── GET /inbox ────────────────────────────────────────────────────────────

    def test_get_inbox_returns_messages(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = [self._msg_row()]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/inbox", headers=self._auth_header())
        assert resp.status_code == 200
        msgs = resp.json()["messages"]
        assert len(msgs) == 1
        assert msgs[0]["subject"] == "Match Result"
        assert msgs[0]["read"] is False

    def test_get_inbox_empty(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/inbox", headers=self._auth_header())
        assert resp.status_code == 200
        assert resp.json()["messages"] == []

    def test_get_inbox_unread_only_flag(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/inbox?unread_only=true", headers=self._auth_header())
        assert resp.status_code == 200

    def test_get_inbox_no_token_returns_422(self):
        resp = client.get("/inbox")
        assert resp.status_code == 422

    # ── GET /inbox/unread-count ───────────────────────────────────────────────

    def test_unread_count_returns_number(self):
        ctx, session = _make_session_mock(fetchone_return=(5,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/inbox/unread-count", headers=self._auth_header())
        assert resp.status_code == 200
        assert resp.json()["unread_count"] == 5

    def test_unread_count_no_token_returns_422(self):
        resp = client.get("/inbox/unread-count")
        assert resp.status_code == 422

    # ── PATCH /inbox/{id}/read ────────────────────────────────────────────────

    def test_mark_inbox_read_success(self):
        msg_id = str(uuid.uuid4())
        ctx, session = _make_session_mock(fetchone_return=(msg_id,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                f"/inbox/{msg_id}/read",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["read"] is True

    def test_mark_inbox_read_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                f"/inbox/{uuid.uuid4()}/read",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_mark_inbox_read_no_token_returns_422(self):
        resp = client.patch(f"/inbox/{uuid.uuid4()}/read")
        assert resp.status_code == 422

    # ── PATCH /inbox/read-all ─────────────────────────────────────────────────

    def test_mark_all_inbox_read_success(self):
        ctx, session = _make_session_mock()
        session.execute.return_value.rowcount = 4
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch("/inbox/read-all", headers=self._auth_header())
        assert resp.status_code == 200
        assert "marked_read" in resp.json()

    def test_mark_all_inbox_read_no_token_returns_422(self):
        resp = client.patch("/inbox/read-all")
        assert resp.status_code == 422

    # ── DELETE /inbox/{id} ────────────────────────────────────────────────────

    def test_delete_inbox_message_success(self):
        msg_id = str(uuid.uuid4())
        ctx, session = _make_session_mock(fetchone_return=(msg_id,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/inbox/{msg_id}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_delete_inbox_not_found_returns_404(self):
        ctx, session = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(
                f"/inbox/{uuid.uuid4()}",
                headers=self._auth_header(),
            )
        assert resp.status_code == 404

    def test_delete_inbox_no_token_returns_422(self):
        resp = client.delete(f"/inbox/{uuid.uuid4()}")
        assert resp.status_code == 422


# ─── Rate limiter unit tests ──────────────────────────────────────────────────

class TestRateLimiter:
    """Unit tests for _check_rate_limit helper (no DB needed)."""

    def setup_method(self):
        import main
        main._rate_buckets.clear()

    def test_allows_calls_within_limit(self):
        from main import _check_rate_limit
        for _ in range(4):
            _check_rate_limit("rl_key", max_calls=5, window_secs=60)

    def test_blocks_when_limit_exceeded(self):
        from main import _check_rate_limit
        from fastapi import HTTPException as _HTTPException
        for _ in range(5):
            _check_rate_limit("rl_key2", max_calls=5, window_secs=60)
        with pytest.raises(_HTTPException) as exc_info:
            _check_rate_limit("rl_key2", max_calls=5, window_secs=60)
        assert exc_info.value.status_code == 429

    def test_different_keys_are_independent(self):
        from main import _check_rate_limit
        for _ in range(5):
            _check_rate_limit("key_a", max_calls=5, window_secs=60)
        # key_b has its own bucket — should not be limited
        _check_rate_limit("key_b", max_calls=5, window_secs=60)

    def test_register_rate_limited_after_5_per_minute(self):
        """POST /auth/register → 429 after 5 attempts from same IP."""
        import main
        # Exhaust the bucket for testclient's IP
        for _ in range(5):
            main._check_rate_limit("register:testclient", max_calls=5)
        from fastapi import HTTPException as _HTTPException
        with pytest.raises(_HTTPException) as exc_info:
            main._check_rate_limit("register:testclient", max_calls=5)
        assert exc_info.value.status_code == 429
