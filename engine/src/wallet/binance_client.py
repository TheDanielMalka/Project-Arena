from __future__ import annotations

import logging
import time
from typing import Optional

import ccxt

from engine.src.config import BINANCE_API_KEY, BINANCE_SECRET

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY = 2.0          # seconds between retries on rate-limit
DEFAULT_SYMBOL = "USDT"    # asset used by the platform


class BinanceClientError(Exception):
    """Raised when Binance operations fail after exhausting retries."""


class BinanceClient:
    """
    Thin wrapper around ccxt.binance.

    Usage:
        client = BinanceClient()          # reads keys from env
        client = BinanceClient(api_key=.., secret=..)  # explicit keys (tests)

    All public methods raise BinanceClientError on unrecoverable failures.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        secret: Optional[str] = None,
        testnet: bool = False,
    ) -> None:
        self._exchange = ccxt.binance(
            {
                "apiKey": api_key or BINANCE_API_KEY or "",
                "secret": secret or BINANCE_SECRET or "",
                "enableRateLimit": True,          # ccxt built-in throttle
                "options": {"defaultType": "spot"},
            }
        )
        if testnet:
            self._exchange.set_sandbox_mode(True)

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _call(self, fn, *args, **kwargs):
        """Execute a ccxt call with automatic retry on rate-limit errors."""
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return fn(*args, **kwargs)
            except ccxt.RateLimitExceeded:
                if attempt == MAX_RETRIES:
                    raise BinanceClientError("Rate limit exceeded after retries")
                wait = RETRY_DELAY * attempt
                logger.warning("Rate limit hit — waiting %.1fs (attempt %d/%d)", wait, attempt, MAX_RETRIES)
                time.sleep(wait)
            except ccxt.AuthenticationError as exc:
                raise BinanceClientError(f"Authentication failed: {exc}") from exc
            except ccxt.NetworkError as exc:
                raise BinanceClientError(f"Network error: {exc}") from exc
            except ccxt.ExchangeError as exc:
                raise BinanceClientError(f"Exchange error: {exc}") from exc

    # ── Public API ───────────────────────────────────────────────────────────

    def ping(self) -> bool:
        """Return True if the exchange is reachable."""
        try:
            self._call(self._exchange.fetch_time)
            return True
        except BinanceClientError:
            return False

    def get_balance(self, asset: str = DEFAULT_SYMBOL) -> float:
        """
        Return the free (available) balance for *asset*.

        Args:
            asset: Ticker symbol, e.g. "USDT", "BTC", "ETH".

        Returns:
            Free balance as float (0.0 if asset not held).
        """
        data = self._call(self._exchange.fetch_balance)
        return float(data.get("free", {}).get(asset, 0.0))

    def get_price(self, symbol: str = "BTC/USDT") -> float:
        """
        Return the last traded price for *symbol*.

        Args:
            symbol: ccxt market symbol, e.g. "BTC/USDT".

        Returns:
            Last price as float.
        """
        ticker = self._call(self._exchange.fetch_ticker, symbol)
        return float(ticker["last"])

    def get_all_balances(self) -> dict[str, float]:
        """Return all assets with non-zero free balance."""
        data = self._call(self._exchange.fetch_balance)
        return {
            asset: float(amount)
            for asset, amount in data.get("free", {}).items()
            if float(amount) > 0
        }
