-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 034 — Transactions hot-path indexes                          ║
-- ║                                                                         ║
-- ║  Audit finding: daily-limit and reconciliation queries that filter      ║
-- ║  transactions by match_id or by (user_id, created_at) fall back to a    ║
-- ║  full sequential scan.  On a production-sized ledger this is a DoS      ║
-- ║  vector (_at_payout_already_happened, per-user activity lookups run     ║
-- ║  on every settle/refund + every /auth/me request).                      ║
-- ║                                                                         ║
-- ║  Idempotent: no-op if the indexes already exist.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- 1. transactions(match_id) — used by _at_payout_already_happened()
--    ("SELECT 1 FROM transactions WHERE match_id = :mid AND type IN ...")
--    Partial: the vast majority of rows (at_purchase / at_spend / at_withdrawal)
--    have match_id = NULL and never need the index, keeping it small.
CREATE INDEX IF NOT EXISTS idx_transactions_match_id
    ON transactions(match_id)
    WHERE match_id IS NOT NULL;

-- 2. transactions(user_id, created_at DESC) — used by daily-limit /
--    activity-feed queries that need the latest-first slice for a user
--    (existing idx_transactions_user on user_id alone can't serve the
--    ORDER BY without a separate sort step).
CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at
    ON transactions(user_id, created_at DESC);
