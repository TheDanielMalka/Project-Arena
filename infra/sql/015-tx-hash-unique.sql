-- Migration 015: prevent duplicate AT credits from replayed on-chain transactions
-- A partial UNIQUE index means the same tx_hash can only appear once in transactions.
-- NULL tx_hashes are excluded — internal/legacy rows are unaffected.

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tx_hash_unique
  ON transactions(tx_hash)
  WHERE tx_hash IS NOT NULL;
