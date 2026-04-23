-- ============================================================
-- 043-discord-channel-ids.sql
-- Stores the Discord channel IDs created by the bot at match
-- start so they can be referenced and cleaned up later.
-- Both columns are NULL until the Discord bot runs successfully.
-- ============================================================

ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS discord_team_a_channel_id VARCHAR(32),
    ADD COLUMN IF NOT EXISTS discord_team_b_channel_id VARCHAR(32);
