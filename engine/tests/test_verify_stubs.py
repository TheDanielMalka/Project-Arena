"""
GET /verify/steam|riot|discord — format-only stubs until API keys land.

# TODO[VERIF]: replace format-only with real API call when steam_api_key configured
# TODO[VERIF]: Riot API when riot_api_key in platform_config
# TODO[GOOGLE]: POST /auth/google — implement after Client ID received
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_db_for_uniqueness():
    """Stub SessionLocal so uniqueness check does not hit a real DB."""
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = None
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    with patch("main.SessionLocal", return_value=ctx):
        yield


class TestVerifySteamStub:
    def test_verify_steam_valid_format(self):
        r = client.get("/verify/steam", params={"steam_id": "76561198000000001"})
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True
        assert d.get("verified_by") == "format"

    def test_verify_steam_invalid_format(self):
        r = client.get("/verify/steam", params={"steam_id": "12345"})
        assert r.status_code == 200
        assert r.json()["valid"] is False


class TestVerifyRiotStub:
    def test_verify_riot_valid_format(self):
        r = client.get("/verify/riot", params={"riot_id": "PlayerName#TAG"})
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True

    def test_verify_riot_invalid_no_tag(self):
        r = client.get("/verify/riot", params={"riot_id": "JustName"})
        assert r.status_code == 200
        assert r.json()["valid"] is False


class TestVerifyDiscordStub:
    def test_verify_discord_valid(self):
        r = client.get("/verify/discord", params={"discord_id": "12345678901234567"})
        assert r.status_code == 200
        assert r.json()["valid"] is True
