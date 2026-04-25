-- ============================================================
-- 051-match-team-size-constraint.sql
-- Add CHECK constraint: max_players must equal max_per_team * 2.
--
-- Context: without this constraint a match could be created with
-- e.g. max_players=3, max_per_team=1, causing consensus to wait
-- for 3 submissions that never arrive (PENDING forever).
--
-- The NULL guard allows legacy rows where max_per_team was not
-- set (pre-migration schema). All new rows enforce the invariant.
-- ============================================================

ALTER TABLE matches
    ADD CONSTRAINT chk_max_players_eq_team_times_2
    CHECK (
        max_per_team IS NULL
        OR max_players = max_per_team * 2
    );
