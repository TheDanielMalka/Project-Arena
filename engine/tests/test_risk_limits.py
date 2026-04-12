"""
Unit + guard tests for GitHub #40 — engine/src/risk/limits.py and main._check_* caps.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.risk.limits import count_completed_high_stakes_matches, sum_daily_match_losses


_UID = str(uuid.uuid4())


def test_count_high_stakes_zero_when_min_bet_non_positive():
    session = MagicMock()
    assert count_completed_high_stakes_matches(session, _UID, stake_currency="AT", min_bet=0) == 0
    assert count_completed_high_stakes_matches(session, _UID, stake_currency="AT", min_bet=-1) == 0
    session.execute.assert_not_called()


def test_count_high_stakes_reads_scalar():
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = (7,)
    n = count_completed_high_stakes_matches(session, _UID, stake_currency="AT", min_bet=1)
    assert n == 7
    session.execute.assert_called_once()


def test_sum_losses_zero_when_row_empty():
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = None
    assert sum_daily_match_losses(session, _UID, stake_currency="CRYPTO") == 0.0


def test_sum_losses_coerces_float():
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = ("42.5",)
    assert sum_daily_match_losses(session, _UID, stake_currency="AT") == 42.5


def test_check_high_stakes_skips_when_disabled():
    import main as m

    session = MagicMock()
    with patch.object(m, "_high_stakes_daily_max", 0):
        m._check_high_stakes_daily_cap(session, _UID, "AT", 1_000_000.0)
    session.execute.assert_not_called()


def test_check_high_stakes_skips_below_threshold_at():
    import main as m

    session = MagicMock()
    with patch.object(m, "_high_stakes_daily_max", 3), patch.object(m, "_high_stakes_min_bet_at", 500):
        m._check_high_stakes_daily_cap(session, _UID, "AT", 100.0)
    session.execute.assert_not_called()


def test_check_high_stakes_429_at_cap():
    import main as m

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = (3,)
    with patch.object(m, "_high_stakes_daily_max", 3), patch.object(m, "_high_stakes_min_bet_at", 1):
        with pytest.raises(HTTPException) as ei:
            m._check_high_stakes_daily_cap(session, _UID, "AT", 100.0)
    assert ei.value.status_code == 429
    assert "high-stakes" in ei.value.detail.lower()


def test_check_daily_loss_skips_when_cap_zero():
    import main as m

    session = MagicMock()
    with patch.object(m, "_daily_loss_cap_at", 0):
        m._check_daily_loss_cap(session, _UID, "AT", 500.0)
    session.execute.assert_not_called()


def test_check_daily_loss_429_when_would_exceed_at():
    import main as m

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = (800.0,)
    with patch.object(m, "_daily_loss_cap_at", 1000):
        with pytest.raises(HTTPException) as ei:
            m._check_daily_loss_cap(session, _UID, "AT", 300.0)
    assert ei.value.status_code == 429
    assert "loss" in ei.value.detail.lower()


def test_check_daily_loss_crypto_uses_usdt_cap():
    import main as m

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = (40.0,)
    with patch.object(m, "_daily_loss_cap_usdt", 50.0):
        with pytest.raises(HTTPException) as ei:
            m._check_daily_loss_cap(session, _UID, "CRYPTO", 15.0)
    assert ei.value.status_code == 429
