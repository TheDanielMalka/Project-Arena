-- Migration 004: Add missing indexes on match_players
-- Safe to run on existing EC2 DB — IF NOT EXISTS prevents errors.
-- Fixes: GET /client/match (JOIN match_players ON mp.wallet_address = :w)
--        was doing full table scans without this index.

CREATE INDEX IF NOT EXISTS idx_match_players_wallet ON match_players(wallet_address);
CREATE INDEX IF NOT EXISTS idx_match_players_match  ON match_players(match_id);
