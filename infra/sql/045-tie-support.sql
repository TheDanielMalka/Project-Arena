-- 045-tie-support.sql
-- Adds 'tied' status to match_status enum and a ties counter to user_stats.
-- Triggered by TieDeclared event from ArenaEscrow.declareTie().

ALTER TYPE match_status ADD VALUE IF NOT EXISTS 'tied' AFTER 'cancelled';

ALTER TABLE user_stats
    ADD COLUMN IF NOT EXISTS ties INTEGER NOT NULL DEFAULT 0;
