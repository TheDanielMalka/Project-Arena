"""
Identity-lock & 24h post-deletion cooldown.

Covers the rules introduced on branch `agent/engine/steam-id-lock`:

  • PATCH /users/me with steam_id (any value) → 400.
  • PATCH /users/me with riot_id  (any value) → 400.
  • PATCH /users/me wallet write-once + cooldown (deeper coverage lives in
    test_api_routes.py::TestPatchWalletAddress).
  • POST /auth/register blocked when email or username is in 24h cooldown.
  • GET  /auth/steam/return blocked when that Steam ID is in 24h cooldown.

The tests never hit a real DB — every SessionLocal is mocked.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

_USER_ID = str(uuid.uuid4())
_TOKEN   = auth.issue_token(_USER_ID, "lock@arena.gg", "LockUser")
_HEADERS = {"Authorization": f"Bearer {_TOKEN}"}

_VALID_STEAM = "76561198000000042"
_VALID_RIOT  = "Locker#0001"
_VALID_ADDR  = "0xAbCd1234AbCd1234AbCd1234AbCd1234AbCd1234"


@pytest.fixture(autouse=True)
def bypass_suspension():
    with patch("main._assert_not_suspended", return_value=None):
        yield


def _ctx(session: MagicMock):
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__  = MagicMock(return_value=False)
    return ctx


# ═════════════════════════════════════════════════════════════════════════════
# PATCH /users/me — steam_id / riot_id are never writable
# ═════════════════════════════════════════════════════════════════════════════

class TestPatchRejectsSteamRiot:
    def test_patch_steam_id_non_empty_returns_400(self):
        """Any non-null steam_id in PATCH body → 400. Never touches the DB."""
        with patch("main.SessionLocal") as MockSession:
            resp = client.patch("/users/me", json={"steam_id": _VALID_STEAM}, headers=_HEADERS)
        assert resp.status_code == 400
        assert "steam id" in resp.json()["detail"].lower()
        # Must not even open a DB session to make this check.
        MockSession.assert_not_called()

    def test_patch_steam_id_empty_string_returns_400(self):
        """Legacy unlink sentinel "" is now rejected just like any other value."""
        with patch("main.SessionLocal") as MockSession:
            resp = client.patch("/users/me", json={"steam_id": ""}, headers=_HEADERS)
        assert resp.status_code == 400
        MockSession.assert_not_called()

    def test_patch_riot_id_non_empty_returns_400(self):
        with patch("main.SessionLocal") as MockSession:
            resp = client.patch("/users/me", json={"riot_id": _VALID_RIOT}, headers=_HEADERS)
        assert resp.status_code == 400
        assert "riot id" in resp.json()["detail"].lower()
        MockSession.assert_not_called()

    def test_patch_riot_id_empty_string_returns_400(self):
        with patch("main.SessionLocal") as MockSession:
            resp = client.patch("/users/me", json={"riot_id": ""}, headers=_HEADERS)
        assert resp.status_code == 400
        MockSession.assert_not_called()

    def test_patch_steam_id_null_ignored(self):
        """Omitting the field (null) is a no-op — no 400."""
        with patch("main.SessionLocal") as MockSession:
            session = MockSession.return_value.__enter__.return_value
            session.execute.return_value.fetchone.return_value = None
            resp = client.patch(
                "/users/me",
                json={"steam_id": None, "avatar": "avatar_01"},
                headers=_HEADERS,
            )
        assert resp.status_code != 400


# ═════════════════════════════════════════════════════════════════════════════
# POST /auth/register — 24h cooldown on recently-deleted email / username
# ═════════════════════════════════════════════════════════════════════════════

class TestRegisterCooldown:
    def _email_hash(self, email: str) -> str:
        return hashlib.sha256(email.lower().encode()).hexdigest()

    def _username_hash(self, username: str) -> str:
        return hashlib.sha256(username.encode()).hexdigest()

    def test_email_cooldown_blocks_registration(self):
        """Email whose hash was in deleted_accounts within last 24h → 409."""
        session = MagicMock()
        recent = datetime.now(timezone.utc) - timedelta(hours=1)
        # Execution order in /auth/register:
        #   1. email duplicate check (users)       → None
        #   2. username duplicate check (users)    → None
        #   3. email_hash cooldown check           → HIT (recent delete)
        session.execute.return_value.fetchone.side_effect = [
            None,
            None,
            (recent,),
        ]
        with patch("main.SessionLocal", return_value=_ctx(session)):
            resp = client.post("/auth/register", json={
                "username": "ColdEmailUser",
                "email":    "cold@arena.gg",
                "password": "password123",
            })
        assert resp.status_code == 409
        assert "cooldown" in resp.json()["detail"].lower()

    def test_username_cooldown_blocks_registration(self):
        """Username cooldown hit → 409 (email clean)."""
        session = MagicMock()
        recent = datetime.now(timezone.utc) - timedelta(hours=3)
        session.execute.return_value.fetchone.side_effect = [
            None,             # email dup check
            None,             # username dup check
            None,             # email_hash cooldown → clear
            (recent,),        # username_hash cooldown → HIT
        ]
        with patch("main.SessionLocal", return_value=_ctx(session)):
            resp = client.post("/auth/register", json={
                "username": "ColdUserName",
                "email":    "fresh@arena.gg",
                "password": "password123",
            })
        assert resp.status_code == 409
        assert "cooldown" in resp.json()["detail"].lower()

    def test_cooldown_expired_allows_registration(self):
        """Cooldown expired (>24h) → register proceeds to INSERT."""
        session = MagicMock()
        # Query filters WHERE deleted_at > NOW() - 24h, so an expired row never
        # reaches Python — the mock returns None for the cooldown queries.
        new_uid = str(uuid.uuid4())
        session.execute.return_value.fetchone.side_effect = [
            None,                                          # email dup
            None,                                          # username dup
            None,                                          # email_hash cooldown clear
            None,                                          # username_hash cooldown clear
            (new_uid, "ColdUser", "cold@arena.gg", "ARENA-AAAA01"),  # INSERT RETURNING
        ]
        with patch("main.SessionLocal", return_value=_ctx(session)):
            resp = client.post("/auth/register", json={
                "username": "ColdUser",
                "email":    "cold@arena.gg",
                "password": "password123",
            })
        assert resp.status_code == 201


# ═════════════════════════════════════════════════════════════════════════════
# Steam OpenID callback — 24h cooldown on recently-deleted steam_id
# ═════════════════════════════════════════════════════════════════════════════

class TestSteamCallbackCooldown:
    """
    GET /auth/steam/callback — mocks httpx so no network call to Valve and
    provides a valid `openid.claimed_id` query param so steam_id extraction
    succeeds.
    """

    _CLAIMED = f"https://steamcommunity.com/openid/id/{_VALID_STEAM}"

    def _fake_httpx_ok(self):
        """Return a context-manager-compatible fake httpx.AsyncClient whose
        POST returns an `is_valid:true` body."""
        fake_resp = MagicMock()
        fake_resp.text = "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"

        class _FakeHC:
            def __init__(self, *a, **kw): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, *a, **kw): return fake_resp

        return _FakeHC

    def _callback(self):
        fake_cls = self._fake_httpx_ok()
        return client.get(
            f"/auth/steam/callback?token={_TOKEN}"
            f"&openid.claimed_id={self._CLAIMED}"
            f"&openid.mode=id_res",
            follow_redirects=False,
        ), fake_cls

    def test_cooldown_steam_id_redirects_with_error(self):
        recent = datetime.now(timezone.utc) - timedelta(hours=2)
        session = MagicMock()
        # Execution order in the callback after Valve verify succeeds:
        #   1. "SELECT 1 FROM users WHERE steam_id = :s AND id != :uid" → None
        #   2. cooldown query                                           → HIT
        session.execute.return_value.fetchone.side_effect = [
            None,
            (recent,),
        ]
        fake_cls = self._fake_httpx_ok()
        with patch("main.httpx.AsyncClient", fake_cls), \
             patch("main.SessionLocal", return_value=_ctx(session)):
            resp = client.get(
                f"/auth/steam/callback?token={_TOKEN}"
                f"&openid.claimed_id={self._CLAIMED}"
                f"&openid.mode=id_res",
                follow_redirects=False,
            )
        assert resp.status_code == 302
        assert "steam_error=cooldown" in resp.headers["location"]

    def test_callback_on_clean_steam_id_succeeds(self):
        session = MagicMock()
        # 1. another-user check → None
        # 2. cooldown          → None
        # 3. current row       → (None, False) — user has no steam yet
        session.execute.return_value.fetchone.side_effect = [
            None,
            None,
            (None, False),
        ]
        fake_cls = self._fake_httpx_ok()
        with patch("main.httpx.AsyncClient", fake_cls), \
             patch("main.SessionLocal", return_value=_ctx(session)):
            resp = client.get(
                f"/auth/steam/callback?token={_TOKEN}"
                f"&openid.claimed_id={self._CLAIMED}"
                f"&openid.mode=id_res",
                follow_redirects=False,
            )
        assert resp.status_code == 302
        assert "steam_linked=1" in resp.headers["location"]

    def test_callback_rejects_relink_when_other_steam_already_locked(self):
        """User already has a different (verified) steam_id → redirect=locked."""
        session = MagicMock()
        other_steam = "76561198999999999"
        session.execute.return_value.fetchone.side_effect = [
            None,                     # another-user check clear
            None,                     # cooldown clear
            (other_steam, True),      # current locked steam on this account
        ]
        fake_cls = self._fake_httpx_ok()
        with patch("main.httpx.AsyncClient", fake_cls), \
             patch("main.SessionLocal", return_value=_ctx(session)):
            resp = client.get(
                f"/auth/steam/callback?token={_TOKEN}"
                f"&openid.claimed_id={self._CLAIMED}"
                f"&openid.mode=id_res",
                follow_redirects=False,
            )
        assert resp.status_code == 302
        assert "steam_error=locked" in resp.headers["location"]


# ═════════════════════════════════════════════════════════════════════════════
# _assert_identifier_cooldown — unit test for the helper itself
# ═════════════════════════════════════════════════════════════════════════════

class TestCooldownHelper:
    def test_unknown_field_raises_runtime_error(self):
        import main as _m
        session = MagicMock()
        with pytest.raises(RuntimeError):
            _m._assert_identifier_cooldown(session, "banana", "x")

    def test_no_recent_deletion_is_no_op(self):
        import main as _m
        from fastapi import HTTPException
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = None
        # Must not raise.
        _m._assert_identifier_cooldown(session, "steam_id", _VALID_STEAM)

    def test_recent_deletion_raises_409(self):
        import main as _m
        from fastapi import HTTPException
        session = MagicMock()
        recent = datetime.now(timezone.utc) - timedelta(hours=5)
        session.execute.return_value.fetchone.return_value = (recent,)
        with pytest.raises(HTTPException) as ei:
            _m._assert_identifier_cooldown(session, "wallet_address", _VALID_ADDR)
        assert ei.value.status_code == 409
        assert "cooldown" in ei.value.detail.lower()
