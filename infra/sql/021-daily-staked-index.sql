-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 021 — Index for daily staked AT query                       ║
-- ║                                                                        ║
-- ║  _get_daily_staked() now queries completed matches via JOIN.           ║
-- ║  These indexes make the query fast for large match histories.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Needed for: WHERE mp.user_id = :uid (the JOIN filter)
CREATE INDEX IF NOT EXISTS idx_match_players_user_id
    ON match_players(user_id);

-- Needed for: WHERE m.status = 'completed' AND m.ended_at > NOW() - INTERVAL '24 hours'
CREATE INDEX IF NOT EXISTS idx_matches_status_ended_at
    ON matches(status, ended_at)
    WHERE ended_at IS NOT NULL;
