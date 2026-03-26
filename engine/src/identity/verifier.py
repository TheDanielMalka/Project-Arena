
from __future__ import annotations

import logging
from dataclasses import dataclass
from src.identity.database import PlayerDatabase

log = logging.getLogger("identity.verifier")

DAILY_MATCH_LIMIT = 10


@dataclass
class VerificationResult:
    approved: bool
    reason:   str


class MatchVerifier:

    def __init__(self, db: PlayerDatabase, daily_match_limit: int = DAILY_MATCH_LIMIT):
        self._db               = db
        self._daily_match_limit = daily_match_limit

    def verify(self, wallet_address: str) -> VerificationResult:
        """
        מריץ את כל הבדיקות בסדר.
        מחזיר את הסיבה הראשונה שנכשלת — אם הכל תקין מחזיר אושר.
        """

        # ── בדיקה 1: השחקן רשום? ─────────────────────────────────────────────
        player = self._db.get(wallet_address)
        if player is None:
            log.info("verify | REJECTED not_registered | wallet=%s", wallet_address)
            return VerificationResult(
                approved=False,
                reason="Wallet not registered — please sign up first",
            )

        # ── בדיקה 2: השחקן חסום? ─────────────────────────────────────────────
        if self._db.is_blacklisted(wallet_address):
            log.info("verify | REJECTED blacklisted | wallet=%s", wallet_address)
            return VerificationResult(
                approved=False,
                reason="Account is banned — submit a dispute to appeal",
            )

        # ── בדיקה 3: הגיע למגבלת משחקים יומית? ──────────────────────────────
        count = self._db.get_today_match_count(wallet_address)
        if count >= self._daily_match_limit:
            log.info("verify | REJECTED daily_match_limit | wallet=%s count=%d", wallet_address, count)
            return VerificationResult(
                approved=False,
                reason=f"Daily match limit reached ({self._daily_match_limit} matches per day)",
            )

        # ── עבר הכל ──────────────────────────────────────────────────────────
        log.info("verify | APPROVED | wallet=%s steam=%s matches_today=%d", wallet_address, player.steam_id, count)
        return VerificationResult(approved=True, reason="OK")
