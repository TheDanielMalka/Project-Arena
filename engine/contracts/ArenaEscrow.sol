// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  ArenaEscrow
 * @notice Trustless 1v1 match escrow for the ARENA platform.
 *
 * Flow:
 *   1. Player A calls createMatch()  → deposits stake, state = WAITING
 *   2. Player B calls joinMatch()    → deposits same stake, state = ACTIVE
 *   3. Vision Engine calls declareWinner() → pays winner, state = FINISHED
 *   4. Timeout fallback: either player calls claimRefund() → state = REFUNDED
 *   5. No-show fallback: Player A calls cancelMatch() → state = CANCELLED
 *
 * Trust model:
 *   - No one (including ARENA) can touch funds mid-match
 *   - Only the designated oracle (Vision Engine wallet) can declare a winner
 *   - Players can always recover funds via refund or cancel
 *   - All logic is public and verifiable on-chain
 *
 * ── DB alignment (matches.status) ──────────────────────────────────────────
 *   MatchState.WAITING   → 'waiting'
 *   MatchState.ACTIVE    → 'in_progress'
 *   MatchState.FINISHED  → 'completed'
 *   MatchState.REFUNDED  → 'cancelled'   (timeout — vision engine offline)
 *   MatchState.CANCELLED → 'cancelled'   (player A cancelled before start)
 *
 * ── DB alignment (transactions.tx_type) ────────────────────────────────────
 *   MatchCreated   event → 'escrow_lock'    for playerA
 *   MatchActive    event → 'escrow_lock'    for playerB
 *   WinnerDeclared event → 'match_win'      for winner  + 'fee' for platform
 *   MatchRefunded  event → 'refund'         for playerA + playerB
 *   MatchCancelled event → 'refund'         for playerA
 *
 * ── Platform settings alignment ────────────────────────────────────────────
 *   FEE_PERCENT     ↔  platform_settings.fee_percent        (5)
 *   paused = true   ↔  platform_settings.kill_switch_active (TRUE)
 */
contract ArenaEscrow {

    // ── Constants ────────────────────────────────────────────────────────────

    uint256 public constant TIMEOUT     = 2 hours;
    uint256 public constant FEE_PERCENT = 5;          // matches platform_settings.fee_percent

    // ── Match states ─────────────────────────────────────────────────────────

    enum MatchState {
        WAITING,    // playerA deposited, waiting for playerB  → DB: 'waiting'
        ACTIVE,     // both deposited, match in progress        → DB: 'in_progress'
        FINISHED,   // winner declared, funds paid out          → DB: 'completed'
        REFUNDED,   // timeout — stakes returned to both        → DB: 'cancelled'
        CANCELLED   // playerA cancelled before playerB joined  → DB: 'cancelled'
    }

    // ── Match data ───────────────────────────────────────────────────────────

    struct Match {
        address playerA;    // wallet — DB: users.wallet_address (team A)
        address playerB;    // wallet — DB: users.wallet_address (team B)
        uint256 stake;      // wei per player — DB: matches.bet_amount
        uint256 startTime;  // block.timestamp when ACTIVE — DB: matches.started_at
        MatchState state;   // DB: matches.status
        address winner;     // DB: matches.winner_id (via wallet lookup)
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    address public owner;           // ARENA platform wallet (receives fees)
    address public oracle;          // Vision Engine wallet (declares winners)
    bool    public paused;          // DB: platform_settings.kill_switch_active

    uint256 public matchCount;
    mapping(uint256 => Match) public matches;
    // matchCount-1 == on_chain_match_id stored in DB matches.on_chain_match_id

    // ── Reentrancy guard ─────────────────────────────────────────────────────

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;

    // ── Events ───────────────────────────────────────────────────────────────
    // The Vision Engine listens to these events to sync Postgres + SQLite ledger

    event MatchCreated   (uint256 indexed matchId, address indexed playerA, uint256 stake);
    event MatchActive    (uint256 indexed matchId, address indexed playerB);
    event WinnerDeclared (uint256 indexed matchId, address indexed winner, uint256 payout, uint256 fee);
    event MatchRefunded  (uint256 indexed matchId);
    event MatchCancelled (uint256 indexed matchId, address indexed cancelledBy);
    event Paused         (address indexed by);
    event Unpaused       (address indexed by);
    event OracleUpdated  (address indexed oldOracle, address indexed newOracle);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier matchExists(uint256 matchId) {
        require(matchId < matchCount, "Match does not exist");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _oracle) {
        require(_oracle != address(0), "Oracle cannot be zero address");
        owner   = msg.sender;
        oracle  = _oracle;
        _status = _NOT_ENTERED;
    }

    // ── Player actions ───────────────────────────────────────────────────────

    /**
     * @notice Player A creates a match and deposits their stake.
     *
     * DB side (Vision Engine handles on MatchCreated event):
     *   INSERT INTO matches (status='waiting', on_chain_match_id=matchId, ...)
     *   INSERT INTO transactions (type='escrow_lock', user_id=playerA, ...)
     *   UPDATE user_balances SET in_escrow = in_escrow + stake WHERE user_id=playerA
     *
     * @return matchId  The on-chain ID. Store in matches.on_chain_match_id.
     */
    function createMatch()
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 matchId)
    {
        require(msg.value > 0, "Stake must be greater than zero");

        matchId = matchCount++;
        matches[matchId] = Match({
            playerA:   msg.sender,
            playerB:   address(0),
            stake:     msg.value,
            startTime: 0,
            state:     MatchState.WAITING,
            winner:    address(0)
        });

        emit MatchCreated(matchId, msg.sender, msg.value);
    }

    /**
     * @notice Player B joins an existing WAITING match by depositing the same stake.
     *
     * DB side (Vision Engine handles on MatchActive event):
     *   UPDATE matches SET status='in_progress', started_at=NOW()
     *   INSERT INTO transactions (type='escrow_lock', user_id=playerB, ...)
     *   UPDATE user_balances SET in_escrow = in_escrow + stake WHERE user_id=playerB
     *
     * @param matchId  The on_chain_match_id of the match to join.
     */
    function joinMatch(uint256 matchId)
        external
        payable
        whenNotPaused
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.WAITING,  "Match not open");
        require(msg.sender != m.playerA,        "Cannot play against yourself");
        require(msg.value == m.stake,           "Must match player A stake exactly");

        m.playerB   = msg.sender;
        m.startTime = block.timestamp;
        m.state     = MatchState.ACTIVE;

        emit MatchActive(matchId, msg.sender);
    }

    /**
     * @notice Player A cancels a match that has not yet started (still WAITING).
     *         Full stake is returned to playerA. No fee.
     *
     * Use case: playerB never shows up, playerA wants their stake back
     *           without waiting for the TIMEOUT (which only applies to ACTIVE).
     *
     * DB side (Vision Engine handles on MatchCancelled event):
     *   UPDATE matches SET status='cancelled', ended_at=NOW()
     *   INSERT INTO transactions (type='refund', user_id=playerA, ...)
     *   UPDATE user_balances SET in_escrow = in_escrow - stake,
     *                            available = available + stake
     *
     * @param matchId  The on_chain_match_id to cancel.
     */
    function cancelMatch(uint256 matchId)
        external
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.WAITING, "Match already started or resolved");
        require(msg.sender == m.playerA,       "Only match creator can cancel");

        // Checks-Effects-Interactions: update state before transfer
        m.state = MatchState.CANCELLED;

        payable(m.playerA).transfer(m.stake);

        emit MatchCancelled(matchId, msg.sender);
    }

    // ── Oracle action ────────────────────────────────────────────────────────

    /**
     * @notice Vision Engine declares the winner after the match result is confirmed.
     *         Pays winner (totalPot - fee) and platform fee to owner.
     *
     * DB side (Vision Engine handles on WinnerDeclared event):
     *   UPDATE matches SET status='completed', winner_id=..., ended_at=NOW()
     *   INSERT INTO transactions (type='match_win',  user_id=winner,   amount=payout, ...)
     *   INSERT INTO transactions (type='fee',        user_id=platform, amount=fee,    ...)
     *   UPDATE user_stats SET wins=wins+1, total_earnings=total_earnings+payout
     *   UPDATE user_stats SET losses=losses+1 (for loser)
     *   UPDATE user_balances: release in_escrow for both, credit winner
     *
     * @param matchId  on_chain_match_id of the finished match.
     * @param winner   Wallet address of the winner (must be playerA or playerB).
     */
    function declareWinner(uint256 matchId, address winner)
        external
        onlyOracle
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.ACTIVE,               "Match not active");
        require(winner == m.playerA || winner == m.playerB, "Winner must be a player");

        uint256 totalPot = m.stake * 2;
        uint256 fee      = (totalPot * FEE_PERCENT) / 100;
        uint256 payout   = totalPot - fee;

        // Checks-Effects-Interactions: update state before transfers
        m.state  = MatchState.FINISHED;
        m.winner = winner;

        payable(winner).transfer(payout);
        payable(owner).transfer(fee);

        emit WinnerDeclared(matchId, winner, payout, fee);
    }

    // ── Timeout refund ───────────────────────────────────────────────────────

    /**
     * @notice Either player can claim a full refund if the match exceeds TIMEOUT.
     *         Protects players if the Vision Engine goes offline.
     *
     * DB side (Vision Engine handles on MatchRefunded event):
     *   UPDATE matches SET status='cancelled', ended_at=NOW()
     *   INSERT INTO transactions (type='refund', user_id=playerA, ...)
     *   INSERT INTO transactions (type='refund', user_id=playerB, ...)
     *   UPDATE user_balances: release in_escrow for both players
     *
     * @param matchId  on_chain_match_id to refund.
     */
    function claimRefund(uint256 matchId)
        external
        nonReentrant
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.ACTIVE,                        "Match not active");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "Not a player in this match");
        require(block.timestamp >= m.startTime + TIMEOUT,           "Timeout not reached yet");

        // Checks-Effects-Interactions: update state before transfers
        m.state = MatchState.REFUNDED;

        payable(m.playerA).transfer(m.stake);
        payable(m.playerB).transfer(m.stake);

        emit MatchRefunded(matchId);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Pause new match creation and joining.
     *         Maps to: UPDATE platform_settings SET kill_switch_active = TRUE
     *
     * Note: does NOT freeze in-progress matches.
     *       Players can still call claimRefund() and cancelMatch() while paused.
     */
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Resume normal operations.
     *         Maps to: UPDATE platform_settings SET kill_switch_active = FALSE
     */
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Replace the oracle (e.g. Vision Engine wallet rotation).
     *         Maps to: UPDATE env SET WALLET_ADDRESS = newOracle (Vision Engine)
     */
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Oracle cannot be zero address");
        address old = oracle;
        oracle = newOracle;
        emit OracleUpdated(old, newOracle);
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Returns full match details.
     *         Used by the API to verify on-chain state against DB state.
     */
    function getMatch(uint256 matchId)
        external
        view
        matchExists(matchId)
        returns (
            address playerA,
            address playerB,
            uint256 stake,
            MatchState state,
            address winner
        )
    {
        Match storage m = matches[matchId];
        return (m.playerA, m.playerB, m.stake, m.state, m.winner);
    }

    /**
     * @notice Convenience check for the API / admin dashboard.
     *         Mirrors platform_settings.kill_switch_active.
     */
    function isPaused() external view returns (bool) {
        return paused;
    }
}
