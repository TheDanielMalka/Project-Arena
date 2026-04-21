-- Migration 040: game account verification flags
-- steam_verified / riot_verified are set to TRUE only after real OAuth/OpenID proof.
-- Users can register without game accounts; verification is required before match play.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS steam_verified    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS steam_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS riot_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS riot_verified_at  TIMESTAMPTZ;

-- Ensure steam_id / riot_id are nullable (existing rows without game accounts must be allowed)
ALTER TABLE users
    ALTER COLUMN steam_id DROP NOT NULL,
    ALTER COLUMN riot_id  DROP NOT NULL;

-- Index for fast "can this user play CS2?" lookups
CREATE INDEX IF NOT EXISTS users_steam_verified_idx ON users (id) WHERE steam_verified = TRUE;
CREATE INDEX IF NOT EXISTS users_riot_verified_idx  ON users (id) WHERE riot_verified  = TRUE;
