-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 044 — Match live state tracking                             ║
-- ║                                                                        ║
-- ║  Stores real-time score updates sent by player clients during a match. ║
-- ║  One row per match — upserted on every screenshot that contains a      ║
-- ║  readable live HUD score.                                               ║
-- ║                                                                        ║
-- ║  ct_score / t_score: last confirmed score seen by any client.          ║
-- ║  round_confirmed: TRUE once the 0-0 opening score has been seen by     ║
-- ║    at least one client — confirms all players are inside the game.     ║
-- ║  submissions: how many score readings we have received this match       ║
-- ║    (used to weight confidence of the displayed score).                 ║
-- ║  updated_at: when the last live-score screenshot arrived.              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS match_live_state (
    match_id             UUID         PRIMARY KEY
                                        REFERENCES matches(id) ON DELETE CASCADE,
    ct_score             SMALLINT     NOT NULL DEFAULT 0,
    t_score              SMALLINT     NOT NULL DEFAULT 0,
    round_confirmed      BOOLEAN      NOT NULL DEFAULT FALSE,
    first_round_at       TIMESTAMPTZ,           -- when 0-0 was first seen
    submissions          INT          NOT NULL DEFAULT 0,
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup for the live-state endpoint
CREATE INDEX IF NOT EXISTS idx_match_live_state_match
    ON match_live_state(match_id);
