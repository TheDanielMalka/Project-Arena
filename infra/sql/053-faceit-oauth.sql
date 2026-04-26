-- Migration 053: FACEIT OAuth account linking
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS faceit_id          VARCHAR(36),
    ADD COLUMN IF NOT EXISTS faceit_nickname    VARCHAR(50),
    ADD COLUMN IF NOT EXISTS faceit_elo         INTEGER,
    ADD COLUMN IF NOT EXISTS faceit_level       SMALLINT,
    ADD COLUMN IF NOT EXISTS faceit_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS faceit_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_faceit_id_idx
    ON users (faceit_id) WHERE faceit_id IS NOT NULL;
