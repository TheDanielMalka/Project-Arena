-- Migration 029: Google Sign-In — google_id, auth_provider, nullable password for OAuth-only users
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'email';

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id_unique
    ON users (google_id)
    WHERE google_id IS NOT NULL;
