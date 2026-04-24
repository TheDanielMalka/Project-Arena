/**
 * ArenaEscrow ABI — only the functions and events the frontend calls directly.
 * Full contract: engine/contracts/src/ArenaEscrow.sol
 */
export const ARENA_ESCROW_ABI = [
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
      { name: "team", type: "uint8" },
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
    type: "event",
    name: "MatchCreated",
    inputs: [
      { name: "matchId",       type: "uint256", indexed: true  },
      { name: "creator",       type: "address", indexed: true  },
      { name: "teamSize",      type: "uint8",   indexed: false },
      { name: "stakePerPlayer",type: "uint256", indexed: false },
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
    name: "MatchCancelled",
    inputs: [
      { name: "matchId",     type: "uint256", indexed: true  },
      { name: "cancelledBy", type: "address", indexed: true  },
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
  {
    type: "function",
    name: "withdraw",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "pendingWithdrawals",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ name: "",        type: "uint256" }],
    stateMutability: "view",
  },
] as const;
