-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 035 — Close the tx_hash=NULL replay loophole                 ║
-- ║                                                                         ║
-- ║  Audit finding: the partial UNIQUE index from migration 015             ║
-- ║  (idx_transactions_tx_hash_unique, WHERE tx_hash IS NOT NULL) is        ║
-- ║  bypassed by every on-chain event handler in escrow_client.py — they    ║
-- ║  INSERT transactions with tx_hash=NULL, so a chain re-org or listener   ║
-- ║  restart that re-fires the same event inserts a duplicate row and       ║
-- ║  can double-credit match_win / escrow_lock / refund / fee.              ║
-- ║                                                                         ║
-- ║  Fix:                                                                   ║
-- ║  1. Keep global uniqueness for single-row TX types (at_purchase —       ║
-- ║     the only type currently populating tx_hash for off-chain receipts). ║
-- ║     An attacker must not be able to replay another user's purchase      ║
-- ║     tx_hash against their own user_id.                                  ║
-- ║  2. Add a scoped UNIQUE for chain-event TX types (escrow_lock,          ║
-- ║     escrow_release, match_win, match_loss, refund, fee) keyed by        ║
-- ║     (tx_hash, user_id, type, match_id) with NULLS NOT DISTINCT so       ║
-- ║     (a) WinnerDeclared's N match_win rows + 1 fee coexist (different    ║
-- ║     user_ids) and (b) a re-fired event fails the second insert.         ║
-- ║  3. Add a NOT VALID CHECK forbidding future on-chain (token='BNB')      ║
-- ║     rows without a tx_hash — the chain event handlers must supply it.   ║
-- ║     Legacy rows are skipped via NOT VALID.                              ║
-- ║                                                                         ║
-- ║  Idempotent: drops the old index only if present, re-creates the new    ║
-- ║  indexes with IF NOT EXISTS, guards the CHECK with a DO block.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Step 1: drop the old overly-strict UNIQUE index.  It would otherwise
-- block the legitimate multi-row chain events (e.g. WinnerDeclared emits
-- N winner rows from the same tx_hash).
DROP INDEX IF EXISTS idx_transactions_tx_hash_unique;

-- Step 2: partial UNIQUE for single-row money-in/money-out rows.
-- These are the rows where tx_hash alone must be globally unique — an
-- attacker reusing another user's deposit tx_hash against their own
-- user_id must still be rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_single_tx_hash
    ON transactions(tx_hash)
 WHERE tx_hash IS NOT NULL
   AND type = 'at_purchase';

-- Step 3: scoped UNIQUE for multi-row chain-event rows.
-- NULLS NOT DISTINCT so the fee row (user_id IS NULL for platform fee)
-- is still dedup'd when the chain event re-fires.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_chain_event_dedup
    ON transactions(tx_hash, user_id, type, match_id)
    NULLS NOT DISTINCT
 WHERE tx_hash IS NOT NULL
   AND type IN ('escrow_lock', 'escrow_release', 'match_win',
                'match_loss', 'refund', 'fee');

-- Step 4: defense-in-depth CHECK — any future on-chain (token='BNB') row
-- must carry a tx_hash.  NOT VALID means existing rows are not
-- re-validated (legacy chain rows may have NULL tx_hash from before the
-- escrow_client.py fix); new inserts are enforced.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'transactions_bnb_requires_tx_hash'
           AND conrelid = 'transactions'::regclass
    ) THEN
        ALTER TABLE transactions
            ADD CONSTRAINT transactions_bnb_requires_tx_hash
            CHECK (token <> 'BNB' OR tx_hash IS NOT NULL) NOT VALID;
    END IF;
END $$;
