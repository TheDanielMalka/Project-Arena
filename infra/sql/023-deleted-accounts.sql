-- ── Migration 023 — deleted_accounts (soft-delete / re-register guard) ─────

CREATE TABLE IF NOT EXISTS deleted_accounts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    steam_id       VARCHAR(30),
    riot_id        VARCHAR(30),
    wallet_address VARCHAR(255),
    email_hash     VARCHAR(64),
    username_hash  VARCHAR(64),
    deleted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    flag_reason    TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_steam ON deleted_accounts(steam_id);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_riot  ON deleted_accounts(riot_id);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_wallet ON deleted_accounts(wallet_address);
