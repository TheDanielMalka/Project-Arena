-- Migration 010: Ensure match_invite exists in notification_type enum
-- Safe to run multiple times — checks pg_enum before adding.
-- Needed on DBs created before match_invite was added to init.sql.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_enum e
        JOIN   pg_type  t ON t.oid = e.enumtypid
        WHERE  t.typname  = 'notification_type'
          AND  e.enumlabel = 'match_invite'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'match_invite';
    END IF;
END$$;
