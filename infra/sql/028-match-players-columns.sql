-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 028 — Add missing match_players columns                     ║
-- ║                                                                        ║
-- ║  ROOT CAUSE of create_match 500:                                       ║
-- ║  wallet_address / has_deposited / deposited_at / deposit_amount were   ║
-- ║  present in init.sql but added/removed across commits with no          ║
-- ║  migration to back-fill live DBs.                                      ║
-- ║                                                                        ║
-- ║  Evidence: migration 004 already tries to CREATE INDEX on              ║
-- ║  match_players(wallet_address) — proving the column was expected —     ║
-- ║  but that index silently fails on any DB that lacks the column         ║
-- ║  (psql has no ON_ERROR_STOP in our deploy runner).                     ║
-- ║                                                                        ║
-- ║  Fix: idempotent ADD COLUMN IF NOT EXISTS for all 4 columns,          ║
-- ║  then recreate the index migration 004 silently skipped.               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE match_players
    ADD COLUMN IF NOT EXISTS wallet_address  VARCHAR(42),
    ADD COLUMN IF NOT EXISTS has_deposited   BOOLEAN      DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deposited_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_amount  NUMERIC(12,2);

-- Recreate the wallet index that migration 004 silently skipped
-- when wallet_address did not yet exist.
CREATE INDEX IF NOT EXISTS idx_match_players_wallet ON match_players(wallet_address);
