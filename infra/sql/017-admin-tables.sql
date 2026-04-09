-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 017 — Admin Infrastructure                                  ║
-- ║                                                                        ║
-- ║  platform_config  — key/value store for global platform settings       ║
-- ║  admin_audit_log  — immutable log of every admin action                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── Platform Config (key-value, dynamic — no schema change to add a key) ──
CREATE TABLE IF NOT EXISTS platform_config (
    key        VARCHAR(100) PRIMARY KEY,
    value      TEXT         NOT NULL,
    updated_at TIMESTAMPTZ  DEFAULT NOW(),
    updated_by UUID         REFERENCES users(id)
);

INSERT INTO platform_config (key, value) VALUES
    ('fee_pct',                '5'),
    ('daily_bet_max_at',       '500'),
    ('maintenance_mode',       'false'),
    ('new_registrations',      'true'),
    ('auto_escalate_disputes', 'false')
ON CONFLICT DO NOTHING;

-- ── Admin Audit Log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id   UUID         REFERENCES users(id),
    action     VARCHAR(100) NOT NULL,   -- FREEZE_PAYOUT, UNFREEZE_PAYOUT,
                                        -- BAN_USER, SUSPEND_USER,
                                        -- DECLARE_WINNER, CONFIG_UPDATE ...
    target_id  VARCHAR(200),            -- user_id / match_id / "global"
    notes      TEXT,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
    ON admin_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin
    ON admin_audit_log(admin_id, created_at DESC);
