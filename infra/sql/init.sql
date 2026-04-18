-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — PostgreSQL Schema Init                            ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE match_status   AS ENUM ('waiting','in_progress','completed','cancelled','disputed');
CREATE TYPE match_type     AS ENUM ('public','custom');
CREATE TYPE match_mode     AS ENUM ('1v1','2v2','4v4','5v5');
CREATE TYPE game           AS ENUM ('CS2','Valorant','Fortnite','Apex Legends','PUBG','COD','League of Legends');
-- TS TransactionType: match_win|match_loss|fee|refund|escrow_lock|escrow_release|at_purchase|at_spend
-- deposit|withdrawal kept for legacy / on-ramp rows if needed
CREATE TYPE tx_type        AS ENUM (
  'deposit','withdrawal',
  'match_win','match_loss','fee','refund','escrow_lock','escrow_release',
  'at_purchase','at_spend'
);
CREATE TYPE tx_status      AS ENUM ('completed','pending','failed','cancelled');
CREATE TYPE dispute_status AS ENUM ('open','reviewing','resolved','escalated');
CREATE TYPE dispute_resolution AS ENUM ('pending','approved','rejected','player_a_wins','player_b_wins','refund','void');
CREATE TYPE network        AS ENUM ('bsc','solana','ethereum');
CREATE TYPE user_status    AS ENUM ('active','flagged','banned','suspended');
CREATE TYPE app_role       AS ENUM ('user','admin','moderator');
CREATE TYPE notification_type AS ENUM ('match_result','payout','system','dispute','match_invite','escrow');

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(50) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    steam_id        VARCHAR(30),           -- nullable; unique via partial index below
    riot_id         VARCHAR(30),           -- nullable; unique via partial index below
    wallet_address  VARCHAR(100),
    rank            VARCHAR(20) DEFAULT 'Unranked',
    tier            VARCHAR(20) DEFAULT 'Bronze',
    verified        BOOLEAN DEFAULT FALSE,
    avatar_initials VARCHAR(4),
    avatar          TEXT DEFAULT 'initials',    -- 'initials' | emoji | 'upload:{dataURL}' | 'preset:{id}' (Identity Studio — src/lib/avatarPresets.ts; optional static /avatars/identity/*)
    avatar_bg       TEXT DEFAULT 'default',     -- bgId from avatarBgs.ts
    equipped_badge_icon TEXT,                   -- Forge badge:* (e.g. badge:founders); NULL = none — aligns with UserProfile.equippedBadgeIcon
    forge_unlocked_item_ids TEXT[] NOT NULL DEFAULT '{}',  -- Forge shop item ids owned (catalog ids until UUID API)
    vip_expires_at  TIMESTAMPTZ,                             -- VIP pass active until; NULL = none — aligns with UserProfile.vipExpiresAt
    shop_entitlements JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ "itemId", "kind", "label", "expiresAt" }] — timed boosts / bundle grants
    preferred_game  game DEFAULT 'CS2',
    arena_id        VARCHAR(12) UNIQUE,   -- immutable public ID (ARENA-XXXXXX) — set on registration, never changed
    status          user_status DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── User Roles (separate table — security best practice) ────
CREATE TABLE user_roles (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    role    app_role NOT NULL,
    UNIQUE (user_id, role)
);

-- ── User Stats ───────────────────────────────────────────────
CREATE TABLE user_stats (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    matches         INT DEFAULT 0,
    wins            INT DEFAULT 0,
    losses          INT DEFAULT 0,
    win_rate        NUMERIC(5,2) DEFAULT 0,
    total_earnings  NUMERIC(12,2) DEFAULT 0,
    in_escrow       NUMERIC(12,2) DEFAULT 0,
    xp              INT DEFAULT 0               -- POST /api/forge/challenges/:id/claim increments; Profile/leaderboard read this row
);

-- ── User Balances ────────────────────────────────────────────
CREATE TABLE user_balances (
    user_id   UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total     NUMERIC(12,2) NOT NULL DEFAULT 0,
    available NUMERIC(12,2) NOT NULL DEFAULT 0,
    in_escrow NUMERIC(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT user_balances_nonneg_chk
        CHECK (total >= 0 AND available >= 0 AND in_escrow >= 0)
);

-- ── Matches ──────────────────────────────────────────────────
CREATE TABLE matches (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         match_type NOT NULL,
    host_id      UUID REFERENCES users(id) NOT NULL,
    game         game NOT NULL,
    mode         match_mode NOT NULL,
    bet_amount   NUMERIC(12,2) NOT NULL CHECK (bet_amount > 0),
    max_players  INT DEFAULT 2,
    status       match_status DEFAULT 'waiting',
    code         VARCHAR(20),
    password     VARCHAR(50),
    max_per_team INT,
    winner_id         UUID REFERENCES users(id),
    on_chain_match_id BIGINT UNIQUE,    -- ArenaEscrow.sol matchId (uint256), set on MatchCreated event — UNIQUE blocks duplicate-event double-link (C15)
    deposits_received INT DEFAULT 0,    -- how many players locked funds on-chain (set on PlayerDeposited events)
    stake_per_player  NUMERIC(12,2),    -- bet_amount per player (redundant but explicit for contract alignment)
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    started_at        TIMESTAMPTZ,
    ended_at          TIMESTAMPTZ
);

-- ── Match Players (join table) ───────────────────────────────
-- One row per player per match. Wallet address verified against users.wallet_address.
-- DB alignment: ArenaEscrow PlayerDeposited event populates has_deposited + deposited_at.
CREATE TABLE match_players (
    match_id       UUID REFERENCES matches(id) ON DELETE CASCADE,
    user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    team           VARCHAR(1) CHECK (team IN ('A','B')),
    wallet_address VARCHAR(42),           -- on-chain address used to deposit (verified vs users.wallet_address)
    has_deposited  BOOLEAN DEFAULT FALSE, -- set TRUE on ArenaEscrow PlayerDeposited event
    deposited_at   TIMESTAMPTZ,           -- timestamp of on-chain deposit
    deposit_amount NUMERIC(12,2),         -- matches matches.bet_amount (stored for audit trail)
    joined_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (match_id, user_id)
);

CREATE INDEX idx_match_players_wallet ON match_players(wallet_address);
CREATE INDEX idx_match_players_match  ON match_players(match_id);

-- ── Transactions ─────────────────────────────────────────────
CREATE TABLE transactions (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID REFERENCES users(id) NOT NULL,
    type      tx_type NOT NULL,
    amount    NUMERIC(12,2) NOT NULL,
    token     VARCHAR(20) DEFAULT 'USDT',
    usd_value NUMERIC(12,2),
    status    tx_status DEFAULT 'pending',
    tx_hash   VARCHAR(100),
    from_addr VARCHAR(100),
    to_addr   VARCHAR(100),
    note      TEXT,
    match_id  UUID REFERENCES matches(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Disputes ─────────────────────────────────────────────────
CREATE TABLE disputes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    UUID REFERENCES matches(id) NOT NULL,
    player_a    UUID REFERENCES users(id) NOT NULL,
    player_b    UUID REFERENCES users(id) NOT NULL,
    reason      TEXT NOT NULL,
    status      dispute_status DEFAULT 'open',
    resolution  dispute_resolution DEFAULT 'pending',
    evidence    TEXT,
    admin_notes TEXT,
    resolved_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ── Audit Log ────────────────────────────────────────────────
CREATE TABLE audit_logs (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id  UUID REFERENCES users(id),
    action    VARCHAR(100) NOT NULL,
    target    VARCHAR(200),
    detail    TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Platform Settings (single-row config) ────────────────────
CREATE TABLE platform_settings (
    id                       SERIAL PRIMARY KEY,          -- always 1
    fee_percent              NUMERIC(4,2) DEFAULT 5.00,   -- ArenaEscrow FEE_PERCENT
    daily_betting_max        NUMERIC(10,2) DEFAULT 500.00,-- user hard cap
    maintenance_mode         BOOLEAN DEFAULT FALSE,
    registration_open        BOOLEAN DEFAULT TRUE,
    auto_dispute_escalation  BOOLEAN DEFAULT TRUE,
    kill_switch_active       BOOLEAN DEFAULT FALSE,
    updated_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_by               UUID REFERENCES users(id)
);
-- Seed the single row
INSERT INTO platform_settings DEFAULT VALUES;

-- ── User Settings (per-user configurable limits) ─────────────
CREATE TABLE user_settings (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_betting_limit  NUMERIC(10,2) DEFAULT 500.00 CHECK (daily_betting_limit >= 50),
    -- daily_betting_used resets at midnight UTC — computed from transactions, not stored
    two_factor_enabled   BOOLEAN DEFAULT FALSE,
    withdraw_whitelist   BOOLEAN DEFAULT FALSE,
    notif_match_results  BOOLEAN DEFAULT TRUE,
    notif_payouts        BOOLEAN DEFAULT TRUE,
    notif_system_alerts  BOOLEAN DEFAULT TRUE,
    notif_promotions     BOOLEAN DEFAULT FALSE,
    region               VARCHAR(10) DEFAULT 'EU',
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Daily Challenge Progress (per-user, per-day) ──────────────
CREATE TABLE user_challenge_progress (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    challenge_id VARCHAR(50) NOT NULL,    -- matches DailyChallenge.id (server-defined)
    current      INT DEFAULT 0,           -- current progress toward target
    status       VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','completed','claimed')),
    date         DATE NOT NULL DEFAULT CURRENT_DATE,  -- resets daily
    claimed_at   TIMESTAMPTZ,
    UNIQUE (user_id, challenge_id, date)
);
CREATE INDEX idx_challenge_progress_user ON user_challenge_progress(user_id, date);

-- ── Notifications ────────────────────────────────────────────
CREATE TABLE notifications (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    type      notification_type NOT NULL,
    title     VARCHAR(200) NOT NULL,
    message   TEXT NOT NULL,
    read      BOOLEAN DEFAULT FALSE,
    metadata  JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tokens / Wallet Info ─────────────────────────────────────
CREATE TABLE wallet_tokens (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    symbol    VARCHAR(10) NOT NULL,
    name      VARCHAR(50),
    balance   NUMERIC(18,8) DEFAULT 0,
    usd_value NUMERIC(12,2) DEFAULT 0,
    change_24h NUMERIC(6,2) DEFAULT 0,
    network   network NOT NULL
);

CREATE TABLE wallet_addresses (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    network network NOT NULL,
    address VARCHAR(100) NOT NULL,
    PRIMARY KEY (user_id, network)
);

-- ── Users: uniqueness indexes ────────────────────────────────
-- Case-insensitive email (stored lowercase via API, index enforces it at DB level too)
CREATE UNIQUE INDEX users_email_lower_idx    ON users (lower(email));
-- Case-insensitive username (display case preserved, duplicates blocked)
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));
-- Nullable unique IDs — NULLs allowed, but non-NULL values must be globally unique
CREATE UNIQUE INDEX users_steam_id_idx       ON users (steam_id) WHERE steam_id IS NOT NULL;
CREATE UNIQUE INDEX users_riot_id_idx        ON users (riot_id)  WHERE riot_id  IS NOT NULL;

-- ── Game account registry (future: replaces steam_id/riot_id columns) ─
CREATE TABLE user_game_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,        -- 'steam' | 'riot' | 'epic' | 'psn' | 'xbox' …
    account_id  TEXT NOT NULL,        -- platform-assigned ID
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (provider, account_id),    -- one account per provider, globally
    UNIQUE (user_id,  provider)       -- one provider account per user
);
CREATE INDEX idx_uga_user ON user_game_accounts(user_id);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_matches_status        ON matches(status);
CREATE INDEX idx_matches_host          ON matches(host_id);
CREATE INDEX idx_matches_on_chain      ON matches(on_chain_match_id);
CREATE INDEX idx_transactions_user  ON transactions(user_id);
CREATE INDEX idx_transactions_user_created_at
    ON transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_match_id
    ON transactions(match_id)
    WHERE match_id IS NOT NULL;
CREATE INDEX idx_disputes_match     ON disputes(match_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);
CREATE INDEX idx_audit_admin        ON audit_logs(admin_id);

-- ── Helper: check role (security definer) ────────────────────
CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = _user_id AND role = _role
    )
$$;

-- ── Support Tickets (Player Reports + Match Disputes + General Support) ───────
CREATE TYPE ticket_reason AS ENUM (
    'cheating','harassment','fake_screenshot','disconnect_abuse','other'
);
CREATE TYPE ticket_status AS ENUM ('open','investigating','dismissed','resolved');

-- How the ticket was opened — aligns with SupportTicketCategory in src/types/index.ts
CREATE TYPE support_ticket_category AS ENUM (
    'player_report',    -- submitted from PlayerCardPopover / Admin Reports tab
    'match_dispute',    -- submitted from History page "Appeal this match"
    'general_support'   -- submitted from Settings "Help & Support" / Header help icon
);

-- Topic when category = general_support — aligns with SupportTopic in src/types/index.ts
CREATE TYPE support_topic AS ENUM (
    'account_access',
    'payments_escrow',
    'bug_technical',
    'match_outcome',
    'feedback',
    'other'
);

CREATE TABLE support_tickets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id  UUID REFERENCES users(id) NOT NULL,
    -- NULL when category = general_support (ticket goes to platform support queue, not against a user)
    reported_id  UUID REFERENCES users(id),
    reason       ticket_reason NOT NULL,
    description  TEXT NOT NULL,
    status       ticket_status NOT NULL DEFAULT 'open',
    -- How the ticket was filed — matches SupportTicketCategory (client sends this field)
    category     support_ticket_category NOT NULL DEFAULT 'player_report',
    -- Set when category = match_dispute — links ticket to the disputed match
    match_id     UUID REFERENCES matches(id),
    -- Set when category = general_support — narrows the support topic
    topic        support_topic,
    -- Client-side data URL until file-upload API exists; server stores S3/CDN URL in prod
    attachment_url TEXT,
    admin_note   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    -- Only enforce no-self-report when a specific user is reported (general_support has reported_id = NULL)
    CONSTRAINT no_self_report CHECK (reported_id IS NULL OR reporter_id <> reported_id)
);

-- Auto-touch updated_at on any admin status / note change
CREATE OR REPLACE FUNCTION set_support_tickets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION set_support_tickets_updated_at();

CREATE INDEX idx_tickets_reported ON support_tickets(reported_id);
CREATE INDEX idx_tickets_reporter ON support_tickets(reporter_id);
CREATE INDEX idx_tickets_status   ON support_tickets(status);
CREATE INDEX idx_tickets_category ON support_tickets(category);   -- Admin panel filters by category

-- ── Arena ID Generator Function ───────────────────────────────
-- Generates a unique ARENA-XXXXXX identifier on user registration
CREATE OR REPLACE FUNCTION generate_arena_id()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := 'ARENA-';
    i INT;
BEGIN
    FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
    END LOOP;
    RETURN result;
END;
$$;

-- Trigger: auto-generate arena_id on INSERT if not provided
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

CREATE TRIGGER trg_set_arena_id
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION set_arena_id();

-- Touch users.updated_at on profile / cosmetic changes (avatar, avatar_bg, equipped_badge_icon, forge_unlocked_item_ids, etc.)
CREATE OR REPLACE FUNCTION set_users_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_users_updated_at();

-- ── Friendships ───────────────────────────────────────────────
CREATE TYPE friendship_status AS ENUM ('pending','accepted','blocked');

CREATE TABLE friendships (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiator_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    receiver_id  UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    status       friendship_status NOT NULL DEFAULT 'pending',
    message      TEXT,                                         -- optional message sent with friend request
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT no_self_friendship CHECK (initiator_id <> receiver_id),
    CONSTRAINT unique_friendship   UNIQUE (initiator_id, receiver_id)
);

CREATE INDEX idx_friendships_initiator ON friendships(initiator_id, status);
CREATE INDEX idx_friendships_receiver  ON friendships(receiver_id,  status);

-- ── Direct Messages ───────────────────────────────────────────
CREATE TABLE direct_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id   UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
    read        BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT no_self_message CHECK (sender_id <> receiver_id)
);

CREATE INDEX idx_dm_sender   ON direct_messages(sender_id,   created_at DESC);
CREATE INDEX idx_dm_receiver ON direct_messages(receiver_id, read);
-- Composite index for conversation lookup (both directions)
CREATE INDEX idx_dm_conversation ON direct_messages(
    LEAST(sender_id::TEXT, receiver_id::TEXT),
    GREATEST(sender_id::TEXT, receiver_id::TEXT),
    created_at DESC
);

-- ── Inbox Messages (formal, non-real-time) ────────────────────
CREATE TABLE inbox_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id   UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    subject     VARCHAR(200) NOT NULL,
    content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
    read        BOOLEAN DEFAULT FALSE,
    deleted     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT no_self_inbox CHECK (sender_id <> receiver_id)
);

CREATE INDEX idx_inbox_receiver ON inbox_messages(receiver_id, read, deleted);
CREATE INDEX idx_inbox_sender   ON inbox_messages(sender_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- FORGE — Store, Challenges, Events, Drops
-- ─────────────────────────────────────────────────────────────────────────────

-- Arena Tokens balance per user (earned via challenges/events, spent in Forge)
CREATE TABLE arena_tokens (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance        INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    lifetime_earned INTEGER NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AT transaction ledger  (matches → earn | forge_purchase → spend)
CREATE TABLE at_transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('earn_challenge','earn_event','spend_purchase','spend_drop','refund')),
    amount      INTEGER NOT NULL,          -- positive = earn, negative = spend
    ref_id      TEXT,                      -- challenge_id / event_id / purchase_id
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_at_tx_user ON at_transactions(user_id, created_at DESC);

-- Forge item catalogue
CREATE TABLE forge_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('avatar','frame','badge','boost','vip','bundle')),
    rarity      TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
    icon        TEXT NOT NULL,   -- preset:id = Identity Studio (avatarPresets.ts); also bg:/badge:/boost:/vip:/bundle:
    price_at    INTEGER,                   -- NULL = not available for AT
    price_usdt  NUMERIC(10,2),             -- NULL = not available for USDT
    featured    BOOLEAN NOT NULL DEFAULT FALSE,
    limited     BOOLEAN NOT NULL DEFAULT FALSE,
    stock       INTEGER,                   -- NULL = unlimited
    expires_at  TIMESTAMPTZ,
    owned_by    INTEGER NOT NULL DEFAULT 0,-- denormalized popularity counter
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_forge_items_category ON forge_items(category, rarity);

-- ── Forge catalogue seed — synced with src/stores/forgeStore.ts ──────────────
-- slug = id used by the frontend
-- price_at NULL  = not purchasable with Arena Tokens
-- price_usdt NULL = not purchasable with USDT
INSERT INTO forge_items (slug, name, description, category, rarity, icon, price_at, price_usdt, featured, limited, stock, owned_by, active) VALUES
  -- Avatars
  ('item-001',      'Vermilion Edge',       'Identity Studio legendary — radiant duelist portrait for clutch rounds.',          'avatar',  'legendary', 'preset:vermilion_edge',   3200, 24.99, TRUE,  TRUE,  47,   23,     TRUE),
  ('item-002',      'Titan Shifter',        'Heavyweight pressure — semi-realistic forged bust.',                               'avatar',  'epic',      'preset:titan_shifter',    1899, 14.99, FALSE, FALSE, NULL, 156,    TRUE),
  ('item-003',      'Arcane Emperor',       'Arcane command — premium painted portrait.',                                       'avatar',  'rare',      'preset:arcane_emperor',    849,  6.99, FALSE, FALSE, NULL, 489,    TRUE),
  ('item-004',      'Emerald Samurai',      'Clean edge starter look — Identity Studio line.',                                  'avatar',  'common',    'preset:emerald_samurai',   320,  2.99, FALSE, FALSE, NULL, 1240,   TRUE),
  -- Frames
  ('frame-001',     'Sovereign Gold Frame', 'Gold aura frame — premium glow.',                                                  'frame',   'rare',      'bg:gold',                 NULL,  1.99, FALSE, FALSE, NULL, 89,     TRUE),
  ('frame-002',     'Chroma Luxe Frame',    'Prismatic chroma — flex worthy.',                                                  'frame',   'epic',      'bg:rainbow',              NULL,  2.99, FALSE, FALSE, NULL, 34,     TRUE),
  ('frame-003',     'Northern Pulse Frame', 'Aurora pulse — clean and cold.',                                                   'frame',   'epic',      'bg:aurora',               NULL,  2.99, FALSE, FALSE, NULL, 21,     TRUE),
  ('frame-004',     'Magma Elite Frame',    'Molten heat — loud but classy.',                                                   'frame',   'rare',      'bg:lava',                 NULL,  1.99, FALSE, FALSE, NULL, 55,     TRUE),
  -- Badges free
  ('badge-free-01', 'Arena Ring Sigil',     'Default Arena ring crest — clean gold bezel, starter Identity Studio pin.',        'badge',   'common',    'badge:arena_ring',           0, NULL, FALSE, FALSE, NULL, 128400, TRUE),
  ('badge-free-02', 'Sun God Crest',        'Radiant solar plate — warm metallics for a regal ring accent.',                    'badge',   'common',    'badge:sun_god',              0, NULL, FALSE, FALSE, NULL, 94200,  TRUE),
  ('badge-free-03', 'Neon Hunter Mark',     'Phoenix-flame sigil — high-energy accent.',                                        'badge',   'common',    'badge:neon_hunter',          0, NULL, FALSE, FALSE, NULL, 81050,  TRUE),
  -- Badges event
  ('badge-ev-01',   'Shadow Ronin',         'Blade-bound oni crest — violet steel, event-limited forge line.',                  'badge',   'epic',      'badge:shadow_ronin',      1100, NULL, FALSE, FALSE, NULL, 412,    TRUE),
  ('badge-ev-02',   'Black Mage',           'Serpent-root grove seal — quiet menace on the ring.',                              'badge',   'rare',      'badge:black_mage',         720, NULL, FALSE, FALSE, NULL, 633,    TRUE),
  ('badge-ev-03',   'Desert Prince',        'Rune-lit codex — scholar-king vibe for ladder grinders.',                          'badge',   'rare',      'badge:desert_prince',      680, NULL, FALSE, FALSE, NULL, 540,    TRUE),
  ('badge-ev-04',   'Storm Swordsman',      'Coiled storm drake — teal ice peaks, premium event flex.',                         'badge',   'epic',      'badge:storm_swordsman',    980, NULL, FALSE, FALSE, NULL, 298,    TRUE),
  -- Badges premium
  ('badge-pr-01',   'Crimson Core',         'Molten heart reactor — forged premium pin, Identity Studio line.',                 'badge',   'epic',      'badge:crimson_core',      1250, NULL, FALSE, FALSE, NULL, 156,    TRUE),
  ('badge-pr-02',   'Void Warden',          'Obsidian warden plate — void-edge glow for top earners.',                          'badge',   'legendary', 'badge:void_warden',       2100,16.99, FALSE, TRUE,  80,   44,     TRUE),
  ('badge-pr-03',   'Iron Command',         'Command stripe insignia — tactical steel for consistent grinders.',                'badge',   'rare',      'badge:iron_command',       640, NULL, FALSE, FALSE, NULL, 890,    TRUE),
  ('item-005',      'Founder''s Badge',     'Hall medallion — molten gold, obsidian depth, cinematic rim.',                     'badge',   'legendary', 'badge:founders',          NULL,  9.99, FALSE, TRUE,  100,  89,    TRUE),
  ('item-006',      'Champion''s Seal',     'Amethyst-forged seal for ladder killers — violet arc glow.',                       'badge',   'epic',      'badge:champions',          900, NULL, FALSE, FALSE, NULL, 234,    TRUE),
  ('item-007',      'Veteran''s Mark',      'Battle-worn steel crest with arena-cyan bevel.',                                   'badge',   'rare',      'badge:veterans',           400, NULL, FALSE, FALSE, NULL, 678,    TRUE),
  -- Boosts
  ('item-008',      'Double XP (24h)',      'Earn 2× XP on all matches for 24 hours.',                                          'boost',   'common',    'boost:xp',                 150, NULL, FALSE, FALSE, NULL, 0,      TRUE),
  ('item-009',      'Win Shield',           'Protect your win streak — one loss won''t count.',                                 'boost',   'rare',      'boost:shield',             500, NULL, FALSE, FALSE, NULL, 0,      TRUE),
  -- VIP
  ('item-010',      'VIP Pass (30d)',       'Priority matchmaking, 5% cashback, exclusive VIP badge.',                          'vip',     'epic',      'vip:month',               3000, 14.99, FALSE, FALSE, NULL, 0,     TRUE),
  ('item-011',      'VIP Pass (7d)',        'A week of VIP treatment.',                                                          'vip',     'rare',      'vip:week',                 900,  4.99, FALSE, FALSE, NULL, 0,     TRUE),
  -- Bundles
  ('item-012',      'Elite Bundle',         'Top cosmetics + Champion''s Seal + 30d VIP + 3× Double XP. Best value.',           'bundle',  'legendary', 'bundle:elite',            5000, 24.99, FALSE, FALSE, NULL, 12,    TRUE)
ON CONFLICT (slug) DO NOTHING;

-- User-owned forge items
CREATE TABLE forge_purchases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES forge_items(id),
    currency    TEXT NOT NULL CHECK (currency IN ('AT','USDT')),
    amount      NUMERIC(12,2) NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_forge_purchases_user ON forge_purchases(user_id, purchased_at DESC);

-- Forge challenges (daily + weekly)
CREATE TABLE forge_challenges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    icon        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('daily','weekly')),
    reward_at   INTEGER NOT NULL CHECK (reward_at > 0),
    reward_xp   INTEGER NOT NULL CHECK (reward_xp > 0),
    target      INTEGER NOT NULL CHECK (target > 0),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user progress on each challenge (resets with the cycle)
CREATE TABLE forge_challenge_progress (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id UUID NOT NULL REFERENCES forge_challenges(id) ON DELETE CASCADE,
    progress     INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','claimable','claimed')),
    cycle_start  DATE NOT NULL,           -- the day (daily) or week-start (weekly) this row belongs to
    PRIMARY KEY (user_id, challenge_id, cycle_start)
);
CREATE INDEX idx_forge_ch_progress_user ON forge_challenge_progress(user_id, cycle_start);

-- Forge events (tournaments, seasonal, special)
CREATE TABLE forge_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    description       TEXT NOT NULL,
    game              TEXT NOT NULL,
    type              TEXT NOT NULL CHECK (type IN ('tournament','seasonal','special')),
    icon              TEXT NOT NULL,
    prize_pool        NUMERIC(12,2),
    reward_at         INTEGER,
    entry_fee_usdt    NUMERIC(10,2),      -- NULL = free
    max_participants  INTEGER,
    start_at          TIMESTAMPTZ NOT NULL,
    end_at            TIMESTAMPTZ NOT NULL,
    status            TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','ended')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_forge_events_status ON forge_events(status, start_at);

-- Event participant registrations
CREATE TABLE forge_event_participants (
    event_id   UUID NOT NULL REFERENCES forge_events(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_forge_ep_user ON forge_event_participants(user_id);

-- Forge drops (season passes, bundles, flash deals)
CREATE TABLE forge_drops (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 TEXT NOT NULL,
    description          TEXT NOT NULL,
    type                 TEXT NOT NULL CHECK (type IN ('season_pass','bundle','flash')),
    icon                 TEXT NOT NULL,
    original_price_usdt  NUMERIC(10,2),
    sale_price_usdt      NUMERIC(10,2),
    price_at             INTEGER,
    discount_percent     SMALLINT CHECK (discount_percent BETWEEN 0 AND 100),
    stock                INTEGER,          -- NULL = unlimited
    expires_at           TIMESTAMPTZ,
    highlights           JSONB NOT NULL DEFAULT '[]',
    tag                  TEXT,
    active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User purchases of drops
CREATE TABLE forge_drop_purchases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drop_id     UUID NOT NULL REFERENCES forge_drops(id),
    amount_usdt NUMERIC(10,2) NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_forge_dp_user ON forge_drop_purchases(user_id, purchased_at DESC);

-- Add lock_countdown_start to matches (10-second leave window before escrow locks on-chain)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS lock_countdown_start TIMESTAMPTZ;
COMMENT ON COLUMN matches.lock_countdown_start IS 'Set when all players have deposited. Clients have 10s to leave before contract locks.';

-- ── Match Lobby Enhancements ──────────────────────────────────────────────────

-- Auto-expire: regular column populated by trigger on INSERT.
-- GENERATED ALWAYS AS cannot use TIMESTAMPTZ arithmetic (classified STABLE, not
-- IMMUTABLE in PostgreSQL due to timezone dependency) — trigger is the fix.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_match_expires_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.expires_at := NEW.created_at + INTERVAL '1 hour';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_match_expires_at ON matches;
CREATE TRIGGER trg_match_expires_at
    BEFORE INSERT ON matches
    FOR EACH ROW EXECUTE FUNCTION set_match_expires_at();

-- Index for the expiry polling query and CRON cleanup
CREATE INDEX IF NOT EXISTS idx_matches_expires_at
  ON matches(expires_at) WHERE status = 'waiting';

-- DELETE /api/matches/:id endpoint spec (host-only, waiting-only):
--   1. Verify: caller_id = matches.host_id AND status = 'waiting'
--   2. Call:   ArenaEscrow.cancelMatch(on_chain_match_id)
--              → emits MatchCancelled(matchId, cancelledBy)
--              → emits MatchRefunded(matchId) for each depositor
--   3. On MatchCancelled event:  UPDATE matches SET status='cancelled', ended_at=NOW()
--   4. On MatchRefunded event:   For each match_players row with has_deposited=TRUE:
--                                  INSERT INTO transactions (type='refund', amount=deposit_amount, ...)
--                                  UPDATE user_balances SET available=available+deposit_amount,
--                                                           in_escrow=in_escrow-deposit_amount
--   5. Response: 204 No Content

-- Server CRON (runs every 60s) — replaces client-side expireOldMatches():
--   UPDATE matches SET status='cancelled', ended_at=NOW()
--   WHERE status='waiting' AND expires_at < NOW();
--   -- Then for each cancelled match: trigger MatchRefunded logic above

-- ── Client Sessions ───────────────────────────────────────────────────────────
-- One row per connected Arena desktop client instance.
-- The engine's POST /client/heartbeat UPSERTs this row every HEARTBEAT_INTERVAL.
-- The web UI reads GET /client/status to show the connection badge.
--
-- Phase 3 (auth): add user_id FK once JWT auth is wired.
-- Phase 4 (sync): web UI polls this table directly via REST; WS pushes on change.
--
CREATE TYPE client_status AS ENUM ('idle', 'in_game', 'in_match', 'disconnected');

CREATE TABLE client_sessions (
    id              UUID PRIMARY KEY,              -- set by client (session_id from config.json)
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,  -- set via POST /client/bind
    wallet_address  VARCHAR(100) NOT NULL,
    status          client_status NOT NULL DEFAULT 'idle',
    game            game,                          -- NULL when idle; 'CS2' | 'Valorant' when active
    client_version  VARCHAR(20) NOT NULL DEFAULT 'unknown',
    match_id        UUID REFERENCES matches(id),   -- NULL unless status = 'in_match'
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ                    -- set when client sends disconnect or heartbeat times out
);

-- Only one active session per wallet at a time; older rows kept for audit trail.
CREATE UNIQUE INDEX idx_client_sessions_wallet_active
    ON client_sessions(wallet_address)
    WHERE disconnected_at IS NULL;

CREATE INDEX idx_client_sessions_wallet    ON client_sessions(wallet_address, last_heartbeat DESC);
CREATE INDEX idx_client_sessions_match     ON client_sessions(match_id) WHERE match_id IS NOT NULL;
CREATE INDEX idx_client_sessions_heartbeat ON client_sessions(last_heartbeat);

-- ── Migration 016 — M8 player penalties ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_penalties (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offense_type    VARCHAR(100) NOT NULL,
    notes           TEXT,
    offense_count   INT          NOT NULL DEFAULT 1,
    suspended_until TIMESTAMPTZ,
    banned_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      UUID         REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_player_penalties_user_id  ON player_penalties(user_id);
CREATE INDEX IF NOT EXISTS idx_player_penalties_created_at ON player_penalties(created_at);

-- Auto-disconnect sessions whose heartbeat has not been received for >60s.
-- Called by the engine's background task (or a DB CRON job).
CREATE OR REPLACE FUNCTION expire_stale_client_sessions()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    affected INTEGER;
BEGIN
    UPDATE client_sessions
    SET    status = 'disconnected',
           disconnected_at = NOW()
    WHERE  disconnected_at IS NULL
      AND  last_heartbeat < NOW() - INTERVAL '60 seconds';
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;


-- ── Match Evidence ─────────────────────────────────────────────────────────────
-- Stores every validated screenshot submission from the Arena desktop client.
-- One row per POST /validate/screenshot that returns accepted=true.
-- Used as the audit trail for disputes and escrow release decisions.
--
-- Phase 3: add submitter_id FK once auth is live.
-- Phase 4: wire to StateMachine consensus — require N matching evidence rows
--          before marking match as 'completed' and releasing escrow.
--
CREATE TYPE evidence_result AS ENUM ('victory', 'defeat');

CREATE TABLE match_evidence (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id         UUID REFERENCES matches(id) ON DELETE CASCADE NOT NULL,
    -- DB-ready (Phase 3): add FK → users(id) once auth is live
    -- submitter_id  UUID REFERENCES users(id),
    wallet_address   VARCHAR(100),                    -- who submitted (pre-auth)
    game             game NOT NULL,
    result           evidence_result NOT NULL,        -- 'victory' | 'defeat'
    confidence       NUMERIC(4,3) NOT NULL,           -- 0.000 – 1.000
    accepted         BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE when confidence >= threshold
    players          TEXT[] NOT NULL DEFAULT '{}',    -- OCR-detected player names
    agents           TEXT[] NOT NULL DEFAULT '{}',    -- Valorant agent names; empty for CS2
    score            VARCHAR(10),                     -- e.g. '13-11'; NULL if not detected
    screenshot_path  TEXT NOT NULL,                   -- engine-local path under SCREENSHOT_DIR
    evidence_path    TEXT,                            -- engine-local path under EVIDENCE_DIR
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evidence_match   ON match_evidence(match_id, submitted_at DESC);
CREATE INDEX idx_evidence_wallet  ON match_evidence(wallet_address);
CREATE INDEX idx_evidence_result  ON match_evidence(match_id, result, accepted);

-- ── Oracle Sync State ─────────────────────────────────────────────────────────
-- Single-row table tracking the last blockchain block processed by the
-- EscrowClient event listener.  On engine restart the listener resumes from
-- last_block instead of re-scanning the full lookback window, preventing
-- missed WinnerDeclared / PlayerDeposited / MatchRefunded events.
--
-- Written by: EscrowClient._save_last_block()
-- Read by:    EscrowClient._load_last_block()
CREATE TABLE IF NOT EXISTS oracle_sync_state (
    id           VARCHAR(20)  PRIMARY KEY DEFAULT 'singleton',
    last_block   BIGINT       NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO oracle_sync_state (id, last_block)
VALUES ('singleton', 0)
ON CONFLICT (id) DO NOTHING;

-- ── AT Staking ────────────────────────────────────────────────────────────────
-- stake_currency on matches: 'CRYPTO' (ETH/BNB via escrow contract) | 'AT'
ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS stake_currency VARCHAR(10) NOT NULL DEFAULT 'CRYPTO';

-- AT purchase packages with tiered discounts
CREATE TABLE IF NOT EXISTS at_packages (
    id           SERIAL PRIMARY KEY,
    at_amount    INTEGER         NOT NULL,
    usdt_price   NUMERIC(10,2)  NOT NULL,
    discount_pct NUMERIC(5,2)   NOT NULL DEFAULT 0,
    active       BOOLEAN         NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_at_packages_amount UNIQUE (at_amount)
);

INSERT INTO at_packages (at_amount, usdt_price, discount_pct) VALUES
    (500,    5.00,   0.00),
    (1000,  10.00,   5.00),
    (2500,  25.00,   8.00),
    (5000,  50.00,  12.00),
    (10000, 100.00, 15.00)
ON CONFLICT DO NOTHING;

-- ── Migration 017 — Admin Infrastructure ─────────────────────────────────────
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

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id   UUID         REFERENCES users(id),
    action     VARCHAR(100) NOT NULL,
    target_id  VARCHAR(200),
    notes      TEXT,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin   ON admin_audit_log(admin_id, created_at DESC);

-- ── Migration 018 — Admin Query Indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_status        ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created_at    ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_status     ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_created_at ON disputes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_player_a   ON disputes(player_a);

-- ── Migration 019 — Ensure matches.host_id is indexed ────────────────────────
CREATE INDEX IF NOT EXISTS idx_matches_host ON matches(host_id);

-- ── Migration 020 — Raise daily AT bet limit: 500 → 50000 ────────────────────
INSERT INTO platform_config (key, value)
VALUES ('daily_bet_max_at', '50000')
ON CONFLICT (key) DO UPDATE SET value = '50000', updated_at = NOW();

-- ── Migration 030 — Fraud / AML report thresholds (Issue #57) ────────────────
INSERT INTO platform_config (key, value) VALUES
    ('fraud_pair_match_gt',              '3'),
    ('fraud_pair_window_hours',          '24'),
    ('fraud_intentional_loss_min_count', '5'),
    ('fraud_intentional_loss_days',      '7')
ON CONFLICT (key) DO NOTHING;

-- ── Migration 031 — Host client lobby auto-cancel timeout (seconds) ─────────
INSERT INTO platform_config (key, value) VALUES
    ('client_lobby_host_timeout_sec', '60')
ON CONFLICT (key) DO NOTHING;

-- ── Migration 021 — Index for daily staked AT query ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_match_players_user_id
    ON match_players(user_id);

CREATE INDEX IF NOT EXISTS idx_matches_status_ended_at
    ON matches(status, ended_at)
    WHERE ended_at IS NOT NULL;

-- ── Migration 022 — TOTP / 2FA columns on users ──────────────────────────────
-- TODO[GOOGLE]: ADD COLUMN IF NOT EXISTS google_id VARCHAR(100) UNIQUE DEFAULT NULL,
--               ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'email'
-- ^ Add these when Google OAuth is ready (next week). Do NOT add them now.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Migration 023 — deleted_accounts (soft-delete / re-register guard) ─────
CREATE TABLE IF NOT EXISTS deleted_accounts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    steam_id       VARCHAR(30),
    riot_id        VARCHAR(30),
    wallet_address VARCHAR(255),
    email_hash     VARCHAR(64),
    username_hash  VARCHAR(64),
    deleted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    flag_reason    TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_steam ON deleted_accounts(steam_id);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_riot  ON deleted_accounts(riot_id);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_wallet ON deleted_accounts(wallet_address);

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

-- ── Migration 025 — wallet_blacklist (banned wallet/steam/riot) ─────────────
-- Migration 025: wallet/steam blacklist for banned accounts
CREATE TABLE IF NOT EXISTS wallet_blacklist (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address VARCHAR(255),
    steam_id       VARCHAR(30),
    riot_id        VARCHAR(30),
    user_id        UUID,           -- original user (may be deleted)
    reason         TEXT NOT NULL DEFAULT 'ban',
    banned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    banned_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_blacklist_wallet ON wallet_blacklist(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_blacklist_steam  ON wallet_blacklist(steam_id);
CREATE INDEX IF NOT EXISTS idx_wallet_blacklist_riot   ON wallet_blacklist(riot_id);

-- ── Migration 026 — match_players.user_id nullable (history on delete) ──────
-- Migration 026: allow user_id NULL in match_players to preserve match history on account deletion
-- Step 1: drop the old composite PK only (idempotent — skip if PK is already on surrogate `id`)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'match_players'
      AND c.conname = 'match_players_pkey'
      AND c.contype = 'p'
      AND array_length(c.conkey, 1) > 1
  ) THEN
    ALTER TABLE match_players DROP CONSTRAINT match_players_pkey;
  END IF;
END $$;

-- Step 2: add a surrogate PK
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS id SERIAL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'match_players'
      AND c.contype = 'p'
  ) THEN
    ALTER TABLE match_players ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Step 3: make user_id nullable + change FK to SET NULL
ALTER TABLE match_players
    ALTER COLUMN user_id DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS match_players_user_id_fkey,
    ADD CONSTRAINT match_players_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Step 4: unique constraint to prevent duplicate active entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_players_match_user
    ON match_players(match_id, user_id)
    WHERE user_id IS NOT NULL;

-- ── Migration 027 — tx_type enum: escrow_refund_* values ─────────────────────
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_leave';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_kicked';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_disconnect';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'escrow_refund_cancel';

-- ── Migration 029 — Google OAuth (google_id, auth_provider, nullable password) ─
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'email';
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id_unique
    ON users (google_id)
    WHERE google_id IS NOT NULL;
