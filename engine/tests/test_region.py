"""
PATCH /users/settings — region; GET /auth/me includes region.

# TODO[GOOGLE]: POST /auth/google — implement after Client ID received
# TODO[VERIF]: Steam/Riot API call — implement after API keys in platform_config
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

_USER_ID = str(uuid.uuid4())
_TOKEN = auth.issue_token(_USER_ID, "region@arena.gg", "RegionUser")
_HEADERS = {"Authorization": f"Bearer {_TOKEN}"}


@pytest.fixture(autouse=True)
def _daily_patches():
    with patch("main._get_daily_staked", return_value=0), patch("main._get_daily_limit", return_value=50_000):
        yield


def _me_row(region: str = "NA"):
    return (
        _USER_ID,
        "RegionUser",
        "region@arena.gg",
        "ARENA-RG001",
        "Gold",
        None,
        None,
        None,
        100,
        1,
        2,
        "initials",
        "default",
        None,
        [],
        None,
        500,
        "user",
        region,
    )


class TestUserSettingsRegion:
    def test_save_region_eu(self):
        session = MagicMock()
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.patch("/users/settings", json={"region": "eu"}, headers=_HEADERS)
        assert r.status_code == 200
        assert r.json() == {"region": "EU"}
        assert session.execute.called
        assert session.commit.called

    def test_save_invalid_region_returns_400(self):
        """Unknown region string → 400 (handler), not Pydantic 422."""
        session = MagicMock()
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.patch("/users/settings", json={"region": "ZZ"}, headers=_HEADERS)
        assert r.status_code == 400

    def test_save_invalid_region_type_returns_422(self):
        """Malformed body (region not a string) → 422 validation error."""
        r = client.patch("/users/settings", json={"region": 123}, headers=_HEADERS)
        assert r.status_code == 422


class TestAuthMeRegion:
    def test_region_returned_in_auth_me(self):
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = _me_row("ASIA")
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__ = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            r = client.get("/auth/me", headers=_HEADERS)
        assert r.status_code == 200
        assert r.json()["region"] == "ASIA"
