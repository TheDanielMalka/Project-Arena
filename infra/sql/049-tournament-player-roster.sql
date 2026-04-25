CREATE TABLE IF NOT EXISTS tournament_registration_players (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID        NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
    slot            INT         NOT NULL,
    ign             TEXT        NOT NULL,
    steam_id        TEXT,
    country         TEXT,
    email           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT trp_reg_slot UNIQUE(registration_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_trp_reg ON tournament_registration_players(registration_id);
