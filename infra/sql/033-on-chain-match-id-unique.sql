-- Migration 033: make matches.on_chain_match_id UNIQUE.
-- Motivation (C15): without a UNIQUE constraint, a duplicate MatchCreated
-- event (chain re-org, listener restart, bug in the event dedup path) can
-- insert TWO rows with the same on_chain_match_id. Later events lookup
-- matches with `WHERE on_chain_match_id = :oid` and may hit the wrong DB
-- row — escrow release could be routed to the wrong match.
--
-- The constraint is PARTIAL (WHERE on_chain_match_id IS NOT NULL) because
-- AT-only matches never set on_chain_match_id, and multiple NULLs must be
-- allowed to coexist.
--
-- Idempotent: no-op if the index already exists.

-- Step 1: collapse any pre-existing duplicates by keeping the earliest row.
-- Safe default — newer duplicate rows typically have no players attached
-- yet, so deleting them is recoverable from the chain. This is a
-- best-effort cleanup; if operator sees unexpected rows they should
-- investigate before re-running migrations.
WITH ranked AS (
    SELECT id,
           on_chain_match_id,
           ROW_NUMBER() OVER (
               PARTITION BY on_chain_match_id ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM matches
    WHERE on_chain_match_id IS NOT NULL
)
DELETE FROM matches
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: add the partial UNIQUE index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_on_chain_match_id
    ON matches(on_chain_match_id)
 WHERE on_chain_match_id IS NOT NULL;
