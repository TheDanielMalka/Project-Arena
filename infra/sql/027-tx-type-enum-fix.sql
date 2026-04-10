-- Migration 027: add missing tx_type ENUM values used by engine (leave/kick/stale/cancel refunds)
-- Idempotent: ADD VALUE IF NOT EXISTS (PostgreSQL 15+; docker-compose uses postgres:16).
-- ALTER TYPE ADD VALUE must not run inside a transaction block on some PG versions — keep each
-- statement standalone; deploy runner should use autocommit per file or split statements.

ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_leave';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_kicked';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_disconnect';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_cancel';
