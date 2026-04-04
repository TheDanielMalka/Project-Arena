/**
 * ArenaEscrow — Deploy Script
 *
 * Usage:
 *   npm run deploy:testnet   →  npx hardhat run scripts/deploy.js --network bscTestnet
 *   npm run deploy:mainnet   →  npx hardhat run scripts/deploy.js --network bsc
 *
 * What this script does:
 *   1. Reads ORACLE_ADDRESS (or falls back to WALLET_ADDRESS) from root .env
 *   2. Deploys ArenaEscrow(oracle) with the PRIVATE_KEY account as owner
 *   3. Waits for 5 block confirmations (required for BscScan auto-verification)
 *   4. Auto-updates CONTRACT_ADDRESS and VITE_CONTRACT_ADDRESS in root .env
 *   5. Prints the `npx hardhat verify` command ready to copy-paste
 *
 * Sync:
 *   owner (deployer)   → platform fee wallet  ↔ engine/src/config.py WALLET_ADDRESS
 *   oracle             → Vision Engine wallet  ↔ engine/src/config.py ORACLE_ADDRESS / WALLET_ADDRESS
 *   CONTRACT_ADDRESS   → written to root .env  ↔ engine/src/config.py CONTRACT_ADDRESS
 *   VITE_CONTRACT_ADDRESS → written to .env    ↔ frontend wagmi/ethers contract calls
 *   CHAIN_ID=97        → BSC Testnet           ↔ hardhat.config.js bscTestnet.chainId
 *
 * After deploy (Issue #27):
 *   1. Copy CONTRACT_ADDRESS from .env into arena-engine Docker env on EC2
 *   2. Run the printed `npx hardhat verify` command to verify on BscScan
 *   3. Test deposit + withdrawal on BSC Testnet (Step 2 sign-off)
 */

const hre   = require("hardhat");
const path  = require("path");
const fs    = require("fs");

// ── Helper: update a key=value line in a .env file ─────────────────────────
function updateEnvFile(envPath, key, value) {
  if (!fs.existsSync(envPath)) return false;

  let content = fs.readFileSync(envPath, "utf8");
  const regex = new RegExp(`^${key}=.*$`, "m");

  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    // Key not present — append it
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }

  fs.writeFileSync(envPath, content, "utf8");
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const { ethers, network } = hre;

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║      ArenaEscrow — Deploy Script             ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\nNetwork : ${network.name}`);
  console.log(`Chain ID: ${network.config.chainId}`);

  // ── Oracle address ────────────────────────────────────────────────────────
  // oracle = Vision Engine wallet — the only address allowed to call declareWinner()
  // In production, use a dedicated ORACLE_ADDRESS wallet separate from WALLET_ADDRESS.
  // CONTRACT-ready: this oracle address is stored as escrow.oracle on-chain.
  //                 escrow_client.py (Issue #28) will use this wallet to call declareWinner().
  const oracleAddress =
    process.env.ORACLE_ADDRESS?.trim() ||
    process.env.WALLET_ADDRESS?.trim();

  if (!oracleAddress || oracleAddress === "0xYourWalletAddressHere") {
    throw new Error(
      "\n❌ Oracle address not configured.\n" +
      "   Set ORACLE_ADDRESS (or WALLET_ADDRESS) in your root .env file.\n" +
      "   Example: ORACLE_ADDRESS=0xAbCd...1234\n"
    );
  }

  // ── Deployer account ──────────────────────────────────────────────────────
  const [deployer] = await ethers.getSigners();
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Oracle  : ${oracleAddress}`);
  console.log(`Balance : ${ethers.formatEther(balance)} BNB`);

  if (balance === 0n && network.name !== "hardhat") {
    throw new Error(
      "\n❌ Deployer balance is 0 BNB.\n" +
      "   Fund your wallet from the BSC Testnet faucet:\n" +
      "   https://testnet.bnbchain.org/faucet-smart\n"
    );
  }

  // ── Deploy ────────────────────────────────────────────────────────────────
  console.log("\nDeploying ArenaEscrow...");

  const ArenaEscrow = await ethers.getContractFactory("ArenaEscrow");
  const escrow      = await ArenaEscrow.deploy(oracleAddress);
  const deployTx    = escrow.deploymentTransaction();

  console.log(`Tx hash : ${deployTx.hash}`);
  console.log("Waiting for deployment confirmation...");

  await escrow.waitForDeployment();
  const contractAddress = await escrow.getAddress();

  console.log(`\n✅ Deployed successfully!`);
  console.log(`   Contract : ${contractAddress}`);
  console.log(`   Owner    : ${deployer.address}    (receives 5% platform fee)`);
  console.log(`   Oracle   : ${oracleAddress}  (Vision Engine — calls declareWinner)`);

  // ── Wait for block confirmations (BscScan indexing) ──────────────────────
  const confirmations = network.name === "hardhat" ? 1 : 5;
  if (confirmations > 1) {
    console.log(`\nWaiting for ${confirmations} block confirmations for BscScan verification...`);
    await deployTx.wait(confirmations);
    console.log("Confirmed ✅");
  }

  // ── Auto-update root .env ─────────────────────────────────────────────────
  // Updates CONTRACT_ADDRESS and VITE_CONTRACT_ADDRESS in the root .env file.
  // Both values must stay in sync:
  //   CONTRACT_ADDRESS      ↔ engine/src/config.py  (used by escrow_client.py)
  //   VITE_CONTRACT_ADDRESS ↔ frontend wagmi/ethers calls (MetaMask / WalletConnect)
  const rootEnv = path.join(__dirname, "../../../.env");
  const updated = updateEnvFile(rootEnv, "CONTRACT_ADDRESS", contractAddress);

  if (updated) {
    updateEnvFile(rootEnv, "VITE_CONTRACT_ADDRESS", contractAddress);
    console.log(`\n📝 .env updated:`);
    console.log(`   CONTRACT_ADDRESS      = ${contractAddress}`);
    console.log(`   VITE_CONTRACT_ADDRESS = ${contractAddress}`);
  } else {
    console.log(`\n⚠️  Root .env not found at: ${rootEnv}`);
    console.log("   Manually add these lines to your .env:");
    console.log(`   CONTRACT_ADDRESS=${contractAddress}`);
    console.log(`   VITE_CONTRACT_ADDRESS=${contractAddress}`);
  }

  // ── BscScan verification command ──────────────────────────────────────────
  // Run this after deployment to make the contract source public on BscScan.
  // Requires BSCSCAN_API_KEY in .env (get it at https://bscscan.com/myapikey).
  console.log("\n── Verify on BscScan ──────────────────────────────────────────");
  console.log(
    `npx hardhat verify --network ${network.name} ${contractAddress} ${oracleAddress}`
  );
  console.log("────────────────────────────────────────────────────────────────");

  // ── Explorer link ─────────────────────────────────────────────────────────
  const explorerBase =
    network.name === "bsc"
      ? "https://bscscan.com/address"
      : "https://testnet.bscscan.com/address";

  console.log(`\n🔗 Explorer: ${explorerBase}/${contractAddress}`);
  console.log("\n✅ Deployment complete.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Deployment failed:", err.message);
    process.exit(1);
  });
