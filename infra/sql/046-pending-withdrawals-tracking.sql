-- Migration 046: pending on-chain withdrawals, leave intents, reconciliation audit log
--
-- Motivation: ArenaEscrow.sol uses a pull-payment fallback (_payOrCredit) that credits
-- pendingWithdrawals[recipient] when a direct ETH transfer fails. This table mirrors
-- that on-chain mapping so the backend and UI can surface the "Withdraw" button.
-- pending_leaves tracks in-flight CRYPTO cancel/leave intents before on-chain confirmation.
-- contract_reconciliation_log is the audit trail for the ContractReconciler loop.
--
-- ALTER TYPE must run outside a transaction block on some PG versions — keep statements
-- separated (each run takes effect before the next DDL reads the type).

ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'pending_withdrawal_credit';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'pending_withdrawal_claimed';

-- pending_withdrawals: mirrors pendingWithdrawals[wallet] on-chain.
-- Row inserted when PayoutCredited event fires. claimed_at/claim_tx set on Withdrawn event.
CREATE TABLE IF NOT EXISTS pending_withdrawals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_addr TEXT NOT NULL,
    amount_wei  NUMERIC(78,0) NOT NULL,
    match_id    UUID REFERENCES matches(id),
    credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at  TIMESTAMPTZ,
    claim_tx    TEXT,
    CONSTRAINT uq_pending_withdrawal_wallet_match UNIQUE (wallet_addr, match_id)
);

CREATE INDEX IF NOT EXISTS idx_pw_user_unclaimed
    ON pending_withdrawals (user_id)
    WHERE claimed_at IS NULL;

-- pending_leaves: tracks CRYPTO cancel/leave intents before on-chain confirmation.
-- Prevents double-clicks and enables leave-status polling.
CREATE TABLE IF NOT EXISTS pending_leaves (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id      UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    intent        TEXT NOT NULL CHECK (intent IN ('leave', 'delete')),
    initiated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at  TIMESTAMPTZ,
    tx_hash       TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'rolled_back', 'failed')),
    CONSTRAINT uq_pending_leave_match_user UNIQUE (match_id, user_id)
);

-- contract_reconciliation_log: audit trail for the ContractReconciler background task.
CREATE TABLE IF NOT EXISTS contract_reconciliation_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    match_id    UUID REFERENCES matches(id),
    on_chain_id BIGINT,
    db_status   TEXT,
    chain_state SMALLINT,
    issue       TEXT NOT NULL,
    action_taken TEXT
);

CREATE INDEX IF NOT EXISTS idx_recon_log_checked_at
    ON contract_reconciliation_log (checked_at DESC);

-- platform_config entries for reconciler and leave-confirmation behaviour.
INSERT INTO platform_config (key, value) VALUES
    ('reconciliation_interval_sec',    '300'),
    ('leave_confirmation_timeout_sec', '120'),
    ('stuck_waiting_alert_after_sec',  '3600')
ON CONFLICT (key) DO NOTHING;
