-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — PostgreSQL Schema Init                            ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE match_status   AS ENUM ('waiting','in_progress','completed','cancelled','disputed');
CREATE TYPE match_type     AS ENUM ('public','custom');
CREATE TYPE match_mode     AS ENUM ('1v1','2v2','4v4','5v5');
CREATE TYPE game           AS ENUM ('CS2','Valorant','Fortnite','Apex Legends','PUBG','COD','League of Legends');
CREATE TYPE tx_type        AS ENUM ('deposit','withdrawal','match_win','match_loss','fee','refund','escrow_lock','escrow_release');
CREATE TYPE tx_status      AS ENUM ('completed','pending','failed');
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
    steam_id        VARCHAR(30),
    wallet_address  VARCHAR(100),
    rank            VARCHAR(20) DEFAULT 'Unranked',
    tier            VARCHAR(20) DEFAULT 'Bronze',
    verified        BOOLEAN DEFAULT FALSE,
    avatar_initials VARCHAR(4),
    avatar          TEXT DEFAULT 'initials',    -- 'initials' | emoji | 'upload:{dataURL}'
    avatar_bg       TEXT DEFAULT 'default',     -- bgId from avatarBgs.ts
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
    xp              INT DEFAULT 0               -- earned via challenges & wins
);

-- ── User Balances ────────────────────────────────────────────
CREATE TABLE user_balances (
    user_id   UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total     NUMERIC(12,2) DEFAULT 0,
    available NUMERIC(12,2) DEFAULT 0,
    in_escrow NUMERIC(12,2) DEFAULT 0
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
    on_chain_match_id BIGINT,           -- ArenaEscrow.sol matchId (uint256), set on MatchCreated event
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

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_matches_status        ON matches(status);
CREATE INDEX idx_matches_host          ON matches(host_id);
CREATE INDEX idx_matches_on_chain      ON matches(on_chain_match_id);
CREATE INDEX idx_transactions_user  ON transactions(user_id);
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

-- ── Support Tickets (Player Reports) ─────────────────────────
CREATE TYPE ticket_reason AS ENUM (
    'cheating','harassment','fake_screenshot','disconnect_abuse','other'
);
CREATE TYPE ticket_status AS ENUM ('open','investigating','dismissed','resolved');

CREATE TABLE support_tickets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id  UUID REFERENCES users(id) NOT NULL,
    reported_id  UUID REFERENCES users(id) NOT NULL,
    reason       ticket_reason NOT NULL,
    description  TEXT NOT NULL,
    status       ticket_status NOT NULL DEFAULT 'open',
    admin_note   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT no_self_report CHECK (reporter_id <> reported_id)
);

CREATE INDEX idx_tickets_reported ON support_tickets(reported_id);
CREATE INDEX idx_tickets_reporter ON support_tickets(reporter_id);
CREATE INDEX idx_tickets_status   ON support_tickets(status);

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
    category    TEXT NOT NULL CHECK (category IN ('avatar','badge','boost','vip','bundle')),
    rarity      TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
    icon        TEXT NOT NULL,
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

-- Auto-expire: computed column so clients and server always agree on expiry time
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    GENERATED ALWAYS AS (created_at + INTERVAL '30 minutes') STORED;

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
