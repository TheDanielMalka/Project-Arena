// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArenaEscrow} from "../ArenaEscrow.sol";

/**
 * @dev Test-only helper. Its receive() always reverts, simulating a
 *      malicious contract recipient that would DoS a payout loop if the
 *      escrow used a blocking _sendEth. With _payOrCredit, this
 *      contract's credit must fall into pendingWithdrawals while every
 *      other loop recipient is paid directly.
 *
 *      Exposes thin wrappers around ArenaEscrow so the test can
 *      createMatch / joinMatch / claimRefund / cancelMatch / withdraw
 *      from this contract's address.
 */
contract RevertingReceiver {
    ArenaEscrow public immutable escrow;
    bool public acceptIncoming;

    constructor(ArenaEscrow _escrow) {
        escrow = _escrow;
    }

    // Toggle whether receive() accepts funds — lets a single test craft
    // the "fails now, succeeds on withdraw" scenario.
    function setAcceptIncoming(bool v) external {
        acceptIncoming = v;
    }

    receive() external payable {
        require(acceptIncoming, "RevertingReceiver: receive disabled");
    }

    // ── Thin wrappers ────────────────────────────────────────────────────

    function createMatch(uint8 teamSize) external payable returns (uint256) {
        return escrow.createMatch{value: msg.value}(teamSize);
    }

    function joinMatch(uint256 matchId, uint8 team) external payable {
        escrow.joinMatch{value: msg.value}(matchId, team);
    }

    function cancelMatch(uint256 matchId) external {
        escrow.cancelMatch(matchId);
    }

    function cancelWaiting(uint256 matchId) external {
        escrow.cancelWaiting(matchId);
    }

    function claimRefund(uint256 matchId) external {
        escrow.claimRefund(matchId);
    }

    function withdraw() external {
        escrow.withdraw();
    }
}
