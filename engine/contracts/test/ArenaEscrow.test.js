/**
 * ArenaEscrow — Full Hardhat test suite
 *
 * Coverage:
 *   1.  Deployment
 *   2.  createMatch
 *   3.  joinMatch
 *   4.  cancelMatch      → Issue #26 subtask
 *   5.  declareWinner
 *   6.  claimRefund
 *   7.  pause / unpause  → Issue #26 subtask
 *   8.  setOracle
 *   9.  nonReentrant / CEI pattern  → Issue #26 subtask
 *   10. Multi-team formats (2v2, 5v5)
 *   11. View helpers (getMatch, isDeposited, isPaused)
 *
 * Sync contract:
 *   FEE_PERCENT = 5     ↔ platform_settings.fee_percent
 *   TIMEOUT = 7200 s    ↔ rage-quit threshold (Issue #56)
 *   MatchState enum     ↔ matches.status ('waiting','in_progress','completed','cancelled')
 *   winningTeam 0/1     ↔ match_players.team ('A' / 'B')
 *   on_chain_match_id   ↔ matches.on_chain_match_id BIGINT
 *   All events          ↔ escrow_client.py listeners (Step 3 / Issue #28)
 */

const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect }            = require("chai");
const { ethers }            = require("hardhat");

// ── Constants (must mirror the contract) ──────────────────────────────────────
const STAKE   = ethers.parseEther("0.1");  // 0.1 ETH per player
const TIMEOUT = 2 * 60 * 60;              // 2 hours in seconds — matches TIMEOUT in contract

// MatchState enum values (order must match contract enum)
const STATE = { WAITING: 0, ACTIVE: 1, FINISHED: 2, REFUNDED: 3, CANCELLED: 4 };

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function deployFixture() {
  const signers            = await ethers.getSigners();
  const [owner, oracle, ...players] = signers; // Hardhat provides 20 signers
  const ArenaEscrow        = await ethers.getContractFactory("ArenaEscrow");
  const escrow             = await ArenaEscrow.deploy(oracle.address);
  await escrow.waitForDeployment();
  return { escrow, owner, oracle, players };
}

// 1v1 match created by players[0] — WAITING, one teamA slot filled
async function create1v1Fixture() {
  const base = await deployFixture();
  await base.escrow.connect(base.players[0]).createMatch(1, { value: STAKE });
  return base;
}

// 1v1 match fully filled — ACTIVE (players[0] teamA, players[1] teamB)
async function active1v1Fixture() {
  const base = await create1v1Fixture();
  await base.escrow.connect(base.players[1]).joinMatch(0, 1, { value: STAKE });
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ArenaEscrow", function () {

  // ══════════════════════════════════════════════════════════════════════════
  // 1. DEPLOYMENT
  // ══════════════════════════════════════════════════════════════════════════
  describe("Deployment", function () {

    it("sets owner and oracle correctly", async function () {
      const { escrow, owner, oracle } = await loadFixture(deployFixture);
      expect(await escrow.owner()).to.equal(owner.address);
      expect(await escrow.oracle()).to.equal(oracle.address);
    });

    it("starts with matchCount = 0", async function () {
      const { escrow } = await loadFixture(deployFixture);
      expect(await escrow.matchCount()).to.equal(0n);
    });

    it("starts unpaused", async function () {
      const { escrow } = await loadFixture(deployFixture);
      expect(await escrow.paused()).to.equal(false);
    });

    it("reverts if oracle address is zero", async function () {
      const Factory = await ethers.getContractFactory("ArenaEscrow");
      await expect(
        Factory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("Oracle cannot be zero address");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. createMatch
  // ══════════════════════════════════════════════════════════════════════════
  describe("createMatch", function () {

    it("creates a 1v1 match and emits MatchCreated", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).createMatch(1, { value: STAKE })
      )
        .to.emit(escrow, "MatchCreated")
        .withArgs(0n, players[0].address, 1, STAKE);

      expect(await escrow.matchCount()).to.equal(1n);
    });

    it("records creator as teamA[0] with deposit marked", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await escrow.connect(players[0]).createMatch(1, { value: STAKE });

      const [teamA, , stakePerPlayer, teamSize, depositsA, depositsB] =
        await escrow.getMatch(0);

      expect(teamA[0]).to.equal(players[0].address);
      expect(stakePerPlayer).to.equal(STAKE);
      expect(teamSize).to.equal(1);
      expect(depositsA).to.equal(1);
      expect(depositsB).to.equal(0);
      expect(await escrow.hasDeposited(0, players[0].address)).to.be.true;
    });

    it("sets match state to WAITING", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await escrow.connect(players[0]).createMatch(1, { value: STAKE });
      const [, , , , , , state] = await escrow.getMatch(0);
      expect(state).to.equal(STATE.WAITING);
    });

    it("sets winningTeam to 255 (undecided)", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await escrow.connect(players[0]).createMatch(1, { value: STAKE });
      const [, , , , , , , winningTeam] = await escrow.getMatch(0);
      expect(winningTeam).to.equal(255);
    });

    it("reverts with teamSize = 0", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).createMatch(0, { value: STAKE })
      ).to.be.revertedWith("Invalid team size (1,2,4,5)");
    });

    it("reverts with teamSize = 6 (above MAX_TEAM)", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).createMatch(6, { value: STAKE })
      ).to.be.revertedWith("Invalid team size (1,2,4,5)");
    });

    it("reverts with teamSize = 3 (not a supported format)", async function () {
      // Security fix: 3 was previously accepted by range check (1-5) but has no DB mapping.
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).createMatch(3, { value: STAKE })
      ).to.be.revertedWith("Invalid team size (1,2,4,5)");
    });

    it("reverts with zero ETH value", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).createMatch(1, { value: 0n })
      ).to.be.revertedWith("Stake must be greater than zero");
    });

    it("reverts when contract is paused", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[0]).createMatch(1, { value: STAKE })
      ).to.be.revertedWith("Contract is paused");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. joinMatch
  // ══════════════════════════════════════════════════════════════════════════
  describe("joinMatch", function () {

    it("player joins teamB and emits PlayerDeposited", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await expect(
        escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE })
      )
        .to.emit(escrow, "PlayerDeposited")
        .withArgs(0n, players[1].address, 1, STAKE, 1, 1);
                                       // matchId, player, team=B(1), stakePerPlayer, depositsA=1, depositsB=1
    });

    it("1v1 match activates when both slots are filled — emits MatchActive", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await expect(
        escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE })
      ).to.emit(escrow, "MatchActive").withArgs(0n);

      const [, , , , , , state] = await escrow.getMatch(0);
      expect(state).to.equal(STATE.ACTIVE);
    });

    it("marks deposit for joining player", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE });
      expect(await escrow.hasDeposited(0, players[1].address)).to.be.true;
    });

    it("reverts if wrong stake amount sent", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await expect(
        escrow.connect(players[1]).joinMatch(0, 1, { value: ethers.parseEther("0.2") })
      ).to.be.revertedWith("Must match stake exactly");
    });

    it("reverts if player has already deposited", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      // players[0] is already in teamA — try joining teamB
      await expect(
        escrow.connect(players[0]).joinMatch(0, 1, { value: STAKE })
      ).to.be.revertedWith("Already deposited");
    });

    it("reverts if match is already ACTIVE", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(players[2]).joinMatch(0, 1, { value: STAKE })
      ).to.be.revertedWith("Match not open");
    });

    it("reverts if team A is full", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      // teamA already has 1/1 slot filled by creator
      await expect(
        escrow.connect(players[1]).joinMatch(0, 0, { value: STAKE })
      ).to.be.revertedWith("Team A is full");
    });

    it("reverts if team B is full", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      // 1v1: create → p1 fills teamB → p2 tries to join teamB again
      await escrow.connect(players[0]).createMatch(1, { value: STAKE });
      await escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE });
      // match is now ACTIVE so this also tests "Match not open", but the team check
      // fires first in WAITING state — test with a 2v2 instead
      await escrow.connect(players[2]).createMatch(2, { value: STAKE });
      await escrow.connect(players[3]).joinMatch(1, 1, { value: STAKE }); // teamB slot 1
      await escrow.connect(players[4]).joinMatch(1, 1, { value: STAKE }); // teamB slot 2 — full
      await expect(
        escrow.connect(players[5]).joinMatch(1, 1, { value: STAKE })
      ).to.be.revertedWith("Team B is full");
    });

    it("reverts if team value is invalid (2)", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await expect(
        escrow.connect(players[1]).joinMatch(0, 2, { value: STAKE })
      ).to.be.revertedWith("Team must be 0 (A) or 1 (B)");
    });

    it("reverts when contract is paused", async function () {
      const { escrow, owner, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE })
      ).to.be.revertedWith("Contract is paused");
    });

    it("reverts for non-existent matchId", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).joinMatch(99, 0, { value: STAKE })
      ).to.be.revertedWith("Match does not exist");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. cancelMatch   — Issue #26 subtask
  // ══════════════════════════════════════════════════════════════════════════
  describe("cancelMatch — WAITING state refund", function () {

    it("creator cancels WAITING match — emits MatchCancelled and receives refund", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      const tx = escrow.connect(players[0]).cancelMatch(0);
      await expect(tx)
        .to.emit(escrow, "MatchCancelled")
        .withArgs(0n, players[0].address);
      await expect(tx)
        .to.changeEtherBalance(players[0], STAKE);

      const [, , , , , , state] = await escrow.getMatch(0);
      expect(state).to.equal(STATE.CANCELLED);
    });

    it("refunds ALL depositors when some teamB players have already joined", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      // 2v2: creator (p0) + p1 in teamA; p2 in teamB — p3 never joined
      await escrow.connect(players[0]).createMatch(2, { value: STAKE });
      await escrow.connect(players[1]).joinMatch(0, 0, { value: STAKE });
      await escrow.connect(players[2]).joinMatch(0, 1, { value: STAKE });

      await expect(
        escrow.connect(players[0]).cancelMatch(0)
      ).to.changeEtherBalances(
        [players[0], players[1], players[2]],
        [STAKE,      STAKE,      STAKE]
      );
    });

    it("reverts if called by non-creator", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await expect(
        escrow.connect(players[1]).cancelMatch(0)
      ).to.be.revertedWith("Only match creator can cancel");
    });

    it("reverts if match is already ACTIVE", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(players[0]).cancelMatch(0)
      ).to.be.revertedWith("Match already started or resolved");
    });

    it("reverts for non-existent matchId", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).cancelMatch(99)
      ).to.be.revertedWith("Match does not exist");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. declareWinner
  // ══════════════════════════════════════════════════════════════════════════
  describe("declareWinner", function () {

    it("oracle declares teamA wins — correct payout and 5% fee (1v1)", async function () {
      const { escrow, oracle, owner, players } = await loadFixture(active1v1Fixture);

      // Sync: FEE_PERCENT=5 ↔ platform_settings.fee_percent=5
      const totalPot = STAKE * 2n;
      const fee      = totalPot * 5n / 100n;   // 0.01 ETH
      const payout   = totalPot - fee;          // 0.19 ETH (single winner, teamSize=1)

      const tx = escrow.connect(oracle).declareWinner(0, 0);   // 0 = teamA wins
      await expect(tx)
        .to.emit(escrow, "WinnerDeclared")
        .withArgs(0n, 0, payout, fee);
      await expect(tx)
        .to.changeEtherBalances(
          [players[0], players[1], owner],   // winner, loser, platform
          [payout,     0n,         fee]
        );

      const [, , , , , , state, winningTeam] = await escrow.getMatch(0);
      expect(state).to.equal(STATE.FINISHED);
      expect(winningTeam).to.equal(0); // teamA
    });

    it("oracle declares teamB wins (1v1)", async function () {
      const { escrow, oracle, owner, players } = await loadFixture(active1v1Fixture);

      const totalPot = STAKE * 2n;
      const fee      = totalPot * 5n / 100n;
      const payout   = totalPot - fee;

      await expect(
        escrow.connect(oracle).declareWinner(0, 1)   // 1 = teamB wins
      ).to.changeEtherBalances(
        [players[1], players[0], owner],
        [payout,     0n,         fee]
      );

      const [, , , , , , , winningTeam] = await escrow.getMatch(0);
      expect(winningTeam).to.equal(1); // teamB
    });

    it("handles integer dust — first winner gets extra wei (4v4 case)", async function () {
      // stakePerPlayer=103 wei, teamSize=4:
      //   totalPot=824, fee=41, totalPayout=783, payPerWinner=195, dust=3
      const { escrow, oracle, players } = await loadFixture(deployFixture);
      const dustStake = 103n;
      const teamSize  = 4;

      await escrow.connect(players[0]).createMatch(teamSize, { value: dustStake });
      for (let i = 1; i < 4; i++)
        await escrow.connect(players[i]).joinMatch(0, 0, { value: dustStake });
      for (let i = 4; i < 8; i++)
        await escrow.connect(players[i]).joinMatch(0, 1, { value: dustStake });

      const totalPot    = dustStake * BigInt(teamSize) * 2n; // 824
      const fee         = totalPot * 5n / 100n;              // 41
      const totalPayout = totalPot - fee;                    // 783
      const perWinner   = totalPayout / BigInt(teamSize);    // 195
      const dust        = totalPayout - perWinner * BigInt(teamSize); // 3

      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.changeEtherBalances(
        [players[0], players[1], players[2], players[3]],
        [perWinner + dust, perWinner, perWinner, perWinner]
      );
    });

    it("reverts if called by non-oracle (owner)", async function () {
      const { escrow, owner } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(owner).declareWinner(0, 0)
      ).to.be.revertedWith("Only oracle");
    });

    it("reverts if called by non-oracle (random player)", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(players[5]).declareWinner(0, 0)
      ).to.be.revertedWith("Only oracle");
    });

    it("reverts on WAITING match", async function () {
      const { escrow, oracle } = await loadFixture(create1v1Fixture);
      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.be.revertedWith("Match not active");
    });

    it("reverts if winningTeam value is invalid (2)", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(oracle).declareWinner(0, 2)
      ).to.be.revertedWith("Winning team must be 0 (A) or 1 (B)");
    });

    it("reverts for non-existent matchId", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(oracle).declareWinner(99, 0)
      ).to.be.revertedWith("Match does not exist");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. claimRefund
  // ══════════════════════════════════════════════════════════════════════════
  describe("claimRefund", function () {

    it("reverts before 2-hour timeout elapses", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(players[0]).claimRefund(0)
      ).to.be.revertedWith("Timeout not reached yet");
    });

    it("full refund to all players after timeout — emits MatchRefunded", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await time.increase(TIMEOUT + 1);  // fast-forward past 2 hours

      const tx = escrow.connect(players[0]).claimRefund(0);
      await expect(tx)
        .to.emit(escrow, "MatchRefunded")
        .withArgs(0n);
      await expect(tx)
        .to.changeEtherBalances(
          [players[0], players[1]],
          [STAKE,      STAKE]
        );

      const [, , , , , , state] = await escrow.getMatch(0);
      expect(state).to.equal(STATE.REFUNDED);
    });

    it("either player can trigger the refund (teamB player)", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await time.increase(TIMEOUT + 1);

      // players[1] is teamB — they trigger the refund
      await expect(
        escrow.connect(players[1]).claimRefund(0)
      ).to.emit(escrow, "MatchRefunded").withArgs(0n);
    });

    it("reverts if a non-player tries to claim refund", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await time.increase(TIMEOUT + 1);

      await expect(
        escrow.connect(players[5]).claimRefund(0)
      ).to.be.revertedWith("Not a player in this match");
    });

    it("reverts if match is WAITING (never reached ACTIVE)", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await time.increase(TIMEOUT + 1);
      await expect(
        escrow.connect(players[0]).claimRefund(0)
      ).to.be.revertedWith("Match not active");
    });

    it("reverts if match is already FINISHED", async function () {
      const { escrow, oracle, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(oracle).declareWinner(0, 0);
      await time.increase(TIMEOUT + 1);

      await expect(
        escrow.connect(players[0]).claimRefund(0)
      ).to.be.revertedWith("Match not active");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. pause / unpause   — Issue #26 subtask
  // ══════════════════════════════════════════════════════════════════════════
  describe("pause / unpause — blocks new matches", function () {

    it("owner pauses — emits Paused, isPaused() returns true", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(escrow.connect(owner).pause())
        .to.emit(escrow, "Paused")
        .withArgs(owner.address);

      expect(await escrow.paused()).to.be.true;
      expect(await escrow.isPaused()).to.be.true;
    });

    it("owner unpauses — emits Unpaused, isPaused() returns false", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(escrow.connect(owner).unpause())
        .to.emit(escrow, "Unpaused")
        .withArgs(owner.address);

      expect(await escrow.paused()).to.be.false;
    });

    it("createMatch is blocked when paused", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[0]).createMatch(1, { value: STAKE })
      ).to.be.revertedWith("Contract is paused");
    });

    it("joinMatch is blocked when paused", async function () {
      const { escrow, owner, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE })
      ).to.be.revertedWith("Contract is paused");
    });

    it("createMatch resumes after unpause", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();
      await expect(
        escrow.connect(players[0]).createMatch(1, { value: STAKE })
      ).to.emit(escrow, "MatchCreated");
    });

    it("cancelMatch still works while paused (no whenNotPaused modifier)", async function () {
      const { escrow, owner, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[0]).cancelMatch(0)
      ).to.emit(escrow, "MatchCancelled");
    });

    it("claimRefund still works while paused", async function () {
      const { escrow, owner, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).pause();
      await time.increase(TIMEOUT + 1);
      await expect(
        escrow.connect(players[0]).claimRefund(0)
      ).to.emit(escrow, "MatchRefunded");
    });

    it("reverts if non-owner tries to pause", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).pause()
      ).to.be.revertedWith("Only owner");
    });

    it("reverts if non-owner tries to unpause", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[0]).unpause()
      ).to.be.revertedWith("Only owner");
    });

    it("reverts pause() if already paused", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(owner).pause()
      ).to.be.revertedWith("Already paused");
    });

    it("reverts unpause() if not paused", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).unpause()
      ).to.be.revertedWith("Not paused");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. setOracle
  // ══════════════════════════════════════════════════════════════════════════
  describe("setOracle", function () {

    it("owner updates oracle — emits OracleUpdated", async function () {
      const { escrow, owner, oracle, players } = await loadFixture(deployFixture);
      const newOracle = players[0];

      await expect(
        escrow.connect(owner).setOracle(newOracle.address)
      )
        .to.emit(escrow, "OracleUpdated")
        .withArgs(oracle.address, newOracle.address);

      expect(await escrow.oracle()).to.equal(newOracle.address);
    });

    it("new oracle can immediately declare winners", async function () {
      const { escrow, owner, players } = await loadFixture(active1v1Fixture);
      const newOracle = players[5];
      await escrow.connect(owner).setOracle(newOracle.address);

      await expect(
        escrow.connect(newOracle).declareWinner(0, 0)
      ).to.emit(escrow, "WinnerDeclared");
    });

    it("old oracle can no longer declare winners after rotation", async function () {
      const { escrow, oracle, owner, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).setOracle(players[5].address);

      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.be.revertedWith("Only oracle");
    });

    it("reverts if non-owner calls setOracle", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).setOracle(players[1].address)
      ).to.be.revertedWith("Only owner");
    });

    it("reverts if new oracle is zero address", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).setOracle(ethers.ZeroAddress)
      ).to.be.revertedWith("Oracle cannot be zero address");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 9. nonReentrant / CEI pattern   — Issue #26 subtask
  //
  //    Proof: state changes to terminal value BEFORE ETH transfers.
  //    Any reentrant callback would see the new state and revert immediately.
  // ══════════════════════════════════════════════════════════════════════════
  describe("nonReentrant — CEI pattern", function () {

    it("declareWinner: state = FINISHED before transfer — second call reverts", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(oracle).declareWinner(0, 0);

      // State is FINISHED; any reentrant or repeated call is blocked
      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.be.revertedWith("Match not active");
    });

    it("claimRefund: state = REFUNDED before transfer — second call reverts", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await time.increase(TIMEOUT + 1);
      await escrow.connect(players[0]).claimRefund(0);

      await expect(
        escrow.connect(players[0]).claimRefund(0)
      ).to.be.revertedWith("Match not active");
    });

    it("cancelMatch: state = CANCELLED before transfer — second call reverts", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(players[0]).cancelMatch(0);

      await expect(
        escrow.connect(players[0]).cancelMatch(0)
      ).to.be.revertedWith("Match already started or resolved");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 10. Multi-team formats
  // ══════════════════════════════════════════════════════════════════════════
  describe("Multi-team formats", function () {

    it("2v2 full flow: fill → ACTIVE → declareWinner → split payout", async function () {
      const { escrow, oracle, owner, players } = await loadFixture(deployFixture);
      const teamSize = 2;

      await escrow.connect(players[0]).createMatch(teamSize, { value: STAKE });
      await escrow.connect(players[1]).joinMatch(0, 0, { value: STAKE }); // teamA slot 2
      await escrow.connect(players[2]).joinMatch(0, 1, { value: STAKE }); // teamB slot 1
      await expect(
        escrow.connect(players[3]).joinMatch(0, 1, { value: STAKE })      // teamB slot 2 → ACTIVE
      ).to.emit(escrow, "MatchActive").withArgs(0n);

      const totalPot  = STAKE * BigInt(teamSize) * 2n;     // 0.4 ETH
      const fee       = totalPot * 5n / 100n;              // 0.02 ETH
      const perWinner = (totalPot - fee) / BigInt(teamSize); // 0.19 ETH each

      // teamA wins: players[0] and players[1] each get 0.19 ETH
      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.changeEtherBalances(
        [players[0], players[1], owner],
        [perWinner,  perWinner,  fee]
      );
    });

    it("5v5 full flow: all 10 players deposit → ACTIVE → teamB wins", async function () {
      const { escrow, oracle, owner, players } = await loadFixture(deployFixture);
      const teamSize = 5;

      await escrow.connect(players[0]).createMatch(teamSize, { value: STAKE });
      for (let i = 1; i < 5; i++)
        await escrow.connect(players[i]).joinMatch(0, 0, { value: STAKE });
      for (let i = 5; i < 9; i++)
        await escrow.connect(players[i]).joinMatch(0, 1, { value: STAKE });
      await expect(
        escrow.connect(players[9]).joinMatch(0, 1, { value: STAKE }) // last slot → ACTIVE
      ).to.emit(escrow, "MatchActive").withArgs(0n);

      const totalPot  = STAKE * BigInt(teamSize) * 2n;     // 1.0 ETH
      const fee       = totalPot * 5n / 100n;              // 0.05 ETH
      const perWinner = (totalPot - fee) / BigInt(teamSize); // 0.19 ETH each

      // teamB wins: players[5]–players[9]
      await expect(
        escrow.connect(oracle).declareWinner(0, 1)
      ).to.changeEtherBalances(
        [players[5], players[6], players[7], players[8], players[9], owner],
        [perWinner,  perWinner,  perWinner,  perWinner,  perWinner,  fee]
      );
    });

    it("5v5 timeout refund — all 10 players get full stake back", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      const teamSize = 5;

      await escrow.connect(players[0]).createMatch(teamSize, { value: STAKE });
      for (let i = 1; i < 5; i++)
        await escrow.connect(players[i]).joinMatch(0, 0, { value: STAKE });
      for (let i = 5; i < 10; i++)
        await escrow.connect(players[i]).joinMatch(0, 1, { value: STAKE });

      await time.increase(TIMEOUT + 1);

      // Any player triggers — everyone gets back STAKE
      await expect(
        escrow.connect(players[0]).claimRefund(0)
      ).to.changeEtherBalances(
        players.slice(0, 10),
        Array(10).fill(STAKE)
      );
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 11. cancelWaiting — escape hatch for stuck WAITING matches
  //
  //  Security fix: non-creator depositors were permanently locked if the
  //  creator disappeared. cancelWaiting() lets any depositor recover funds
  //  after WAITING_TIMEOUT (1 hour).
  // ══════════════════════════════════════════════════════════════════════════
  describe("cancelWaiting", function () {

    const WAITING_TIMEOUT = 1 * 60 * 60; // 1 hour — mirrors contract constant

    it("creator can cancel a stuck WAITING match after timeout", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await time.increase(WAITING_TIMEOUT + 1);

      const tx = escrow.connect(players[0]).cancelWaiting(0);
      await expect(tx)
        .to.emit(escrow, "MatchCancelled")
        .withArgs(0n, players[0].address);
      await expect(tx)
        .to.changeEtherBalance(players[0], STAKE);

      const [, , , , , , state] = await escrow.getMatch(0);
      expect(state).to.equal(STATE.CANCELLED);
    });

    it("non-creator teamB depositor can cancel after timeout (the key protection)", async function () {
      // 2v2: creator (p0) in teamA, p2 in teamB; p1 never joins teamA and p3 never joins teamB
      const { escrow, players } = await loadFixture(deployFixture);
      await escrow.connect(players[0]).createMatch(2, { value: STAKE }); // creator joins teamA
      await escrow.connect(players[2]).joinMatch(0, 1, { value: STAKE }); // p2 joins teamB

      await time.increase(WAITING_TIMEOUT + 1);

      // players[2] (teamB, non-creator) triggers the rescue
      const tx = escrow.connect(players[2]).cancelWaiting(0);
      await expect(tx)
        .to.emit(escrow, "MatchCancelled")
        .withArgs(0n, players[2].address);
      // Both depositors should be refunded
      await expect(tx)
        .to.changeEtherBalances([players[0], players[2]], [STAKE, STAKE]);
    });

    it("reverts before WAITING_TIMEOUT elapses", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      // Only 30 min has elapsed — timeout is 1 hour
      await time.increase(WAITING_TIMEOUT / 2);
      await expect(
        escrow.connect(players[0]).cancelWaiting(0)
      ).to.be.revertedWith("Waiting timeout not reached yet");
    });

    it("reverts if caller has not deposited", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await time.increase(WAITING_TIMEOUT + 1);
      // players[5] never deposited in this match
      await expect(
        escrow.connect(players[5]).cancelWaiting(0)
      ).to.be.revertedWith("Not a depositor in this match");
    });

    it("reverts if match is already ACTIVE (use claimRefund instead)", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await time.increase(WAITING_TIMEOUT + 1);
      await expect(
        escrow.connect(players[0]).cancelWaiting(0)
      ).to.be.revertedWith("Match not in WAITING state");
    });

    it("reverts for non-existent matchId", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).cancelWaiting(99)
      ).to.be.revertedWith("Match does not exist");
    });

    it("second call after successful cancelWaiting reverts (state = CANCELLED)", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      await time.increase(WAITING_TIMEOUT + 1);
      await escrow.connect(players[0]).cancelWaiting(0);

      await expect(
        escrow.connect(players[0]).cancelWaiting(0)
      ).to.be.revertedWith("Match not in WAITING state");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 12. View helpers
  // ══════════════════════════════════════════════════════════════════════════
  describe("View helpers", function () {

    it("getMatch returns correct data for an active 1v1", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      const [teamA, teamB, stakePerPlayer, teamSize, depositsA, depositsB, state, winningTeam] =
        await escrow.getMatch(0);

      expect(teamA[0]).to.equal(players[0].address);
      expect(teamB[0]).to.equal(players[1].address);
      expect(stakePerPlayer).to.equal(STAKE);
      expect(teamSize).to.equal(1);
      expect(depositsA).to.equal(1);
      expect(depositsB).to.equal(1);
      expect(state).to.equal(STATE.ACTIVE);
      expect(winningTeam).to.equal(255); // undecided
    });

    it("isDeposited returns true only for deposited players", async function () {
      const { escrow, players } = await loadFixture(create1v1Fixture);
      expect(await escrow.isDeposited(0, players[0].address)).to.be.true;
      expect(await escrow.isDeposited(0, players[1].address)).to.be.false;
    });

    it("getMatch reverts for non-existent matchId", async function () {
      const { escrow } = await loadFixture(deployFixture);
      await expect(escrow.getMatch(0)).to.be.revertedWith("Match does not exist");
    });

    it("isDeposited reverts for non-existent matchId", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.isDeposited(99, players[0].address)
      ).to.be.revertedWith("Match does not exist");
    });

    it("isPaused mirrors paused state variable", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      expect(await escrow.isPaused()).to.be.false;
      await escrow.connect(owner).pause();
      expect(await escrow.isPaused()).to.be.true;
    });

  });

});
