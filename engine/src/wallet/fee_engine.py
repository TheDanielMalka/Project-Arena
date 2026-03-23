"""
ARENA Engine — Fee Engine (Platform Commission)
Issue #24: Calculates and logs platform fees on every match payout.

Default fee: 5% of the gross payout amount.
Fee deductions are logged in TransactionLedger (Issue #22) as tx_type="fee".

TODO (requires M5 Smart Contract):
    - Route fee amount to platform wallet on-chain via Escrow contract.
      Currently fee is calculated and logged but not transferred on-chain.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from src.wallet.ledger import TransactionLedger

from src.wallet.wallet_manager import Transaction

log = logging.getLogger("wallet.fee_engine")

# ── Constants ─────────────────────────────────────────────────────────────────
DEFAULT_FEE_PERCENT = 5.0    # 5% platform commission
MIN_FEE_PERCENT     = 0.0
MAX_FEE_PERCENT     = 50.0   # safety cap


# ── Exceptions ────────────────────────────────────────────────────────────────
class FeeConfigError(Exception):
    """Raised when fee percentage is out of allowed range."""


# ── Result dataclass ──────────────────────────────────────────────────────────
@dataclass
class FeeResult:
    gross_amount:   float   # original payout before fee
    fee_amount:     float   # amount deducted as platform commission
    net_amount:     float   # what the player actually receives
    fee_percent:    float   # fee percentage applied
    asset:          str     # e.g. "USDT"
    match_id:       Optional[str]
    wallet_address: str


# ── Fee Engine ────────────────────────────────────────────────────────────────
class FeeEngine:
    """
    Calculates platform commission on match payouts.

    Usage:
        engine = FeeEngine()                        # 5% default
        engine = FeeEngine(fee_percent=5.0)         # custom %
        engine = FeeEngine(ledger=my_ledger)        # with ledger logging

    Flow:
        1. calculate(gross, wallet, match_id) → FeeResult
        2. FeeResult.net_amount → sent to player via WalletManager
        3. FeeResult.fee_amount → logged in ledger as TX_FEE
        4. TODO: route fee on-chain via M5 Smart Contract Escrow
    """

    def __init__(
        self,
        fee_percent: float = DEFAULT_FEE_PERCENT,
        platform_address: str = "",
        ledger: Optional[TransactionLedger] = None,
    ) -> None:
        if not (MIN_FEE_PERCENT <= fee_percent <= MAX_FEE_PERCENT):
            raise FeeConfigError(
                f"fee_percent must be between {MIN_FEE_PERCENT} and {MAX_FEE_PERCENT}, "
                f"got {fee_percent}"
            )
        self._fee_percent     = fee_percent
        self._platform_address = platform_address
        self._ledger          = ledger
        log.info("FeeEngine ready | fee=%.1f%%", fee_percent)

    # ── Properties ────────────────────────────────────────────────────────────
    @property
    def fee_percent(self) -> float:
        return self._fee_percent

    # ── Core calculation ──────────────────────────────────────────────────────
    def calculate(
        self,
        gross_amount: float,
        wallet_address: str,
        asset: str = "USDT",
        match_id: Optional[str] = None,
    ) -> FeeResult:
        """
        Calculate fee deduction for a payout.

        Args:
            gross_amount:   Total payout before fee.
            wallet_address: Winning player's wallet.
            asset:          Token type, e.g. "USDT".
            match_id:       Match this payout belongs to.

        Returns:
            FeeResult with gross, fee, and net amounts.
        """
        fee_amount = round(gross_amount * self._fee_percent / 100, 8)
        net_amount = round(gross_amount - fee_amount, 8)

        result = FeeResult(
            gross_amount=gross_amount,
            fee_amount=fee_amount,
            net_amount=net_amount,
            fee_percent=self._fee_percent,
            asset=asset,
            match_id=match_id,
            wallet_address=wallet_address,
        )

        log.info(
            "fee | wallet=%s match=%s gross=%.4f fee=%.4f net=%.4f %s",
            wallet_address, match_id, gross_amount, fee_amount, net_amount, asset,
        )

        if self._ledger is not None:
            self._log_fee(result)

        return result

    # ── Ledger logging ────────────────────────────────────────────────────────
    def _log_fee(self, result: FeeResult) -> None:
        """Log the fee deduction in TransactionLedger as tx_type='fee'."""
        from src.wallet.ledger import TX_FEE
        fee_tx = Transaction(
            amount=result.fee_amount,
            to_address=self._platform_address,
            from_address=result.wallet_address,
            asset=result.asset,
            timestamp=datetime.now(timezone.utc),
            tx_hash=None,
            # TODO (M5): set tx_hash once fee is routed on-chain via Smart Contract
            status="success",
        )
        self._ledger.record(
            fee_tx,
            wallet_address=result.wallet_address,
            tx_type=TX_FEE,
            match_id=result.match_id,
        )

    # ── Convenience ───────────────────────────────────────────────────────────
    def net_amount(self, gross_amount: float) -> float:
        """Quick helper — returns net amount after fee, no logging."""
        return round(gross_amount * (1 - self._fee_percent / 100), 8)

    def fee_amount(self, gross_amount: float) -> float:
        """Quick helper — returns only the fee amount, no logging."""
        return round(gross_amount * self._fee_percent / 100, 8)
