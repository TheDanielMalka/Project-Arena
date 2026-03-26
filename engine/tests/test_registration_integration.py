"""
Integration tests for the full player registration flow.
Tests the complete chain: register_player → SmurfDetector → PlayerDatabase.
"""

import pytest
from src.identity.database import PlayerDatabase
from src.identity.registration import register_player

WALLET_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
WALLET_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
WALLET_C = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
STEAM_A  = "76561198012345678"
STEAM_B  = "76561198087654321"
STEAM_C  = "76561198099999999"


@pytest.fixture
def db(tmp_path):
    database = PlayerDatabase(db_path=str(tmp_path / "integration.db"))
    yield database
    database.close()


# ── Full happy path ───────────────────────────────────────────────────────────
class TestFullRegistrationFlow:
    def test_player_registered_and_retrievable(self, db):
        """Player registers successfully and can be retrieved from the DB."""
        result = register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)

        assert result.success is True
        player = db.get(WALLET_A)
        assert player is not None
        assert player.wallet_address == WALLET_A
        assert player.steam_id == STEAM_A
        assert player.steam_display_name == "daniel_cs"
        assert player.game == "CS2"

    def test_display_name_stored_for_ocr(self, db):
        """The stored display name is exactly what OCR will search for."""
        register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)

        player = db.get(WALLET_A)
        assert player.steam_display_name == "daniel_cs"

    def test_multiple_different_players_can_register(self, db):
        """Three different players can register successfully."""
        r1 = register_player(WALLET_A, STEAM_A, "player_one", "CS2", db)
        r2 = register_player(WALLET_B, STEAM_B, "player_two", "CS2", db)
        r3 = register_player(WALLET_C, STEAM_C, "player_three", "Valorant", db)

        assert r1.success is True
        assert r2.success is True
        assert r3.success is True


# ── Smurf detection in full flow ─────────────────────────────────────────────
class TestSmurfDetectionFlow:
    def test_same_steam_blocked_on_second_wallet(self, db):
        """The same Steam ID cannot be registered under two different wallets."""
        register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)
        result = register_player(WALLET_B, STEAM_A, "daniel2", "CS2", db)

        assert result.success is False
        assert "already registered" in result.message

    def test_original_player_unaffected_after_smurf_attempt(self, db):
        """A smurf attempt does not affect the original registered player."""
        register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)
        register_player(WALLET_B, STEAM_A, "imposter", "CS2", db)

        player = db.get(WALLET_A)
        assert player is not None
        assert player.steam_display_name == "daniel_cs"

    def test_same_wallet_same_steam_blocked(self, db):
        """The same wallet with the same Steam ID cannot register twice."""
        register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)
        result = register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)

        assert result.success is False


# ── Blacklist in full flow ────────────────────────────────────────────────────
class TestBlacklistFlow:
    def test_blacklisted_wallet_cannot_register(self, db):
        """A blacklisted wallet cannot register."""
        db.blacklist(WALLET_A)
        result = register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)

        assert result.success is False
        assert "blacklisted" in result.message

    def test_blacklisted_player_not_saved_in_db(self, db):
        """A blacklisted wallet is not saved in the DB."""
        db.blacklist(WALLET_A)
        register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)

        assert db.get(WALLET_A) is None

    def test_unblacklisted_wallet_can_register(self, db):
        """A wallet removed from the blacklist can register."""
        db.blacklist(WALLET_A)
        db.unblacklist(WALLET_A)
        result = register_player(WALLET_A, STEAM_A, "daniel_cs", "CS2", db)

        assert result.success is True
