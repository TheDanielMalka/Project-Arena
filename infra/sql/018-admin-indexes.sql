-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 018 — Admin Query Indexes                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
CREATE INDEX IF NOT EXISTS idx_users_status        ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created_at    ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_status     ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_created_at ON disputes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_player_a   ON disputes(player_a);
