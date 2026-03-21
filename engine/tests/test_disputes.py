"""
Tests for the dispute system in PlayerDatabase.
"""

import pytest
from src.identity.database import Player, PlayerDatabase

WALLET = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
STEAM  = "76561198012345678"


@pytest.fixture
def db(tmp_path):
    database = PlayerDatabase(db_path=str(tmp_path / "test.db"))
    database.add(Player(wallet_address=WALLET, steam_id=STEAM, steam_display_name="daniel", game="CS2"))
    database.blacklist(WALLET, reason="smurf")
    yield database
    database.close()


class TestSubmitDispute:
    def test_submit_dispute_succeeds(self, db):
        db.submit_dispute(WALLET, reason="I am not a smurf")
        pending = db.get_pending_disputes()
        assert len(pending) == 1
        assert pending[0].wallet_address == WALLET
        assert pending[0].reason == "I am not a smurf"
        assert pending[0].status == "pending"

    def test_submit_dispute_not_blacklisted_raises(self, db):
        db.unblacklist(WALLET)
        with pytest.raises(ValueError, match="not blacklisted"):
            db.submit_dispute(WALLET, reason="test")

    def test_submit_dispute_invalid_wallet_raises(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.submit_dispute("bad_wallet", reason="test")


class TestResolveDispute:
    def test_approve_removes_from_blacklist(self, db):
        db.submit_dispute(WALLET, reason="I am not a smurf")
        db.resolve_dispute(WALLET, approved=True, admin_note="looks clean")
        assert db.is_blacklisted(WALLET) is False

    def test_reject_keeps_blacklist(self, db):
        db.submit_dispute(WALLET, reason="I am not a smurf")
        db.resolve_dispute(WALLET, approved=False, admin_note="still suspicious")
        assert db.is_blacklisted(WALLET) is True

    def test_resolve_no_pending_raises(self, db):
        with pytest.raises(ValueError, match="No pending dispute"):
            db.resolve_dispute(WALLET, approved=True)

    def test_resolved_dispute_not_in_pending(self, db):
        db.submit_dispute(WALLET, reason="I am not a smurf")
        db.resolve_dispute(WALLET, approved=True)
        assert db.get_pending_disputes() == []
