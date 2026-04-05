-- Migration 008 — AT staking support
-- Adds stake_currency to matches so a room can be played with Arena Tokens
-- instead of on-chain crypto.  Existing rows default to 'CRYPTO'.

ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS stake_currency VARCHAR(10) NOT NULL DEFAULT 'CRYPTO';

-- AT purchase packages with discount tiers.
-- Each row is a fixed bundle the user can buy via /wallet/buy-at-package.
-- discount_pct is applied to the usdt_price (user pays less USDT for the same AT).
CREATE TABLE IF NOT EXISTS at_packages (
    id          SERIAL PRIMARY KEY,
    at_amount   INTEGER          NOT NULL,   -- AT tokens received
    usdt_price  NUMERIC(10,2)    NOT NULL,   -- full price in USDT
    discount_pct NUMERIC(5,2)   NOT NULL DEFAULT 0,  -- e.g. 5.00 = 5%
    active      BOOLEAN          NOT NULL DEFAULT TRUE
);

-- Seed default packages
INSERT INTO at_packages (at_amount, usdt_price, discount_pct) VALUES
    (500,    5.00,   0.00),
    (1000,  10.00,   5.00),
    (2500,  25.00,   8.00),
    (5000,  50.00,  12.00),
    (10000, 100.00, 15.00)
ON CONFLICT DO NOTHING;
