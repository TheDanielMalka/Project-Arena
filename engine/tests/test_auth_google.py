"""POST /auth/google — verify token, link or create user, JWT (same shape as login)."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

_GOOD_TOKEN = "eyJmock.header.payload.sig"


def _install_google_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")


@pytest.fixture
def google_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_google_env(monkeypatch)


def test_google_auth_not_configured_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    r = client.post("/auth/google", json={"id_token": _GOOD_TOKEN})
    assert r.status_code == 503


def test_google_auth_invalid_token_returns_401(google_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token as google_id_token

    def _boom(_tok, _req, _aud):
        raise ValueError("bad token")

    monkeypatch.setattr(google_id_token, "verify_oauth2_token", _boom)
    r = client.post("/auth/google", json={"id_token": "bad"})
    assert r.status_code == 401


def test_google_auth_creates_user(google_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token as google_id_token

    sub = f"google-sub-{uuid.uuid4().hex[:12]}"
    email = f"guser_{uuid.uuid4().hex[:8]}@example.com"

    def _ok(_tok, _req, aud):
        assert "googleusercontent.com" in aud
        return {
            "sub": sub,
            "email": email,
            "email_verified": True,
            "name": "Test Player",
        }

    monkeypatch.setattr(google_id_token, "verify_oauth2_token", _ok)

    calls = {"n": 0}

    class _Sess:
        def execute(self, *args, **kwargs):
            m = MagicMock()
            sql = str(args[0])
            calls["n"] += 1
            if "WHERE google_id" in sql and "FROM users" in sql:
                m.fetchone.return_value = None
            elif "WHERE lower(email)" in sql and "FROM users" in sql:
                m.fetchone.return_value = None
            elif sql.strip().startswith("INSERT INTO users"):
                uid = uuid.uuid4()
                m.fetchone.return_value = (uid, "Test_Player", email, "ARENA-TEST01", None)
            elif "INSERT INTO user_stats" in sql:
                m.fetchone.return_value = None
            elif "INSERT INTO user_balances" in sql:
                m.fetchone.return_value = None
            elif "INSERT INTO user_roles" in sql:
                m.fetchone.return_value = None
            elif "INSERT INTO user_settings" in sql:
                m.fetchone.return_value = None
            elif "SELECT 1 FROM users WHERE lower(username)" in sql:
                m.fetchone.return_value = None
            else:
                m.fetchone.return_value = None
                m.scalar.return_value = None
            return m

        def commit(self):
            return None

    ctx = MagicMock()
    ctx.__enter__ = lambda s: _Sess()
    ctx.__exit__ = lambda *a: None

    with patch("main.SessionLocal", return_value=ctx), patch("main.auth.issue_token", return_value="jwt-google"):
        r = client.post("/auth/google", json={"id_token": _GOOD_TOKEN})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] == "jwt-google"
    assert body["email"] == email
    assert body["requires_2fa"] is False


def test_google_auth_existing_google_id_returns_token(google_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from google.oauth2 import id_token as google_id_token

    sub = "same-google-sub-123"
    email = "existing@example.com"

    def _ok(_tok, _req, _aud):
        return {"sub": sub, "email": email, "email_verified": True, "name": "Ex"}

    monkeypatch.setattr(google_id_token, "verify_oauth2_token", _ok)

    uid = uuid.uuid4()

    class _Sess:
        def execute(self, *args, **kwargs):
            m = MagicMock()
            sql = str(args[0])
            if "WHERE google_id" in sql:
                m.fetchone.return_value = (
                    uid,
                    "ExUser",
                    email,
                    "ARENA-OLD",
                    None,
                    False,
                )
            return m

        def commit(self):
            return None

    ctx = MagicMock()
    ctx.__enter__ = lambda s: _Sess()
    ctx.__exit__ = lambda *a: None

    with patch("main.SessionLocal", return_value=ctx), patch("main.auth.issue_token", return_value="jwt-2"):
        r = client.post("/auth/google", json={"id_token": _GOOD_TOKEN})

    assert r.status_code == 200
    assert r.json()["access_token"] == "jwt-2"
