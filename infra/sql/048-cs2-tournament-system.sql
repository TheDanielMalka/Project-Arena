-- CS2 tournament system — registration, prizes (ILS), testnet + live phases
-- Apply after 047-*.sql

CREATE TABLE IF NOT EXISTS tournament_seasons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
    title_he            TEXT,
    subtitle            TEXT,
    game                game NOT NULL DEFAULT 'CS2',
    network_phase       TEXT NOT NULL DEFAULT 'testnet'
        CHECK (network_phase IN ('testnet', 'mainnet', 'internal')),
    state               TEXT NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft', 'registration_open', 'warmup', 'live', 'completed', 'cancelled')),
    warm_up_minutes     INT NOT NULL DEFAULT 30,
    registration_opens_at  TIMESTAMPTZ,
    registration_closes_at TIMESTAMPTZ,
    main_starts_at         TIMESTAMPTZ,
    test_disclaimer_md  TEXT,
    future_rewards_md   TEXT,
    marketing_blurb_md  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_divisions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id           UUID NOT NULL REFERENCES tournament_seasons(id) ON DELETE CASCADE,
    mode                match_mode NOT NULL,
    title               TEXT NOT NULL,
    title_he            TEXT,
    position            INT NOT NULL DEFAULT 0,
    prize1_ils          INT NOT NULL DEFAULT 0,
    prize2_ils          INT NOT NULL DEFAULT 0,
    prize3_ils          INT NOT NULL DEFAULT 0,
    format_markdown     TEXT,
    max_slots           INT NOT NULL DEFAULT 64,
    is_team_mode        BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (season_id, mode)
);

CREATE TABLE IF NOT EXISTS tournament_registrations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id             UUID NOT NULL REFERENCES tournament_seasons(id) ON DELETE CASCADE,
    division_id            UUID NOT NULL REFERENCES tournament_divisions(id) ON DELETE CASCADE,
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    steam_id_at_register  TEXT,
    team_label            TEXT,
    ack_arena_client      BOOLEAN NOT NULL DEFAULT FALSE,
    ack_testnet           BOOLEAN NOT NULL DEFAULT FALSE,
    ack_cs2_ownership     BOOLEAN NOT NULL DEFAULT FALSE,
    wants_demo_at         BOOLEAN NOT NULL DEFAULT FALSE,
    met_wallet_connected  BOOLEAN NOT NULL DEFAULT FALSE,
    status                TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'waitlist', 'cancelled', 'disqualified')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tournament_reg_user_division UNIQUE (user_id, division_id)
);

CREATE INDEX IF NOT EXISTS idx_treg_season ON tournament_registrations(season_id);
CREATE INDEX IF NOT EXISTS idx_treg_div    ON tournament_registrations(division_id);
CREATE INDEX IF NOT EXISTS idx_treg_user  ON tournament_registrations(user_id);

-- Seed: Arena CS2 Open — testnet (copy row — edit dates in admin later)
INSERT INTO tournament_seasons (
    slug, title, title_he, subtitle, game, network_phase, state,
    warm_up_minutes, test_disclaimer_md, future_rewards_md, marketing_blurb_md
) VALUES (
    'cs2-arena-open-2026',
    'Arena CS2 Open — System Test (Testnet)',
    'תחרות CS2 — בדיקת מערכת (טסט נט)',
    '5v5 · 2v2 · 1v1 · Prizes in ILS · CS2 on Steam only',
    'CS2', 'testnet', 'registration_open',
    30,
    'This tournament is also a full-stack test. Participation helps validate Arena. Rules may be adjusted. Fair play and patience are required.',
    'All participants in early seasons may be eligible for future in-app rewards and recognition if the platform launches successfully, independent of placement in this event.',
    '**Bring your squad.** Stack wins. Prove the stack works.'
) ON CONFLICT (slug) DO NOTHING;

-- Divisions (prizes in ILS as specified)
INSERT INTO tournament_divisions (season_id, mode, title, title_he, position, prize1_ils, prize2_ils, prize3_ils, format_markdown, max_slots, is_team_mode)
SELECT
    s.id, '5v5'::match_mode, '5v5 Grand bracket', 'טור 5v5', 0,
    5000, 3000, 2000,
    '**16 teams** · Single elimination (knockout) · All rounds **Best of 3** maps — **Grand final Best of 5** (pro CS2 format). Warm-up block **30 minutes** before the first 5v5 match.',
    16, TRUE
FROM tournament_seasons s WHERE s.slug = 'cs2-arena-open-2026'
ON CONFLICT (season_id, mode) DO NOTHING;

INSERT INTO tournament_divisions (season_id, mode, title, title_he, position, prize1_ils, prize2_ils, prize3_ils, format_markdown, max_slots, is_team_mode)
SELECT
    s.id, '2v2'::match_mode, '2v2 bracket', 'טור 2v2', 1,
    1500, 750, 250,
    'Knockout format · **Best of 3** until finals · Final **Best of 5** where noted by admins.',
    32, TRUE
FROM tournament_seasons s WHERE s.slug = 'cs2-arena-open-2026'
ON CONFLICT (season_id, mode) DO NOTHING;

INSERT INTO tournament_divisions (season_id, mode, title, title_he, position, prize1_ils, prize2_ils, prize3_ils, format_markdown, max_slots, is_team_mode)
SELECT
    s.id, '1v1'::match_mode, '1v1 duels', 'דו-קרב 1v1', 2,
    1500, 750, 250,
    'Knockout duels · **BO3** stages · Final may be **BO5** (admin).',
    32, FALSE
FROM tournament_seasons s WHERE s.slug = 'cs2-arena-open-2026'
ON CONFLICT (season_id, mode) DO NOTHING;
