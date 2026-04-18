-- Migration 032: harden user_balances against NULL / negative values.
-- Motivation (C11): without NOT NULL + CHECK (>= 0), a bug or race in the
-- engine could store a NULL balance or decrement below zero, letting a user
-- "withdraw" funds they never deposited. Engine code already clamps with
-- GREATEST(0, ...) and INSERTs use defaults, so this migration is safe.
--
-- Idempotent: uses IF NOT EXISTS and guarded ALTER to allow re-runs.

-- Step 1: backfill any NULL values to 0 so SET NOT NULL succeeds.
UPDATE user_balances
   SET total     = COALESCE(total, 0),
       available = COALESCE(available, 0),
       in_escrow = COALESCE(in_escrow, 0);

-- Step 2: clamp any existing negative balances to 0 so the CHECK passes.
-- These should not exist in a clean DB — any match is an earlier bug that
-- the CHECK constraint will prevent from recurring.
UPDATE user_balances
   SET total     = GREATEST(total, 0),
       available = GREATEST(available, 0),
       in_escrow = GREATEST(in_escrow, 0);

-- Step 3: enforce NOT NULL.
ALTER TABLE user_balances
    ALTER COLUMN total     SET NOT NULL,
    ALTER COLUMN available SET NOT NULL,
    ALTER COLUMN in_escrow SET NOT NULL;

-- Step 4: enforce non-negative balances. Guarded so re-runs don't error.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_balances_nonneg_chk'
    ) THEN
        ALTER TABLE user_balances
            ADD CONSTRAINT user_balances_nonneg_chk
            CHECK (total >= 0 AND available >= 0 AND in_escrow >= 0);
    END IF;
END $$;
