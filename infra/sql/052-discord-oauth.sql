-- Migration 052: Discord OAuth account linking
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS discord_id          VARCHAR(20),
    ADD COLUMN IF NOT EXISTS discord_username    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS discord_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS discord_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_idx
    ON users (discord_id) WHERE discord_id IS NOT NULL;
