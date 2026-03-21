"""
Tests for engine/src/identity/database.py
Covers: add, get, update, delete, validation.
"""

import pytest
from src.identity.database import Player, PlayerDatabase


# ── Helpers ───────────────────────────────────────────────────────────────────
def make_player(
    wallet="0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    steam_id="76561198012345678",
    steam_display_name="daniel_cs",
    game="CS2",
) -> Player:
    return Player(wallet_address=wallet, steam_id=steam_id, steam_display_name=steam_display_name, game=game)


@pytest.fixture
def db(tmp_path):
    """Fresh in-memory-like DB for each test (temp file, auto-cleaned)."""
    db_file = str(tmp_path / "test_players.db")
    database = PlayerDatabase(db_path=db_file)
    yield database
    database.close()


# ── Add ───────────────────────────────────────────────────────────────────────
class TestAdd:
    def test_add_player_succeeds(self, db):
        db.add(make_player())
        player = db.get("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")
        assert player is not None
        assert player.steam_display_name == "daniel_cs"

    def test_add_duplicate_raises(self, db):
        db.add(make_player())
        with pytest.raises(ValueError, match="already exists"):
            db.add(make_player())

    def test_add_invalid_wallet_raises(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.add(make_player(wallet="not_a_wallet"))

    def test_add_invalid_steam_raises(self, db):
        with pytest.raises(ValueError, match="Invalid Steam ID"):
            db.add(make_player(steam_id="123"))


# ── Get ───────────────────────────────────────────────────────────────────────
class TestGet:
    def test_get_existing_player(self, db):
        db.add(make_player())
        player = db.get("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")
        assert player.steam_id == "76561198012345678"
        assert player.game == "CS2"

    def test_get_nonexistent_returns_none(self, db):
        result = db.get("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")
        assert result is None

    def test_get_invalid_wallet_raises(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.get("bad_wallet")


# ── Update ────────────────────────────────────────────────────────────────────
class TestUpdate:
    def test_update_steam_display_name(self, db):
        db.add(make_player())
        updated = make_player(steam_display_name="new_name")
        db.update(updated)
        player = db.get("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")
        assert player.steam_display_name == "new_name"

    def test_update_game(self, db):
        db.add(make_player())
        updated = make_player(game="Valorant")
        db.update(updated)
        player = db.get("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")
        assert player.game == "Valorant"

    def test_update_nonexistent_raises(self, db):
        with pytest.raises(ValueError, match="not found"):
            db.update(make_player())

    def test_update_invalid_wallet_raises(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.update(make_player(wallet="bad"))


# ── Delete ────────────────────────────────────────────────────────────────────
class TestDelete:
    def test_delete_existing_player(self, db):
        db.add(make_player())
        db.delete("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")
        assert db.get("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12") is None

    def test_delete_nonexistent_raises(self, db):
        with pytest.raises(ValueError, match="not found"):
            db.delete("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")

    def test_delete_invalid_wallet_raises(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.delete("bad_wallet")


# ── Validation ────────────────────────────────────────────────────────────────
class TestValidation:
    def test_wallet_must_start_with_0x(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.add(make_player(wallet="AbCdEf1234567890AbCdEf1234567890AbCdEf12"))

    def test_wallet_must_be_42_chars(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.add(make_player(wallet="0x123"))

    def test_steam_id_must_be_17_digits(self, db):
        with pytest.raises(ValueError, match="Invalid Steam ID"):
            db.add(make_player(steam_id="1234567890123456"))  # 16 digits

    def test_steam_id_cannot_contain_letters(self, db):
        with pytest.raises(ValueError, match="Invalid Steam ID"):
            db.add(make_player(steam_id="7656119801234567X"))
