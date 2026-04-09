# ProjectArena — Agent Sync

This file is the shared coordination memory between agents.

## Coordination Log

- [CURSOR-DBSYNC] 2026-04-09 15:41 UTC audit/db-ui-sync-check Audited DB→API→UI sync for host_id/your_team/bet_amount/stake_currency/in_match; added migration 019 (idx_matches_host). 0 tests run.
- [CURSOR] 2026-04-09 18:48 UTC test/frontend-p0-p1-coverage Added apiMatchHeartbeat, apiKickPlayer, apiRespondToNotification + team in join to engine-api.ts; 8 fetch-stub vitest tests. 501/501 vitest pass.
- [CURSOR] 2026-04-09 19:05 UTC test/oracle-coverage Verified test_state_machine.py (18 tests) covers WAITING→DETECTED→CONFIRMED→REPORTED; test_consensus.py (23 tests) covers majority win + minority flagged. 41/41 pytest pass. No prod code changes.

## Migration Status (do not edit past migrations)

- 016 `player_penalties` ✅ (completed; do not touch)
- 017 `platform_config + admin_audit_log` ✅ (completed; do not touch)
- 018 `admin indexes` ✅ (completed; do not touch)
- 019 `matches.host_id index` ✅ (added in this branch)

## Active API Contract (latest)

POST `/matches/{id}/join` → `{ joined, match_id, game, stake_currency, team: "A"|"B", started }`

POST `/matches/{id}/heartbeat` → `{
  in_match, match_id, status, game, mode, code,
  max_players, max_per_team, host_id, type,
  bet_amount, stake_currency, created_at,
  your_user_id, your_team, stale_removed,
  players: [{ user_id, username, avatar, arena_id, team }]
}`

POST `/matches/{id}/kick` → `{ kicked: true, match_id, user_id }`

GET `/match/active` → `{ match: {
  match_id, game, status, bet_amount, stake_currency,
  type, code, created_at, mode, host_id, host_username,
  max_players, max_per_team, your_user_id, your_team, players[]
} }`

## DB→API→UI Sync Audit (2026-04-09)

### Field 1 — `host_id`

- **DB**: `matches.host_id UUID REFERENCES users(id)`
- **API**: `GET /match/active` returns `host_id` ✅
- **UI**: `MatchLobby.tsx` uses `myActiveRoom.hostId` (mapped from `host_id`) for host-only actions like Delete Room/Leave Room ✅
- **Mismatch**: Kick flow is not implemented in `MatchLobby.tsx` (no usage of `/matches/{id}/kick` and no “Kick” button) ❌

### Field 2 — `your_team`

- **DB**: `match_players.team` stored as `"A"|"B"`
- **API**:
  - `GET /match/active` returns `your_team: "A"|"B"|null` ✅
  - `GET /match/{id}/status` returns `your_team: 0|1|null` ✅ (contract differs intentionally)
- **UI**:
  - `src/lib/engine-api.ts` `ActiveMatchResponse` type currently omits `your_team`/`your_user_id` ❌
  - `MatchLobby.tsx` does not use `your_team` from server to render a “ME” badge (no such UI present) ❌

### Field 3 — `bet_amount`

- **DB**: `matches.bet_amount NUMERIC(12,2)`
- **API**: returned as string (e.g. `"10.00"`, `"100"`) ✅
- **UI**: `mapApiMatchRowToMatch()` parses numeric strings → `Match.betAmount: number`, and lobby formatting uses it ✅

### Field 4 — `stake_currency`

- **DB**: `matches.stake_currency`
- **API**: returns `"AT"|"CRYPTO"` ✅
- **UI**:
  - Create flow shows “AT” explicitly and handles CRYPTO via wallet gating ✅
  - Lobby list displays “AT” explicitly but represents CRYPTO stakes as `$<amount>` / “BNB” copy, not the literal label `"CRYPTO"` (may be acceptable UX, but not a strict label match) ⚠️

### Field 5 — `in_match` (heartbeat)

- **DB**: computed live from `match_players` (not persisted) ✅
- **API**: `/matches/{id}/heartbeat` returns boolean `in_match` ✅
- **UI**:
  - `useActiveRoomServerSync` polls `GET /match/active` only; it does not call `/matches/{id}/heartbeat` and does not handle `in_match=false` explicitly for a kick/leave UX (it only clears the active room after 2 misses) ❌

