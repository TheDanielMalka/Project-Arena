# ArenaEscrow — Contract Documentation

## What It Does

ArenaEscrow is a smart contract that holds two players' funds during a 1v1 match.
No one — including Arena — can touch the funds mid-match.
The contract only releases money when a winner is declared or a refund is triggered.

---

## State Machine

```
createMatch()           joinMatch()          declareWinner()
     │                      │                      │
  WAITING  ──────────►  ACTIVE  ──────────────►  FINISHED
     │                      │
     │                      │  block.timestamp >= startTime + 2h
     │                      └──────────────────►  REFUNDED
     │
     │  cancelMatch()
     └──────────────────────────────────────────►  CANCELLED
```

| State     | Meaning                                      | DB `matches.status` |
|-----------|----------------------------------------------|---------------------|
| WAITING   | Player A deposited, waiting for Player B     | `waiting`           |
| ACTIVE    | Both deposited, match in progress            | `in_progress`       |
| FINISHED  | Winner declared, funds paid out              | `completed`         |
| REFUNDED  | 2h timeout — both players refunded           | `cancelled`         |
| CANCELLED | Player A cancelled before Player B joined    | `cancelled`         |

---

## Roles

| Role   | Who                          | What they can do                          |
|--------|------------------------------|-------------------------------------------|
| Owner  | Arena platform wallet        | pause, unpause, setOracle, receives fees  |
| Oracle | Vision Engine wallet         | declareWinner only                        |
| Player | Any registered wallet        | createMatch, joinMatch, cancelMatch, claimRefund |

---

## Functions

### `createMatch()` — payable
**Who calls it:** Player A (from the Frontend or directly)

**What it does:**
- Locks Player A's stake in the contract
- Creates a new match in state WAITING
- Returns `matchId` (uint256) — stored in DB as `matches.on_chain_match_id`

**Events emitted:** `MatchCreated(matchId, playerA, stake)`

**DB side (Engine handles on event):**
- `INSERT INTO matches (status='waiting', on_chain_match_id=matchId)`
- `INSERT INTO transactions (type='escrow_lock', user_id=playerA)`
- `UPDATE user_balances SET in_escrow = in_escrow + stake`

---

### `joinMatch(matchId)` — payable
**Who calls it:** Player B

**What it does:**
- Player B deposits the exact same stake as Player A
- Match transitions to ACTIVE
- Records `startTime` — the 2h timeout clock starts here

**Requires:**
- Match must be in WAITING state
- `msg.value` must equal `m.stake` exactly
- Player B cannot be the same address as Player A

**Events emitted:** `MatchActive(matchId, playerB)`

**DB side:**
- `UPDATE matches SET status='in_progress', started_at=NOW()`
- `INSERT INTO transactions (type='escrow_lock', user_id=playerB)`
- `UPDATE user_balances SET in_escrow = in_escrow + stake`

---

### `cancelMatch(matchId)`
**Who calls it:** Player A only

**What it does:**
- Cancels a match that Player B has not yet joined
- Returns Player A's full stake — no fee
- Only works while state is WAITING

**Requires:**
- Match must be in WAITING state
- `msg.sender` must be Player A

**Events emitted:** `MatchCancelled(matchId, playerA)`

**DB side:**
- `UPDATE matches SET status='cancelled', ended_at=NOW()`
- `INSERT INTO transactions (type='refund', user_id=playerA)`
- `UPDATE user_balances SET in_escrow = in_escrow - stake, available = available + stake`

---

### `declareWinner(matchId, winner)` — onlyOracle
**Who calls it:** Vision Engine (Oracle wallet) — or Admin via backend when resolving a dispute

**What it does:**
- Declares the winner of an ACTIVE match
- Pays winner: `stake × 2 × 95%`
- Pays Arena: `stake × 2 × 5%` (FEE_PERCENT)

**Requires:**
- Caller must be the Oracle address
- Match must be in ACTIVE state
- `winner` must be either playerA or playerB

**Events emitted:** `WinnerDeclared(matchId, winner, payout, fee)`

**DB side:**
- `UPDATE matches SET status='completed', winner_id=..., ended_at=NOW()`
- `INSERT INTO transactions (type='match_win', user_id=winner, amount=payout)`
- `INSERT INTO transactions (type='fee', amount=fee)`
- `UPDATE user_stats SET wins=wins+1, total_earnings=total_earnings+payout` (winner)
- `UPDATE user_stats SET losses=losses+1` (loser)
- `UPDATE user_balances` — release in_escrow for both, credit winner

---

### `claimRefund(matchId)`
**Who calls it:** Either player (after timeout)

**What it does:**
- Returns full stake to both players — no fee
- Triggered when match has been ACTIVE for more than 2 hours
- Protects players if the Vision Engine goes offline

**Requires:**
- Match must be in ACTIVE state
- Caller must be playerA or playerB
- `block.timestamp >= startTime + 2 hours`

**Events emitted:** `MatchRefunded(matchId)`

**DB side:**
- `UPDATE matches SET status='cancelled', ended_at=NOW()`
- `INSERT INTO transactions (type='refund', user_id=playerA)`
- `INSERT INTO transactions (type='refund', user_id=playerB)`
- `UPDATE user_balances` — release in_escrow for both players

---

### `pause()` / `unpause()` — onlyOwner
**Who calls it:** Arena platform wallet (Owner)

**What it does:**
- `pause()` — blocks `createMatch` and `joinMatch`
- `unpause()` — resumes normal operation
- Does NOT freeze in-progress matches — players can still `claimRefund` and `cancelMatch`

**Maps to:** `platform_settings.kill_switch_active` in DB

**Events emitted:** `Paused(owner)` / `Unpaused(owner)`

---

### `setOracle(newOracle)` — onlyOwner
**Who calls it:** Arena platform wallet

**What it does:**
- Replaces the Oracle wallet address
- Used when rotating the Vision Engine wallet

**Events emitted:** `OracleUpdated(oldOracle, newOracle)`

---

### `getMatch(matchId)` — view
**Who calls it:** Anyone (API, Frontend, Engine)

**Returns:** `playerA, playerB, stake, state, winner`

**Used for:** Verifying on-chain state against DB state.

---

## Money Flow

```
Player A  ──── stake ────►┐
                          │  Contract holds (stake × 2)
Player B  ──── stake ────►┘
                          │
              ┌───────────┴────────────┐
              │ declareWinner()        │ claimRefund() / cancelMatch()
              ▼                        ▼
   Winner gets stake×2×95%       Players get stake back
   Arena  gets stake×2×5%        No fee
```

---

## Security

| Threat                  | Protection                                              |
|-------------------------|---------------------------------------------------------|
| Reentrancy attack       | `nonReentrant` modifier on all functions that transfer  |
| Unauthorized resolution | `onlyOracle` modifier on `declareWinner`                |
| Admin stealing funds    | Owner can only pause/setOracle — cannot touch stakes    |
| Funds stuck forever     | `claimRefund` after 2h + `cancelMatch` for WAITING      |
| Integer overflow        | Solidity 0.8.20 — built-in overflow protection          |
| Zero address oracle     | Validated in constructor and `setOracle`                |

---

## DB Alignment

| Contract                  | Postgres                                      |
|---------------------------|-----------------------------------------------|
| `matchId` (uint256)       | `matches.on_chain_match_id` (BIGINT)          |
| `MatchState.WAITING`      | `matches.status = 'waiting'`                  |
| `MatchState.ACTIVE`       | `matches.status = 'in_progress'`              |
| `MatchState.FINISHED`     | `matches.status = 'completed'`                |
| `MatchState.REFUNDED`     | `matches.status = 'cancelled'`                |
| `MatchState.CANCELLED`    | `matches.status = 'cancelled'`                |
| `FEE_PERCENT = 5`         | `platform_settings.fee_percent = 5.00`        |
| `paused = true`           | `platform_settings.kill_switch_active = TRUE` |
| `escrow_lock` event       | `transactions.type = 'escrow_lock'`           |
| `match_win` event         | `transactions.type = 'match_win'`             |
| `fee` event               | `transactions.type = 'fee'`                   |
| `refund` event            | `transactions.type = 'refund'`                |

---

## Constants

| Name          | Value   | Meaning                              |
|---------------|---------|--------------------------------------|
| `TIMEOUT`     | 2 hours | Max match duration before refund     |
| `FEE_PERCENT` | 5       | Platform commission on every payout  |

---

## Contract Address

Deployed address is stored in `.env` as `CONTRACT_ADDRESS` after deployment (Issue #27).
