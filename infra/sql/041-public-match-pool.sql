-- ============================================================
-- 041-public-match-pool.sql
-- Public Match Pool: auto-managed open rooms per game/mode/stake.
--
-- Changes:
--   1. System user for pool-managed room creation
--   2. game_password column on matches (revealed only when ACTIVE)
--   3. public_match_pool_config table — defines how many rooms
--      should always be open per (game, mode, currency, amount)
--   4. Initial CS2 config rows
-- ============================================================

-- ── 1. System user ──────────────────────────────────────────
-- arena_id 'ARENA-SYSTEM' is reserved; no real login possible.
INSERT INTO users (
    id,
    username,
    email,
    password_hash,
    arena_id,
    status,
    verified
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'arena_system',
    'system@arena.internal',
    'DISABLED',
    'ARENA-SYSTEM',
    'active',
    TRUE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- ── 2. game_password column ──────────────────────────────────
-- Generated server-side when a public match becomes in_progress.
-- Never returned by the API until status = in_progress.
ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS game_password VARCHAR(32);

-- ── 3. public_match_pool_config table ────────────────────────
CREATE TABLE IF NOT EXISTS public_match_pool_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game            game    NOT NULL,
    mode            match_mode NOT NULL,
    stake_currency  VARCHAR(10) NOT NULL CHECK (stake_currency IN ('CRYPTO','AT')),
    stake_amount    NUMERIC(20,8) NOT NULL CHECK (stake_amount > 0),
    min_open_rooms  INT NOT NULL DEFAULT 2 CHECK (min_open_rooms >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (game, mode, stake_currency, stake_amount)
);

-- ── 4. Initial CS2 pool config ───────────────────────────────
-- AT tiers
INSERT INTO public_match_pool_config (game, mode, stake_currency, stake_amount, min_open_rooms) VALUES
    ('CS2', '1v1', 'AT', 100,  2),
    ('CS2', '2v2', 'AT', 100,  2),
    ('CS2', '5v5', 'AT', 100,  2),
    ('CS2', '1v1', 'AT', 500,  2),
    ('CS2', '5v5', 'AT', 500,  2)
ON CONFLICT (game, mode, stake_currency, stake_amount) DO NOTHING;

-- CRYPTO tiers (tBNB testnet — ~$0.1 equivalent)
INSERT INTO public_match_pool_config (game, mode, stake_currency, stake_amount, min_open_rooms) VALUES
    ('CS2', '1v1', 'CRYPTO', 0.1, 2),
    ('CS2', '2v2', 'CRYPTO', 0.1, 2),
    ('CS2', '5v5', 'CRYPTO', 0.1, 2)
ON CONFLICT (game, mode, stake_currency, stake_amount) DO NOTHING;
