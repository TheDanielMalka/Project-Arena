-- Migration 025: wallet/steam blacklist for banned accounts
CREATE TABLE IF NOT EXISTS wallet_blacklist (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address VARCHAR(255),
    steam_id       VARCHAR(30),
    riot_id        VARCHAR(30),
    user_id        UUID,           -- original user (may be deleted)
    reason         TEXT NOT NULL DEFAULT 'ban',
    banned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    banned_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_blacklist_wallet ON wallet_blacklist(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_blacklist_steam  ON wallet_blacklist(steam_id);
CREATE INDEX IF NOT EXISTS idx_wallet_blacklist_riot   ON wallet_blacklist(riot_id);
