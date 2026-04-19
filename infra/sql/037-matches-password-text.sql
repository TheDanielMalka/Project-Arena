-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 037 — widen matches.password from VARCHAR(50) to TEXT
--
-- Regression fix (2026-04-20):
--   Commit a1a91bf (2026-04-19, "fix(engine): hash room passwords with bcrypt")
--   switched the INSERT in POST /matches from storing plaintext to storing
--   bcrypt(req.password). Bcrypt hashes are **60 characters** (format
--   $2b$<cost>$<22-char-salt><31-char-hash>), but the column was declared
--   VARCHAR(50). Every room created with a password since that commit fails
--   with `value too long for type character varying(50)` — caught by the
--   blanket except-clause in create_match(), which re-raises as
--   HTTPException(500, "Match creation failed").
--
--   Symptom on the frontend: toast reads "Match creation failed. Please try
--   again." with no HTTP status, because apiCreateMatch's network-error
--   fallback (`status: 0`) kicks in for 500 too via fetch; even when it
--   surfaces the 500, createFailureMessage has no specific branch for it.
--
-- Fix: ALTER COLUMN to TEXT. Postgres stores VARCHAR and TEXT identically
-- under the hood — no rewrite cost, no index invalidation, no lock beyond
-- the momentary ACCESS EXCLUSIVE needed to update pg_attribute. Existing
-- short plaintext rows remain valid (the engine falls back to
-- hmac.compare_digest for legacy rows — see _verify_room_password).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE matches ALTER COLUMN password TYPE TEXT;

COMMENT ON COLUMN matches.password IS
  'Optional room password. Since H1 (commit a1a91bf) stored as bcrypt hash '
  '(60 chars); legacy pre-H1 rows may still contain plaintext and are '
  'verified via constant-time fallback in _verify_room_password.';

COMMIT;
