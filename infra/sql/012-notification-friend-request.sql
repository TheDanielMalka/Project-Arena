-- Migration 012: Ensure friend_request exists in notification_type enum
-- Safe to run multiple times — checks pg_enum before adding.
-- Needed on DBs created before friend_request was added to init.sql.
-- The TypeScript NotificationType union already includes 'friend_request';
-- this migration closes the DB ↔ TS gap.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_enum e
        JOIN   pg_type  t ON t.oid = e.enumtypid
        WHERE  t.typname  = 'notification_type'
          AND  e.enumlabel = 'friend_request'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'friend_request';
    END IF;
END$$;
