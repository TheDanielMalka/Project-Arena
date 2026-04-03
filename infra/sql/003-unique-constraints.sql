-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — Migration 003: Unique constraints & riot_id       ║
-- ║  Safe to run multiple times (IF NOT EXISTS)                ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── 1. Add riot_id column ────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS riot_id VARCHAR(30);

-- ── 2. Normalize existing emails to lowercase ────────────────
-- Prevents case-sensitivity bypass (e.g. John@ vs john@)
UPDATE users SET email = lower(email) WHERE email != lower(email);

-- ── 3. Case-insensitive unique indexes ───────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
    ON users (lower(username));

-- ── 4. Nullable unique IDs ────────────────────────────────────
-- Multiple NULLs allowed; non-NULL values must be globally unique
CREATE UNIQUE INDEX IF NOT EXISTS users_steam_id_idx
    ON users (steam_id) WHERE steam_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_riot_id_idx
    ON users (riot_id) WHERE riot_id IS NOT NULL;

-- ── 5. user_game_accounts (future extensibility) ─────────────
CREATE TABLE IF NOT EXISTS user_game_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (provider, account_id),
    UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_uga_user ON user_game_accounts(user_id);
