-- ============================================================
-- 050-valorant-pool-config.sql
-- Valorant public match pool rows (5v5 only).
--
-- Changes:
--   1. Insert Valorant 5v5 rows for AT tiers (100, 500)
--   2. Insert Valorant 5v5 row for CRYPTO tier (0.1)
-- ============================================================

-- AT tiers
INSERT INTO public_match_pool_config (game, mode, stake_currency, stake_amount, min_open_rooms) VALUES
    ('Valorant', '5v5', 'AT',     100,  2),
    ('Valorant', '5v5', 'AT',     500,  2),
    ('Valorant', '5v5', 'CRYPTO', 0.1,  2)
ON CONFLICT (game, mode, stake_currency, stake_amount) DO NOTHING;
