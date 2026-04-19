// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  ArenaEscrow
 * @notice Trustless multi-player match escrow for the ARENA platform.
 *         Supports 1v1, 2v2, 4v4, and 5v5 match formats.
 *
 * Flow:
 *   1. Creator calls createMatch(teamSize) → deposits stake, joins teamA, state = WAITING
 *   2. Players call joinMatch(matchId, team) → each deposits same stake
 *   3. When all (teamSize × 2) players deposited → state = ACTIVE automatically
 *   4. Vision Engine calls declareWinner(matchId, winningTeam) → distributes to all winners
 *   5. Timeout fallback: any player calls claimRefund() → all refunded (ACTIVE → REFUNDED)
 *   6. No-show fallback: creator calls cancelMatch() OR any depositor calls cancelWaiting()
 *      after WAITING_TIMEOUT → all depositors refunded (WAITING → CANCELLED)
 *
 * Trust model:
 *   - No one (including ARENA) can touch funds mid-match
 *   - Only the designated oracle (Vision Engine wallet) can declare a winner
 *   - Each player deposits individually — verified against their SteamID/wallet link
 *   - Players can always recover funds via refund or cancel
 *   - All logic is public and verifiable on-chain
 *
 * Security notes (audit 2026-04-11, hardened 2026-04-19):
 *   - Reentrancy: OpenZeppelin ReentrancyGuard (nonReentrant) on all state-changing externals
 *   - Emergency pause (M8): OpenZeppelin Pausable — createMatch, joinMatch, declareWinner use whenNotPaused.
 *     Mirrors backend kill switch (POST /admin/freeze / _PAYOUTS_FROZEN): platform should call pause() in tandem.
 *   - Access: OpenZeppelin Ownable — deployer is owner (receives fee); oracle wallet is separate (onlyOracle on declareWinner).
 *   - CEI: state updated before all external calls; events emitted before transfers
 *   - Transfer: .call() used instead of .transfer() — removes hard 2300-gas limit
 *     that could DoS payouts if any player/owner is a contract with an expensive fallback
 *   - Pull-payment DoS guard (audit 2026-04-19): loops in declareWinner / cancelMatch /
 *     cancelWaiting / claimRefund call _payOrCredit() which tries a bounded .call
 *     (PAYOUT_CALL_GAS) and, on failure, credits pendingWithdrawals[recipient]
 *     + emits PayoutCredited so a single malicious/contract recipient that reverts
 *     in its fallback cannot block payouts for everyone else in the loop.
 *     Recipients pull via withdraw() — single-recipient CEI, reverts on fail so
 *     msg.sender can retry without losing the credit.
 *   - WAITING escape hatch: cancelWaiting() added — any depositor can cancel after
 *     WAITING_TIMEOUT if creator disappears and not all slots are filled
 *   - teamSize validated to {1,2,4,5} only; 3 is rejected
 *
 * ── Supported formats ──────────────────────────────────────────────────────────
 *   teamSize = 1 → 1v1  (2  players total)
 *   teamSize = 2 → 2v2  (4  players total)
 *   teamSize = 4 → 4v4  (8  players total)
 *   teamSize = 5 → 5v5  (10 players total)
 *
 * ── DB alignment (matches.status) ──────────────────────────────────────────────
 *   MatchState.WAITING   → 'waiting'
 *   MatchState.ACTIVE    → 'in_progress'
 *   MatchState.FINISHED  → 'completed'
 *   MatchState.REFUNDED  → 'cancelled'   (timeout — vision engine offline)
 *   MatchState.CANCELLED → 'cancelled'   (creator cancelled OR waiting timeout)
 *
 * ── DB alignment (transactions.tx_type) ────────────────────────────────────────
 *   MatchCreated    event → 'crypto_escrow_lock'  for creator (teamA[0])
 *   PlayerDeposited event → 'crypto_escrow_lock'  for each joining player
 *   WinnerDeclared  event → 'match_win'           for each winner + 'fee' for platform
 *   MatchRefunded   event → 'refund'              for all players
 *   MatchCancelled  event → 'refund'              for all depositors
 *
 * NOTE: 'crypto_escrow_lock' is intentionally distinct from AT's 'escrow_lock'.
 *   _check_daily_stake_limit() in engine/main.py must count BOTH types toward the daily cap.
 *   The stake_amount for the limit check is stakePerPlayer (emitted in both events below).
 *
 * ── DB alignment (match_players table) ─────────────────────────────────────────
 *   PlayerDeposited event → SET has_deposited=TRUE, deposited_at=NOW(), deposit_amount=stakePerPlayer
 *   MatchActive     event → matches.deposits_received = teamSize * 2
 *
 * ── Platform settings alignment ────────────────────────────────────────────────
 *   FEE_PERCENT     ↔  platform_settings.fee_percent        (5)
 *                     Payout math: (100 - FEE_PERCENT)% to winners split equally; FEE_PERCENT% to owner (not 90/10 unless fee_pct=10).
 *   Pausable.paused ↔  platform_settings.kill_switch_active (TRUE) — sync via owner calling pause()/unpause()
 */
contract ArenaEscrow is ReentrancyGuard, Ownable, Pausable {

    // ── Constants ────────────────────────────────────────────────────────────

    uint256 public constant TIMEOUT         = 2 hours;   // ACTIVE match timeout (rage-quit guard)
    uint256 public constant WAITING_TIMEOUT = 1 hours;   // WAITING match timeout (creator no-show guard)
    uint256 public constant FEE_PERCENT     = 5;         // matches platform_settings.fee_percent
    uint8   public constant MAX_TEAM        = 5;         // maximum players per team (5v5)

    // Gas cap for per-recipient payout in loops (cancelMatch/cancelWaiting/
    // claimRefund/declareWinner). Large enough for a Gnosis Safe / ERC-4337
    // receive (~25k gas), small enough that a malicious contract recipient
    // cannot burn the whole block in a single iteration. If the recipient's
    // fallback reverts or out-of-gases, _payOrCredit credits the amount to
    // pendingWithdrawals so everyone else in the loop still gets paid.
    uint256 public constant PAYOUT_CALL_GAS = 100_000;

    // ── Match states ─────────────────────────────────────────────────────────

    enum MatchState {
        WAITING,    // deposits in progress, not all players joined  → DB: 'waiting'
        ACTIVE,     // all players deposited, match in progress       → DB: 'in_progress'
        FINISHED,   // winner declared, funds paid out               → DB: 'completed'
        REFUNDED,   // timeout — stakes returned to all players      → DB: 'cancelled'
        CANCELLED   // creator cancelled OR waiting timeout          → DB: 'cancelled'
    }

    // ── Match data ───────────────────────────────────────────────────────────

    struct Match {
        address[] teamA;        // ordered deposit list for team A — DB: match_players WHERE team='A'
        address[] teamB;        // ordered deposit list for team B — DB: match_players WHERE team='B'
        uint256 stakePerPlayer; // wei per player — DB: matches.bet_amount / matches.stake_per_player
        uint8   teamSize;       // players per team (1,2,4,5) — DB: matches.max_per_team
        uint8   depositsTeamA;  // how many teamA players deposited — DB: COUNT(match_players WHERE team='A' AND has_deposited=TRUE)
        uint8   depositsTeamB;  // how many teamB players deposited
        uint256 createdAt;      // block.timestamp when createMatch was called — used for WAITING_TIMEOUT
        uint256 startTime;      // block.timestamp when match became ACTIVE — DB: matches.started_at, used for TIMEOUT
        MatchState state;       // DB: matches.status
        uint8   winningTeam;    // 0=teamA, 1=teamB, 255=undecided — DB: matches.winner_id (via wallet lookup)
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    // Ownable: deployer is owner() — platform wallet (receives fee on declareWinner)
    address public oracle;           // Vision Engine wallet (declares winners) — onlyOracle

    uint256 public matchCount;
    mapping(uint256 => Match) public matches;
    // matchCount-1 == on_chain_match_id stored in DB matches.on_chain_match_id

    // Prevents a single address from depositing twice in the same match
    // DB-ready: enforced on-chain, double-checked by match_players UNIQUE (match_id, user_id)
    mapping(uint256 => mapping(address => bool)) public hasDeposited;

    // Pull-payment ledger — credits set when a direct payout call fails
    // (malicious contract recipient / gas griefing / out-of-gas receive).
    // Recipients call withdraw() to claim. Uses wei units — matches msg.value.
    // Backend sync: PayoutCredited event mirrors a successful _sendEth in
    // accounting terms (user's in_escrow still released; just sitting in
    // contract balance instead of recipient's wallet until withdraw()).
    mapping(address => uint256) public pendingWithdrawals;

    // ── Events ───────────────────────────────────────────────────────────────
    // Vision Engine listens to these to sync Postgres + user balances

    event MatchCreated   (uint256 indexed matchId, address indexed creator, uint8 teamSize, uint256 stakePerPlayer);
    // stakePerPlayer included so the backend can INSERT transactions(type='crypto_escrow_lock', amount=stakePerPlayer)
    // without an extra contract call — required for _check_daily_stake_limit() to count CRYPTO deposits.
    event PlayerDeposited(uint256 indexed matchId, address indexed player, uint8 team, uint256 stakePerPlayer, uint8 depositsTeamA, uint8 depositsTeamB);
    event MatchActive    (uint256 indexed matchId);                                             // all players deposited
    event WinnerDeclared (uint256 indexed matchId, uint8 winningTeam, uint256 payoutPerWinner, uint256 fee);
    event MatchRefunded  (uint256 indexed matchId);
    event MatchCancelled (uint256 indexed matchId, address indexed cancelledBy);
    event OracleUpdated  (address indexed oldOracle, address indexed newOracle);
    // Pull-payment fallback: recipient's receive() failed or out-of-gased
    // under PAYOUT_CALL_GAS — amount credited to pendingWithdrawals[recipient].
    event PayoutCredited (address indexed recipient, uint256 amount);
    // Recipient pulled their pending credit via withdraw().
    event Withdrawn      (address indexed recipient, uint256 amount);
    // Paused / Unpaused: emitted by OpenZeppelin Pausable — do not redeclare here.

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    modifier matchExists(uint256 matchId) {
        require(matchId < matchCount, "Match does not exist");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _oracle) Ownable(msg.sender) {
        require(_oracle != address(0), "Oracle cannot be zero address");
        oracle = _oracle;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /**
     * @dev Tries to send `amount` wei to `recipient` under a bounded gas cap.
     *      On success: ETH leaves the contract immediately (hot path for EOAs
     *      and well-behaved contract wallets).
     *      On failure: credits pendingWithdrawals[recipient] and emits
     *      PayoutCredited so the DoS vector from a single reverting recipient
     *      inside a payout loop (cancelMatch / cancelWaiting / declareWinner
     *      / claimRefund) is removed — everyone else in the loop still gets
     *      paid, and the stuck recipient can pull via withdraw() later.
     *      nonReentrant on every caller prevents reentrancy; the per-call
     *      PAYOUT_CALL_GAS cap prevents gas griefing across the loop.
     */
    function _payOrCredit(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool success, ) = payable(recipient).call{value: amount, gas: PAYOUT_CALL_GAS}("");
        if (!success) {
            pendingWithdrawals[recipient] += amount;
            emit PayoutCredited(recipient, amount);
        }
    }

    /**
     * @dev Validates that teamSize is one of the four supported match formats.
     *      Rejects teamSize=3 which passes the range check (1-5) but has no DB mapping.
     */
    function _validTeamSize(uint8 teamSize) internal pure returns (bool) {
        return teamSize == 1 || teamSize == 2 || teamSize == 4 || teamSize == 5;
    }

    // ── Player actions ───────────────────────────────────────────────────────

    /**
     * @notice Creator opens a match and deposits their stake as the first teamA player.
     *         Match stays WAITING until all (teamSize × 2) players deposit.
     *
     * DB side (Vision Engine handles on MatchCreated event):
     *   INSERT INTO matches (status='waiting', mode=modeFor(teamSize), max_per_team=teamSize,
     *                        max_players=teamSize*2, on_chain_match_id=matchId,
     *                        bet_amount=stakePerPlayer, stake_per_player=stakePerPlayer)
     *   INSERT INTO match_players (user_id=creator, team='A', wallet_address=creator, has_deposited=TRUE)
     *   INSERT INTO transactions  (type='crypto_escrow_lock', user_id=creator, amount=stakePerPlayer)
     *   UPDATE user_balances SET in_escrow = in_escrow + stakePerPlayer WHERE user_id=creator
     *
     * @param teamSize  Players per team: 1 (1v1), 2 (2v2), 4 (4v4), or 5 (5v5).
     * @return matchId  The on-chain ID. Store in matches.on_chain_match_id.
     */
    function createMatch(uint8 teamSize)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 matchId)
    {
        require(_validTeamSize(teamSize), "Invalid team size (1,2,4,5)");
        require(msg.value > 0, "Stake must be greater than zero");

        matchId = matchCount++;

        Match storage m = matches[matchId];
        m.stakePerPlayer = msg.value;
        m.teamSize       = teamSize;
        m.depositsTeamA  = 1;
        m.depositsTeamB  = 0;
        m.createdAt      = block.timestamp;  // used for WAITING_TIMEOUT reference
        m.startTime      = 0;               // set when match becomes ACTIVE
        m.state          = MatchState.WAITING;
        m.winningTeam    = 255; // 255 = undecided
        m.teamA.push(msg.sender);

        hasDeposited[matchId][msg.sender] = true;

        emit MatchCreated(matchId, msg.sender, teamSize, msg.value);
    }

    /**
     * @notice A player joins an existing WAITING match by depositing the exact stake.
     *         When the last required player deposits, match transitions to ACTIVE automatically.
     *
     * DB side (Vision Engine handles on PlayerDeposited event):
     *   INSERT INTO match_players (user_id=..., team=team==0?'A':'B', wallet_address=player,
     *                              has_deposited=TRUE, deposited_at=NOW(), deposit_amount=stakePerPlayer)
     *   INSERT INTO transactions  (type='crypto_escrow_lock', user_id=..., amount=stakePerPlayer)
     *   UPDATE matches SET deposits_received = deposits_received + 1
     *   UPDATE user_balances SET in_escrow = in_escrow + stakePerPlayer
     *
     * DB side (Vision Engine handles on MatchActive event):
     *   UPDATE matches SET status='in_progress', started_at=NOW()
     *
     * @param matchId  The on_chain_match_id of the match to join.
     * @param team     0 = join teamA, 1 = join teamB.
     */
    function joinMatch(uint256 matchId, uint8 team)
        external
        payable
        whenNotPaused
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.WAITING,       "Match not open");
        require(team == 0 || team == 1,              "Team must be 0 (A) or 1 (B)");
        require(!hasDeposited[matchId][msg.sender],  "Already deposited");
        require(msg.value == m.stakePerPlayer,       "Must match stake exactly");

        if (team == 0) {
            require(m.depositsTeamA < m.teamSize, "Team A is full");
            m.teamA.push(msg.sender);
            m.depositsTeamA++;
        } else {
            require(m.depositsTeamB < m.teamSize, "Team B is full");
            m.teamB.push(msg.sender);
            m.depositsTeamB++;
        }

        hasDeposited[matchId][msg.sender] = true;

        emit PlayerDeposited(matchId, msg.sender, team, m.stakePerPlayer, m.depositsTeamA, m.depositsTeamB);

        // All players deposited → activate match
        if (m.depositsTeamA == m.teamSize && m.depositsTeamB == m.teamSize) {
            m.startTime = block.timestamp;   // TIMEOUT reference starts from when match is ACTIVE
            m.state     = MatchState.ACTIVE;
            emit MatchActive(matchId);
        }
    }

    /**
     * @notice Creator cancels a WAITING match (not all players have joined yet).
     *         Refunds all players who have already deposited. No fee.
     *
     * Use case: waiting room expired — not all players joined in time.
     *
     * DB side (Vision Engine handles on MatchCancelled event):
     *   UPDATE matches SET status='cancelled', ended_at=NOW()
     *   For each depositor: INSERT INTO transactions (type='refund', ...)
     *                       UPDATE user_balances SET in_escrow = in_escrow - stakePerPlayer,
     *                                               available = available + stakePerPlayer
     *
     * @param matchId  The on_chain_match_id to cancel.
     */
    function cancelMatch(uint256 matchId)
        external
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.WAITING,  "Match already started or resolved");
        require(msg.sender == m.teamA[0],        "Only match creator can cancel");

        // Checks-Effects-Interactions: update state and emit before transfers
        m.state = MatchState.CANCELLED;
        emit MatchCancelled(matchId, msg.sender);

        // Refund all teamA depositors
        for (uint8 i = 0; i < m.depositsTeamA; i++) {
            _payOrCredit(m.teamA[i], m.stakePerPlayer);
        }
        // Refund all teamB depositors (if any joined)
        for (uint8 i = 0; i < m.depositsTeamB; i++) {
            _payOrCredit(m.teamB[i], m.stakePerPlayer);
        }
    }

    /**
     * @notice Any deposited player can cancel a WAITING match after WAITING_TIMEOUT.
     *         Protects non-creator depositors if the creator disappears before the
     *         match is full. Refunds everyone who has already deposited. No fee.
     *
     * Security note: adds an escape hatch that .cancelMatch() lacks — creators can
     * abandon a WAITING match and leave teamB depositors locked. This function
     * allows any depositor (including teamB) to rescue funds after 1 hour.
     *
     * DB side (Vision Engine handles on MatchCancelled event):
     *   Same as cancelMatch — UPDATE matches SET status='cancelled' + refund transactions
     *
     * @param matchId  The on_chain_match_id of the stuck WAITING match.
     */
    function cancelWaiting(uint256 matchId)
        external
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.WAITING,              "Match not in WAITING state");
        require(hasDeposited[matchId][msg.sender],          "Not a depositor in this match");
        require(block.timestamp >= m.createdAt + WAITING_TIMEOUT, "Waiting timeout not reached yet");

        // Checks-Effects-Interactions: update state and emit before transfers
        m.state = MatchState.CANCELLED;
        emit MatchCancelled(matchId, msg.sender);

        // Refund all teamA depositors
        for (uint8 i = 0; i < m.depositsTeamA; i++) {
            _payOrCredit(m.teamA[i], m.stakePerPlayer);
        }
        // Refund all teamB depositors (if any joined)
        for (uint8 i = 0; i < m.depositsTeamB; i++) {
            _payOrCredit(m.teamB[i], m.stakePerPlayer);
        }
    }

    // ── Oracle action ────────────────────────────────────────────────────────

    /**
     * @notice Vision Engine declares the winning team after match result is confirmed.
     *         Distributes (totalPot - 5% fee) equally among all winners.
     *         Integer dust (from division) goes to the first winner.
     *
     * DB side (Vision Engine handles on WinnerDeclared event):
     *   UPDATE matches SET status='completed', winner_id=winnerTeam[0], ended_at=NOW()
     *   For each winner:   INSERT INTO transactions (type='match_win',  amount=payoutPerWinner)
     *                      UPDATE user_stats SET wins=wins+1, total_earnings+=payoutPerWinner
     *   For each loser:    UPDATE user_stats SET losses=losses+1
     *   INSERT INTO transactions (type='fee', amount=fee)
     *   UPDATE user_balances: release in_escrow for all 10 players, credit winners
     *
     * @param matchId      on_chain_match_id of the finished match.
     * @param winningTeam  0 = teamA wins, 1 = teamB wins.
     */
    function declareWinner(uint256 matchId, uint8 winningTeam)
        external
        onlyOracle
        nonReentrant
        whenNotPaused
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.ACTIVE,        "Match not active");
        require(winningTeam == 0 || winningTeam == 1, "Winning team must be 0 (A) or 1 (B)");

        uint256 totalPot        = m.stakePerPlayer * m.teamSize * 2;
        uint256 fee             = (totalPot * FEE_PERCENT) / 100;
        uint256 totalPayout     = totalPot - fee;
        uint256 payoutPerWinner = totalPayout / m.teamSize;
        // Dust from integer division goes to first winner — avoids locked funds
        uint256 dust            = totalPayout - (payoutPerWinner * m.teamSize);

        // Checks-Effects-Interactions: update state and emit before transfers
        m.state       = MatchState.FINISHED;
        m.winningTeam = winningTeam;
        emit WinnerDeclared(matchId, winningTeam, payoutPerWinner, fee);

        address[] storage winners = winningTeam == 0 ? m.teamA : m.teamB;
        for (uint8 i = 0; i < m.teamSize; i++) {
            uint256 amount = (i == 0) ? payoutPerWinner + dust : payoutPerWinner;
            _payOrCredit(winners[i], amount);
        }
        _payOrCredit(owner(), fee);
    }

    // ── Timeout refund ───────────────────────────────────────────────────────

    /**
     * @notice Any deposited player can claim a full refund if the match exceeds TIMEOUT.
     *         Protects all players if the Vision Engine goes offline mid-match.
     *         All players on both teams receive their full stake back. No fee.
     *
     * DB side (Vision Engine handles on MatchRefunded event):
     *   UPDATE matches SET status='cancelled', ended_at=NOW()
     *   For each player: INSERT INTO transactions (type='refund', ...)
     *                    UPDATE user_balances: release in_escrow for all players
     *
     * @param matchId  on_chain_match_id to refund.
     */
    function claimRefund(uint256 matchId)
        external
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.ACTIVE,              "Match not active");
        require(hasDeposited[matchId][msg.sender],         "Not a player in this match");
        require(block.timestamp >= m.startTime + TIMEOUT,  "Timeout not reached yet");

        // Checks-Effects-Interactions: update state and emit before transfers
        m.state = MatchState.REFUNDED;
        emit MatchRefunded(matchId);

        for (uint8 i = 0; i < m.teamSize; i++) {
            _payOrCredit(m.teamA[i], m.stakePerPlayer);
            _payOrCredit(m.teamB[i], m.stakePerPlayer);
        }
    }

    // ── Pull-payment withdrawal ──────────────────────────────────────────────

    /**
     * @notice Claim any funds that were credited to your pendingWithdrawals
     *         balance because a direct payout (cancelMatch / cancelWaiting /
     *         declareWinner / claimRefund) could not be delivered under the
     *         PAYOUT_CALL_GAS cap — for example, a contract recipient with a
     *         heavy receive() function. Reverts if the caller's credit is 0.
     *
     * CEI: pendingWithdrawals zeroed before the external call; revert-on-fail
     * keeps state + funds aligned so the caller can try again from a
     * different wallet / after fixing their receive().
     *
     * DB side (no event-driven DB sync needed — PayoutCredited already
     *   flagged the balance; Withdrawn is observational only).
     *   Optional backend: listen to Withdrawn to update a "pending withdrawals"
     *   UI badge if one is added later.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");
        pendingWithdrawals[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Emergency pause — blocks createMatch, joinMatch, and declareWinner (OpenZeppelin Pausable).
     *         Maps to: UPDATE platform_settings SET kill_switch_active = TRUE
     *
     * Note: cancelMatch, cancelWaiting, claimRefund remain callable while paused (user fund recovery).
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume normal operations.
     *         Maps to: UPDATE platform_settings SET kill_switch_active = FALSE
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Replace the oracle (e.g. Vision Engine wallet rotation).
     *         Maps to: UPDATE env SET ORACLE_WALLET = newOracle (Vision Engine)
     */
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Oracle cannot be zero address");
        address old = oracle;
        oracle = newOracle;
        emit OracleUpdated(old, newOracle);
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Returns full match details including both team rosters.
     *         Used by the API to verify on-chain state against DB state.
     */
    function getMatch(uint256 matchId)
        external
        view
        matchExists(matchId)
        returns (
            address[] memory teamA,
            address[] memory teamB,
            uint256 stakePerPlayer,
            uint8   teamSize,
            uint8   depositsTeamA,
            uint8   depositsTeamB,
            MatchState state,
            uint8   winningTeam
        )
    {
        Match storage m = matches[matchId];
        return (
            m.teamA,
            m.teamB,
            m.stakePerPlayer,
            m.teamSize,
            m.depositsTeamA,
            m.depositsTeamB,
            m.state,
            m.winningTeam
        );
    }

    /**
     * @notice Check if a specific address has deposited in a match.
     *         Used by the API to validate player deposit status.
     */
    function isDeposited(uint256 matchId, address player)
        external
        view
        matchExists(matchId)
        returns (bool)
    {
        return hasDeposited[matchId][player];
    }

    /**
     * @notice Convenience check for the API / admin dashboard.
     *         Mirrors platform_settings.kill_switch_active.
     */
    function isPaused() external view returns (bool) {
        return paused();
    }
}
