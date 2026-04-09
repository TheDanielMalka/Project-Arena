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
| Admin panel — all data live (no seeds) | ✅ Complete | 2026-04-09 |
| apiAdminGetUsers / apiAdminGetDisputes | ✅ Complete | engine-api.ts |
| apiAdminFreeze / apiAdminFreezeStatus | ✅ Complete | engine-api.ts |
| apiGetPlatformConfig / apiUpdatePlatformConfig | ✅ Complete | engine-api.ts |
| apiAdminGetAuditLog (30s poll) | ✅ Complete | engine-api.ts |
| apiAdminGetFraudReport | ✅ Complete | engine-api.ts |
| apiAdminPenalty (escalation) | ✅ Complete | engine-api.ts |
| apiAdminDeclareWinner | ✅ Complete | engine-api.ts |
| apiEngineHealth | ✅ Complete | engine-api.ts |
| Fraud Report tab | ✅ Complete | Admin.tsx |
| Oracle tab (engine health) | ✅ Complete | Admin.tsx |
| Migration 018 (admin indexes) | ✅ Complete | feat/frontend-admin-ui |
| apiJoinMatch sends team field | ❌ Missing | Add `team?: "A"\|"B"` to opts + body |
| apiMatchHeartbeat function | ❌ Missing | New function + HeartbeatResponse type |
| apiKickPlayer function | ❌ Missing | New function |
| apiRespondToNotification | ❌ Missing | New function |
| Heartbeat polling in useActiveRoomServerSync | ❌ Missing | Replace GET /match/active for waiting matches |
| Accept invite → join → navigate | ❌ Missing | NotificationCenter accept flow |
| 429 handling | ❌ Missing | All API calls |
| 409 handling on buy-AT | ❌ Missing | AT purchase flow |
| Kick UI button (host only) | ❌ Missing | MatchLobby.tsx |
| payload.username display | ❌ Missing | JWT has username field |
| your_team from server | ⚠️ Partial | Use server truth not local state |

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
| 017 (platform_config key-value + admin_audit_log) | ✅ Created — run on live DB |
| 018 (admin query indexes — users + disputes) | ✅ Created — run on live DB |

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
- [CLAUDE]  2026-04-09 19:00 UTC  feat/frontend-admin-ui             Migration 018 (5 admin query indexes). 11 admin API functions in engine-api.ts. Admin.tsx fully wired to live APIs — zero seed data. Fraud + Oracle tabs added. 0 TS errors.
