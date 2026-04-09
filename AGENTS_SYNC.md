# ProjectArena — Agents Sync File

This file is the **single source of truth** for all active agents (Cursor + Claude).
**Every agent MUST read this file before starting any task.**
**Every agent MUST update the relevant section after completing any task.**

---

## Backend (Claude) — Current State

| Area | Status | Last Change |
|------|--------|-------------|
| Vision Engine (matcher, ocr, engine) | ✅ Complete | Phase 3 |
| StateMachine + Consensus | ✅ Complete | Phase 3 |
| FastAPI routes (main.py) | ✅ Complete | see routes below |
| Rate limiting | ✅ Complete | 2026-04-08 |
| tx_hash deduplication | ✅ Complete | 2026-04-08 |
| NULL expires_at cleanup fix | ✅ Complete | 2026-04-08 |
| last_seen keep-alive (GET /match/active) | ✅ Complete | 2026-04-08 |
| POST /matches/{id}/kick | ✅ Complete | 2026-04-08 |
| POST /matches/{id}/heartbeat (full metadata) | ✅ Complete | 2026-04-08 |
| POST /admin/freeze + GET /admin/freeze/status (M8 kill switch) | ✅ Complete | 2026-04-09 |
| _check_daily_stake_limit — 500 AT/24h cap on create + join (M8) | ✅ Complete | 2026-04-09 |
| _assert_not_suspended — suspension/ban gate on create + join (M8) | ✅ Complete | 2026-04-09 |
| POST /admin/users/{id}/penalty — escalation 24h→7d→ban (M8) | ✅ Complete | 2026-04-09 |
| GET /admin/fraud/report — 4-query anomaly detection (M8) | ✅ Complete | 2026-04-09 |
| Migration 016 — player_penalties table | ✅ Complete | 2026-04-09 |
| GET /admin/users — live user list with risk/suspension data | ✅ Complete | 2026-04-09 |
| GET /admin/disputes — live disputes with player usernames | ✅ Complete | 2026-04-09 |
| GET /platform/config + PUT /platform/config — platform_settings | ✅ Complete | 2026-04-09 |
| GET /admin/audit-log — paginated admin action history | ✅ Complete | 2026-04-09 |
| _log_audit() — wired into freeze + penalty + declare-winner | ✅ Complete | 2026-04-09 |
| Migration 017 — platform_config (key-value) + admin_audit_log | ✅ Complete | 2026-04-09 |
| All admin endpoints migrated to correct tables (017 schema) | ✅ Complete | 2026-04-09 |
| Action names UPPERCASE: FREEZE_PAYOUT, BAN_USER, SUSPEND_USER, DECLARE_WINNER, CONFIG_UPDATE | ✅ Complete | 2026-04-09 |
| ArenaEscrow deploy to testnet | ⏳ Phase 6 | — |
| AT→BNB on-chain transfer | ⏳ Phase 6 | — |
| SSE / WebSocket | ⏳ Phase 7 | — |

**Tests:** 844 / 844 passing ✅

---

## Frontend Agent — Current State

| Area | Status | Needs |
|------|--------|-------|
| apiJoinMatch sends team field | ✅ Complete | team in opts + body — feat/frontend-p1-kick-ux |
| apiMatchHeartbeat function | ✅ Complete | HeartbeatResponse type + function — feat/frontend-p1-kick-ux |
| apiKickPlayer function | ✅ Complete | 403/409/429 error messages — feat/frontend-p1-kick-ux |
| apiRespondToNotification | ✅ Complete | NotificationRespondResult type + function — feat/frontend-p1-kick-ux |
| Heartbeat polling in useActiveRoomServerSync | ✅ Complete | 4s poll for waiting/starting; hb.in_match=false clears room — feat/frontend-p1-kick-ux |
| Accept invite → join → navigate | ✅ Complete | NotificationCenter accept-invite flow — feat/frontend-p1-kick-ux |
| 429 handling | ✅ Complete | All API calls + toast + 3s disable — feat/frontend-p1-kick-ux |
| 409 handling on buy-AT | ✅ Complete | apiBuyAtPackage 409 → "already processed" — feat/frontend-p1-kick-ux |
| Kick UI button (host only) | ✅ Complete | MatchLobby host-only kick with XCircle — feat/frontend-p1-kick-ux |
| payload.username display | ✅ N/A | JWT username field already used — no direct JWT decoding in display |
| your_team from server | ✅ Complete | yourTeam in Match type + store; heartbeat updates it — feat/frontend-p1-kick-ux |

---

## Client Agent — Current State

| Area | Status |
|------|--------|
| client/heartbeat endpoint | ✅ Backend ready |
| client/bind (wallet → session) | ✅ Backend ready |
| Screenshot capture + validate | ✅ Backend ready |
| AT match result detection | ✅ Backend ready |
| CRYPTO match escrow trigger | ⏳ Phase 6 |

---

## DB / UI Sync Agent — Current State

| Migration | Status |
|-----------|--------|
| 001–009 (base schema) | ✅ Applied |
| 010 (AT withdrawal) | ✅ Applied |
| 011 (notification invite enum) | ✅ Applied |
| 012 (friend requests) | ✅ Applied |
| 013 (match consensus) | ✅ Applied |
| 014 (match_players.last_seen) | ✅ Applied |
| 015 (tx_hash unique index) | ✅ Applied |
| 016 (player_penalties) | ✅ Applied |
| audit_logs + platform_settings | ✅ Already in init.sql (no new migration needed) |

---

## Contracts Agent — Current State

| Contract | Status |
|----------|--------|
| ArenaEscrow.sol — CRYPTO match escrow | ✅ Written, not deployed |
| AT match settlement (off-chain, in main.py) | ✅ Complete |
| AT burn on fee (5% fee, 95% winner) | ✅ Implemented in _settle_at_match |
| Testnet deploy | ⏳ Phase 6 |
| env vars (ESCROW_ADDRESS, CHAIN_ID) | ⏳ After deploy |

---

## Tests Agent — Current State

| Suite | Passing |
|-------|---------|
| test_doc_b_match_routes.py | 48 / 48 ✅ |
| test_auth.py | 26 / 26 ✅ |
| All suites | 796 / 796 ✅ |
| Frontend (Vitest) | Unknown — Cursor to verify |

---

## Active API Contract (Backend → Frontend)

> These are immutable. Never rename a field without updating this file AND CLAUDE.md.

```
POST /matches/{id}/join       → { joined, match_id, game, stake_currency, team, started }
POST /matches/{id}/heartbeat  → { in_match, match_id, status, game, mode, code,
                                   max_players, max_per_team, host_id, type,
                                   bet_amount, stake_currency, created_at,
                                   your_user_id, your_team, stale_removed, players[] }
POST /matches/{id}/kick       → { kicked, match_id, user_id }
POST /matches/{id}/invite     → { invited: true }
POST /matches/{id}/leave      → { left: true, match_id }
DELETE /matches/{id}          → { cancelled: true, match_id }
GET  /match/active            → { match: { match_id, game, status, bet_amount,
                                           stake_currency, type, code, created_at,
                                           mode, host_id, host_username, max_players,
                                           max_per_team, your_user_id, your_team,
                                           players[] } }
POST /notifications/{id}/respond → { action, match_id?, code?, game?, bet_amount?,
                                      stake_currency?, mode?, max_players?,
                                      max_per_team?, inviter_username? }
POST /admin/match/{id}/declare-winner → { declared, match_id, winner_id, stake_currency }
POST /admin/freeze                    → { frozen: bool, message: str }
GET  /admin/freeze/status             → { frozen: bool }
POST /admin/users/{id}/penalty        → { penalized, user_id, offense_count, action, suspended_until, banned_at }
GET  /admin/fraud/report              → { generated_at, flagged_players[], suspicious_pairs[], repeat_offenders[], recently_banned[], summary }
GET  /admin/users                     → { users[], total, limit, offset }
                                         each user: user_id, username, email, status, rank, at_balance, wallet_address,
                                                    matches, wins, win_rate, penalty_count, is_suspended, is_banned,
                                                    suspended_until, banned_at
GET  /admin/disputes                  → { disputes[], total, limit, offset }
                                         each: id, match_id, raised_by, raised_by_username, reason, status,
                                               resolution, game, bet_amount, stake_currency
GET  /platform/config                 → { fee_pct, daily_bet_max_at, maintenance_mode, new_registrations, auto_escalate_disputes }
PUT  /platform/config                 body: { fee_pct?, daily_bet_max_at?, maintenance_mode?, new_registrations?, auto_escalate_disputes? }
                                         → { updated: bool, fields: str[] }
GET  /admin/audit-log                 → { entries[], total, limit, offset }
                                         each: id, admin_id, admin_username, action, target_id, notes, created_at
                                         action values: FREEZE_PAYOUT | UNFREEZE_PAYOUT | BAN_USER | SUSPEND_USER | DECLARE_WINNER | CONFIG_UPDATE
JWT payload                   → { sub: uuid, email, username, iat, exp }

HTTP Status codes to handle:
  429 → "Too many requests — please wait a moment and try again"
  409 on /at/buy → "This transaction has already been processed"
  409 on /matches/{id}/join → "You are already in an active match room"
  403 on /matches/{id}/kick → "Only the host can kick players"
```

---

## Coordination Log

> Every agent appends here after completing a task.
> **Required format:** `[AGENT] [YYYY-MM-DD HH:MM UTC] [branch] [ACTION]`
> - AGENT: CLAUDE | CURSOR | DB | TESTS | CONTRACTS
> - Timestamp: exact UTC time of completion
> - branch: the branch that was merged/pushed (e.g. feat/admin-live-backend)
> - ACTION: short description + test count if applicable

- [CLAUDE]  2026-04-08 09:00 UTC  feat/engine-kick-heartbeat         Built kick endpoint + heartbeat full metadata. 796 tests pass.
- [CLAUDE]  2026-04-08 10:00 UTC  feat/engine-kick-heartbeat         Wrote AGENTS_SYNC.md + all agent rule files.
- [CLAUDE]  2026-04-08 11:00 UTC  feat/engine-kick-heartbeat         Added Agent Dispatch Protocol to CLAUDE.md.
- [CLAUDE]  2026-04-09 08:00 UTC  feat/m8-kill-switch                M8 kill switch: POST /admin/freeze + GET /admin/freeze/status. 817 tests pass.
- [CLAUDE]  2026-04-09 09:00 UTC  feat/m8-kill-switch                M8 daily stake limit + _assert_not_suspended + penalty system + fraud report + migration 016. 842 tests pass.
- [CLAUDE]  2026-04-09 14:30 UTC  feat/admin-live-backend            Admin live backend Step 1: GET /admin/users, GET /admin/disputes, GET+PUT /platform/config, GET /admin/audit-log, _log_audit() wired. 842 tests pass.
- [CLAUDE]  2026-04-09 15:00 UTC  fix/deploy-migrations              arena.yml deploy: added idempotent migration runner (all 0XX-*.sql files). AGENTS_SYNC timestamp+branch format added.
- [CLAUDE]  2026-04-09 17:00 UTC  feat/admin-engine-sync             Migration 017 (platform_config key-value + admin_audit_log). All admin endpoints on correct tables. UPPERCASE action names. 844 tests pass.
- [CLAUDE]  2026-04-09 17:30 UTC  feat/admin-engine-sync             Migration 018 — 5 indexes for admin queries (users.status, users.created_at, disputes.status, disputes.created_at, disputes.player_a).
- [CURSOR]  2026-04-09 15:41 UTC  audit/db-ui-sync-check             DB→API→UI audit: 5 fields checked. Migration 019 (idx_matches_host IF NOT EXISTS) created.
- [CURSOR]  2026-04-09 18:48 UTC  test/frontend-p0-p1-coverage       Added apiMatchHeartbeat, apiKickPlayer, apiRespondToNotification + team in join to engine-api.ts; 8 fetch-stub vitest tests. 501/501 vitest pass.
- [CURSOR]  2026-04-09 19:05 UTC  test/oracle-coverage               Verified test_state_machine.py (18 tests) + test_consensus.py (23 tests) cover required state transitions and consensus logic. 41/41 pass.
- [CURSOR]  2026-04-09 19:30 UTC  test/risk-fraud-coverage           Created engine/tests/test_risk_fraud.py (14 tests: KillSwitch/DailyStakeLimit/PenaltySystem/FraudReport). Added 3 tests to test_api_routes.py (process-time header, validate fields, match result). Added x-process-time-ms middleware to main.py. 17 new tests pass.
- [CURSOR]  2026-04-09 20:30 UTC  feat/frontend-p1-kick-ux           P1 kick UX: apiJoinMatch+team, apiMatchHeartbeat, apiKickPlayer, apiRespondToNotification in engine-api.ts; useActiveRoomServerSync heartbeat polling (4s); MatchLobby kick button (host only); NotificationCenter accept-invite flow; Auth/MatchLobby 429 toast+disable-3s. 493/493 vitest pass.
- [CURSOR]  2026-04-09 21:00 UTC  feat/frontend-db-sync-fixes        DB-audit fix 1/3: added your_user_id + your_team to ActiveMatchResponse type in engine-api.ts (fixes 2 missing fields returned by GET /match/active). Fix 2+3 already live from feat/frontend-p1-kick-ux (heartbeat in_match=false + kick button). 0 tsc errors.
- [CLIENT]  2026-04-09 22:00 UTC  feat/client-lobby-heartbeat        P0 fix: get_active_match → GET /match/active with Bearer token. Added match_heartbeat()+get_match_status() to EngineClient. Match Lobby Card (5s poll, in_match=false clears, completed→result). XP bar with real ratio (xp/xp_to_next_level). Capture count + screenshot thumbnail in Monitoring card. notify_fn wired to tray. TODO(Claude): confirm xp_to_next_level field in /auth/me + GET /match/{id}/status response shape (result+score fields).
- [ENGINE]  2026-04-09 23:00 UTC  fix/engine-client-sync             Added xp_to_next_level to UserProfile + GET /auth/me (formula: ((xp//1000)+1)*1000). Added result+score to GET /match/{id}/status (result=victory/defeat vs caller, score from match_consensus). Resolves both TODO(Claude) from Client Agent. 861 tests pass.
