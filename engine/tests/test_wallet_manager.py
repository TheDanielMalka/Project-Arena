"""
Tests for WalletManager — all Binance calls are mocked.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
import pytest
import ccxt

from src.wallet.binance_client import BinanceClient, BinanceClientError
from src.wallet.wallet_manager import (
    WalletManager,
    InsufficientBalanceError,
    TransactionError,
    DEFAULT_ASSET,
    MAX_RETRIES,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

PLATFORM_ADDRESS = "0xPlatform1234"
PLAYER_ADDRESS   = "0xPlayer5678"


@pytest.fixture
def mock_client():
    client = MagicMock(spec=BinanceClient)
    client._exchange = MagicMock()
    return client


@pytest.fixture
def manager(mock_client):
    return WalletManager(client=mock_client, platform_address=PLATFORM_ADDRESS)


# ── check_balance ─────────────────────────────────────────────────────────────

class TestCheckBalance:
    def test_returns_balance_when_sufficient(self, manager, mock_client):
        mock_client.get_balance.return_value = 500.0
        result = manager.check_balance(required=100.0)
        assert result == 500.0

    def test_raises_when_insufficient(self, manager, mock_client):
        mock_client.get_balance.return_value = 50.0
        with pytest.raises(InsufficientBalanceError, match="need 100"):
            manager.check_balance(required=100.0)

    def test_exact_balance_is_sufficient(self, manager, mock_client):
        mock_client.get_balance.return_value = 100.0
        assert manager.check_balance(required=100.0) == 100.0

    def test_zero_required_always_passes(self, manager, mock_client):
        mock_client.get_balance.return_value = 0.0
        assert manager.check_balance(required=0.0) == 0.0

    def test_uses_correct_asset(self, manager, mock_client):
        mock_client.get_balance.return_value = 1.0
        manager.check_balance(required=0.5, asset="BTC")
        mock_client.get_balance.assert_called_once_with("BTC")


# ── send_payment ──────────────────────────────────────────────────────────────

class TestSendPayment:
    def _setup_withdraw(self, mock_client, balance=1000.0, tx_id="TX_ABC123"):
        mock_client.get_balance.return_value = balance
        mock_client._call.return_value = {"id": tx_id}

    def test_successful_payment_returns_transaction(self, manager, mock_client):
        self._setup_withdraw(mock_client)
        tx = manager.send_payment(to_address=PLAYER_ADDRESS, amount=50.0)
        assert tx.status == "success"
        assert tx.tx_hash == "TX_ABC123"
        assert tx.amount == 50.0
        assert tx.to_address == PLAYER_ADDRESS
        assert tx.from_address == PLATFORM_ADDRESS
        assert tx.asset == DEFAULT_ASSET

    def test_payment_has_utc_timestamp(self, manager, mock_client):
        self._setup_withdraw(mock_client)
        tx = manager.send_payment(to_address=PLAYER_ADDRESS, amount=10.0)
        assert tx.timestamp.tzinfo == timezone.utc

    def test_payment_logged_on_success(self, manager, mock_client):
        self._setup_withdraw(mock_client)
        manager.send_payment(to_address=PLAYER_ADDRESS, amount=10.0)
        assert len(manager.get_transaction_log()) == 1

    def test_raises_insufficient_before_sending(self, manager, mock_client):
        mock_client.get_balance.return_value = 5.0
        with pytest.raises(InsufficientBalanceError):
            manager.send_payment(to_address=PLAYER_ADDRESS, amount=100.0)
        mock_client._call.assert_not_called()

    def test_failed_payment_logged_with_failed_status(self, manager, mock_client):
        mock_client.get_balance.return_value = 1000.0
        mock_client._call.side_effect = BinanceClientError("network error")
        with pytest.raises(TransactionError):
            manager.send_payment(to_address=PLAYER_ADDRESS, amount=50.0)
        log = manager.get_transaction_log()
        assert len(log) == 1
        assert log[0].status == "failed"

    def test_raises_transaction_error_after_retries(self, manager, mock_client):
        mock_client.get_balance.return_value = 1000.0
        mock_client._call.side_effect = BinanceClientError("timeout")
        with pytest.raises(TransactionError, match="failed after"):
            manager.send_payment(to_address=PLAYER_ADDRESS, amount=50.0)
        assert mock_client._call.call_count == MAX_RETRIES

    def test_retries_then_succeeds(self, manager, mock_client):
        mock_client.get_balance.return_value = 1000.0
        mock_client._call.side_effect = [
            BinanceClientError("timeout"),
            BinanceClientError("timeout"),
            {"id": "TX_RETRY_OK"},
        ]
        tx = manager.send_payment(to_address=PLAYER_ADDRESS, amount=50.0)
        assert tx.status == "success"
        assert tx.tx_hash == "TX_RETRY_OK"
        assert mock_client._call.call_count == 3

    def test_uses_txid_fallback_when_no_id(self, manager, mock_client):
        mock_client.get_balance.return_value = 1000.0
        mock_client._call.return_value = {"txid": "TXID_FALLBACK"}
        tx = manager.send_payment(to_address=PLAYER_ADDRESS, amount=10.0)
        assert tx.tx_hash == "TXID_FALLBACK"

    def test_custom_asset(self, manager, mock_client):
        mock_client.get_balance.return_value = 5.0
        mock_client._call.return_value = {"id": "TX_BTC"}
        tx = manager.send_payment(to_address=PLAYER_ADDRESS, amount=0.01, asset="BTC")
        assert tx.asset == "BTC"


# ── transaction log ───────────────────────────────────────────────────────────

class TestTransactionLog:
    def test_log_empty_initially(self, manager):
        assert manager.get_transaction_log() == []

    def test_multiple_payments_all_logged(self, manager, mock_client):
        mock_client.get_balance.return_value = 1000.0
        mock_client._call.return_value = {"id": "TX1"}
        manager.send_payment(to_address=PLAYER_ADDRESS, amount=10.0)
        mock_client._call.return_value = {"id": "TX2"}
        manager.send_payment(to_address=PLAYER_ADDRESS, amount=20.0)
        log = manager.get_transaction_log()
        assert len(log) == 2
        assert log[0].tx_hash == "TX1"
        assert log[1].tx_hash == "TX2"

    def test_get_log_returns_copy(self, manager, mock_client):
        mock_client.get_balance.return_value = 1000.0
        mock_client._call.return_value = {"id": "TX1"}
        manager.send_payment(to_address=PLAYER_ADDRESS, amount=10.0)
        log = manager.get_transaction_log()
        log.clear()
        assert len(manager.get_transaction_log()) == 1
