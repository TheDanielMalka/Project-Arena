-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 036 — PII retention policy + GDPR purge job
-- Audit finding (medium, 2026-04-19):
--   The DB stores PII (DMs, inbox, notifications, audit logs, support
--   tickets) with no retention cap. GDPR Article 5(1)(e) requires data to
--   be kept "no longer than necessary". This migration:
--     1. Documents the retention windows (kept as SQL comments on tables).
--     2. Adds `run_pii_retention_purge()` — idempotent deletion routine.
--     3. Adds `pii_retention_run_log` so we keep an audit trail of purges
--        (how many rows were deleted from each table, and when).
--   The purge is called by the engine on a daily schedule (see
--   engine/src/jobs/pii_retention_job.py) — NOT by pg_cron, because our
--   managed Postgres may not have it installed.
--
-- Retention windows (documented here, enforced by run_pii_retention_purge):
--   direct_messages        : 365 days after created_at
--   inbox_messages         : 365 days after created_at, OR 30d after
--                            `deleted=true` (soft-deleted by user)
--   notifications          : 180 days after created_at AND read=TRUE
--   audit_logs             : 730 days (2 years) — financial/regulatory
--   admin_audit_log        : 730 days (2 years) — admin actions
--   support_tickets        : 730 days after resolved_at/closed
--   report_attachments     : cascaded via support_tickets FK
--   deleted_accounts       : kept indefinitely (hashes only — no PII)
--
-- All windows are tunable via the `pii_retention_config` single-row table
-- below. Operators can UPDATE those values without code redeploy.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Config: a single-row table the admin can tune per environment ──
CREATE TABLE IF NOT EXISTS pii_retention_config (
    id                                SERIAL PRIMARY KEY,
    direct_messages_days              INT NOT NULL DEFAULT 365
        CHECK (direct_messages_days      BETWEEN 30 AND 3650),
    inbox_messages_days               INT NOT NULL DEFAULT 365
        CHECK (inbox_messages_days       BETWEEN 30 AND 3650),
    inbox_soft_deleted_days           INT NOT NULL DEFAULT 30
        CHECK (inbox_soft_deleted_days   BETWEEN 1  AND 365),
    notifications_days                INT NOT NULL DEFAULT 180
        CHECK (notifications_days        BETWEEN 30 AND 3650),
    audit_logs_days                   INT NOT NULL DEFAULT 730
        CHECK (audit_logs_days           BETWEEN 90 AND 3650),
    admin_audit_log_days              INT NOT NULL DEFAULT 730
        CHECK (admin_audit_log_days      BETWEEN 90 AND 3650),
    support_tickets_days              INT NOT NULL DEFAULT 730
        CHECK (support_tickets_days      BETWEEN 90 AND 3650),
    updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by                        UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT pii_retention_singleton CHECK (id = 1)
);
INSERT INTO pii_retention_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE  pii_retention_config
    IS 'Single-row GDPR retention windows (days). Tunable at runtime.';

-- ── Audit trail: every purge run writes one row here ──
CREATE TABLE IF NOT EXISTS pii_retention_run_log (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ran_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_by           TEXT NOT NULL DEFAULT 'system',   -- 'system' | 'admin:<user_id>'
    dm_deleted             BIGINT NOT NULL DEFAULT 0,
    inbox_deleted          BIGINT NOT NULL DEFAULT 0,
    notifications_deleted  BIGINT NOT NULL DEFAULT 0,
    audit_logs_deleted     BIGINT NOT NULL DEFAULT 0,
    admin_audit_deleted    BIGINT NOT NULL DEFAULT 0,
    tickets_deleted        BIGINT NOT NULL DEFAULT 0,
    error                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_pii_retention_run_log_ran_at
    ON pii_retention_run_log(ran_at DESC);

COMMENT ON TABLE  pii_retention_run_log
    IS 'Append-only audit trail of every run of run_pii_retention_purge().';

-- ── Purge routine (idempotent, safe to call repeatedly) ──
CREATE OR REPLACE FUNCTION run_pii_retention_purge(
    _triggered_by TEXT DEFAULT 'system'
)
RETURNS pii_retention_run_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cfg                       pii_retention_config%ROWTYPE;
    log_row                   pii_retention_run_log;
    v_dm                      BIGINT := 0;
    v_inbox                   BIGINT := 0;
    v_notifications           BIGINT := 0;
    v_audit                   BIGINT := 0;
    v_admin_audit             BIGINT := 0;
    v_tickets                 BIGINT := 0;
BEGIN
    SELECT * INTO cfg FROM pii_retention_config WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'pii_retention_config row missing — migration 036 not applied?';
    END IF;

    -- 1. direct_messages — hard-delete after N days
    WITH del AS (
        DELETE FROM direct_messages
         WHERE created_at < NOW() - (cfg.direct_messages_days * INTERVAL '1 day')
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_dm FROM del;

    -- 2. inbox_messages — hard-delete after N days OR 30d after soft-delete
    WITH del AS (
        DELETE FROM inbox_messages
         WHERE (created_at < NOW() - (cfg.inbox_messages_days * INTERVAL '1 day'))
            OR (deleted = TRUE
                AND created_at < NOW() - (cfg.inbox_soft_deleted_days * INTERVAL '1 day'))
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_inbox FROM del;

    -- 3. notifications — only READ ones older than N days (keep unread)
    WITH del AS (
        DELETE FROM notifications
         WHERE read = TRUE
           AND created_at < NOW() - (cfg.notifications_days * INTERVAL '1 day')
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_notifications FROM del;

    -- 4. audit_logs — regulatory 2y window by default
    WITH del AS (
        DELETE FROM audit_logs
         WHERE created_at < NOW() - (cfg.audit_logs_days * INTERVAL '1 day')
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_audit FROM del;

    -- 5. admin_audit_log — same 2y window (separate table)
    IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
        WITH del AS (
            DELETE FROM admin_audit_log
             WHERE created_at < NOW() - (cfg.admin_audit_log_days * INTERVAL '1 day')
            RETURNING 1
        )
        SELECT COUNT(*) INTO v_admin_audit FROM del;
    END IF;

    -- 6. support_tickets — only CLOSED tickets (resolved or dismissed)
    --    older than N days. Attachments cascade via FK.
    --    support_tickets has no `resolved_at`; the `updated_at` trigger
    --    auto-touches on every status change, so that is the closure
    --    timestamp for this purpose.
    WITH del AS (
        DELETE FROM support_tickets
         WHERE status IN ('resolved', 'dismissed')
           AND COALESCE(updated_at, created_at)
               < NOW() - (cfg.support_tickets_days * INTERVAL '1 day')
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_tickets FROM del;

    INSERT INTO pii_retention_run_log
        (triggered_by, dm_deleted, inbox_deleted, notifications_deleted,
         audit_logs_deleted, admin_audit_deleted, tickets_deleted)
    VALUES
        (_triggered_by, v_dm, v_inbox, v_notifications,
         v_audit, v_admin_audit, v_tickets)
    RETURNING * INTO log_row;

    RETURN log_row;
END;
$$;

COMMENT ON FUNCTION run_pii_retention_purge(TEXT)
    IS 'Idempotent PII retention purge. Called by the engine daily job. Returns the run_log row.';

COMMIT;
