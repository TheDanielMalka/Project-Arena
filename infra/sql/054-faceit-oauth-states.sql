-- Migration 054: FACEIT OAuth PKCE state table
CREATE TABLE IF NOT EXISTS faceit_oauth_states (
    nonce         TEXT PRIMARY KEY,
    jwt_token     TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL
);
