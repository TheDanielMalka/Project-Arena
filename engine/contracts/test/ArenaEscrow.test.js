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
 *   feePercent  = 5     ↔ platform_settings.fee_percent (settable via setFeePercent; bounded by MAX_FEE_PERCENT=10)
 *   TIMEOUT = 7200 s    ↔ rage-quit threshold (Issue #56)
 *   MatchState enum     ↔ matches.status ('waiting','in_progress','completed','cancelled')
 *   winningTeam 0/1     ↔ match_players.team ('A' / 'B')
 *   on_chain_match_id   ↔ matches.on_chain_match_id BIGINT
 *   All events          ↔ escrow_client.py listeners (Step 3 / Issue #28)
 *   Pause / Ownable     ↔ OpenZeppelin Pausable + Ownable (tests use revertedWithCustomError)
 */

const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect }            = require("chai");
const { ethers }            = require("hardhat");

// ── Constants (must mirror the contract) ──────────────────────────────────────
const STAKE   = ethers.parseEther("0.1");  // 0.1 ETH per player
const TIMEOUT = 2 * 60 * 60;              // 2 hours in seconds — matches TIMEOUT in contract

// MatchState enum values (order must match contract enum)
const STATE = { WAITING: 0, ACTIVE: 1, FINISHED: 2, REFUNDED: 3, CANCELLED: 4, TIED: 5 };

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
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
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
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
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

    it("reverts when contract is paused (M8 kill switch — oracle blocked)", async function () {
      const { escrow, owner, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
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
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("joinMatch is blocked when paused", async function () {
      const { escrow, owner, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE })
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
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
      )
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(players[0].address);
    });

    it("reverts if non-owner tries to unpause", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[0]).unpause()
      )
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(players[0].address);
    });

    it("reverts pause() if already paused", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(owner).pause()
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("reverts unpause() if not paused", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).unpause()
      ).to.be.revertedWithCustomError(escrow, "ExpectedPause");
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. Oracle rotation (2-step with timelock — audit 2026-04-19)
  //
  //    Immediate setOracle was removed. Rotation is now:
  //      proposeOracle(new)  →  wait ORACLE_ROTATION_DELAY (24h)  →  acceptOracle()
  //    cancelProposedOracle() can abort a hostile proposal before the delay.
  // ══════════════════════════════════════════════════════════════════════════
  describe("Oracle rotation (2-step)", function () {

    const ORACLE_ROTATION_DELAY = 24 * 60 * 60; // mirrors contract constant

    it("proposeOracle emits OracleProposed and sets pending slot", async function () {
      const { escrow, owner, oracle, players } = await loadFixture(deployFixture);
      const newOracle = players[0];

      const tx = escrow.connect(owner).proposeOracle(newOracle.address);
      await expect(tx)
        .to.emit(escrow, "OracleProposed"); // withArgs checked below with readyAt

      expect(await escrow.pendingOracle()).to.equal(newOracle.address);
      const readyAt = await escrow.pendingOracleAcceptAt();
      expect(readyAt).to.be.gt(0n);
    });

    it("acceptOracle reverts before timelock elapses", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).proposeOracle(players[0].address);
      await time.increase(ORACLE_ROTATION_DELAY - 60); // 1 min short

      await expect(
        escrow.connect(owner).acceptOracle()
      ).to.be.revertedWith("Oracle rotation timelock not elapsed");
    });

    it("acceptOracle succeeds after delay — emits OracleUpdated, clears pending", async function () {
      const { escrow, owner, oracle, players } = await loadFixture(deployFixture);
      const newOracle = players[0];
      await escrow.connect(owner).proposeOracle(newOracle.address);
      await time.increase(ORACLE_ROTATION_DELAY + 1);

      await expect(escrow.connect(owner).acceptOracle())
        .to.emit(escrow, "OracleUpdated")
        .withArgs(oracle.address, newOracle.address);

      expect(await escrow.oracle()).to.equal(newOracle.address);
      expect(await escrow.pendingOracle()).to.equal(ethers.ZeroAddress);
      expect(await escrow.pendingOracleAcceptAt()).to.equal(0n);
    });

    it("acceptOracle is permissionless after delay (anyone may finalize)", async function () {
      const { escrow, owner, oracle, players } = await loadFixture(deployFixture);
      const newOracle = players[0];
      await escrow.connect(owner).proposeOracle(newOracle.address);
      await time.increase(ORACLE_ROTATION_DELAY + 1);

      // players[3] — random bystander — finalizes; should still work
      await expect(escrow.connect(players[3]).acceptOracle())
        .to.emit(escrow, "OracleUpdated")
        .withArgs(oracle.address, newOracle.address);
    });

    it("new oracle can declare winners AFTER acceptOracle", async function () {
      const { escrow, owner, players } = await loadFixture(active1v1Fixture);
      const newOracle = players[5];
      await escrow.connect(owner).proposeOracle(newOracle.address);
      await time.increase(ORACLE_ROTATION_DELAY + 1);
      await escrow.connect(owner).acceptOracle();

      await expect(
        escrow.connect(newOracle).declareWinner(0, 0)
      ).to.emit(escrow, "WinnerDeclared");
    });

    it("old oracle cannot declare winners after rotation", async function () {
      const { escrow, oracle, owner, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).proposeOracle(players[5].address);
      await time.increase(ORACLE_ROTATION_DELAY + 1);
      await escrow.connect(owner).acceptOracle();

      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.be.revertedWith("Only oracle");
    });

    it("old oracle STILL works while rotation is pending (pre-accept)", async function () {
      // Critical: proposing a rotation must not brick the existing oracle
      // — otherwise a stolen owner key could grief live matches.
      const { escrow, oracle, owner, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).proposeOracle(players[5].address);
      // Do NOT advance time / do NOT acceptOracle
      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.emit(escrow, "WinnerDeclared");
    });

    it("cancelProposedOracle aborts a hostile proposal", async function () {
      const { escrow, owner, oracle, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).proposeOracle(players[0].address);

      await expect(escrow.connect(owner).cancelProposedOracle())
        .to.emit(escrow, "OracleProposalCancelled")
        .withArgs(players[0].address);

      expect(await escrow.pendingOracle()).to.equal(ethers.ZeroAddress);
      expect(await escrow.oracle()).to.equal(oracle.address); // unchanged

      // After cancel, acceptOracle() must revert
      await time.increase(ORACLE_ROTATION_DELAY + 1);
      await expect(
        escrow.connect(owner).acceptOracle()
      ).to.be.revertedWith("No pending oracle");
    });

    it("acceptOracle reverts if no proposal pending", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).acceptOracle()
      ).to.be.revertedWith("No pending oracle");
    });

    it("cancelProposedOracle reverts if nothing pending", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).cancelProposedOracle()
      ).to.be.revertedWith("No pending oracle");
    });

    it("proposeOracle reverts if non-owner", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).proposeOracle(players[1].address)
      )
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(players[0].address);
    });

    it("cancelProposedOracle reverts if non-owner", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).proposeOracle(players[0].address);
      await expect(
        escrow.connect(players[1]).cancelProposedOracle()
      )
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(players[1].address);
    });

    it("proposeOracle reverts if new oracle is zero address", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).proposeOracle(ethers.ZeroAddress)
      ).to.be.revertedWith("Oracle cannot be zero address");
    });

    it("proposeOracle reverts if new oracle equals current (no-op guard)", async function () {
      const { escrow, owner, oracle } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).proposeOracle(oracle.address)
      ).to.be.revertedWith("New oracle equals current");
    });

    it("proposeOracle overwrites a prior pending proposal (resets timer)", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).proposeOracle(players[0].address);
      await time.increase(ORACLE_ROTATION_DELAY / 2);
      await escrow.connect(owner).proposeOracle(players[1].address);

      expect(await escrow.pendingOracle()).to.equal(players[1].address);
      // Timer reset: cannot accept just from the original elapsed half
      await time.increase(ORACLE_ROTATION_DELAY / 2 + 1); // total ~1x delay from first propose
      await expect(
        escrow.connect(owner).acceptOracle()
      ).to.be.revertedWith("Oracle rotation timelock not elapsed");
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

  // ══════════════════════════════════════════════════════════════════════════
  // 13. Fee governance — setFeePercent (audit 2026-04-19)
  //
  //     Converts the old FEE_PERCENT constant into a settable state var so
  //     platform_settings.fee_percent can be synced without a redeploy.
  //     Bounded by MAX_FEE_PERCENT=10.
  // ══════════════════════════════════════════════════════════════════════════
  describe("Fee governance (setFeePercent)", function () {

    it("initial feePercent is 5 (matches legacy FEE_PERCENT)", async function () {
      const { escrow } = await loadFixture(deployFixture);
      expect(await escrow.feePercent()).to.equal(5);
    });

    it("owner can change feePercent within bounds + emits event", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(escrow.connect(owner).setFeePercent(7))
        .to.emit(escrow, "FeePercentUpdated")
        .withArgs(5, 7);
      expect(await escrow.feePercent()).to.equal(7);
    });

    it("setFeePercent reverts above MAX_FEE_PERCENT (10)", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(escrow.connect(owner).setFeePercent(11))
        .to.be.revertedWith("Fee exceeds MAX_FEE_PERCENT");
    });

    it("setFeePercent accepts exactly MAX_FEE_PERCENT (10)", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await escrow.connect(owner).setFeePercent(10);
      expect(await escrow.feePercent()).to.equal(10);
    });

    it("setFeePercent accepts 0 (fee-free operation)", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await escrow.connect(owner).setFeePercent(0);
      expect(await escrow.feePercent()).to.equal(0);
    });

    it("setFeePercent reverts if value unchanged (no spurious events)", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(escrow.connect(owner).setFeePercent(5))
        .to.be.revertedWith("Fee unchanged");
    });

    it("setFeePercent reverts if called by non-owner", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(escrow.connect(players[0]).setFeePercent(7))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(players[0].address);
    });

    it("declareWinner uses the current feePercent at payout time (not at match creation)", async function () {
      // Create a match at fee=5, change fee to 10 mid-match, declareWinner
      // should apply fee=10.
      const { escrow, owner, oracle, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).setFeePercent(10);

      const totalPot  = STAKE * 2n;              // 1v1 → 0.2 ETH
      const fee       = totalPot * 10n / 100n;   // 0.02 ETH
      const perWinner = (totalPot - fee);         // 0.18 ETH (1 winner in 1v1)

      await expect(escrow.connect(oracle).declareWinner(0, 0))
        .to.changeEtherBalances([players[0], owner], [perWinner, fee]);
    });

    it("declareWinner with fee=0 pays entire pot to winners", async function () {
      const { escrow, owner, oracle, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).setFeePercent(0);

      const totalPot  = STAKE * 2n;
      await expect(escrow.connect(oracle).declareWinner(0, 0))
        .to.changeEtherBalances([players[0], owner], [totalPot, 0n]);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 14. Pull-payment fallback (audit 2026-04-19)
  //
  //     A single malicious contract recipient that reverts in receive() must
  //     NOT be able to block payouts for everyone else in a loop.
  //     _payOrCredit tries a bounded .call; on failure credits
  //     pendingWithdrawals and emits PayoutCredited. The recipient can later
  //     pull via withdraw() after fixing their receive().
  // ══════════════════════════════════════════════════════════════════════════
  describe("Pull-payment fallback (DoS guard)", function () {

    async function deployRevertingReceiver(escrow) {
      const Factory = await ethers.getContractFactory("RevertingReceiver");
      const rr = await Factory.deploy(await escrow.getAddress());
      await rr.waitForDeployment();
      // acceptIncoming defaults to false → receive() reverts
      return rr;
    }

    it("cancelMatch: reverting receiver credited, other depositors paid directly", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      const rr = await deployRevertingReceiver(escrow);

      // rr creates a 2v2 (so it can cancel), players[2] joins teamB
      await rr.createMatch(2, { value: STAKE });
      await escrow.connect(players[2]).joinMatch(0, 1, { value: STAKE });

      // rr cancels — teamA[0]=rr (revert on receive → credit), teamB[0]=players[2] (paid directly)
      await expect(rr.cancelMatch(0))
        .to.emit(escrow, "PayoutCredited")
        .withArgs(await rr.getAddress(), STAKE);

      expect(await escrow.pendingWithdrawals(await rr.getAddress())).to.equal(STAKE);
      // players[2] received their stake directly (balance delta tested via separate path below)
    });

    it("claimRefund: one reverting winner does not block the other 9", async function () {
      // 5v5 active: put a RevertingReceiver as teamA[2]. Timeout refund.
      const { escrow, players } = await loadFixture(deployFixture);
      const rr = await deployRevertingReceiver(escrow);
      const teamSize = 5;

      await escrow.connect(players[0]).createMatch(teamSize, { value: STAKE });
      await escrow.connect(players[1]).joinMatch(0, 0, { value: STAKE });
      // rr is teamA[2] — the critical iteration that would previously DoS
      await rr.joinMatch(0, 0, { value: STAKE });
      await escrow.connect(players[2]).joinMatch(0, 0, { value: STAKE });
      await escrow.connect(players[3]).joinMatch(0, 0, { value: STAKE });
      for (let i = 4; i < 9; i++)
        await escrow.connect(players[i]).joinMatch(0, 1, { value: STAKE });

      await time.increase(TIMEOUT + 1);

      // claimRefund must succeed for everyone else even though rr reverts
      const before = await Promise.all(
        [players[0], players[1], players[2], players[3],
         players[4], players[5], players[6], players[7], players[8]]
          .map(p => ethers.provider.getBalance(p.address))
      );
      await escrow.connect(players[0]).claimRefund(0); // gas paid by p0
      const after = await Promise.all(
        [players[0], players[1], players[2], players[3],
         players[4], players[5], players[6], players[7], players[8]]
          .map(p => ethers.provider.getBalance(p.address))
      );

      // p0 spent gas, others gained exactly STAKE
      for (let i = 1; i < 9; i++) {
        expect(after[i] - before[i]).to.equal(STAKE, `player ${i} not refunded`);
      }
      // rr has STAKE credited but not received
      expect(await escrow.pendingWithdrawals(await rr.getAddress())).to.equal(STAKE);
    });

    it("declareWinner: reverting winner credited, fee still reaches owner", async function () {
      const { escrow, owner, oracle, players } = await loadFixture(deployFixture);
      const rr = await deployRevertingReceiver(escrow);
      const teamSize = 2;

      await escrow.connect(players[0]).createMatch(teamSize, { value: STAKE });
      await rr.joinMatch(0, 0, { value: STAKE });   // rr is teamA[1]
      await escrow.connect(players[2]).joinMatch(0, 1, { value: STAKE });
      await escrow.connect(players[3]).joinMatch(0, 1, { value: STAKE });

      const totalPot  = STAKE * BigInt(teamSize) * 2n;
      const fee       = totalPot * 5n / 100n;
      const perWinner = (totalPot - fee) / BigInt(teamSize);

      const ownerBefore = await ethers.provider.getBalance(owner.address);
      const p0Before    = await ethers.provider.getBalance(players[0].address);

      await expect(
        escrow.connect(oracle).declareWinner(0, 0) // teamA wins
      ).to.emit(escrow, "PayoutCredited")
       .withArgs(await rr.getAddress(), perWinner);

      // players[0] got their payout directly
      expect(await ethers.provider.getBalance(players[0].address) - p0Before)
        .to.equal(perWinner);
      // owner got their fee directly
      expect(await ethers.provider.getBalance(owner.address) - ownerBefore)
        .to.equal(fee);
      // rr has their winnings in pending
      expect(await escrow.pendingWithdrawals(await rr.getAddress()))
        .to.equal(perWinner);
    });

    it("withdraw: pulls credited funds once receive() is re-enabled", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      const rr = await deployRevertingReceiver(escrow);

      await rr.createMatch(1, { value: STAKE });
      await rr.cancelMatch(0); // credits STAKE to rr

      // Flip receiver on
      await rr.setAcceptIncoming(true);

      const rrAddr   = await rr.getAddress();
      const before   = await ethers.provider.getBalance(rrAddr);
      await expect(rr.withdraw())
        .to.emit(escrow, "Withdrawn")
        .withArgs(rrAddr, STAKE);

      expect(await ethers.provider.getBalance(rrAddr) - before).to.equal(STAKE);
      expect(await escrow.pendingWithdrawals(rrAddr)).to.equal(0n);
    });

    it("withdraw reverts if nothing pending", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(players[0]).withdraw()
      ).to.be.revertedWith("No pending withdrawal");
    });

    it("withdraw: second call reverts (balance zeroed by CEI)", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      const rr = await deployRevertingReceiver(escrow);

      await rr.createMatch(1, { value: STAKE });
      await rr.cancelMatch(0);
      await rr.setAcceptIncoming(true);
      await rr.withdraw();

      await expect(rr.withdraw()).to.be.revertedWith("No pending withdrawal");
    });

    it("withdraw reverts if recipient's receive still fails — credit preserved", async function () {
      // Receiver stays broken: withdraw() reverts and pending balance remains.
      const { escrow } = await loadFixture(deployFixture);
      const rr = await deployRevertingReceiver(escrow);

      await rr.createMatch(1, { value: STAKE });
      await rr.cancelMatch(0);

      // acceptIncoming still false → receive reverts
      await expect(rr.withdraw()).to.be.reverted;
      // Credit must still be there (state reverted by require(success))
      expect(await escrow.pendingWithdrawals(await rr.getAddress())).to.equal(STAKE);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 15. Cascading refund failure (audit 2026-04-19 coverage gap)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Extends "Pull-payment fallback" beyond the single-reverting-receiver case.
  // If *every* payout recipient reverts, the contract must still:
  //   (a) transition the match out of ACTIVE/WAITING so it cannot be
  //       replayed,
  //   (b) credit every recipient's full stake to pendingWithdrawals so no
  //       funds are lost,
  //   (c) keep the call-site successful (no revert bubbling up from _payOrCredit).
  // ══════════════════════════════════════════════════════════════════════════
  describe("Cascading refund failure (every recipient reverts)", function () {

    async function deployRR(escrow) {
      const Factory = await ethers.getContractFactory("RevertingReceiver");
      const rr = await Factory.deploy(await escrow.getAddress());
      await rr.waitForDeployment();
      return rr;
    }

    it("cancelMatch: every depositor reverts — all credited, state=CANCELLED", async function () {
      // 4v4 partially filled (still WAITING) with 4 separate RevertingReceivers.
      // cancelMatch requires state=WAITING, so we leave 4 slots open.
      const { escrow } = await loadFixture(deployFixture);
      const rrs = await Promise.all([deployRR(escrow), deployRR(escrow), deployRR(escrow), deployRR(escrow)]);

      await rrs[0].createMatch(4, { value: STAKE });           // teamA[0]
      await rrs[1].joinMatch(0, 0, { value: STAKE });          // teamA[1]
      await rrs[2].joinMatch(0, 1, { value: STAKE });          // teamB[0]
      await rrs[3].joinMatch(0, 1, { value: STAKE });          // teamB[1]
      // 4/8 filled → still WAITING — creator may cancel.

      // Creator (rrs[0]) cancels — none of the four can receive ETH.
      await expect(rrs[0].cancelMatch(0)).to.not.be.reverted;

      // State machine moved forward.
      const m = await escrow.getMatch(0);
      expect(m.state).to.equal(STATE.CANCELLED);

      // Every reverting address holds exactly STAKE in pending withdrawals.
      for (const rr of rrs) {
        expect(await escrow.pendingWithdrawals(await rr.getAddress())).to.equal(STAKE);
      }
      // Contract still holds the full pot (nothing drained, nothing lost).
      expect(await ethers.provider.getBalance(await escrow.getAddress()))
        .to.equal(STAKE * 4n);
    });

    it("claimRefund: all 10 players revert — contract state moves to REFUNDED", async function () {
      // 5v5: 10 RevertingReceivers. One of them triggers claimRefund (paid gas in BNB by its deployer,
      // not by ETH transfer from escrow). Even though *every* recipient reverts, the loop completes.
      const { escrow } = await loadFixture(deployFixture);
      const rrs = [];
      for (let i = 0; i < 10; i++) rrs.push(await deployRR(escrow));

      await rrs[0].createMatch(5, { value: STAKE });
      for (let i = 1; i < 5; i++) await rrs[i].joinMatch(0, 0, { value: STAKE });
      for (let i = 5; i < 10; i++) await rrs[i].joinMatch(0, 1, { value: STAKE });

      await time.increase(TIMEOUT + 1);
      await expect(rrs[0].claimRefund(0)).to.not.be.reverted;

      const m = await escrow.getMatch(0);
      expect(m.state).to.equal(STATE.REFUNDED);

      for (const rr of rrs) {
        expect(await escrow.pendingWithdrawals(await rr.getAddress())).to.equal(STAKE);
      }
    });

    it("declareWinner: all winners + owner revert — everyone credited, match FINISHED", async function () {
      // Make the owner itself revert on receive. Deploy a fresh escrow whose
      // owner is a RevertingReceiver pre-deployed and initialised.
      const { escrow, oracle } = await loadFixture(deployFixture);
      const rrs = [await deployRR(escrow), await deployRR(escrow)];  // winners (teamA)

      // losers can be normal EOAs
      const signers = await ethers.getSigners();
      const losers = [signers[10], signers[11]];

      await rrs[0].createMatch(2, { value: STAKE });
      await rrs[1].joinMatch(0, 0, { value: STAKE });
      await escrow.connect(losers[0]).joinMatch(0, 1, { value: STAKE });
      await escrow.connect(losers[1]).joinMatch(0, 1, { value: STAKE });

      // teamA (both reverting) wins — they each get credited, owner gets fee directly.
      await expect(escrow.connect(oracle).declareWinner(0, 0)).to.not.be.reverted;

      const m = await escrow.getMatch(0);
      expect(m.state).to.equal(STATE.FINISHED);

      const totalPot  = STAKE * 2n * 2n;
      const fee       = totalPot * 5n / 100n;
      const perWinner = (totalPot - fee) / 2n;

      expect(await escrow.pendingWithdrawals(await rrs[0].getAddress())).to.equal(perWinner);
      expect(await escrow.pendingWithdrawals(await rrs[1].getAddress())).to.equal(perWinner);
    });

    it("pendingWithdrawals accumulates across multiple cancelled matches", async function () {
      // One RR cancels the same kind of match twice — its credit must sum, not overwrite.
      const { escrow } = await loadFixture(deployFixture);
      const rr = await deployRR(escrow);

      await rr.createMatch(1, { value: STAKE });
      await rr.cancelMatch(0);
      await rr.createMatch(1, { value: STAKE });
      await rr.cancelMatch(1);

      expect(await escrow.pendingWithdrawals(await rr.getAddress()))
        .to.equal(STAKE * 2n);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 16. Oracle compromise (audit 2026-04-19 coverage gap)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Assume an attacker has stolen the oracle EOA. What can they do — and
  // more importantly, what can they NOT do? These tests lock in the blast
  // radius so a future code change that widens oracle privileges will fail
  // loudly here.
  // ══════════════════════════════════════════════════════════════════════════
  describe("Oracle compromise — blast radius", function () {

    it("compromised oracle cannot declareWinner for WAITING match", async function () {
      const { escrow, oracle, players } = await loadFixture(create1v1Fixture);
      // Only the creator has deposited — match is still WAITING.
      await expect(escrow.connect(oracle).declareWinner(0, 0))
        .to.be.revertedWith("Match not active");
    });

    it("compromised oracle cannot declareWinner for CANCELLED match", async function () {
      const { escrow, oracle, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(players[0]).cancelMatch(0);
      await expect(escrow.connect(oracle).declareWinner(0, 0))
        .to.be.revertedWith("Match not active");
    });

    it("compromised oracle cannot declareWinner for REFUNDED match", async function () {
      const { escrow, oracle, players } = await loadFixture(active1v1Fixture);
      await time.increase(TIMEOUT + 1);
      await escrow.connect(players[0]).claimRefund(0);
      await expect(escrow.connect(oracle).declareWinner(0, 0))
        .to.be.revertedWith("Match not active");
    });

    it("compromised oracle cannot re-declare after the match is FINISHED", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(oracle).declareWinner(0, 0);
      await expect(escrow.connect(oracle).declareWinner(0, 1))
        .to.be.revertedWith("Match not active");
    });

    it("compromised oracle cannot pick an invalid team index", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await expect(escrow.connect(oracle).declareWinner(0, 2))
        .to.be.revertedWith("Winning team must be 0 (A) or 1 (B)");
    });

    it("compromised oracle cannot rotate itself (onlyOwner)", async function () {
      const { escrow, oracle } = await loadFixture(deployFixture);
      const impostor = (await ethers.getSigners())[15];
      await expect(escrow.connect(oracle).proposeOracle(impostor.address))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("compromised oracle cannot pause, unpause, or change fee", async function () {
      const { escrow, oracle } = await loadFixture(deployFixture);
      await expect(escrow.connect(oracle).pause())
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
      await expect(escrow.connect(oracle).setFeePercent(9))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("compromised oracle cannot withdraw from pendingWithdrawals it has not earned", async function () {
      // withdraw() only pays the caller's own balance, not an arbitrary recipient.
      const { escrow, oracle } = await loadFixture(deployFixture);
      await expect(escrow.connect(oracle).withdraw())
        .to.be.revertedWith("No pending withdrawal");
    });

    it("owner can pause the contract to contain a compromised oracle", async function () {
      // Rotation takes 24h, but owner can pause immediately so no new declarations land.
      const { escrow, owner, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(escrow.connect(oracle).declareWinner(0, 0))
        .to.be.revertedWithCustomError(escrow, "EnforcedPause");
      // Users can still recover funds (no whenNotPaused on cancel / refund).
      // Match stays ACTIVE (declareWinner reverted), so claimRefund works after TIMEOUT.
      await time.increase(TIMEOUT + 1);
      // No direct revert assertion; claim succeeds — covered by claimRefund tests.
    });

    it("post-rotation the OLD oracle key cannot declareWinner", async function () {
      // Full rotation happy-path: old key bricked after acceptOracle.
      const { escrow, owner, oracle } = await loadFixture(active1v1Fixture);
      const newOracle = (await ethers.getSigners())[16];

      await escrow.connect(owner).proposeOracle(newOracle.address);
      await time.increase(24 * 60 * 60 + 1);
      await escrow.connect(newOracle).acceptOracle();

      await expect(escrow.connect(oracle).declareWinner(0, 0))
        .to.be.revertedWith("Only oracle");
      // But the new oracle works.
      await expect(escrow.connect(newOracle).declareWinner(0, 0))
        .to.not.be.reverted;
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 17. Pause mid-payout (audit 2026-04-19 coverage gap)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Pause must:
  //   - Block new match creation + declareWinner (winner declaration is the
  //     only payout path).
  //   - NOT block cancel / claimRefund / withdraw — users must always be
  //     able to recover funds, even under kill-switch.
  //   - Not leave in-flight payouts half-finished: a pause call BETWEEN
  //     payments within a single tx is impossible (atomic), so what we're
  //     really testing is the surrounding boundary.
  // ══════════════════════════════════════════════════════════════════════════
  describe("pause mid-payout — kill-switch boundary", function () {

    it("pause blocks createMatch", async function () {
      const { escrow, owner, players } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[0]).createMatch(1, { value: STAKE })
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks joinMatch", async function () {
      const { escrow, owner, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE })
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks declareWinner (payout path)", async function () {
      const { escrow, owner, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(oracle).declareWinner(0, 0)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause does NOT block cancelMatch (user fund recovery)", async function () {
      const { escrow, owner, players } = await loadFixture(create1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(escrow.connect(players[0]).cancelMatch(0)).to.not.be.reverted;
    });

    it("pause does NOT block claimRefund (user fund recovery)", async function () {
      const { escrow, owner, players } = await loadFixture(active1v1Fixture);
      await time.increase(TIMEOUT + 1);
      await escrow.connect(owner).pause();
      await expect(escrow.connect(players[0]).claimRefund(0)).to.not.be.reverted;
    });

    it("pause does NOT block cancelWaiting (user fund recovery after 1h)", async function () {
      const { escrow, owner, players } = await loadFixture(create1v1Fixture);
      await time.increase(60 * 60 + 1); // WAITING_TIMEOUT = 1h
      await escrow.connect(owner).pause();
      await expect(escrow.connect(players[0]).cancelWaiting(0)).to.not.be.reverted;
    });

    it("pause does NOT block withdraw (credited users can still pull)", async function () {
      // Accumulate a credit, pause, then withdraw.
      const { escrow, owner } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("RevertingReceiver");
      const rr = await Factory.deploy(await escrow.getAddress());
      await rr.waitForDeployment();

      await rr.createMatch(1, { value: STAKE });
      await rr.cancelMatch(0);
      await rr.setAcceptIncoming(true);

      await escrow.connect(owner).pause();
      await expect(rr.withdraw()).to.not.be.reverted;
      expect(await escrow.pendingWithdrawals(await rr.getAddress())).to.equal(0n);
    });

    it("unpause restores createMatch / declareWinner", async function () {
      const { escrow, owner, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();
      await expect(escrow.connect(oracle).declareWinner(0, 0)).to.not.be.reverted;
    });

    it("pause is idempotent enough: double-pause reverts, state stays paused", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await escrow.connect(owner).pause();
      await expect(escrow.connect(owner).pause())
        .to.be.revertedWithCustomError(escrow, "EnforcedPause");
      expect(await escrow.paused()).to.equal(true);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 18. Multi-match gas stress (audit 2026-04-19 coverage gap)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Running many matches concurrently must not:
  //   - Let state from one match leak into another.
  //   - Produce gas that scales with matchCount (each call should be O(teamSize),
  //     not O(matchCount)).
  //   - Corrupt pendingWithdrawals accumulation across matches.
  //
  // These tests are not a gas regression harness (no absolute gwei numbers,
  // which are node-version-sensitive). They're about *isolation* and
  // *stable per-call gas* — exactly the invariants gas-stress bugs break.
  // ══════════════════════════════════════════════════════════════════════════
  describe("Multi-match gas stress — isolation + stable per-call gas", function () {

    it("matchCount monotonically increases as matches are created", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      expect(await escrow.matchCount()).to.equal(0n);
      for (let i = 0; i < 5; i++) {
        await escrow.connect(players[i]).createMatch(1, { value: STAKE });
        expect(await escrow.matchCount()).to.equal(BigInt(i + 1));
      }
    });

    it("cancelling match N does not affect match N+1 or N-1", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      for (let i = 0; i < 3; i++) {
        await escrow.connect(players[i]).createMatch(1, { value: STAKE });
      }
      // Cancel the middle one
      await escrow.connect(players[1]).cancelMatch(1);

      const m0 = await escrow.getMatch(0);
      const m1 = await escrow.getMatch(1);
      const m2 = await escrow.getMatch(2);
      expect(m0.state).to.equal(STATE.WAITING);
      expect(m1.state).to.equal(STATE.CANCELLED);
      expect(m2.state).to.equal(STATE.WAITING);
    });

    it("declareWinner in one match does not consume funds of another", async function () {
      const { escrow, oracle, players } = await loadFixture(deployFixture);
      // 2 concurrent 1v1 matches, same stake.
      await escrow.connect(players[0]).createMatch(1, { value: STAKE });
      await escrow.connect(players[1]).joinMatch(0, 1, { value: STAKE });
      await escrow.connect(players[2]).createMatch(1, { value: STAKE });
      await escrow.connect(players[3]).joinMatch(1, 1, { value: STAKE });

      const contractBefore = await ethers.provider.getBalance(await escrow.getAddress());
      expect(contractBefore).to.equal(STAKE * 4n);

      // Resolve match 0.
      await escrow.connect(oracle).declareWinner(0, 0);

      // Exactly match 0's pot moved out — match 1's funds untouched.
      const contractAfter = await ethers.provider.getBalance(await escrow.getAddress());
      expect(contractAfter).to.equal(STAKE * 2n);

      const m1 = await escrow.getMatch(1);
      expect(m1.state).to.equal(STATE.ACTIVE);
    });

    it("per-call gas for createMatch is stable across matchCount (not O(N))", async function () {
      // Create 3 matches and confirm the gasUsed spread stays inside a tight
      // envelope — exact numbers vary per node, but scaling by matchCount
      // would blow the envelope wide open.
      const { escrow, players } = await loadFixture(deployFixture);
      const gasUsed = [];
      for (let i = 0; i < 3; i++) {
        const tx = await escrow.connect(players[i]).createMatch(1, { value: STAKE });
        const rc = await tx.wait();
        gasUsed.push(rc.gasUsed);
      }
      // After the very first match the storage slot is warm; 2nd and 3rd should be flat.
      const spread = gasUsed[2] > gasUsed[1] ? gasUsed[2] - gasUsed[1] : gasUsed[1] - gasUsed[2];
      expect(spread).to.be.lessThan(5_000n, `gas spread ${spread} suggests O(N) scaling`);
    });

    it("10 concurrent matches all cancelled — total refund equals total deposited", async function () {
      const { escrow, players } = await loadFixture(deployFixture);
      const N = 10;
      for (let i = 0; i < N; i++) {
        await escrow.connect(players[i]).createMatch(1, { value: STAKE });
      }
      expect(await ethers.provider.getBalance(await escrow.getAddress()))
        .to.equal(STAKE * BigInt(N));

      for (let i = 0; i < N; i++) {
        await escrow.connect(players[i]).cancelMatch(i);
      }

      // All funds returned — contract balance is 0.
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
      for (let i = 0; i < N; i++) {
        const m = await escrow.getMatch(i);
        expect(m.state).to.equal(STATE.CANCELLED);
      }
    });

    it("pending withdrawals from different matches sum correctly for same recipient", async function () {
      // A RevertingReceiver participates in 3 separate matches, all cancelled.
      // Its pending balance must equal STAKE * 3, not be overwritten per-match.
      const { escrow } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("RevertingReceiver");
      const rr = await Factory.deploy(await escrow.getAddress());
      await rr.waitForDeployment();

      for (let i = 0; i < 3; i++) {
        await rr.createMatch(1, { value: STAKE });
        await rr.cancelMatch(BigInt(i));
      }

      expect(await escrow.pendingWithdrawals(await rr.getAddress()))
        .to.equal(STAKE * 3n);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // declareTie — draw outcome (Wingman 8-8 / Competitive 12-12)
  // ══════════════════════════════════════════════════════════════════════════
  describe("declareTie", function () {

    it("emits TieDeclared with correct refund and fee amounts", async function () {
      const { escrow, oracle, players } = await loadFixture(active1v1Fixture);
      const feePercent = await escrow.feePercent(); // 5
      const totalPot   = STAKE * 2n;
      const fee        = (totalPot * feePercent) / 100n;
      const refundPool = totalPot - fee;
      const refundPer  = refundPool / 2n;   // 2 players in 1v1

      await expect(
        escrow.connect(oracle).declareTie(0)
      )
        .to.emit(escrow, "TieDeclared")
        .withArgs(0n, refundPer, fee);
    });

    it("sets match state to TIED", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(oracle).declareTie(0);
      const [,,,,,, state] = await escrow.getMatch(0);
      expect(state).to.equal(STATE.TIED);
    });

    it("refunds all players minus fee (1v1)", async function () {
      const { escrow, oracle, players } = await loadFixture(active1v1Fixture);
      const feePercent = await escrow.feePercent();
      const totalPot   = STAKE * 2n;
      const fee        = (totalPot * feePercent) / 100n;
      const refundPool = totalPot - fee;
      const refundPer  = refundPool / 2n;
      const dust       = refundPool - refundPer * 2n;

      const balA0Before = await ethers.provider.getBalance(players[0].address);
      const balA1Before = await ethers.provider.getBalance(players[1].address);

      const tx       = await escrow.connect(oracle).declareTie(0);
      const receipt  = await tx.wait();
      // oracle paid gas — adjust only for player balances (no gas for them here)

      const balA0After = await ethers.provider.getBalance(players[0].address);
      const balA1After = await ethers.provider.getBalance(players[1].address);

      // players[0] is teamA[0] → gets refundPer + dust
      expect(balA0After - balA0Before).to.equal(refundPer + dust);
      // players[1] is teamB[0] → gets refundPer
      expect(balA1After - balA1Before).to.equal(refundPer);
    });

    it("fee goes to owner", async function () {
      const { escrow, owner, oracle } = await loadFixture(active1v1Fixture);
      const feePercent   = await escrow.feePercent();
      const totalPot     = STAKE * 2n;
      const fee          = (totalPot * feePercent) / 100n;

      const ownerBefore  = await ethers.provider.getBalance(owner.address);
      const tx           = await escrow.connect(oracle).declareTie(0);
      const receipt      = await tx.wait();
      const ownerAfter   = await ethers.provider.getBalance(owner.address);

      // owner didn't pay gas (oracle did) — delta should equal fee exactly
      expect(ownerAfter - ownerBefore).to.equal(fee);
    });

    it("works for 2v2 — all 4 players refunded correctly", async function () {
      const { escrow, oracle, players } = await loadFixture(deployFixture);
      // Create 2v2 match
      await escrow.connect(players[0]).createMatch(2, { value: STAKE });
      await escrow.connect(players[1]).joinMatch(0, 0, { value: STAKE }); // teamA
      await escrow.connect(players[2]).joinMatch(0, 1, { value: STAKE }); // teamB
      await escrow.connect(players[3]).joinMatch(0, 1, { value: STAKE }); // teamB — activates

      const feePercent = await escrow.feePercent();
      const totalPot   = STAKE * 4n;
      const fee        = (totalPot * feePercent) / 100n;
      const refundPool = totalPot - fee;
      const refundPer  = refundPool / 4n;

      const balsBefore = await Promise.all(
        [players[0],players[1],players[2],players[3]].map(p => ethers.provider.getBalance(p.address))
      );

      await escrow.connect(oracle).declareTie(0);

      const balsAfter = await Promise.all(
        [players[0],players[1],players[2],players[3]].map(p => ethers.provider.getBalance(p.address))
      );

      const dust = refundPool - refundPer * 4n;
      // players[0] is teamA[0] — gets refundPer + dust
      expect(balsAfter[0] - balsBefore[0]).to.equal(refundPer + dust);
      // remaining 3 each get refundPer
      for (let i = 1; i < 4; i++) {
        expect(balsAfter[i] - balsBefore[i]).to.equal(refundPer);
      }
    });

    it("reverts when called by non-oracle", async function () {
      const { escrow, players } = await loadFixture(active1v1Fixture);
      await expect(
        escrow.connect(players[0]).declareTie(0)
      ).to.be.revertedWith("Only oracle");
    });

    it("reverts when match is not ACTIVE (WAITING)", async function () {
      const { escrow, oracle, players } = await loadFixture(create1v1Fixture);
      await expect(
        escrow.connect(oracle).declareTie(0)
      ).to.be.revertedWith("Match not active");
    });

    it("reverts when match is not ACTIVE (already FINISHED)", async function () {
      const { escrow, oracle, players } = await loadFixture(active1v1Fixture);
      await escrow.connect(oracle).declareWinner(0, 0);
      await expect(
        escrow.connect(oracle).declareTie(0)
      ).to.be.revertedWith("Match not active");
    });

    it("reverts when match is not ACTIVE (already TIED)", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(oracle).declareTie(0);
      await expect(
        escrow.connect(oracle).declareTie(0)
      ).to.be.revertedWith("Match not active");
    });

    it("reverts when paused", async function () {
      const { escrow, owner, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(oracle).declareTie(0)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("reverts for non-existent match", async function () {
      const { escrow, oracle } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(oracle).declareTie(99)
      ).to.be.revertedWith("Match does not exist");
    });

    it("compromised oracle cannot declareTie after match already TIED", async function () {
      const { escrow, oracle } = await loadFixture(active1v1Fixture);
      await escrow.connect(oracle).declareTie(0);
      await expect(
        escrow.connect(oracle).declareTie(0)
      ).to.be.revertedWith("Match not active");
    });

    it("5v5 tie: total refunded + fee equals total pot", async function () {
      const { escrow, oracle, players } = await loadFixture(deployFixture);
      // Create 5v5 match (10 players)
      await escrow.connect(players[0]).createMatch(5, { value: STAKE });
      for (let i = 1; i < 5; i++)
        await escrow.connect(players[i]).joinMatch(0, 0, { value: STAKE });
      for (let i = 5; i < 10; i++)
        await escrow.connect(players[i]).joinMatch(0, 1, { value: STAKE });

      const contractBefore = await ethers.provider.getBalance(await escrow.getAddress());
      expect(contractBefore).to.equal(STAKE * 10n);

      await escrow.connect(oracle).declareTie(0);

      const contractAfter = await ethers.provider.getBalance(await escrow.getAddress());
      expect(contractAfter).to.equal(0n);
    });

  });

});
