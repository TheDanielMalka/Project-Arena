-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 016 — M8 Risk & Fraud Engine: player_penalties table        ║
-- ║                                                                        ║
-- ║  Stores admin-issued penalties per player.                             ║
-- ║  Logic (in engine/main.py POST /admin/users/{id}/penalty):             ║
-- ║    1st offense → suspended_until = NOW() + 24h                         ║
-- ║    2nd offense → suspended_until = NOW() + 7 days                      ║
-- ║    3rd+ offense → banned_at = NOW() (permanent)                        ║
-- ║                                                                        ║
-- ║  Checked at create_match + join_match via _assert_not_suspended().     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS player_penalties (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offense_type    VARCHAR(100) NOT NULL,          -- e.g. "rage_quit", "kick_abuse", "fraud"
    notes           TEXT,                           -- admin note
    offense_count   INT          NOT NULL DEFAULT 1, -- cumulative at time of issuing
    suspended_until TIMESTAMPTZ,                    -- NULL if banned or no suspension
    banned_at       TIMESTAMPTZ,                    -- non-NULL = permanent ban
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      UUID         REFERENCES users(id)  -- admin who issued the penalty
);

CREATE INDEX IF NOT EXISTS idx_player_penalties_user_id
    ON player_penalties(user_id);

CREATE INDEX IF NOT EXISTS idx_player_penalties_created_at
    ON player_penalties(created_at);
