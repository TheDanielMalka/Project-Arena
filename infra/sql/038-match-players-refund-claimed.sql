-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 038 — add refund_claimed columns to match_players
--
-- Required by feat/escrow-claim-refund:
--   EscrowClient._handle_refund_claimed() marks the player's row when the
--   on-chain RefundClaimed event fires, so the UI button disappears and the
--   player cannot claim twice.
--
-- GET /match/:id/refund-status reads refund_claimed to determine canRefund.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE match_players
  ADD COLUMN IF NOT EXISTS refund_claimed    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS refund_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN match_players.refund_claimed IS
  'TRUE once the player called ArenaEscrow.claimRefund() and the on-chain '
  'RefundClaimed event was processed by EscrowClient._handle_refund_claimed.';

COMMENT ON COLUMN match_players.refund_claimed_at IS
  'Timestamp when refund_claimed was set to TRUE (from RefundClaimed event).';

CREATE INDEX IF NOT EXISTS idx_match_players_refund_pending
  ON match_players (match_id)
  WHERE has_deposited = TRUE AND refund_claimed = FALSE;

COMMIT;
