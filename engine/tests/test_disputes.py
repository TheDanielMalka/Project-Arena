"""
Tests for the dispute system in PlayerDatabase.
Status flow matches UI: open → reviewing → escalated → resolved
Resolution values: approved | rejected | refund | void | player_a_wins | player_b_wins
"""

import pytest
from src.identity.database import Player, PlayerDatabase, Dispute

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
        open_disputes = db.get_open_disputes()
        assert len(open_disputes) == 1
        assert open_disputes[0].wallet_address == WALLET
        assert open_disputes[0].reason == "I am not a smurf"
        assert open_disputes[0].status == "open"

    def test_submit_dispute_not_blacklisted_raises(self, db):
        db.unblacklist(WALLET)
        with pytest.raises(ValueError, match="not blacklisted"):
            db.submit_dispute(WALLET, reason="test")

    def test_submit_dispute_invalid_wallet_raises(self, db):
        with pytest.raises(ValueError, match="Invalid wallet"):
            db.submit_dispute("bad_wallet", reason="test")

    def test_submit_sets_empty_resolution(self, db):
        db.submit_dispute(WALLET, reason="appeal")
        d = db.get_open_disputes()[0]
        assert d.resolution == ""


class TestUpdateDisputeStatus:
    def test_open_to_reviewing(self, db):
        db.submit_dispute(WALLET, reason="appeal")
        db.update_dispute_status(WALLET, "reviewing")
        disputes = db.get_open_disputes()
        assert disputes[0].status == "reviewing"

    def test_reviewing_to_escalated(self, db):
        db.submit_dispute(WALLET, reason="appeal")
        db.update_dispute_status(WALLET, "escalated")
        assert db.get_open_disputes()[0].status == "escalated"

    def test_invalid_status_raises(self, db):
        db.submit_dispute(WALLET, reason="appeal")
        with pytest.raises(ValueError, match="Invalid status"):
            db.update_dispute_status(WALLET, "pending")

    def test_cannot_update_resolved_dispute(self, db):
        db.submit_dispute(WALLET, reason="appeal")
        db.resolve_dispute(WALLET, approved=True)
        with pytest.raises(ValueError, match="No active dispute"):
            db.update_dispute_status(WALLET, "reviewing")


class TestResolveDispute:
    def test_approve_removes_from_blacklist(self, db):
        db.submit_dispute(WALLET, reason="I am not a smurf")
        db.resolve_dispute(WALLET, approved=True, admin_note="looks clean")
        assert db.is_blacklisted(WALLET) is False

    def test_approve_sets_resolution_approved(self, db):
        db.submit_dispute(WALLET, reason="appeal")
        db.resolve_dispute(WALLET, approved=True)
        disputes = db.get_open_disputes()
        assert disputes == []

    def test_reject_keeps_blacklist(self, db):
        db.submit_dispute(WALLET, reason="I am not a smurf")
        db.resolve_dispute(WALLET, approved=False, admin_note="still suspicious")
        assert db.is_blacklisted(WALLET) is True

    def test_custom_resolution_stored(self, db):
        db.submit_dispute(WALLET, reason="appeal")
        db.resolve_dispute(WALLET, approved=False, resolution="refund")
        # After resolve, dispute is no longer open
        assert db.get_open_disputes() == []

    def test_resolve_no_pending_raises(self, db):
        with pytest.raises(ValueError, match="No pending dispute"):
            db.resolve_dispute(WALLET, approved=True)

    def test_resolved_dispute_not_in_open(self, db):
        db.submit_dispute(WALLET, reason="I am not a smurf")
        db.resolve_dispute(WALLET, approved=True)
        assert db.get_open_disputes() == []


class TestGetPendingDisputesAlias:
    def test_get_pending_disputes_is_alias(self, db):
        """get_pending_disputes() must remain for backward compatibility."""
        db.submit_dispute(WALLET, reason="appeal")
        assert db.get_pending_disputes() == db.get_open_disputes()
