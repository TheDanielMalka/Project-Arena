-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — Migration 005: Arena Token balance on users        ║
-- ║  Safe to run multiple times (IF NOT EXISTS / DO NOTHING)   ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── 1. Add at_balance column ─────────────────────────────────────────────────
-- Stores the user's Arena Token (AT) balance.
-- Default 0; signup flow sets it to 200 (welcome gift).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS at_balance INTEGER NOT NULL DEFAULT 0;

-- ── 2. Back-fill: any existing rows keep 0 (no real users yet) ───────────────
-- New registrations receive 200 AT via application logic (POST /auth/register).
