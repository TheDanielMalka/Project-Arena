"""
POST /auth/2fa/setup|verify|confirm, DELETE /auth/2fa — TOTP (Phase 4).

# TODO[GOOGLE]: POST /auth/google — implement after Client ID received
# TODO[VERIF]: Steam/Riot API call — implement after API keys in platform_config
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import jwt
import pyotp
import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

_USER_ID = str(uuid.uuid4())
_TOKEN = auth.issue_token(_USER_ID, "twofa@arena.gg", "TwoFAUser")
_HEADERS = {"Authorization": f"Bearer {_TOKEN}"}

_TOTP_SECRET = "JBSWY3DPEHPK3PXP"  # valid base32


def _valid_code() -> str:
    return pyotp.TOTP(_TOTP_SECRET).now()


@pytest.fixture(autouse=True)
def _daily_patches():
    with patch("main._get_daily_staked", return_value=0), patch("main._get_daily_limit", return_value=50_000):
        yield


class TestTwoFASetup:
    def test_2fa_setup_returns_secret_and_qr(self):
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = ("twofa@arena.gg",)
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.post("/auth/2fa/setup", headers=_HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert "secret" in data and len(data["secret"]) >= 16
        assert "qr_uri" in data
        assert data["qr_uri"].startswith("otpauth://totp/")
        assert "secret=" in data["qr_uri"]


class TestTwoFAVerify:
    def test_2fa_verify_correct_code(self):
        """Enabling 2FA sets totp_enabled=TRUE (UPDATE executed)."""
        code = _valid_code()
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            (_TOTP_SECRET,),  # SELECT totp_secret
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.post("/auth/2fa/verify", json={"code": code}, headers=_HEADERS)
        assert r.status_code == 200
        assert r.json() == {"enabled": True}
        texts = [str(c.args[0]) for c in session.execute.call_args_list if c.args]
        assert any("totp_enabled = TRUE" in t for t in texts)

    def test_2fa_verify_wrong_code(self):
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = (_TOTP_SECRET,)
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.post("/auth/2fa/verify", json={"code": "000000"}, headers=_HEADERS)
        assert r.status_code == 400


class TestTwoFALoginFlow:
    def test_login_with_2fa_enabled(self):
        ph = auth.hash_password("secret123")
        row = (
            _USER_ID,
            "u",
            "e@e.com",
            ph,
            "ARENA-TST",
            None,
            True,  # totp_enabled
            _TOTP_SECRET,
        )
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = row
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.post("/auth/login", json={"identifier": "e@e.com", "password": "secret123"})
        assert r.status_code == 200
        data = r.json()
        assert data.get("requires_2fa") is True
        assert data.get("temp_token")
        assert not data.get("access_token")

    def test_2fa_confirm_correct(self):
        temp = auth.issue_2fa_pending_token(_USER_ID)
        code = _valid_code()
        row = ("u", "e@e.com", "ARENA-TST", None, _TOTP_SECRET, True)
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = row
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.post("/auth/2fa/confirm", json={"temp_token": temp, "code": code})
        assert r.status_code == 200
        data = r.json()
        assert data.get("access_token")
        assert data.get("requires_2fa") is False

    def test_2fa_confirm_expired_token(self):
        import src.auth as auth_mod

        now = datetime.now(timezone.utc)
        expired = jwt.encode(
            {
                "sub": _USER_ID,
                "token_use": "2fa_pending",
                "iat": now - timedelta(minutes=30),
                "exp": now - timedelta(minutes=1),
            },
            auth_mod._JWT_SECRET,
            algorithm=auth_mod._JWT_ALGORITHM,
        )
        r = client.post(
            "/auth/2fa/confirm",
            json={"temp_token": expired, "code": "123456"},
        )
        assert r.status_code == 401


class TestTwoFADisable:
    def test_2fa_disable_correct(self):
        ph = auth.hash_password("mypass")
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = (ph, _TOTP_SECRET, True)
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        code = _valid_code()
        with patch("main.SessionLocal", return_value=ctx):
            r = client.request(
                "DELETE",
                "/auth/2fa",
                json={"password": "mypass", "code": code},
                headers=_HEADERS,
            )
        assert r.status_code == 200
        assert r.json().get("disabled") is True
        texts = [str(c.args[0]) for c in session.execute.call_args_list if c.args]
        assert any("totp_enabled = FALSE" in t and "totp_secret = NULL" in t for t in texts)
