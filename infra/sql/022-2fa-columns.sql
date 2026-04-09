-- ── Migration 022 — TOTP / 2FA columns on users ────────────────────────────
-- TODO[GOOGLE]: ADD COLUMN IF NOT EXISTS google_id VARCHAR(100) UNIQUE DEFAULT NULL,
--               ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'email'
-- ^ Add these when Google OAuth is ready (next week). Do NOT add them now.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
