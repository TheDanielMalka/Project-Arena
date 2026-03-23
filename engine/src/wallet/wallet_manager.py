"""
ARENA Engine — Wallet Balance & Transaction Module
Manages deposits, payouts, and transaction logging for the platform wallet.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from src.wallet.ledger import TransactionLedger

import ccxt

from src.wallet.binance_client import BinanceClient, BinanceClientError

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────
DEFAULT_ASSET = "USDT"
MAX_RETRIES = 3


# ── Exceptions ───────────────────────────────────────────────────────────────

class InsufficientBalanceError(Exception):
    """Raised when the platform wallet lacks funds for a payout."""


class TransactionError(Exception):
    """Raised when a payment fails after exhausting retries."""


# ── Data model ───────────────────────────────────────────────────────────────

@dataclass
class Transaction:
    amount: float
    to_address: str
    from_address: str
    asset: str
    timestamp: datetime
    tx_hash: Optional[str] = None
    status: str = "pending"   # pending | success | failed


# ── Manager ──────────────────────────────────────────────────────────────────

class WalletManager:
    """
    High-level wallet operations for the ARENA platform.

    Wraps BinanceClient and adds:
    - balance validation before every payout
    - retry logic for transient network failures
    - in-memory transaction log (handed off to Issue #22 ledger later)
    """

    def __init__(
        self,
        client: BinanceClient,
        platform_address: str,
        ledger: Optional[TransactionLedger] = None,
    ) -> None:
        self._client = client
        self._platform_address = platform_address
        self._ledger = ledger          # Issue #22 — optional persistent ledger
        self._log: list[Transaction] = []

    # ── Balance ──────────────────────────────────────────────────────────────

    def check_balance(self, required: float, asset: str = DEFAULT_ASSET) -> float:
        """
        Return available balance. Raise InsufficientBalanceError if below *required*.

        Args:
            required: Minimum amount needed.
            asset:    Ticker, e.g. "USDT".

        Returns:
            Current free balance.
        """
        balance = self._client.get_balance(asset)
        if balance < required:
            raise InsufficientBalanceError(
                f"Insufficient {asset}: need {required}, have {balance:.4f}"
            )
        return balance

    # ── Payment ──────────────────────────────────────────────────────────────

    def send_payment(
        self,
        to_address: str,
        amount: float,
        asset: str = DEFAULT_ASSET,
        match_id: Optional[str] = None,
        tx_type: str = "match_win",
    ) -> Transaction:
        """
        Send *amount* of *asset* to *to_address*.

        Steps:
        1. Validate balance (raises InsufficientBalanceError if not enough)
        2. Call Binance withdraw — retry up to MAX_RETRIES on network errors
        3. Log the transaction

        Returns:
            Completed Transaction dataclass (status="success").

        Raises:
            InsufficientBalanceError: not enough funds.
            TransactionError: payment failed after all retries.
        """
        self.check_balance(amount, asset)

        tx = Transaction(
            amount=amount,
            to_address=to_address,
            from_address=self._platform_address,
            asset=asset,
            timestamp=datetime.now(timezone.utc),
        )

        last_error: Optional[Exception] = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                result = self._client._call(
                    self._client._exchange.withdraw,
                    asset, amount, to_address,
                )
                tx.tx_hash = result.get("id") or result.get("txid", "unknown")
                tx.status = "success"
                self._log_transaction(tx, to_address, match_id, tx_type)
                logger.info(
                    "Payment sent: %.4f %s → %s (tx=%s)",
                    amount, asset, to_address, tx.tx_hash,
                )
                return tx

            except BinanceClientError as exc:
                last_error = exc
                if attempt < MAX_RETRIES:
                    logger.warning(
                        "Payment attempt %d/%d failed: %s — retrying",
                        attempt, MAX_RETRIES, exc,
                    )

        tx.status = "failed"
        self._log_transaction(tx, to_address, match_id, tx_type)
        raise TransactionError(
            f"Payment of {amount} {asset} to {to_address} failed "
            f"after {MAX_RETRIES} attempts: {last_error}"
        )

    # ── Transaction log ──────────────────────────────────────────────────────

    def _log_transaction(
        self,
        tx: Transaction,
        wallet_address: str = "",
        match_id: Optional[str] = None,
        tx_type: str = "match_win",
    ) -> None:
        self._log.append(tx)
        if self._ledger is not None:
            self._ledger.record(tx, wallet_address=wallet_address,
                                tx_type=tx_type, match_id=match_id)

    def get_transaction_log(self) -> list[Transaction]:
        """Return a copy of all logged transactions (used by Issue #22 ledger)."""
        return list(self._log)
