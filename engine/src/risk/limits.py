"""
Daily betting risk helpers (GitHub #40).

- High-stakes: count completed matches in rolling 24h where stake >= threshold.
- Loss cap: sum stakes from completed matches the user lost (winner_id set and != user).

SQL uses matches + match_players; only status='completed' with ended_at in window.
"""

from __future__ import annotations

from sqlalchemy import text


def count_completed_high_stakes_matches(
    session,
    user_id: str,
    *,
    stake_currency: str,
    min_bet: float,
) -> int:
    """How many distinct completed matches (24h) the user played with bet_amount >= min_bet."""
    if min_bet <= 0:
        return 0
    try:
        row = session.execute(
            text(
                "SELECT COUNT(DISTINCT m.id) "
                "FROM matches m "
                "JOIN match_players mp ON mp.match_id = m.id "
                "WHERE mp.user_id = CAST(:uid AS uuid) "
                "  AND m.stake_currency = :sc "
                "  AND m.status = 'completed' "
                "  AND m.bet_amount >= :min_bet "
                "  AND m.ended_at IS NOT NULL "
                "  AND m.ended_at > NOW() - INTERVAL '24 hours'"
            ),
            {"uid": user_id, "sc": stake_currency, "min_bet": min_bet},
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else 0
    except (TypeError, ValueError, Exception):
        return 0


def sum_daily_match_losses(
    session,
    user_id: str,
    *,
    stake_currency: str,
) -> float:
    """
    Sum of bet_amount for completed matches in the last 24h where this user lost
    (winner_id is set and is not the user).
    """
    try:
        row = session.execute(
            text(
                "SELECT COALESCE(SUM(m.bet_amount), 0) "
                "FROM matches m "
                "JOIN match_players mp ON mp.match_id = m.id "
                "WHERE mp.user_id = CAST(:uid AS uuid) "
                "  AND m.stake_currency = :sc "
                "  AND m.status = 'completed' "
                "  AND m.winner_id IS NOT NULL "
                "  AND m.winner_id <> CAST(:uid AS uuid) "
                "  AND m.ended_at IS NOT NULL "
                "  AND m.ended_at > NOW() - INTERVAL '24 hours'"
            ),
            {"uid": user_id, "sc": stake_currency},
        ).fetchone()
        if not row or row[0] is None:
            return 0.0
        return float(row[0])
    except (TypeError, ValueError, Exception):
        return 0.0
