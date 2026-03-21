"""
Tests for engine/src/identity/smurf_detector.py
Covers: duplicate steam ID, blacklist, clean registration.
"""

import pytest
from src.identity.database import Player, PlayerDatabase
from src.identity.smurf_detector import SmurfDetector, SmurfDetected


# ── Fixtures ──────────────────────────────────────────────────────────────────
WALLET_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
WALLET_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
STEAM_A  = "76561198012345678"
STEAM_B  = "76561198087654321"


@pytest.fixture
def db(tmp_path):
    database = PlayerDatabase(db_path=str(tmp_path / "test.db"))
    yield database
    database.close()


@pytest.fixture
def detector(db):
    return SmurfDetector(db=db)


def add_player(db, wallet=WALLET_A, steam=STEAM_A, name="daniel", game="CS2"):
    db.add(Player(wallet_address=wallet, steam_id=steam, player_name=name, game=game))


# ── Clean registration ────────────────────────────────────────────────────────
class TestCleanRegistration:
    def test_new_wallet_and_steam_passes(self, detector):
        detector.validate(WALLET_A, STEAM_A)  # no exception = OK

    def test_same_wallet_same_steam_passes(self, db, detector):
        add_player(db)
        detector.validate(WALLET_A, STEAM_A)  # already registered, same pair = OK


# ── Duplicate Steam ID ────────────────────────────────────────────────────────
class TestDuplicateSteamID:
    def test_same_steam_different_wallet_raises(self, db, detector):
        add_player(db, wallet=WALLET_A, steam=STEAM_A)
        with pytest.raises(SmurfDetected, match="already registered"):
            detector.validate(WALLET_B, STEAM_A)

    def test_different_steam_different_wallet_passes(self, db, detector):
        add_player(db, wallet=WALLET_A, steam=STEAM_A)
        detector.validate(WALLET_B, STEAM_B)  # no exception = OK


# ── Blacklist ─────────────────────────────────────────────────────────────────
class TestBlacklist:
    def test_blacklisted_wallet_raises(self, db, detector):
        db.blacklist(WALLET_A)
        with pytest.raises(SmurfDetected, match="blacklisted"):
            detector.validate(WALLET_A, STEAM_A)

    def test_unblacklisted_wallet_passes(self, db, detector):
        db.blacklist(WALLET_A)
        db.unblacklist(WALLET_A)
        detector.validate(WALLET_A, STEAM_A)  # no exception = OK

    def test_blacklist_checked_before_duplicate(self, db, detector):
        add_player(db, wallet=WALLET_A, steam=STEAM_A)
        db.blacklist(WALLET_B)
        with pytest.raises(SmurfDetected, match="blacklisted"):
            detector.validate(WALLET_B, STEAM_A)


# ── Blacklist DB methods ──────────────────────────────────────────────────────
class TestBlacklistDB:
    def test_is_blacklisted_true(self, db):
        db.blacklist(WALLET_A)
        assert db.is_blacklisted(WALLET_A) is True

    def test_is_blacklisted_false(self, db):
        assert db.is_blacklisted(WALLET_A) is False

    def test_unblacklist_removes(self, db):
        db.blacklist(WALLET_A)
        db.unblacklist(WALLET_A)
        assert db.is_blacklisted(WALLET_A) is False

    def test_blacklist_with_reason(self, db):
        db.blacklist(WALLET_A, reason="cheating")
        assert db.is_blacklisted(WALLET_A) is True
