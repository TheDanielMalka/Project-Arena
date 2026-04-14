-- Seed AML / fraud detection thresholds (Issue #57, admin GET/PUT /platform/config).
-- Engine reads these at startup; ON CONFLICT preserves admin overrides.

INSERT INTO platform_config (key, value) VALUES
    ('fraud_pair_match_gt',              '3'),
    ('fraud_pair_window_hours',          '24'),
    ('fraud_intentional_loss_min_count', '5'),
    ('fraud_intentional_loss_days',      '7')
ON CONFLICT (key) DO NOTHING;
