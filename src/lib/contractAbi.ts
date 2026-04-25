/**
 * ArenaEscrow ABI — complete interface mirroring engine/src/contract/escrow_client.py.
 * Full contract: engine/contracts/src/ArenaEscrow.sol
 */
export const ARENA_ESCROW_ABI = [
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "MatchCreated",
    inputs: [
      { name: "matchId",        type: "uint256", indexed: true  },
      { name: "creator",        type: "address", indexed: true  },
      { name: "teamSize",       type: "uint8",   indexed: false },
      { name: "stakePerPlayer", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PlayerDeposited",
    inputs: [
      { name: "matchId",        type: "uint256", indexed: true  },
      { name: "player",         type: "address", indexed: true  },
      { name: "team",           type: "uint8",   indexed: false },
      { name: "stakePerPlayer", type: "uint256", indexed: false },
      { name: "depositsTeamA",  type: "uint8",   indexed: false },
      { name: "depositsTeamB",  type: "uint8",   indexed: false },
    ],
  },
  {
    type: "event",
    name: "MatchActive",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "WinnerDeclared",
    inputs: [
      { name: "matchId",         type: "uint256", indexed: true  },
      { name: "winningTeam",     type: "uint8",   indexed: false },
      { name: "payoutPerWinner", type: "uint256", indexed: false },
      { name: "fee",             type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TieDeclared",
    inputs: [
      { name: "matchId",         type: "uint256", indexed: true  },
      { name: "refundPerPlayer", type: "uint256", indexed: false },
      { name: "fee",             type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MatchRefunded",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "MatchCancelled",
    inputs: [
      { name: "matchId",     type: "uint256", indexed: true },
      { name: "cancelledBy", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PayoutCredited",
    inputs: [
      { name: "recipient", type: "address", indexed: true  },
      { name: "amount",    type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "recipient", type: "address", indexed: true  },
      { name: "amount",    type: "uint256", indexed: false },
    ],
  },
  // ── Write functions (user-facing) ─────────────────────────────────────────
  {
    type: "function",
    name: "createMatch",
    inputs: [{ name: "teamSize", type: "uint8" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "joinMatch",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "team",    type: "uint8"   },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "cancelMatch",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelWaiting",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimRefund",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── Write functions (oracle-only) ─────────────────────────────────────────
  {
    type: "function",
    name: "declareWinner",
    inputs: [
      { name: "matchId",     type: "uint256" },
      { name: "winningTeam", type: "uint8"   },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "declareTie",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── View functions ────────────────────────────────────────────────────────
  {
    type: "function",
    name: "pendingWithdrawals",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ name: "",        type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getMatch",
    inputs:  [{ name: "matchId", type: "uint256" }],
    outputs: [
      { name: "teamA",          type: "address[]" },
      { name: "teamB",          type: "address[]" },
      { name: "stakePerPlayer", type: "uint256"   },
      { name: "teamSize",       type: "uint8"     },
      { name: "depositsTeamA",  type: "uint8"     },
      { name: "depositsTeamB",  type: "uint8"     },
      { name: "state",          type: "uint8"     },
      { name: "winningTeam",    type: "uint8"     },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isPaused",
    inputs:  [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;
