"""
ARENA Engine — Smurf Detection
Prevents one person from playing with multiple accounts.
"""

from __future__ import annotations

import logging
from src.identity.database import PlayerDatabase

log = logging.getLogger("identity.smurf_detector")


class SmurfDetected(Exception):
    """Raised when a smurf or duplicate registration is detected."""


class SmurfDetector:
    """
    Validates a registration attempt before it is written to the database.
    Checks two things:
      1. Is the wallet blacklisted?
      2. Is the Steam ID already registered with a different wallet?
    """

    def __init__(self, db: PlayerDatabase):
        self.db = db

    def validate(self, wallet_address: str, steam_id: str) -> None:
        """
        Call this before adding a new player.
        Raises SmurfDetected if the registration should be rejected.
        """
        # 1. Blacklist check
        if self.db.is_blacklisted(wallet_address):
            log.warning("smurf | BLOCKED blacklisted wallet=%s", wallet_address)
            raise SmurfDetected(f"Wallet '{wallet_address}' is blacklisted")

        # 2. Duplicate Steam ID check
        existing = self.db.get_by_steam_id(steam_id)
        if existing is not None and existing.wallet_address != wallet_address:
            log.warning(
                "smurf | DUPLICATE steam_id=%s already linked to wallet=%s",
                steam_id, existing.wallet_address,
            )
            raise SmurfDetected(
                f"Steam ID '{steam_id}' is already registered with another wallet"
            )

        log.info("smurf | OK wallet=%s steam_id=%s", wallet_address, steam_id)
