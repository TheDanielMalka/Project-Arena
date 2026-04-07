-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 013 — Match Consensus persistence                           ║
-- ║                                                                        ║
-- ║  Problem: MatchConsensus lives only in RAM.  When the engine restarts  ║
-- ║  (deploy, crash, OOM) all pending votes are lost and the room deadlocks.║
-- ║                                                                        ║
-- ║  Solution: persist one row per (match, wallet) to match_consensus so   ║
-- ║  the consensus object can restore itself from DB on any restart.        ║
-- ║                                                                        ║
-- ║  Schema mirrors PlayerSubmission fields exactly — no transformation     ║
-- ║  needed between DB and in-memory representation.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS match_consensus (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id       UUID         NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    wallet_address VARCHAR(200) NOT NULL,
    result         VARCHAR(50),           -- "victory" | "defeat" | "CT_WIN" | "T_WIN" | NULL
    confidence     FLOAT        NOT NULL DEFAULT 0,
    players        TEXT[]       NOT NULL DEFAULT '{}',
    agents         TEXT[]       NOT NULL DEFAULT '{}',
    score          VARCHAR(20),
    submitted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- One submission per player per match — duplicates silently rejected (ON CONFLICT DO NOTHING)
    CONSTRAINT uq_match_consensus_player UNIQUE (match_id, wallet_address)
);

-- Fast lookup: "give me all votes for this match"
CREATE INDEX IF NOT EXISTS idx_match_consensus_match_id
    ON match_consensus(match_id);
