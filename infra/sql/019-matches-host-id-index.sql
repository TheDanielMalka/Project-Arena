-- Migration 019 — Ensure matches.host_id is indexed (kick + active room lookups)
-- Safe to run multiple times.

CREATE INDEX IF NOT EXISTS idx_matches_host ON matches(host_id);

