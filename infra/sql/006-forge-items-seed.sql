-- ╔══════════════════════════════════════════════════════════════╗
-- ║  ARENA — Migration 006: Forge catalogue seed               ║
-- ║  Safe to run multiple times (ON CONFLICT DO NOTHING)       ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Synced with src/stores/forgeStore.ts (item-001 … item-012)
-- price_at NULL  = not purchasable with Arena Tokens
-- price_usdt NULL = not purchasable with USDT

INSERT INTO forge_items (slug, name, description, category, rarity, icon, price_at, price_usdt, featured, limited, stock, owned_by, active) VALUES
  -- ── Avatars ────────────────────────────────────────────────────────────────
  ('item-001',      'Vermilion Edge',       'Identity Studio legendary — radiant duelist portrait for clutch rounds.',          'avatar',  'legendary', 'preset:vermilion_edge',   3200, 24.99, TRUE,  TRUE,  47,   23,     TRUE),
  ('item-002',      'Titan Shifter',        'Heavyweight pressure — semi-realistic forged bust.',                               'avatar',  'epic',      'preset:titan_shifter',    1899, 14.99, FALSE, FALSE, NULL, 156,    TRUE),
  ('item-003',      'Arcane Emperor',       'Arcane command — premium painted portrait.',                                       'avatar',  'rare',      'preset:arcane_emperor',    849,  6.99, FALSE, FALSE, NULL, 489,    TRUE),
  ('item-004',      'Emerald Samurai',      'Clean edge starter look — Identity Studio line.',                                  'avatar',  'common',    'preset:emerald_samurai',   320,  2.99, FALSE, FALSE, NULL, 1240,   TRUE),
  -- ── Frames ────────────────────────────────────────────────────────────────
  ('frame-001',     'Sovereign Gold Frame', 'Gold aura frame — premium glow.',                                                  'frame',   'rare',      'bg:gold',                 NULL,  1.99, FALSE, FALSE, NULL, 89,     TRUE),
  ('frame-002',     'Chroma Luxe Frame',    'Prismatic chroma — flex worthy.',                                                  'frame',   'epic',      'bg:rainbow',              NULL,  2.99, FALSE, FALSE, NULL, 34,     TRUE),
  ('frame-003',     'Northern Pulse Frame', 'Aurora pulse — clean and cold.',                                                   'frame',   'epic',      'bg:aurora',               NULL,  2.99, FALSE, FALSE, NULL, 21,     TRUE),
  ('frame-004',     'Magma Elite Frame',    'Molten heat — loud but classy.',                                                   'frame',   'rare',      'bg:lava',                 NULL,  1.99, FALSE, FALSE, NULL, 55,     TRUE),
  -- ── Badges — free ─────────────────────────────────────────────────────────
  ('badge-free-01', 'Arena Ring Sigil',     'Default Arena ring crest — clean gold bezel, starter Identity Studio pin.',        'badge',   'common',    'badge:arena_ring',           0, NULL, FALSE, FALSE, NULL, 128400, TRUE),
  ('badge-free-02', 'Sun God Crest',        'Radiant solar plate — warm metallics for a regal ring accent.',                    'badge',   'common',    'badge:sun_god',              0, NULL, FALSE, FALSE, NULL, 94200,  TRUE),
  ('badge-free-03', 'Neon Hunter Mark',     'Phoenix-flame sigil — high-energy accent.',                                        'badge',   'common',    'badge:neon_hunter',          0, NULL, FALSE, FALSE, NULL, 81050,  TRUE),
  -- ── Badges — event ────────────────────────────────────────────────────────
  ('badge-ev-01',   'Shadow Ronin',         'Blade-bound oni crest — violet steel, event-limited forge line.',                  'badge',   'epic',      'badge:shadow_ronin',      1100, NULL, FALSE, FALSE, NULL, 412,    TRUE),
  ('badge-ev-02',   'Black Mage',           'Serpent-root grove seal — quiet menace on the ring.',                              'badge',   'rare',      'badge:black_mage',         720, NULL, FALSE, FALSE, NULL, 633,    TRUE),
  ('badge-ev-03',   'Desert Prince',        'Rune-lit codex — scholar-king vibe for ladder grinders.',                          'badge',   'rare',      'badge:desert_prince',      680, NULL, FALSE, FALSE, NULL, 540,    TRUE),
  ('badge-ev-04',   'Storm Swordsman',      'Coiled storm drake — teal ice peaks, premium event flex.',                         'badge',   'epic',      'badge:storm_swordsman',    980, NULL, FALSE, FALSE, NULL, 298,    TRUE),
  -- ── Badges — premium ──────────────────────────────────────────────────────
  ('badge-pr-01',   'Crimson Core',         'Molten heart reactor — forged premium pin, Identity Studio line.',                 'badge',   'epic',      'badge:crimson_core',      1250, NULL, FALSE, FALSE, NULL, 156,    TRUE),
  ('badge-pr-02',   'Void Warden',          'Obsidian warden plate — void-edge glow for top earners.',                          'badge',   'legendary', 'badge:void_warden',       2100,16.99, FALSE, TRUE,  80,   44,     TRUE),
  ('badge-pr-03',   'Iron Command',         'Command stripe insignia — tactical steel for consistent grinders.',                'badge',   'rare',      'badge:iron_command',       640, NULL, FALSE, FALSE, NULL, 890,    TRUE),
  ('item-005',      'Founder''s Badge',     'Hall medallion — molten gold, obsidian depth, cinematic rim.',                     'badge',   'legendary', 'badge:founders',          NULL,  9.99, FALSE, TRUE,  100,  89,    TRUE),
  ('item-006',      'Champion''s Seal',     'Amethyst-forged seal for ladder killers — violet arc glow.',                       'badge',   'epic',      'badge:champions',          900, NULL, FALSE, FALSE, NULL, 234,    TRUE),
  ('item-007',      'Veteran''s Mark',      'Battle-worn steel crest with arena-cyan bevel.',                                   'badge',   'rare',      'badge:veterans',           400, NULL, FALSE, FALSE, NULL, 678,    TRUE),
  -- ── Boosts ────────────────────────────────────────────────────────────────
  ('item-008',      'Double XP (24h)',      'Earn 2× XP on all matches for 24 hours.',                                          'boost',   'common',    'boost:xp',                 150, NULL, FALSE, FALSE, NULL, 0,      TRUE),
  ('item-009',      'Win Shield',           'Protect your win streak — one loss won''t count.',                                 'boost',   'rare',      'boost:shield',             500, NULL, FALSE, FALSE, NULL, 0,      TRUE),
  -- ── VIP ───────────────────────────────────────────────────────────────────
  ('item-010',      'VIP Pass (30d)',       'Priority matchmaking, 5% cashback, exclusive VIP badge.',                          'vip',     'epic',      'vip:month',               3000, 14.99, FALSE, FALSE, NULL, 0,     TRUE),
  ('item-011',      'VIP Pass (7d)',        'A week of VIP treatment.',                                                          'vip',     'rare',      'vip:week',                 900,  4.99, FALSE, FALSE, NULL, 0,     TRUE),
  -- ── Bundles ───────────────────────────────────────────────────────────────
  ('item-012',      'Elite Bundle',         'Top cosmetics + Champion''s Seal + 30d VIP + 3× Double XP. Best value.',           'bundle',  'legendary', 'bundle:elite',            5000, 24.99, FALSE, FALSE, NULL, 12,    TRUE)
ON CONFLICT (slug) DO NOTHING;
