"""
Tests for BinanceClient — all API calls are mocked (no real keys needed).
"""

from unittest.mock import MagicMock, patch, PropertyMock
import pytest
import ccxt

from engine.src.wallet.binance_client import BinanceClient, BinanceClientError, MAX_RETRIES


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    """BinanceClient with fake credentials (no real API calls)."""
    return BinanceClient(api_key="fake_key", secret="fake_secret")


def _mock_exchange(client: BinanceClient) -> MagicMock:
    """Replace the internal ccxt exchange with a MagicMock."""
    mock = MagicMock()
    client._exchange = mock
    return mock


# ── ping ──────────────────────────────────────────────────────────────────────

class TestPing:
    def test_ping_returns_true_on_success(self, client):
        mock = _mock_exchange(client)
        mock.fetch_time.return_value = 1234567890000
        assert client.ping() is True

    def test_ping_returns_false_on_network_error(self, client):
        mock = _mock_exchange(client)
        mock.fetch_time.side_effect = ccxt.NetworkError("timeout")
        assert client.ping() is False

    def test_ping_returns_false_on_auth_error(self, client):
        mock = _mock_exchange(client)
        mock.fetch_time.side_effect = ccxt.AuthenticationError("bad key")
        assert client.ping() is False


# ── get_balance ───────────────────────────────────────────────────────────────

class TestGetBalance:
    def test_returns_usdt_balance(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.return_value = {"free": {"USDT": "250.75", "BTC": "0.01"}}
        assert client.get_balance("USDT") == 250.75

    def test_returns_btc_balance(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.return_value = {"free": {"USDT": "100", "BTC": "0.5"}}
        assert client.get_balance("BTC") == 0.5

    def test_returns_zero_for_missing_asset(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.return_value = {"free": {"USDT": "100"}}
        assert client.get_balance("ETH") == 0.0

    def test_raises_on_auth_error(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.side_effect = ccxt.AuthenticationError("invalid key")
        with pytest.raises(BinanceClientError, match="Authentication failed"):
            client.get_balance()

    def test_raises_on_exchange_error(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.side_effect = ccxt.ExchangeError("server error")
        with pytest.raises(BinanceClientError, match="Exchange error"):
            client.get_balance()


# ── get_price ─────────────────────────────────────────────────────────────────

class TestGetPrice:
    def test_returns_btc_price(self, client):
        mock = _mock_exchange(client)
        mock.fetch_ticker.return_value = {"last": 65000.0}
        assert client.get_price("BTC/USDT") == 65000.0

    def test_returns_eth_price(self, client):
        mock = _mock_exchange(client)
        mock.fetch_ticker.return_value = {"last": 3200.50}
        assert client.get_price("ETH/USDT") == 3200.50

    def test_raises_on_network_error(self, client):
        mock = _mock_exchange(client)
        mock.fetch_ticker.side_effect = ccxt.NetworkError("connection refused")
        with pytest.raises(BinanceClientError, match="Network error"):
            client.get_price()

    def test_raises_on_exchange_error(self, client):
        mock = _mock_exchange(client)
        mock.fetch_ticker.side_effect = ccxt.ExchangeError("symbol not found")
        with pytest.raises(BinanceClientError, match="Exchange error"):
            client.get_price("FAKE/USDT")


# ── get_all_balances ──────────────────────────────────────────────────────────

class TestGetAllBalances:
    def test_returns_only_nonzero_balances(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.return_value = {
            "free": {"USDT": "500", "BTC": "0.0", "ETH": "2.5", "XRP": "0"}
        }
        result = client.get_all_balances()
        assert result == {"USDT": 500.0, "ETH": 2.5}

    def test_returns_empty_dict_when_no_balance(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.return_value = {"free": {"USDT": "0", "BTC": "0"}}
        assert client.get_all_balances() == {}


# ── Rate limit retry ──────────────────────────────────────────────────────────

class TestRateLimitRetry:
    def test_retries_on_rate_limit_then_succeeds(self, client):
        mock = _mock_exchange(client)
        # Fail twice, succeed on third attempt
        mock.fetch_balance.side_effect = [
            ccxt.RateLimitExceeded("slow down"),
            ccxt.RateLimitExceeded("slow down"),
            {"free": {"USDT": "100"}},
        ]
        with patch("engine.src.wallet.binance_client.time.sleep"):
            result = client.get_balance("USDT")
        assert result == 100.0

    def test_raises_after_max_retries_exceeded(self, client):
        mock = _mock_exchange(client)
        mock.fetch_balance.side_effect = ccxt.RateLimitExceeded("too fast")
        with patch("engine.src.wallet.binance_client.time.sleep"):
            with pytest.raises(BinanceClientError, match="Rate limit exceeded"):
                client.get_balance()
        assert mock.fetch_balance.call_count == MAX_RETRIES
