"""
Tests for engine/src/identity/registration.py
"""

import pytest
from src.identity.database import PlayerDatabase
from src.identity.registration import register_player

WALLET_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
WALLET_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
STEAM_A  = "76561198012345678"
STEAM_B  = "76561198087654321"


@pytest.fixture
def db(tmp_path):
    database = PlayerDatabase(db_path=str(tmp_path / "test.db"))
    yield database
    database.close()


class TestSuccessfulRegistration:
    def test_new_player_succeeds(self, db):
        result = register_player(WALLET_A, STEAM_A, "daniel", "CS2", db)
        assert result.success is True

    def test_player_saved_in_db(self, db):
        register_player(WALLET_A, STEAM_A, "daniel", "CS2", db)
        player = db.get(WALLET_A)
        assert player is not None
        assert player.player_name == "daniel"
        assert player.steam_id == STEAM_A


class TestDuplicateRegistration:
    def test_same_wallet_twice_fails(self, db):
        register_player(WALLET_A, STEAM_A, "daniel", "CS2", db)
        result = register_player(WALLET_A, STEAM_A, "daniel", "CS2", db)
        assert result.success is False

    def test_same_steam_different_wallet_fails(self, db):
        register_player(WALLET_A, STEAM_A, "daniel", "CS2", db)
        result = register_player(WALLET_B, STEAM_A, "daniel2", "CS2", db)
        assert result.success is False
        assert "already registered" in result.message


class TestBlacklist:
    def test_blacklisted_wallet_fails(self, db):
        db.blacklist(WALLET_A)
        result = register_player(WALLET_A, STEAM_A, "daniel", "CS2", db)
        assert result.success is False
        assert "blacklisted" in result.message


class TestInvalidInput:
    def test_invalid_wallet_fails(self, db):
        result = register_player("not_a_wallet", STEAM_A, "daniel", "CS2", db)
        assert result.success is False

    def test_invalid_steam_fails(self, db):
        result = register_player(WALLET_A, "123", "daniel", "CS2", db)
        assert result.success is False
