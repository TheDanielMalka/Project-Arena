-- ============================================================
-- 042-discord-match-channels.sql
-- Adds per-team Discord channel passwords to matches.
-- Each team gets a unique 8-char password generated at match start.
-- team_a_password → sent only to Team A players
-- team_b_password → sent only to Team B players
-- Both are NULL until status = in_progress.
-- ============================================================

ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS team_a_password VARCHAR(8),
    ADD COLUMN IF NOT EXISTS team_b_password VARCHAR(8);
