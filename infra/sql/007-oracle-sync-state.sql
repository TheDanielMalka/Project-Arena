-- Migration 007: Oracle sync state
--
-- Stores the last blockchain block processed by the EscrowClient event listener.
-- Single-row table (id='singleton') — always upserted, never inserted twice.
--
-- Purpose:
--   After engine restart the listener resumes from last_block instead of
--   scanning only lookback_blocks (100 blocks ≈ 25 min on BSC).
--   Prevents missed WinnerDeclared / PlayerDeposited / MatchRefunded events.
--
-- Written by: EscrowClient._save_last_block()
-- Read by:    EscrowClient._load_last_block()

CREATE TABLE IF NOT EXISTS oracle_sync_state (
    id           VARCHAR(20)  PRIMARY KEY DEFAULT 'singleton',
    last_block   BIGINT       NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO oracle_sync_state (id, last_block)
VALUES ('singleton', 0)
ON CONFLICT (id) DO NOTHING;
