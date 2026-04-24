-- ── Migration 047: disconnect grace period tracking + dispute holdings ──────
--
-- Adds per-match forfeit state columns used by DisconnectMonitor.
-- Adds dispute_holdings table for "both teams gone / private server crash".
-- Adds dispute_holding_transfer tx_type for accounting.
-- Seeds platform_config with tunable thresholds.

-- Grace period columns on matches
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS forfeit_warning_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forfeit_warning_team VARCHAR(4),
  ADD COLUMN IF NOT EXISTS forfeit_committed    BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_matches_forfeit_committed
  ON matches(forfeit_committed) WHERE forfeit_committed = FALSE;

-- Dispute holdings: funds transferred to holding wallet when outcome is ambiguous
CREATE TABLE IF NOT EXISTS dispute_holdings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         UUID        NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  on_chain_tx_hash VARCHAR(100),
  holding_wallet   VARCHAR(42) NOT NULL,
  amount_wei       NUMERIC(32,0) NOT NULL,
  reason           VARCHAR(100) NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','resolved','refunded')),
  admin_notes      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_holdings_match
  ON dispute_holdings(match_id);

CREATE INDEX IF NOT EXISTS idx_dispute_holdings_status
  ON dispute_holdings(status) WHERE status = 'pending';

-- New transaction type for dispute holding transfers
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'dispute_holding_transfer';

-- Platform config: disconnect monitor thresholds (tunable without redeploy)
INSERT INTO platform_config (key, value, description)
VALUES
  ('forfeit_warn_threshold_sec',  '30',  'Seconds of silence before warning is issued'),
  ('forfeit_grace_period_sec',   '120',  'Seconds the disconnected team has to return'),
  ('forfeit_check_interval_sec',  '15',  'DisconnectMonitor polling interval in seconds'),
  ('holding_wallet_address',       '',   'Platform wallet for ambiguous CRYPTO match funds')
ON CONFLICT (key) DO NOTHING;
