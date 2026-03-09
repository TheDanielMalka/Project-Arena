-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — PostgreSQL Schema Init                            ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE match_status   AS ENUM ('waiting','in_progress','completed','cancelled','disputed');
CREATE TYPE match_type     AS ENUM ('public','custom');
CREATE TYPE match_mode     AS ENUM ('1v1','5v5');
CREATE TYPE game           AS ENUM ('CS2','Valorant','Fortnite','Apex Legends');
CREATE TYPE tx_type        AS ENUM ('deposit','withdrawal','match_win','match_loss','fee','refund','escrow_lock','escrow_release');
CREATE TYPE tx_status      AS ENUM ('completed','pending','failed');
CREATE TYPE dispute_status AS ENUM ('open','reviewing','resolved','escalated');
CREATE TYPE dispute_resolution AS ENUM ('pending','player_a_wins','player_b_wins','refund','void');
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
    preferred_game  game DEFAULT 'CS2',
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
    in_escrow       NUMERIC(12,2) DEFAULT 0
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
    winner_id    UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ
);

-- ── Match Players (join table) ───────────────────────────────
CREATE TABLE match_players (
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    team     VARCHAR(1) CHECK (team IN ('A','B')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
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
CREATE INDEX idx_matches_status     ON matches(status);
CREATE INDEX idx_matches_host       ON matches(host_id);
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
