"""
Tests for engine client routes:
  POST /client/heartbeat
  GET  /client/status
  GET  /client/match

These routes allow the Arena desktop client to announce its presence,
display a "Client Connected" badge, and auto-detect an active match_id.
"""
from __future__ import annotations

import time
import uuid
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

import src.auth as auth
from main import app, _client_statuses, _client_store_lock

# Real JWT for routes that call Depends(verify_token)
_TEST_USER_ID = str(uuid.uuid4())
_AUTH_HEADER = {"Authorization": f"Bearer {auth.issue_token(_TEST_USER_ID, 'test@arena.gg')}"}


@pytest.fixture(autouse=True)
def clear_client_store():
    """Wipe the in-memory store before each test to prevent cross-test pollution."""
    with _client_store_lock:
        _client_statuses.clear()
    yield
    with _client_store_lock:
        _client_statuses.clear()


client = TestClient(app)


# ── POST /client/heartbeat ────────────────────────────────────────────────────

class TestClientHeartbeat:

    def test_heartbeat_returns_accepted(self):
        resp = client.post("/client/heartbeat", json={
            "wallet_address": "0xABC123",
            "client_version": "1.0.0",
            "status": "idle",
        })
        assert resp.status_code == 200
        assert resp.json()["accepted"] is True

    def test_heartbeat_stores_record(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xSTORE",
            "status": "in_game",
            "game": "CS2",
            "client_version": "1.0.0",
        })
        with _client_store_lock:
            record = _client_statuses.get("0xSTORE")
        assert record is not None
        assert record["status"] == "in_game"
        assert record["game"] == "CS2"

    def test_heartbeat_stamps_last_seen(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xTIME",
            "status": "idle",
        })
        with _client_store_lock:
            record = _client_statuses.get("0xTIME")
        assert record is not None
        assert "last_seen" in record
        assert record["last_seen"]  # non-empty

    def test_heartbeat_overwrites_previous_record(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xOVER",
            "status": "idle",
            "game": None,
        })
        client.post("/client/heartbeat", json={
            "wallet_address": "0xOVER",
            "status": "in_game",
            "game": "Valorant",
        })
        with _client_store_lock:
            record = _client_statuses.get("0xOVER")
        assert record["status"] == "in_game"
        assert record["game"] == "Valorant"

    def test_heartbeat_with_match_id(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xMATCH",
            "status": "in_match",
            "game": "CS2",
            "match_id": "M-999",
            "session_id": "sess-123",
            "client_version": "1.0.0",
        })
        with _client_store_lock:
            record = _client_statuses.get("0xMATCH")
        assert record["match_id"] == "M-999"
        assert record["session_id"] == "sess-123"

    def test_heartbeat_minimal_payload(self):
        """Only wallet_address is required — all other fields have defaults."""
        resp = client.post("/client/heartbeat", json={
            "wallet_address": "0xMIN",
        })
        assert resp.status_code == 200

    def test_heartbeat_missing_wallet_returns_422(self):
        resp = client.post("/client/heartbeat", json={"status": "idle"})
        assert resp.status_code == 422


# ── GET /client/status ────────────────────────────────────────────────────────

class TestClientStatus:

    def test_status_disconnected_when_never_seen(self):
        resp = client.get("/client/status", params={"wallet_address": "0xNEVER"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "disconnected"
        assert data["online"] is False
        assert data["last_seen"] == ""

    def test_status_online_after_recent_heartbeat(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xONLINE",
            "status": "idle",
            "client_version": "1.0.0",
        })
        resp = client.get("/client/status", params={"wallet_address": "0xONLINE"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["online"] is True
        assert data["status"] == "idle"

    def test_status_returns_correct_game(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xGAME",
            "status": "in_game",
            "game": "CS2",
        })
        resp = client.get("/client/status", params={"wallet_address": "0xGAME"})
        data = resp.json()
        assert data["game"] == "CS2"

    def test_status_returns_correct_match_id(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xMATCH2",
            "status": "in_match",
            "game": "Valorant",
            "match_id": "M-555",
        })
        resp = client.get("/client/status", params={"wallet_address": "0xMATCH2"})
        data = resp.json()
        assert data["match_id"] == "M-555"
        assert data["game"] == "Valorant"

    def test_status_returns_version(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xVER",
            "client_version": "2.3.1",
        })
        resp = client.get("/client/status", params={"wallet_address": "0xVER"})
        assert resp.json()["version"] == "2.3.1"

    def test_status_version_ok_true_for_current_version(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xVOK",
            "client_version": "1.0.0",
        })
        resp = client.get("/client/status", params={"wallet_address": "0xVOK"})
        assert resp.json()["version_ok"] is True

    def test_status_version_ok_false_for_old_version(self):
        client.post("/client/heartbeat", json={
            "wallet_address": "0xVOLD",
            "client_version": "0.9.0",
        })
        resp = client.get("/client/status", params={"wallet_address": "0xVOLD"})
        assert resp.json()["version_ok"] is False

    def test_status_user_id_none_before_bind(self):
        client.post("/client/heartbeat", json={"wallet_address": "0xUID"})
        resp = client.get("/client/status", params={"wallet_address": "0xUID"})
        assert resp.json()["user_id"] is None

    def test_status_wallet_address_echoed(self):
        resp = client.get("/client/status", params={"wallet_address": "0xECHO"})
        assert resp.json()["wallet_address"] == "0xECHO"

    def test_status_missing_wallet_returns_422(self):
        resp = client.get("/client/status")
        assert resp.status_code == 422

    def test_status_online_flag_reflects_freshness(self):
        """
        online=True immediately after heartbeat.
        We can't wait 30s in a unit test, so we verify the logic by
        directly manipulating the store with a stale timestamp.
        """
        from datetime import datetime, timezone, timedelta

        stale_time = (
            datetime.now(timezone.utc) - timedelta(seconds=60)
        ).isoformat()

        with _client_store_lock:
            _client_statuses["0xSTALE"] = {
                "wallet_address": "0xSTALE",
                "status": "idle",
                "game": None,
                "session_id": None,
                "match_id": None,
                "client_version": "1.0.0",
                "last_seen": stale_time,
            }

        resp = client.get("/client/status", params={"wallet_address": "0xSTALE"})
        assert resp.json()["online"] is False

    def test_multiple_wallets_independent(self):
        """Two different wallets maintain independent records."""
        client.post("/client/heartbeat", json={
            "wallet_address": "0xA1",
            "status": "in_game",
            "game": "CS2",
        })
        client.post("/client/heartbeat", json={
            "wallet_address": "0xB2",
            "status": "in_match",
            "game": "Valorant",
            "match_id": "M-100",
        })

        resp_a = client.get("/client/status", params={"wallet_address": "0xA1"})
        resp_b = client.get("/client/status", params={"wallet_address": "0xB2"})

        assert resp_a.json()["game"] == "CS2"
        assert resp_b.json()["game"] == "Valorant"
        assert resp_b.json()["match_id"] == "M-100"


# ── GET /client/match ─────────────────────────────────────────────────────────

class TestClientActiveMatch:

    def test_returns_null_match_when_no_db(self):
        """
        With no DB connected (CI / test env), endpoint returns match_id: null
        gracefully — never raises.
        """
        resp = client.get("/client/match", params={"wallet_address": "0xPLAYER"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["match_id"] is None
        assert data["wallet_address"] == "0xPLAYER"

    def test_echoes_wallet_address(self):
        resp = client.get("/client/match", params={"wallet_address": "0xECHO"})
        assert resp.json()["wallet_address"] == "0xECHO"

    def test_missing_wallet_returns_422(self):
        resp = client.get("/client/match")
        assert resp.status_code == 422

    def test_different_wallets_return_independently(self):
        r1 = client.get("/client/match", params={"wallet_address": "0xAAA"})
        r2 = client.get("/client/match", params={"wallet_address": "0xBBB"})
        assert r1.json()["wallet_address"] == "0xAAA"
        assert r2.json()["wallet_address"] == "0xBBB"


# ── POST /client/bind ─────────────────────────────────────────────────────────

def _make_session_mock(fetchone_return=None):
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = fetchone_return
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx, session


class TestClientBind:
    FAKE_SESSION_ID = str(uuid.uuid4())

    def test_bind_success(self):
        # Pre-seed in-memory with this session
        with _client_store_lock:
            _client_statuses["0xBIND"] = {
                "wallet_address": "0xBIND",
                "session_id": self.FAKE_SESSION_ID,
                "status": "idle",
                "user_id": None,
            }
        # DB returns row with no existing user_id
        ctx, _ = _make_session_mock(fetchone_return=(self.FAKE_SESSION_ID, None))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/client/bind",
                json={"session_id": self.FAKE_SESSION_ID},
                headers=_AUTH_HEADER,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bound"] is True
        assert data["user_id"] == _TEST_USER_ID
        assert data["session_id"] == self.FAKE_SESSION_ID

    def test_bind_updates_in_memory_user_id(self):
        sid = str(uuid.uuid4())
        with _client_store_lock:
            _client_statuses["0xBIND2"] = {
                "wallet_address": "0xBIND2",
                "session_id": sid,
                "status": "idle",
                "user_id": None,
            }
        ctx, _ = _make_session_mock(fetchone_return=(sid, None))
        with patch("main.SessionLocal", return_value=ctx):
            client.post("/client/bind", json={"session_id": sid}, headers=_AUTH_HEADER)

        with _client_store_lock:
            record = _client_statuses.get("0xBIND2")
        assert record is not None
        assert record["user_id"] == _TEST_USER_ID

    def test_bind_without_token_returns_422(self):
        resp = client.post("/client/bind", json={"session_id": self.FAKE_SESSION_ID})
        assert resp.status_code == 422

    def test_bind_invalid_token_returns_401(self):
        resp = client.post(
            "/client/bind",
            json={"session_id": self.FAKE_SESSION_ID},
            headers={"Authorization": "Bearer badtoken"},
        )
        assert resp.status_code == 401

    def test_bind_session_not_found_returns_404(self):
        ctx, _ = _make_session_mock(fetchone_return=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/client/bind",
                json={"session_id": str(uuid.uuid4())},
                headers=_AUTH_HEADER,
            )
        assert resp.status_code == 404

    def test_bind_already_bound_to_different_user_returns_403(self):
        other_user = str(uuid.uuid4())
        ctx, _ = _make_session_mock(
            fetchone_return=(self.FAKE_SESSION_ID, other_user)
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/client/bind",
                json={"session_id": self.FAKE_SESSION_ID},
                headers=_AUTH_HEADER,
            )
        assert resp.status_code == 403

    def test_bind_same_user_rebind_is_allowed(self):
        """Binding the same user again to the same session is idempotent."""
        ctx, _ = _make_session_mock(
            fetchone_return=(self.FAKE_SESSION_ID, _TEST_USER_ID)
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/client/bind",
                json={"session_id": self.FAKE_SESSION_ID},
                headers=_AUTH_HEADER,
            )
        assert resp.status_code == 200


# ── POST /auth/logout ─────────────────────────────────────────────────────────

class TestAuthLogout:

    def test_logout_returns_200(self):
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=MagicMock())
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post("/auth/logout", headers=_AUTH_HEADER)
        assert resp.status_code == 200
        assert resp.json()["logged_out"] is True

    def test_logout_clears_in_memory_session(self):
        """After logout, in-memory record for this user is removed."""
        with _client_store_lock:
            _client_statuses["0xLOGOUT"] = {
                "wallet_address": "0xLOGOUT",
                "status": "idle",
                "user_id": _TEST_USER_ID,
            }
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=MagicMock())
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            client.post("/auth/logout", headers=_AUTH_HEADER)

        with _client_store_lock:
            assert "0xLOGOUT" not in _client_statuses

    def test_logout_without_token_returns_422(self):
        resp = client.post("/auth/logout")
        assert resp.status_code == 422

    def test_logout_invalid_token_returns_401(self):
        resp = client.post(
            "/auth/logout",
            headers={"Authorization": "Bearer faketoken"},
        )
        assert resp.status_code == 401
