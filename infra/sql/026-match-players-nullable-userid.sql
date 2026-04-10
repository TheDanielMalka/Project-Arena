-- Migration 026: allow user_id NULL in match_players to preserve match history on account deletion
-- Step 1: drop the old composite PK
ALTER TABLE match_players DROP CONSTRAINT match_players_pkey;

-- Step 2: add a surrogate PK
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS id SERIAL;
ALTER TABLE match_players ADD PRIMARY KEY (id);

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
