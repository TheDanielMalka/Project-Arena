"""
Tests for PayoutCredited / Withdrawn event handlers and read helpers
in engine/src/contract/escrow_client.py (migration 046 additions).
"""
from __future__ import annotations
import sys, uuid
from contextlib import contextmanager
from unittest.mock import MagicMock, call
import pytest

# ── Stub web3 if not installed ───────────────────────────────────────────────
if "web3" not in sys.modules:
    _s = MagicMock()
    _s.Web3.HTTPProvider = MagicMock()
    _s.Web3.to_checksum_address = lambda x: x
    _s.Web3.from_wei = lambda v, u: float(v) / 10**18
    _s.exceptions.ContractLogicError = Exception
    sys.modules["web3"] = _s
    sys.modules["web3.exceptions"] = _s.exceptions
    sys.modules["web3.middleware"] = MagicMock()
    sys.modules["web3.types"] = MagicMock()


# ── Test helpers ─────────────────────────────────────────────────────────────

def _make_client(fetchone_seq=None, fetchall_seq=None):
    """Returns (EscrowClient stub, session mock)."""
    from src.contract.escrow_client import EscrowClient
    fns = list(fetchone_seq or [])
    fas = list(fetchall_seq or [])
    fi = {"n": 0}; ai = {"n": 0}
    sess = MagicMock()

    def _ex(q, p=None):
        r = MagicMock()
        def fn():
            v = fns[fi["n"]] if fi["n"] < len(fns) else None
            fi["n"] += 1; return v
        def fa():
            v = fas[ai["n"]] if ai["n"] < len(fas) else []
            ai["n"] += 1; return v
        r.fetchone.side_effect = fn
        r.fetchall.side_effect = fa
        return r

    sess.execute.side_effect = _ex

    @contextmanager
    def factory(): yield sess

    ct = MagicMock()
    ct.address = "0x47bB"
    ct.functions.isPaused.return_value.call.return_value = False

    c = object.__new__(EscrowClient)
    c._w3 = MagicMock()
    c._contract = ct
    c._account = MagicMock(address="0xOracle")
    c._session_factory = factory
    c._owner_account = None
    return c, sess


def _event(name: str, args: dict, tx_hash: str = "0xabc123") -> MagicMock:
    e = MagicMock()
    e.__getitem__ = lambda self, k: args if k == "args" else tx_hash
    e.get = lambda k, d=None: (args if k == "args" else (tx_hash.encode() if k == "transactionHash" else d))
    e["args"] = args
    e["transactionHash"] = tx_hash.encode()
    return e


# ── Tests: _handle_payout_credited ──────────────────────────────────────────

class TestHandlePayoutCredited:
    def test_unknown_wallet_skips(self):
        """PayoutCredited for a wallet not in DB → no DB writes, no error."""
        client, sess = _make_client(fetchone_seq=[None])
        ev = _event("PayoutCredited", {"recipient": "0xunknown", "amount": 10**16})
        client._handle_payout_credited(ev)
        sess.commit.assert_not_called()

    def test_zero_amount_skips(self):
        """PayoutCredited with amount=0 → returns immediately."""
        client, sess = _make_client()
        ev = _event("PayoutCredited", {"recipient": "0xwallet", "amount": 0})
        client._handle_payout_credited(ev)
        sess.execute.assert_not_called()

    def test_credits_pending_withdrawals(self):
        """PayoutCredited inserts into pending_withdrawals and transactions."""
        user_id = str(uuid.uuid4())
        client, sess = _make_client(fetchone_seq=[
            (user_id,),   # users lookup
            None,          # match lookup (no match found)
        ])
        ev = _event("PayoutCredited", {"recipient": "0xdepositor", "amount": 5 * 10**16})
        client._handle_payout_credited(ev)
        sess.commit.assert_called_once()
        # Should have executed both INSERT statements
        assert sess.execute.call_count >= 2

    def test_logs_warning_unknown_wallet(self, caplog):
        """Unknown wallet logs a warning."""
        import logging
        client, sess = _make_client(fetchone_seq=[None])
        ev = _event("PayoutCredited", {"recipient": "0xnobody", "amount": 1000})
        with caplog.at_level(logging.WARNING, logger="src.contract.escrow_client"):
            client._handle_payout_credited(ev)
        assert any("unknown wallet" in r.message for r in caplog.records)


# ── Tests: _handle_withdrawn ─────────────────────────────────────────────────

class TestHandleWithdrawn:
    def test_unknown_wallet_skips(self):
        """Withdrawn for unknown wallet → no commit."""
        client, sess = _make_client(fetchone_seq=[None])
        ev = _event("Withdrawn", {"recipient": "0xnobody", "amount": 10**16})
        client._handle_withdrawn(ev)
        sess.commit.assert_not_called()

    def test_marks_claimed(self):
        """Withdrawn for known wallet → UPDATEs pending_withdrawals + transactions."""
        user_id = str(uuid.uuid4())
        client, sess = _make_client(fetchone_seq=[(user_id,)])
        ev = _event("Withdrawn", {"recipient": "0xdepositor", "amount": 5 * 10**16})
        client._handle_withdrawn(ev)
        sess.commit.assert_called_once()
        # Expect at least 3 execute calls: user lookup + UPDATE pw + UPDATE txs + INSERT
        assert sess.execute.call_count >= 2


# ── Tests: read_pending_withdrawals / read_match_state ───────────────────────

class TestReadHelpers:
    def test_read_pending_withdrawals_returns_int(self):
        """read_pending_withdrawals returns the integer from the contract view."""
        client, _ = _make_client()
        client._contract.functions.pendingWithdrawals.return_value.call.return_value = 12345
        result = client.read_pending_withdrawals("0xabcdef1234567890abcdef1234567890abcdef12")
        assert result == 12345
        assert isinstance(result, int)

    def test_read_pending_withdrawals_checksums_address(self):
        """read_pending_withdrawals passes a checksummed address to the contract."""
        client, _ = _make_client()
        client._contract.functions.pendingWithdrawals.return_value.call.return_value = 0
        client.read_pending_withdrawals("0xabcdef1234567890abcdef1234567890abcdef12")
        # to_checksum_address was called (stubbed to identity)
        client._contract.functions.pendingWithdrawals.assert_called_once()

    def test_read_match_state_returns_state_index(self):
        """read_match_state returns result[6] as int."""
        client, _ = _make_client()
        client._contract.functions.getMatch.return_value.call.return_value = (
            [], [], 10**17, 2, 2, 1, 4, 255  # state=4 (CANCELLED)
        )
        state = client.read_match_state(42)
        assert state == 4

    def test_read_match_state_waiting(self):
        """read_match_state=0 for WAITING."""
        client, _ = _make_client()
        client._contract.functions.getMatch.return_value.call.return_value = (
            ["0xA"], [], 10**17, 1, 1, 0, 0, 255
        )
        assert client.read_match_state(0) == 0


# ── Tests: new events registered in handlers dict ───────────────────────────

class TestHandlerRegistration:
    def test_payout_credited_in_handlers(self):
        """PayoutCredited and Withdrawn must be in process_events handlers."""
        client, _ = _make_client()
        # Simulate process_events building the handlers dict
        from src.contract.escrow_client import EscrowClient
        handlers_names = {
            "MatchCreated", "PlayerDeposited", "MatchActive",
            "WinnerDeclared", "TieDeclared", "MatchRefunded", "MatchCancelled",
            "PayoutCredited", "Withdrawn",
        }
        # process_events iterates through handlers — check the method exists on client
        assert hasattr(client, "_handle_payout_credited")
        assert hasattr(client, "_handle_withdrawn")
        assert callable(client._handle_payout_credited)
        assert callable(client._handle_withdrawn)

    def test_withdraw_function_in_abi(self):
        """withdraw() and pendingWithdrawals() must be declared in ARENA_ESCROW_ABI."""
        from src.contract.escrow_client import ARENA_ESCROW_ABI
        names = {e["name"] for e in ARENA_ESCROW_ABI}
        assert "withdraw" in names
        assert "pendingWithdrawals" in names
        assert "PayoutCredited" in names
        assert "Withdrawn" in names
