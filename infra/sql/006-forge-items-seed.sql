-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — Migration 006: Forge catalogue seed               ║
-- ║  Safe to run multiple times (ON CONFLICT DO NOTHING)       ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Synced with src/stores/forgeStore.ts (item-001 … item-012)
-- price_at NULL  = not purchasable with Arena Tokens
-- price_usdt NULL = not purchasable with USDT

INSERT INTO forge_items (slug, name, description, category, rarity, icon, price_at, price_usdt, featured, limited, stock, owned_by, active) VALUES
  ('item-001', 'Vermilion Edge',  'Identity Studio legendary — radiant duelist portrait for clutch rounds.', 'avatar',  'legendary', 'preset:vermilion_edge',  3200, 24.99, TRUE,  TRUE,  47,   23,   TRUE),
  ('item-002', 'Titan Shifter',   'Heavyweight pressure — semi-realistic forged bust.',                       'avatar',  'epic',      'preset:titan_shifter',   1899, 14.99, FALSE, FALSE, NULL, 156,  TRUE),
  ('item-003', 'Arcane Emperor',  'Arcane command — premium painted portrait.',                               'avatar',  'rare',      'preset:arcane_emperor',   849,  6.99, FALSE, FALSE, NULL, 489,  TRUE),
  ('item-004', 'Emerald Samurai', 'Clean edge starter look — Identity Studio line.',                          'avatar',  'common',    'preset:emerald_samurai',  320,  2.99, FALSE, FALSE, NULL, 1240, TRUE),
  ('item-005', 'Founder''s Badge','Hall medallion — molten gold, obsidian depth, cinematic rim.',             'badge',   'legendary', 'badge:founders',          NULL, 9.99, FALSE, TRUE,  100,  89,   TRUE),
  ('item-006', 'Champion''s Seal','Amethyst-forged seal for ladder killers — violet arc glow.',               'badge',   'epic',      'badge:champions',          900, NULL, FALSE, FALSE, NULL, 234,  TRUE),
  ('item-007', 'Veteran''s Mark', 'Battle-worn steel crest with arena-cyan bevel.',                           'badge',   'rare',      'badge:veterans',           400, NULL, FALSE, FALSE, NULL, 678,  TRUE),
  ('item-008', 'Double XP (24h)','Earn 2× XP on all matches for 24 hours.',                                   'boost',   'common',    'boost:xp',                 150, NULL, FALSE, FALSE, NULL, 0,    TRUE),
  ('item-009', 'Win Shield',      'Protect your win streak — one loss won''t count.',                         'boost',   'rare',      'boost:shield',             500, NULL, FALSE, FALSE, NULL, 0,    TRUE),
  ('item-010', 'VIP Pass (30d)', 'Priority matchmaking, 5% cashback, exclusive VIP badge.',                   'vip',     'epic',      'vip:month',               3000, 14.99, FALSE, FALSE, NULL, 0,   TRUE),
  ('item-011', 'VIP Pass (7d)',  'A week of VIP treatment.',                                                   'vip',     'rare',      'vip:week',                 900,  4.99, FALSE, FALSE, NULL, 0,   TRUE),
  ('item-012', 'Elite Bundle',   'Top cosmetics + Champion''s Seal + 30d VIP + 3× Double XP. Best value.',   'bundle',  'legendary', 'bundle:elite',            5000, 24.99, FALSE, FALSE, NULL, 12,  TRUE)
ON CONFLICT (slug) DO NOTHING;
