"""
Tests for engine/src/identity/verifier.py
Covers: steps 1, 2, 3, 5 — registration check, blacklist check, daily match limit, edge cases.
"""

import pytest
from src.identity.database import Player, PlayerDatabase
from src.identity.verifier import MatchVerifier


# ── Helpers ───────────────────────────────────────────────────────────────────
WALLET = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12"

def make_player(wallet=WALLET):
    return Player(
        wallet_address=wallet,
        steam_id="76561198012345678",
        steam_display_name="daniel_cs",
        game="CS2",
    )


@pytest.fixture
def db(tmp_path):
    database = PlayerDatabase(db_path=str(tmp_path / "test.db"))
    yield database
    database.close()


@pytest.fixture
def verifier(db):
    return MatchVerifier(db=db)


# ── Check 1: Is the player registered? ───────────────────────────────────────
class TestRegistrationCheck:
    def test_registered_player_passes(self, db, verifier):
        db.add(make_player())
        result = verifier.verify(WALLET)
        assert result.approved is True

    def test_unregistered_player_rejected(self, verifier):
        result = verifier.verify(WALLET)
        assert result.approved is False
        assert "not registered" in result.reason

    def test_unregistered_reason_is_clear(self, verifier):
        result = verifier.verify(WALLET)
        assert result.reason != ""


# ── Check 2: Is the player blacklisted? ──────────────────────────────────────
class TestBlacklistCheck:
    def test_blacklisted_player_rejected(self, db, verifier):
        db.add(make_player())
        db.blacklist(WALLET, reason="smurf")
        result = verifier.verify(WALLET)
        assert result.approved is False
        assert "banned" in result.reason

    def test_non_blacklisted_player_passes(self, db, verifier):
        db.add(make_player())
        result = verifier.verify(WALLET)
        assert result.approved is True

    def test_unblacklisted_player_passes_again(self, db, verifier):
        db.add(make_player())
        db.blacklist(WALLET)
        db.unblacklist(WALLET)
        result = verifier.verify(WALLET)
        assert result.approved is True


# ── Check 3: Daily match limit ────────────────────────────────────────────────
class TestDailyMatchLimit:
    def test_under_limit_passes(self, db):
        verifier = MatchVerifier(db=db, daily_match_limit=3)
        db.add(make_player())
        db.log_match(WALLET)
        db.log_match(WALLET)
        result = verifier.verify(WALLET)
        assert result.approved is True

    def test_exactly_at_limit_rejected(self, db):
        verifier = MatchVerifier(db=db, daily_match_limit=3)
        db.add(make_player())
        for _ in range(3):
            db.log_match(WALLET)
        result = verifier.verify(WALLET)
        assert result.approved is False
        assert "limit" in result.reason

    def test_over_limit_rejected(self, db):
        verifier = MatchVerifier(db=db, daily_match_limit=3)
        db.add(make_player())
        for _ in range(5):
            db.log_match(WALLET)
        result = verifier.verify(WALLET)
        assert result.approved is False

    def test_zero_matches_passes(self, db, verifier):
        db.add(make_player())
        result = verifier.verify(WALLET)
        assert result.approved is True

    def test_limit_reason_mentions_number(self, db):
        verifier = MatchVerifier(db=db, daily_match_limit=10)
        db.add(make_player())
        for _ in range(10):
            db.log_match(WALLET)
        result = verifier.verify(WALLET)
        assert "10" in result.reason


# ── Check 5: Edge cases ───────────────────────────────────────────────────────
WALLET_B = "0x1111111111111111111111111111111111111111"

class TestEdgeCases:
    def test_invalid_wallet_raises(self, verifier):
        """An invalid wallet raises an error before any check runs."""
        with pytest.raises(ValueError):
            verifier.verify("not_a_wallet")

    def test_two_players_independent(self, db):
        """Player A's limit does not affect player B."""
        verifier = MatchVerifier(db=db, daily_match_limit=2)
        db.add(make_player(wallet=WALLET))
        db.add(Player(
            wallet_address=WALLET_B,
            steam_id="76561198099999999",
            steam_display_name="player_b",
            game="CS2",
        ))
        for _ in range(2):
            db.log_match(WALLET)
        result = verifier.verify(WALLET_B)
        assert result.approved is True

    def test_blacklist_checked_before_limit(self, db):
        """A blacklisted player is rejected due to the ban, not the match limit."""
        verifier = MatchVerifier(db=db, daily_match_limit=3)
        db.add(make_player())
        db.blacklist(WALLET)
        for _ in range(5):
            db.log_match(WALLET)
        result = verifier.verify(WALLET)
        assert result.approved is False
        assert "banned" in result.reason

    def test_approved_result_has_ok_reason(self, db, verifier):
        """An approved player receives reason OK."""
        db.add(make_player())
        result = verifier.verify(WALLET)
        assert result.reason == "OK"

    def test_all_rejections_have_nonempty_reason(self, db):
        """Every rejection reason is never empty."""
        verifier = MatchVerifier(db=db, daily_match_limit=1)
        db.add(make_player())
        db.log_match(WALLET)
        result = verifier.verify(WALLET)
        assert result.approved is False
        assert len(result.reason) > 0
