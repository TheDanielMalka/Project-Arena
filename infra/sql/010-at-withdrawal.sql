-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 010 — AT Withdrawal                              ║
-- ║  1. Add at_daily_withdrawn + at_withdrawal_reset_at to users║
-- ║  2. Add 'at_withdrawal' to transaction_type enum            ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── 1. Track daily AT withdrawal per user ─────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS at_daily_withdrawn    INT         NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS at_withdrawal_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Add at_withdrawal to transaction_type enum ────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'at_withdrawal'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'transaction_type')
    ) THEN
        ALTER TYPE transaction_type ADD VALUE 'at_withdrawal';
    END IF;
END$$;
