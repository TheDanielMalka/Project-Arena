-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 018 — Admin Query Indexes                                   ║
-- ║                                                                        ║
-- ║  Covers all JOINs and filters used by:                                 ║
-- ║    GET /admin/users     → users + user_stats + player_penalties         ║
-- ║    GET /admin/disputes  → disputes + users + matches                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── GET /admin/users ──────────────────────────────────────────────────────────
-- WHERE u.status = :status
CREATE INDEX IF NOT EXISTS idx_users_status
    ON users(status);

-- ORDER BY u.created_at DESC  +  WHERE u.created_at > ...
CREATE INDEX IF NOT EXISTS idx_users_created_at
    ON users(created_at DESC);

-- ── GET /admin/disputes ───────────────────────────────────────────────────────
-- WHERE d.status = :status
CREATE INDEX IF NOT EXISTS idx_disputes_status
    ON disputes(status);

-- ORDER BY d.created_at DESC
CREATE INDEX IF NOT EXISTS idx_disputes_created_at
    ON disputes(created_at DESC);

-- JOIN users ua ON ua.id = d.player_a
CREATE INDEX IF NOT EXISTS idx_disputes_player_a
    ON disputes(player_a);
