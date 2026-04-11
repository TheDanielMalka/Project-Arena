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
| Match room leave/cancel + heartbeat kick toast | ✅ Complete | fix/frontend-match-room-sync — activeRoomId cleared first; store guard on hb.in_match=false |
| Admin fraud UI (Phase 4) | ✅ Complete | feat/frontend-phase4-fraud-ui — GET /admin/fraud/summary on mount, full report tabs + intentional_losing, POST export JSON/CSV, AUTO_FLAG feed, BANNED/SUSPENDED badges |

---

## Client Agent — Current State

| Area | Status |
|------|--------|
| client/heartbeat endpoint | ✅ Backend ready |
| client/bind (wallet → session) | ✅ Backend ready |
| Screenshot capture + validate | ✅ Backend ready |
| AT match result detection | ✅ Backend ready |
| CRYPTO match escrow trigger | ⏳ Phase 6 |
| 2FA after login (modal → POST /auth/2fa/confirm) | ✅ feat/client-phase5-sync |
| 401 → clear session + login screen (httpx response hook) | ✅ feat/client-phase5-sync |
| Tray unread badge (GET /messages/unread/count, 30s) | ✅ feat/client-phase5-sync |
| Region badge in profile (from /auth/me) | ✅ feat/client-phase5-sync |
| Match room lifecycle sync (GET /match/active + heartbeat) | ✅ fix/client-match-room-sync |

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
| 027 (tx_type escrow_refund_leave/kicked/disconnect/cancel) | ✅ Added — fix/db-tx-enum |
| 028 (match_players: wallet_address + has_deposited + deposited_at + deposit_amount) | ✅ Added — fix/db-match-players-columns |

---

## Contracts Agent — Current State

| Contract | Status |
|----------|--------|
| ArenaEscrow.sol — CRYPTO match escrow | ✅ Written, not deployed |
| M8 emergency pause | ✅ OpenZeppelin `Pausable` + `Ownable` + `ReentrancyGuard` — `whenNotPaused` on `createMatch`, `joinMatch`, `declareWinner`; `pause`/`unpause` = `_pause`/`_unpause` (custom errors: `EnforcedPause`, `ExpectedPause`, `OwnableUnauthorizedAccount`) |
| AT match settlement (off-chain, in main.py) | ✅ Complete |
| AT burn on fee (5% fee, 95% winner) | ✅ Implemented in _settle_at_match |
| Testnet deploy | ⏳ Phase 6 |
| env vars (see Phase 6 checklist below) | ⏳ After deploy |

### Phase 6 — Pre-deploy audit (M6) + env checklist (2026-04-11)

**On-chain audit (`ArenaEscrow.sol`):**

| Check | Result |
|-------|--------|
| `declareWinner` payout vs fee | **95%** of pot to winners (split), **5%** to `owner()` via `FEE_PERCENT = 5` — **not** 90/10 unless `fee_pct` is later set to 10 on-chain |
| `cancelMatch` + `cancelWaiting` | ✅ Present (WAITING refunds) |
| Reentrancy | ✅ OpenZeppelin `ReentrancyGuard` (`nonReentrant` on state-changing externals) |
| `declareWinner` access | ✅ `onlyOracle` (not `onlyOwner`); fee recipient is `owner()` (deployer / platform) |
| Kill switch parity | ✅ `whenNotPaused` on `declareWinner` — align `POST /admin/freeze` with `EscrowClient` **owner** key calling `pause()` (oracle key cannot pause) |

**`engine/src/contract/escrow_client.py` (⚠️ Engine — not Contracts domain):**

| Check | Result |
|-------|--------|
| `declare_winner(match_id, winner_id)` | ✅ Exists; builds `declareWinner(on_chain_id, winning_team)` — matches contract |
| `ARENA_ESCROW_ABI` `PlayerDeposited` | ⚠️ **Out of sync** — contract emits `(matchId, player, team, stakePerPlayer, depositsTeamA, depositsTeamB)`; minimal ABI still has 5 non-indexed fields (missing `stakePerPlayer`). **Claude** must update ABI + `_handle_player_deposited` before relying on event args alone. |

**Env / ops before testnet deploy:**

| Variable | Role |
|----------|------|
| `BLOCKCHAIN_RPC_URL` | BSC testnet RPC (e.g. `https://data-seed-prebsc-1-s1.binance.org:8545`) |
| `CHAIN_ID` | `97` (BSC testnet) — align frontend + engine |
| `CONTRACT_ADDRESS` | Deployed `ArenaEscrow` — after `hardhat run scripts/deploy.js --network bscTestnet` |
| Oracle wallet | Constructor arg at deploy — Vision Engine; signs `declareWinner` (`PRIVATE_KEY` in `escrow_client` today = oracle signer) |
| Platform / owner wallet | Deployer = `Ownable` owner — receives fee ETH; **must** sign `pause`/`unpause` when admin kill switch toggles (separate from oracle) |

**Global placeholder rule (all agents):** For Google / Steam / Riot integrations, use `# TODO[GOOGLE]: …` and `# TODO[VERIF]: …` (or `//` in TS) — do not delete working code; add and wire only.

---

## Tests Agent — Current State

| Suite | Passing |
|-------|---------|
| test_doc_b_match_routes.py | 48 / 48 ✅ |
| test_auth.py | 26 / 26 ✅ |
| Phase 4 tests (delete, 2fa, region, unread, attachments, verify stubs) | 30 pass + 0 xfail ✅ (xfail removed — engine uses SET user_id=NULL) |
| test_at_match_lifecycle.py | 5 / 5 ✅ AT leave/kick/create/stale/heartbeat |
| test_phase5_risk_coverage.py | 18 / 18 ✅ auto-penalty, blacklist, null-uid guard, AML, delete-preserves-history |
| All suites | 918 collected (`pytest engine/tests/`); 0 xfail — null-uid fix merged PR #408 |
| Frontend (Vitest) | 506 / 506 ✅ (includes settings.delete, settings.2fa, hub.badge) |

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
GET  /admin/fraud/summary             → { total_flagged, high_winrate, pair_farming, repeat_offenders, recently_banned, intentional_losing } (counts only)
GET  /admin/fraud/report              → { generated_at, flagged_players[], suspicious_pairs[], repeat_offenders[], recently_banned[], intentional_losing[], summary }
                                         summary includes intentional_losing count; intentional_losing[]: loser_username, winner_username, loss_count, first_match, last_match, reason?
POST /admin/fraud/report/export       → JSON file (download) or same JSON body as report (client may flatten to CSV)
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
                                         action values: FREEZE_PAYOUT | UNFREEZE_PAYOUT | BAN_USER | SUSPEND_USER | DECLARE_WINNER | CONFIG_UPDATE | AUTO_FLAG
JWT payload                   → { sub: uuid, email, username, iat, exp }

HTTP Status codes to handle:
  429 → "Too many requests — please wait a moment and try again"
  409 on /at/buy → "This transaction has already been processed"
  409 on /matches/{id}/join → "You are already in an active match room"
  403 on /matches/{id}/kick → "Only the host can kick players"
```

---

## ⚠️ Known Bugs — Match Room (2026-04-10, requires immediate fix)

### BUG-1 CRITICAL: tx_type ENUM missing values (DB Agent → migration 027)
The `tx_type` DB ENUM is missing: `escrow_refund_leave`, `escrow_refund_kicked`, `escrow_refund_disconnect`, `escrow_refund_cancel`.
Code uses all four in leave_match / kick_player / stale_cleanup / heartbeat-stale path.
**Result:** Every AT match leave/kick → PostgreSQL DataError → 500. Stale AT players never removed.
**Fix:** `ALTER TYPE tx_type ADD VALUE IF NOT EXISTS '...'` × 4 in migration 027.

### BUG-2 CRITICAL: Stale cleanup aborts all DELETEs on first AT ENUM error (Engine Agent)
`_stale_player_cleanup_loop` processes all stale players in a single session.
When AT credit fails (BUG-1), the session becomes aborted → all prior DELETEs in that batch roll back.
**Fix:** Isolate each stale player in its own `with SessionLocal() as session:` block.

### BUG-3 RESOLVED: create_match 500 — AmbiguousColumn (fix/engine-ambiguous-id ✅)
Migration 026 added `id SERIAL` PK to `match_players`. Both tables had `id`.
`SELECT id FROM matches m JOIN match_players` → `psycopg2.errors.AmbiguousColumn`.
Fixed: `SELECT m.id`. Merged to main via fix/engine-ambiguous-id PR #407.

### Migration 026 idempotency (resolved fix/db-tx-enum)
Step 1 drops `match_players_pkey` only when it is still the **composite** PK (`array_length(conkey,1) > 1`).
Step 2 adds surrogate PK only when the table has no primary key. Migration 027 adds missing `tx_type` enum values.

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
- [DB Agent] 2026-04-09 22:07 UTC  feat/db-phase1-migrations        Added migrations 022-024: 2FA columns, deleted_accounts, report_attachments.
- [DB Agent] 2026-04-10 01:20 UTC  feat/db-phase2-schema            Added migrations 025-026: wallet_blacklist, match_players nullable user_id + surrogate PK.
- [CLIENT]  2026-04-10 12:00 UTC  feat/client-phase5-sync          2FA modal (temp_token → POST /auth/2fa/confirm); httpx 401 hook → logout + rebuild login UI; tray poll GET /messages/unread/count every 30s + badge on icon; Messages menu opens /messages + clears badge until next poll; region from /auth/me in profile; TODO[GOOGLE]/TODO[VERIF] placeholders. Depends on merged engine /auth/me region + messages unread route.
- [TESTS]   2026-04-10 14:30 UTC  test/phase4-coverage             Added 6 pytest modules (delete account, 2FA, region, unread count, attachments, verify stubs) + 3 Vitest files (settings.delete, settings.2fa, hub.badge). TODO[GOOGLE]/TODO[VERIF] in test module docstrings. Region invalid: 400 value / 422 type. test_delete_preserves_match_history xfail until engine uses SET user_id=NULL. 895 pytest collected; Vitest 506 pass.
- [CLAUDE]  2026-04-10 xx:xx UTC  test/phase3-risk-test-fixes      Fixed 8 failing tests in feat/engine-phase3-risk: mock fetchone sequences for blacklist checks in register, 3rd-offense ban path, and delete account. 894 passed, 1 xfailed.
- [CLAUDE]  2026-04-10 xx:xx UTC  investigation                    ROOT CAUSE AUDIT — match room 500. Found: (1) tx_type ENUM missing escrow_refund_leave/kicked/disconnect — breaks AT leave/kick/stale. (2) stale cleanup uses shared session so ENUM failure aborts all DELETEs. (3) create_match 500 unconfirmed — need EC2 logs. Fix plan: migration 027 (DB) + stale cleanup session isolation (Engine). See KNOWN BUGS below.
- [DB Agent] 2026-04-10 12:20 UTC  fix/db-tx-enum                   Migration 027: tx_type escrow_refund_* enum values; migration 026: idempotent composite-PK drop + guarded PRIMARY KEY(id). init.sql synced.
- [CLIENT]  2026-04-10 16:00 UTC  fix/client-match-room-sync       Match room audit: get_match_active_payload (network err keeps UI); match null/cancelled clears + tray; heartbeat cancelled/in_match=false clears; UI strings waiting/in_progress/completed; 5s auto-clear after completed; auto-start monitor on in_progress. 43 client pytest pass.
- [CLAUDE]  2026-04-10 xx:xx UTC  fix/db-match-players-columns     ROOT CAUSE of create_match 500 found: wallet_address / has_deposited / deposited_at / deposit_amount never added to match_players via migration (only in init.sql). Migration 028 fixes this idempotently.
- [CURSOR]  2026-04-10 12:48 UTC  fix/frontend-match-room-sync      MatchLobby: setActiveRoomId(null) before leave/cancel local cleanup so heartbeat stops immediately; useActiveRoomServerSync skips kick toast if store activeRoomId already cleared. createFailureMessage: 400/403/404/422 + HTTP status fallback. Vitest 506 pass.
- [CLAUDE]  2026-04-11 xx:xx UTC  fix/engine-ambiguous-id          TRUE ROOT CAUSE found via EC2 traceback: migration 026 added id SERIAL to match_players → SELECT id FROM matches m JOIN match_players became AmbiguousColumn → 500 on every create_match. Fix: SELECT m.id (one line). Scanned all 15 JOIN match_players queries — only one was broken. 237 tests pass. Vitest 506/506 pass.
- [CLAUDE]  2026-04-11 xx:xx UTC  fix/engine-null-uid-guard        NULL user_id guard in _refund_at_match + match result user_stats loop. Migration 026 made user_id nullable — deleted accounts left NULL rows that caused str(None)="None" UUID writes. 257 targeted tests pass.
- [TESTS]   2026-04-10 xx:xx UTC  test/at-match-lifecycle          AT match lifecycle: leave/kick refunds, AT create, stale cleanup isolation (per-player session), heartbeat last_seen update. 5 tests, all pass. test_at_match_lifecycle.py.
- [CLAUDE]  2026-04-11 xx:xx UTC  test/phase5-risk-coverage        Phase 5 risk coverage complete: TestAutoPenalty (6), TestBlacklist (4), TestMatchPlayersNull (3 — all pass after PR #408 merge), TestAmlFraudReport (4), TestDeletePreservesHistory (1). xfail removed from test_delete_preserves_match_history. 918 collected, 0 xfail.
- [CURSOR]  2026-04-11 17:55 UTC  feat/frontend-phase4-fraud-ui    Fraud UI: load-on-mount summary (GET /admin/fraud/summary), View Full Report + tabs (incl. intentional_losing), POST export → JSON download (apiAdminFraudExport) + CSV via exportCSV(apiAdminPostFraudExportReport), AUTO_FLAG live-feed orange badge, Users tab BANNED/SUSPENDED badges. engine-api: FraudIntentionalLosingRow, apiAdminGetFraudSummary, apiAdminPostFraudExportReport. Vitest 506 pass.
- [CONTRACTS] 2026-04-11 18:30 UTC  feat/contracts-m8-oz-pausable    M6 audit + Phase 6 checklist appended under Contracts Agent. M8: ArenaEscrow uses OZ Pausable+Ownable+ReentrancyGuard; declareWinner gets whenNotPaused; fee→owner(); isPaused() wraps paused(). @openzeppelin/contracts ^5.0.0. Hardhat 78 tests pass. ⚠️ Claude: sync escrow_client ARENA_ESCROW_ABI PlayerDeposited + wire owner pause on admin/freeze.
