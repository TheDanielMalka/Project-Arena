/**
 * Hardhat configuration — ArenaEscrow
 *
 * Networks:
 *   hardhat      — local in-memory network (tests)
 *   bscTestnet   — BSC Testnet (chainId 97)  ← deploy target for Phase 6
 *   bsc          — BSC Mainnet (chainId 56)  ← production
 *
 * Sync:
 *   CHAIN_ID=97  ↔ engine/src/config.py default
 *   CHAIN_ID=97  ↔ .env.example CHAIN_ID + VITE_CHAIN_ID
 *   bscTestnet   ↔ infra/sql/init.sql  network enum ('bsc','solana','ethereum')
 *   bscTestnet   ↔ src/types/index.ts  Network = "bsc" | ...
 *   bscTestnet   ↔ src/stores/walletStore.ts  selectedNetwork: "bsc"
 */

require("@nomicfoundation/hardhat-toolbox");

// Load root .env — two levels up from engine/contracts/
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },

  paths: {
    sources:   "./src",        // ArenaEscrow.sol in src/ — keeps node_modules out of compile scope
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },

  // ── Networks ────────────────────────────────────────────────────────────────
  networks: {
    // BSC Testnet — Phase 6 deploy target
    // Faucet: https://testnet.bnbchain.org/faucet-smart
    // Explorer: https://testnet.bscscan.com
    bscTestnet: {
      url: process.env.BLOCKCHAIN_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.PRIVATE_KEY
        ? [`0x${process.env.PRIVATE_KEY.replace(/^0x/, "")}`]
        : [],
      gasPrice: 10_000_000_000, // 10 gwei — BSC testnet default
      timeout: 60_000,
    },

    // BSC Mainnet — production (deploy only after full testnet sign-off)
    // Explorer: https://bscscan.com
    bsc: {
      url: "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: process.env.PRIVATE_KEY
        ? [`0x${process.env.PRIVATE_KEY.replace(/^0x/, "")}`]
        : [],
      gasPrice: 3_000_000_000, // 3 gwei — typical BSC mainnet
      timeout: 60_000,
    },
  },

  // ── BscScan verification ─────────────────────────────────────────────────────
  // Get API key at: https://bscscan.com/myapikey
  // Set BSCSCAN_API_KEY in .env, then run:
  //   npx hardhat verify --network bscTestnet <ADDRESS> <ORACLE_ADDRESS>
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc:        process.env.BSCSCAN_API_KEY || "",
    },
    customChains: [
      {
        network:  "bscTestnet",
        chainId:  97,
        urls: {
          apiURL:     "https://api-testnet.bscscan.com/api",
          browserURL: "https://testnet.bscscan.com",
        },
      },
    ],
  },

  // ── Gas reporting (runs during `npx hardhat test`) ──────────────────────────
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    token: "BNB",
  },
};
