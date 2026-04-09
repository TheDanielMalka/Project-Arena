-- ── Migration 020 — Raise daily AT bet limit: 500 → 50000 ───────────────────
-- Updates the platform_config seed value for daily_bet_max_at.
-- Uses ON CONFLICT UPDATE so it applies correctly on both fresh and live DBs.

INSERT INTO platform_config (key, value)
VALUES ('daily_bet_max_at', '50000')
ON CONFLICT (key) DO UPDATE SET value = '50000', updated_at = NOW();
