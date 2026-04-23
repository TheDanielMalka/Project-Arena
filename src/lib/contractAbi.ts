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
] as const;
