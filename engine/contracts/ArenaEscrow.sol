// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  ArenaEscrow
 * @notice Trustless 1v1 match escrow for the ARENA platform.
 *
 * Flow:
 *   1. Two players deposit equal stakes → funds locked in contract
 *   2. ARENA Vision Engine detects winner → calls declareWinner()
 *   3. Contract pays winner (stake × 2 − fee) and fee to platform
 *   4. If no result after TIMEOUT → either player can trigger refund
 *
 * Trust model:
 *   - No one (including ARENA) can touch funds mid-match
 *   - Only the designated oracle (Vision Engine wallet) can declare a winner
 *   - All logic is public and verifiable on-chain
 */
contract ArenaEscrow {

    // ── Constants ────────────────────────────────────────────────────────────

    uint256 public constant TIMEOUT     = 2 hours;   // max match duration
    uint256 public constant FEE_PERCENT = 5;          // 5% platform commission

    // ── Match states ─────────────────────────────────────────────────────────

    enum MatchState {
        WAITING,    // waiting for both players to deposit
        ACTIVE,     // both deposited — match in progress
        FINISHED,   // winner declared — funds paid out
        REFUNDED    // match timed out — stakes returned
    }

    // ── Match data ────────────────────────────────────────────────────────────

    struct Match {
        address playerA;        // first player wallet
        address playerB;        // second player wallet
        uint256 stake;          // amount each player deposits (in wei)
        uint256 startTime;      // when match became ACTIVE
        MatchState state;
        address winner;         // set after declareWinner()
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    address public owner;           // ARENA platform wallet (receives fees)
    address public oracle;          // Vision Engine wallet (declares winners)

    uint256 public matchCount;
    mapping(uint256 => Match) public matches;

    // ── Events ────────────────────────────────────────────────────────────────

    event MatchCreated  (uint256 indexed matchId, address playerA, uint256 stake);
    event MatchActive   (uint256 indexed matchId, address playerB);
    event WinnerDeclared(uint256 indexed matchId, address winner, uint256 payout, uint256 fee);
    event MatchRefunded (uint256 indexed matchId);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle can call this");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    modifier matchExists(uint256 matchId) {
        require(matchId < matchCount, "Match does not exist");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _oracle) {
        owner  = msg.sender;   // deployer = platform wallet
        oracle = _oracle;      // Vision Engine wallet address
    }

    // ── Player actions ────────────────────────────────────────────────────────

    /**
     * @notice Player A creates a match and deposits stake.
     * @return matchId The ID of the newly created match.
     */
    function createMatch() external payable returns (uint256 matchId) {
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
     * @notice Player B joins an existing match by depositing the same stake.
     * @param matchId The match to join.
     */
    function joinMatch(uint256 matchId) external payable matchExists(matchId) {
        Match storage m = matches[matchId];

        require(m.state == MatchState.WAITING,      "Match not open");
        require(msg.sender != m.playerA,            "Cannot play against yourself");
        require(msg.value == m.stake,               "Must match player A stake exactly");

        m.playerB    = msg.sender;
        m.startTime  = block.timestamp;
        m.state      = MatchState.ACTIVE;

        emit MatchActive(matchId, msg.sender);
    }

    // ── Oracle action ─────────────────────────────────────────────────────────

    /**
     * @notice Vision Engine declares the winner after match result is confirmed.
     * @param matchId  The match that ended.
     * @param winner   Address of the winning player (must be playerA or playerB).
     */
    function declareWinner(uint256 matchId, address winner)
        external
        onlyOracle
        matchExists(matchId)
    {
        Match storage m = matches[matchId];

        require(m.state == MatchState.ACTIVE,                        "Match not active");
        require(winner == m.playerA || winner == m.playerB,          "Winner must be a player");

        m.state  = MatchState.FINISHED;
        m.winner = winner;

        uint256 totalPot = m.stake * 2;
        uint256 fee      = (totalPot * FEE_PERCENT) / 100;
        uint256 payout   = totalPot - fee;

        payable(winner).transfer(payout);
        payable(owner).transfer(fee);

        emit WinnerDeclared(matchId, winner, payout, fee);
    }

    // ── Timeout / Refund ──────────────────────────────────────────────────────

    /**
     * @notice Either player can claim a refund if the match exceeds TIMEOUT.
     *         Protects players if the Vision Engine goes offline.
     * @param matchId The match to refund.
     */
    function claimRefund(uint256 matchId) external matchExists(matchId) {
        Match storage m = matches[matchId];

        require(m.state == MatchState.ACTIVE,                            "Match not active");
        require(msg.sender == m.playerA || msg.sender == m.playerB,      "Not a player in this match");
        require(block.timestamp >= m.startTime + TIMEOUT,                "Timeout not reached yet");

        m.state = MatchState.REFUNDED;

        payable(m.playerA).transfer(m.stake);
        payable(m.playerB).transfer(m.stake);

        emit MatchRefunded(matchId);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /**
     * @notice Update the oracle address (e.g. if Vision Engine wallet changes).
     */
    function setOracle(address newOracle) external onlyOwner {
        oracle = newOracle;
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    /**
     * @notice Returns the current state and details of a match.
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
}
