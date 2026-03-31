-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — Phase 3 migrations (apply to existing DB volumes) ║
-- ║  Safe to run multiple times (IF NOT EXISTS / OR REPLACE)   ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── users: Phase 3 columns ────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS arena_id                VARCHAR(12) UNIQUE,
  ADD COLUMN IF NOT EXISTS avatar                  TEXT NOT NULL DEFAULT 'initials',
  ADD COLUMN IF NOT EXISTS avatar_bg               TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS equipped_badge_icon     TEXT,
  ADD COLUMN IF NOT EXISTS forge_unlocked_item_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS vip_expires_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shop_entitlements       JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── user_stats: xp column ─────────────────────────────────────
ALTER TABLE user_stats
  ADD COLUMN IF NOT EXISTS xp INT NOT NULL DEFAULT 0;

-- ── Arena ID generator + trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION generate_arena_id()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    chars  TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    result TEXT := '';
    i      INT;
BEGIN
    FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
    END LOOP;
    RETURN 'ARENA-' || result;
END;
$$;

CREATE OR REPLACE FUNCTION set_arena_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.arena_id IS NULL THEN
        LOOP
            NEW.arena_id := generate_arena_id();
            EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE arena_id = NEW.arena_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_arena_id ON users;
CREATE TRIGGER trg_set_arena_id
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION set_arena_id();

-- ── client_sessions: Phase 3 table ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_status') THEN
    CREATE TYPE client_status AS ENUM ('idle', 'in_game', 'in_match', 'disconnected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS client_sessions (
    id              UUID PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    wallet_address  VARCHAR(100) NOT NULL,
    status          client_status NOT NULL DEFAULT 'idle',
    game            game,
    client_version  VARCHAR(20) NOT NULL DEFAULT 'unknown',
    match_id        UUID REFERENCES matches(id),
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_sessions_wallet_active
    ON client_sessions(wallet_address) WHERE disconnected_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_client_sessions_wallet
    ON client_sessions(wallet_address, last_heartbeat DESC);
CREATE INDEX IF NOT EXISTS idx_client_sessions_match
    ON client_sessions(match_id) WHERE match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_sessions_heartbeat
    ON client_sessions(last_heartbeat);
