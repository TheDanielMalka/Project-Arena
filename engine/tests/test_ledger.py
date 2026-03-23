"""
Tests for TransactionLedger — Issue #22.
All tests use an in-memory SQLite DB (:memory:) — no files created.
"""

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from src.wallet.ledger import TransactionLedger, LedgerEntry, TX_DEPOSIT, TX_PAYOUT, TX_FEE
from src.wallet.wallet_manager import Transaction


# ── Helpers ───────────────────────────────────────────────────────────────────

WALLET_A = "0x" + "a" * 40
WALLET_B = "0x" + "b" * 40
MATCH_1  = "match-001"
MATCH_2  = "match-002"


def make_tx(amount=10.0, asset="USDT", tx_hash="TX123", status="success"):
    return Transaction(
        amount=amount,
        to_address=WALLET_A,
        from_address="0x" + "0" * 40,
        asset=asset,
        timestamp=datetime(2026, 3, 23, 12, 0, 0, tzinfo=timezone.utc),
        tx_hash=tx_hash,
        status=status,
    )


@pytest.fixture
def ledger():
    """In-memory ledger — isolated per test."""
    l = TransactionLedger(db_path=":memory:")
    yield l
    l.close()


# ── record() ──────────────────────────────────────────────────────────────────

class TestRecord:
    def test_record_returns_tx_id(self, ledger):
        tx_id = ledger.record(make_tx(), WALLET_A)
        assert isinstance(tx_id, int)
        assert tx_id >= 1

    def test_record_increments_tx_id(self, ledger):
        id1 = ledger.record(make_tx(), WALLET_A)
        id2 = ledger.record(make_tx(), WALLET_A)
        assert id2 == id1 + 1

    def test_record_stores_all_fields(self, ledger):
        tx = make_tx(amount=25.0, asset="USDT", tx_hash="HASH_XYZ", status="success")
        ledger.record(tx, WALLET_A, tx_type=TX_PAYOUT, match_id=MATCH_1)
        entries = ledger.get_all()
        assert len(entries) == 1
        e = entries[0]
        assert e.wallet_address == WALLET_A
        assert e.match_id == MATCH_1
        assert e.tx_type == TX_PAYOUT
        assert e.amount == 25.0
        assert e.asset == "USDT"
        assert e.tx_hash == "HASH_XYZ"
        assert e.status == "success"

    def test_record_deposit_type(self, ledger):
        ledger.record(make_tx(), WALLET_A, tx_type=TX_DEPOSIT)
        e = ledger.get_all()[0]
        assert e.tx_type == TX_DEPOSIT

    def test_record_fee_type(self, ledger):
        ledger.record(make_tx(), WALLET_A, tx_type=TX_FEE)
        e = ledger.get_all()[0]
        assert e.tx_type == TX_FEE

    def test_record_failed_tx(self, ledger):
        tx = make_tx(status="failed", tx_hash=None)
        ledger.record(tx, WALLET_A)
        e = ledger.get_all()[0]
        assert e.status == "failed"
        assert e.tx_hash is None

    def test_record_no_match_id(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        e = ledger.get_all()[0]
        assert e.match_id is None

    def test_record_datetime_serialized(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        e = ledger.get_all()[0]
        assert "2026-03-23" in e.timestamp


# ── get_by_wallet() ───────────────────────────────────────────────────────────

class TestGetByWallet:
    def test_returns_only_matching_wallet(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        ledger.record(make_tx(), WALLET_B)
        results = ledger.get_by_wallet(WALLET_A)
        assert len(results) == 1
        assert results[0].wallet_address == WALLET_A

    def test_returns_all_entries_for_wallet(self, ledger):
        for _ in range(3):
            ledger.record(make_tx(), WALLET_A)
        assert len(ledger.get_by_wallet(WALLET_A)) == 3

    def test_returns_empty_for_unknown_wallet(self, ledger):
        assert ledger.get_by_wallet(WALLET_B) == []


# ── get_by_match() ────────────────────────────────────────────────────────────

class TestGetByMatch:
    def test_returns_only_matching_match(self, ledger):
        ledger.record(make_tx(), WALLET_A, match_id=MATCH_1)
        ledger.record(make_tx(), WALLET_B, match_id=MATCH_2)
        results = ledger.get_by_match(MATCH_1)
        assert len(results) == 1
        assert results[0].match_id == MATCH_1

    def test_multiple_entries_same_match(self, ledger):
        ledger.record(make_tx(), WALLET_A, match_id=MATCH_1)
        ledger.record(make_tx(), WALLET_B, match_id=MATCH_1)
        assert len(ledger.get_by_match(MATCH_1)) == 2

    def test_returns_empty_for_unknown_match(self, ledger):
        assert ledger.get_by_match("nonexistent") == []


# ── get_by_date() ─────────────────────────────────────────────────────────────

class TestGetByDate:
    def test_returns_entries_for_date(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        results = ledger.get_by_date("2026-03-23")
        assert len(results) == 1

    def test_returns_empty_for_different_date(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        assert ledger.get_by_date("2025-01-01") == []


# ── get_all() ─────────────────────────────────────────────────────────────────

class TestGetAll:
    def test_empty_ledger(self, ledger):
        assert ledger.get_all() == []

    def test_returns_all_entries(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        ledger.record(make_tx(), WALLET_B)
        assert len(ledger.get_all()) == 2

    def test_ordered_by_tx_id(self, ledger):
        ledger.record(make_tx(amount=10.0), WALLET_A)
        ledger.record(make_tx(amount=20.0), WALLET_B)
        entries = ledger.get_all()
        assert entries[0].amount == 10.0
        assert entries[1].amount == 20.0


# ── export_json() ─────────────────────────────────────────────────────────────

class TestExportJson:
    def test_valid_json(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        result = json.loads(ledger.export_json())
        assert isinstance(result, list)
        assert len(result) == 1

    def test_json_contains_correct_fields(self, ledger):
        ledger.record(make_tx(amount=50.0), WALLET_A)
        data = json.loads(ledger.export_json())[0]
        assert data["wallet_address"] == WALLET_A
        assert data["amount"] == 50.0
        assert "tx_id" in data
        assert "timestamp" in data

    def test_json_filtered_by_wallet(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        ledger.record(make_tx(), WALLET_B)
        result = json.loads(ledger.export_json(wallet_address=WALLET_A))
        assert len(result) == 1
        assert result[0]["wallet_address"] == WALLET_A

    def test_json_empty_ledger(self, ledger):
        assert json.loads(ledger.export_json()) == []


# ── export_csv() ──────────────────────────────────────────────────────────────

class TestExportCsv:
    def test_csv_has_header(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        csv_str = ledger.export_csv()
        assert "tx_id" in csv_str
        assert "wallet_address" in csv_str
        assert "amount" in csv_str

    def test_csv_has_data_row(self, ledger):
        ledger.record(make_tx(amount=99.0), WALLET_A)
        csv_str = ledger.export_csv()
        assert "99.0" in csv_str

    def test_csv_filtered_by_wallet(self, ledger):
        ledger.record(make_tx(), WALLET_A)
        ledger.record(make_tx(), WALLET_B)
        csv_str = ledger.export_csv(wallet_address=WALLET_A)
        assert WALLET_B not in csv_str
        assert WALLET_A in csv_str

    def test_csv_empty_ledger(self, ledger):
        csv_str = ledger.export_csv()
        lines = [l for l in csv_str.strip().splitlines() if l]
        assert len(lines) == 1   # header only


# ── WalletManager integration ─────────────────────────────────────────────────

class TestWalletManagerIntegration:
    """Verify WalletManager correctly feeds the ledger."""

    def _make_manager(self, ledger):
        from src.wallet.wallet_manager import WalletManager
        from src.wallet.binance_client import BinanceClient
        client = MagicMock(spec=BinanceClient)
        client._exchange = MagicMock()
        client.get_balance.return_value = 1000.0
        client._call.return_value = {"id": "TX_INTEGRATED"}
        return WalletManager(
            client=client,
            platform_address="0x" + "p" * 40,
            ledger=ledger,
        )

    def test_payment_auto_recorded_in_ledger(self, ledger):
        manager = self._make_manager(ledger)
        manager.send_payment(WALLET_A, amount=30.0, match_id=MATCH_1, tx_type=TX_PAYOUT)
        entries = ledger.get_by_wallet(WALLET_A)
        assert len(entries) == 1
        assert entries[0].amount == 30.0
        assert entries[0].match_id == MATCH_1
        assert entries[0].tx_type == TX_PAYOUT
        assert entries[0].status == "success"

    def test_failed_payment_recorded_in_ledger(self, ledger):
        from src.wallet.binance_client import BinanceClientError
        from src.wallet.wallet_manager import WalletManager, TransactionError
        from src.wallet.binance_client import BinanceClient
        client = MagicMock(spec=BinanceClient)
        client._exchange = MagicMock()
        client.get_balance.return_value = 1000.0
        client._call.side_effect = BinanceClientError("timeout")
        manager = WalletManager(client=client, platform_address="0x" + "p" * 40, ledger=ledger)
        with pytest.raises(TransactionError):
            manager.send_payment(WALLET_A, amount=50.0)
        entries = ledger.get_all()
        assert len(entries) == 1
        assert entries[0].status == "failed"

    def test_manager_without_ledger_still_works(self):
        """Backward compatibility — no ledger param = no crash."""
        from src.wallet.wallet_manager import WalletManager
        from src.wallet.binance_client import BinanceClient
        client = MagicMock(spec=BinanceClient)
        client._exchange = MagicMock()
        client.get_balance.return_value = 1000.0
        client._call.return_value = {"id": "TX_NO_LEDGER"}
        manager = WalletManager(client=client, platform_address="0x" + "p" * 40)
        tx = manager.send_payment(WALLET_A, amount=10.0)
        assert tx.status == "success"
