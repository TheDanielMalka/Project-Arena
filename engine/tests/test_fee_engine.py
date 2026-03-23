"""
Tests for FeeEngine — Issue #24.
Verifies fee calculation accuracy, ledger integration, and edge cases.
"""

import pytest
from unittest.mock import MagicMock, call
from datetime import datetime, timezone

from src.wallet.fee_engine import FeeEngine, FeeResult, FeeConfigError, DEFAULT_FEE_PERCENT
from src.wallet.ledger import TransactionLedger, TX_FEE

WALLET  = "0x" + "a" * 40
MATCH   = "match-001"


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def engine():
    return FeeEngine()

@pytest.fixture
def mock_ledger():
    return MagicMock(spec=TransactionLedger)

@pytest.fixture
def engine_with_ledger(mock_ledger):
    return FeeEngine(ledger=mock_ledger), mock_ledger


# ── Init / config ─────────────────────────────────────────────────────────────

class TestInit:
    def test_default_fee_percent(self, engine):
        assert engine.fee_percent == DEFAULT_FEE_PERCENT

    def test_custom_fee_percent(self):
        e = FeeEngine(fee_percent=5.0)
        assert e.fee_percent == 5.0

    def test_zero_fee_allowed(self):
        e = FeeEngine(fee_percent=0.0)
        assert e.fee_percent == 0.0

    def test_max_fee_allowed(self):
        e = FeeEngine(fee_percent=50.0)
        assert e.fee_percent == 50.0

    def test_above_max_raises(self):
        with pytest.raises(FeeConfigError, match="50"):
            FeeEngine(fee_percent=51.0)

    def test_negative_fee_raises(self):
        with pytest.raises(FeeConfigError):
            FeeEngine(fee_percent=-1.0)


# ── calculate() ───────────────────────────────────────────────────────────────

class TestCalculate:
    def test_returns_fee_result(self, engine):
        result = engine.calculate(100.0, WALLET)
        assert isinstance(result, FeeResult)

    def test_default_5_percent(self, engine):
        result = engine.calculate(100.0, WALLET)
        assert result.fee_amount == 5.0
        assert result.net_amount == 95.0
        assert result.gross_amount == 100.0

    def test_10_percent_fee(self):
        e = FeeEngine(fee_percent=10.0)
        result = e.calculate(200.0, WALLET)
        assert result.fee_amount == 20.0
        assert result.net_amount == 180.0

    def test_zero_fee(self):
        e = FeeEngine(fee_percent=0.0)
        result = e.calculate(100.0, WALLET)
        assert result.fee_amount == 0.0
        assert result.net_amount == 100.0

    def test_gross_equals_fee_plus_net(self, engine):
        result = engine.calculate(77.77, WALLET)
        assert abs(result.gross_amount - (result.fee_amount + result.net_amount)) < 1e-6

    def test_stores_wallet_address(self, engine):
        result = engine.calculate(100.0, WALLET)
        assert result.wallet_address == WALLET

    def test_stores_match_id(self, engine):
        result = engine.calculate(100.0, WALLET, match_id=MATCH)
        assert result.match_id == MATCH

    def test_match_id_none_by_default(self, engine):
        result = engine.calculate(100.0, WALLET)
        assert result.match_id is None

    def test_stores_asset(self, engine):
        result = engine.calculate(100.0, WALLET, asset="BTC")
        assert result.asset == "BTC"

    def test_stores_fee_percent(self, engine):
        result = engine.calculate(100.0, WALLET)
        assert result.fee_percent == DEFAULT_FEE_PERCENT

    def test_small_amount_precision(self):
        e = FeeEngine(fee_percent=5.0)
        result = e.calculate(0.001, WALLET)
        assert result.fee_amount == round(0.001 * 0.05, 8)
        assert result.net_amount == round(0.001 * 0.95, 8)

    def test_large_amount(self):
        e = FeeEngine(fee_percent=5.0)
        result = e.calculate(100_000.0, WALLET)
        assert result.fee_amount == 5_000.0
        assert result.net_amount == 95_000.0


# ── Ledger integration ────────────────────────────────────────────────────────

class TestLedgerIntegration:
    def test_ledger_record_called_on_calculate(self, engine_with_ledger):
        engine, mock_ledger = engine_with_ledger
        engine.calculate(100.0, WALLET, match_id=MATCH)
        mock_ledger.record.assert_called_once()

    def test_ledger_record_uses_tx_fee_type(self, engine_with_ledger):
        engine, mock_ledger = engine_with_ledger
        engine.calculate(100.0, WALLET, match_id=MATCH)
        _, kwargs = mock_ledger.record.call_args
        assert kwargs["tx_type"] == TX_FEE

    def test_ledger_record_uses_correct_match_id(self, engine_with_ledger):
        engine, mock_ledger = engine_with_ledger
        engine.calculate(100.0, WALLET, match_id=MATCH)
        _, kwargs = mock_ledger.record.call_args
        assert kwargs["match_id"] == MATCH

    def test_ledger_record_uses_correct_wallet(self, engine_with_ledger):
        engine, mock_ledger = engine_with_ledger
        engine.calculate(100.0, WALLET, match_id=MATCH)
        _, kwargs = mock_ledger.record.call_args
        assert kwargs["wallet_address"] == WALLET

    def test_ledger_receives_fee_amount(self, engine_with_ledger):
        engine, mock_ledger = engine_with_ledger
        engine.calculate(100.0, WALLET)
        tx_arg = mock_ledger.record.call_args[0][0]
        assert tx_arg.amount == 5.0

    def test_no_ledger_no_crash(self, engine):
        """Engine without ledger should work silently."""
        result = engine.calculate(100.0, WALLET)
        assert result.net_amount == 95.0

    def test_ledger_not_called_without_ledger(self, mock_ledger):
        e = FeeEngine()   # no ledger
        e.calculate(100.0, WALLET)
        mock_ledger.record.assert_not_called()


# ── Convenience helpers ───────────────────────────────────────────────────────

class TestHelpers:
    def test_net_amount_helper(self, engine):
        assert engine.net_amount(100.0) == 95.0

    def test_fee_amount_helper(self, engine):
        assert engine.fee_amount(100.0) == 5.0

    def test_helpers_no_side_effects(self, engine_with_ledger):
        engine, mock_ledger = engine_with_ledger
        engine.net_amount(100.0)
        engine.fee_amount(100.0)
        mock_ledger.record.assert_not_called()
