-- ── Migration 024 — report_attachments (support ticket files) ───────────────

CREATE TABLE IF NOT EXISTS report_attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id    UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    filename     VARCHAR(255) NOT NULL,
    content_type VARCHAR(50)  NOT NULL,
    file_path    TEXT         NOT NULL,
    file_size    INTEGER      NOT NULL,
    uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_report_attachments_ticket ON report_attachments(ticket_id);
