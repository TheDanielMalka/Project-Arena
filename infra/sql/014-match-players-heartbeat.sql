-- Migration 014: add last_seen to match_players for heartbeat / stale-disconnect cleanup
-- Allows the server to detect players who closed the browser without calling leave_match
-- and remove them automatically (Phase 7 WebSocket will replace this polling bridge).

ALTER TABLE match_players
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_match_players_last_seen
    ON match_players(last_seen);
