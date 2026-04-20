-- ─────────────────────────────────────────────────────────────
-- 039 — Arena Creators Hub
-- ─────────────────────────────────────────────────────────────

CREATE TYPE creator_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE creator_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name    VARCHAR(80) NOT NULL,
    bio             TEXT,
    primary_game    TEXT NOT NULL,
    rank_tier       TEXT,
    twitch_url      TEXT,
    youtube_url     TEXT,
    tiktok_url      TEXT,
    twitter_url     TEXT,
    clip_urls       TEXT[]   DEFAULT '{}',
    featured        BOOLEAN  NOT NULL DEFAULT FALSE,
    approved_by     UUID     REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

CREATE TABLE creator_applications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    primary_game    TEXT NOT NULL,
    twitch_url      TEXT,
    youtube_url     TEXT,
    tiktok_url      TEXT,
    twitter_url     TEXT,
    bio             TEXT,
    motivation      TEXT,
    status          creator_status NOT NULL DEFAULT 'pending',
    reviewed_by     UUID REFERENCES users(id),
    review_note     TEXT,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

CREATE INDEX idx_creator_profiles_game    ON creator_profiles(primary_game);
CREATE INDEX idx_creator_profiles_featured ON creator_profiles(featured) WHERE featured = TRUE;
CREATE INDEX idx_creator_applications_status ON creator_applications(status);
