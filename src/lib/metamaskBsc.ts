import { BrowserProvider, Contract, formatEther, getAddress, parseEther } from "ethers";

/**
 * Fetch live BNB/USD price from Binance (primary) with CoinGecko fallback.
 * Used only for the TEST_STAKE_USDT tier to convert $0.1 → equivalent tBNB.
 * TODO: remove after mainnet launch (replace with Chainlink oracle).
 */
export async function fetchBnbUsdPrice(): Promise<number> {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
    const d = await r.json() as { price?: string };
    const p = parseFloat(d.price ?? "");
    if (Number.isFinite(p) && p > 0) return p;
  } catch { /* ignore */ }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd");
    const d = await r.json() as { binancecoin?: { usd?: number } };
    const p = d?.binancecoin?.usd;
    if (p && Number.isFinite(p) && p > 0) return p;
  } catch { /* ignore */ }
  throw new Error("Cannot fetch BNB/USD price — check network connection");
}

/** EIP-155 chain id — default BSC Testnet (97). Override with `VITE_CHAIN_ID`. */
export function getArenaTargetChainId(): number {
  const raw = import.meta.env.VITE_CHAIN_ID;
  const n = raw !== undefined && raw !== "" ? Number.parseInt(String(raw), 10) : 97;
  return Number.isFinite(n) && n > 0 ? n : 97;
}

const BSC_TESTNET_ADD_CHAIN = {
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.binance.org:8545/"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
} as const;

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
}

export function getInjectedEthereum(): EthereumProvider | null {
  const g = globalThis as unknown as { ethereum?: EthereumProvider & { providers?: EthereumProvider[] } };
  const eth = g.ethereum;
  if (!eth?.request) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    return mm ?? eth.providers[0]!;
  }
  return eth;
}

function toChainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

/**
 * Switch MetaMask to the configured chain (BSC Testnet by default).
 * Adds the chain if missing (code 4902).
 */
export async function ensureTargetChain(ethereum: EthereumProvider): Promise<void> {
  const target = getArenaTargetChainId();
  const hex = toChainIdHex(target);
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex,
            chainName: BSC_TESTNET_ADD_CHAIN.chainName,
            nativeCurrency: BSC_TESTNET_ADD_CHAIN.nativeCurrency,
            rpcUrls: [...BSC_TESTNET_ADD_CHAIN.rpcUrls],
            blockExplorerUrls: [...BSC_TESTNET_ADD_CHAIN.blockExplorerUrls],
          },
        ],
      });
      return;
    }
    throw e;
  }
}

/** Human-readable message signed with personal_sign (EIP-191) — proves key ownership; safer than raw eth_sign. */
export function buildWalletOwnershipMessage(walletAddress: string): string {
  const contract = import.meta.env.VITE_CONTRACT_ADDRESS ?? "";
  const chainId = getArenaTargetChainId();
  const nonce = `${Date.now()}`;
  const checksummed = getAddress(walletAddress);
  return [
    "ProjectArena — prove wallet ownership",
    "",
    `wallet_address: ${checksummed}`,
    `chain_id: ${chainId}`,
    `contract: ${contract}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

/** ArenaEscrow.joinMatch — native BNB/tBNB `value` must match stake for this match/team. */
export async function depositToEscrow(
  onChainMatchId: bigint,
  team: 0 | 1,
  stakeWei: bigint,
): Promise<string> {
  const addr = import.meta.env.VITE_CONTRACT_ADDRESS;
  if (!addr || String(addr).trim() === "") {
    throw new Error("VITE_CONTRACT_ADDRESS is not set");
  }
  const eth = getInjectedEthereum();
  if (!eth) throw new Error("MetaMask not found");
  await ensureTargetChain(eth);
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new Contract(
    addr,
    ["function joinMatch(uint256 matchId, uint8 team) payable"],
    signer,
  );
  const tx = await contract.joinMatch(onChainMatchId, team, { value: stakeWei });
  await tx.wait();
  return tx.hash;
}

/**
 * ArenaEscrow.createMatch — host creates the match on-chain and pays their stake.
 * teamSize: 1 | 2 | 4 | 5   stakeEther: e.g. 0.1 (BNB)
 * Returns txHash + the on-chain matchId extracted from the MatchCreated event.
 */
export async function createMatchOnChain(
  teamSize: number,
  stakeEther: number,
): Promise<{ txHash: string; onChainMatchId: bigint }> {
  const addr = import.meta.env.VITE_CONTRACT_ADDRESS;
  if (!addr?.trim() || !String(addr).startsWith("0x")) {
    throw new Error("VITE_CONTRACT_ADDRESS is not set or invalid — expected a 0x… address");
  }
  const eth = getInjectedEthereum();
  if (!eth) throw new Error("MetaMask not found");
  await ensureTargetChain(eth);
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const stakeWei = parseEther(stakeEther.toFixed(8));
  const contract = new Contract(
    addr,
    [
      "function createMatch(uint8 teamSize) payable",
      "event MatchCreated(uint256 indexed matchId, address indexed creator, uint8 teamSize, uint256 stakePerPlayer)",
    ],
    signer,
  );
  const tx = await contract.createMatch(teamSize, { value: stakeWei });
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction receipt not available");

  let onChainMatchId = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "MatchCreated") {
        const arg0 = parsed.args[0];
        onChainMatchId = typeof arg0 === "bigint" ? arg0 : BigInt(String(arg0));
        break;
      }
    } catch {
      /* not our event */
    }
  }
  if (onChainMatchId === 0n) {
    throw new Error("MatchCreated event not found in transaction receipt");
  }
  return { txHash: String(tx.hash), onChainMatchId };
}

/**
 * Native BNB balance of `address` on the current MetaMask chain (ether units, e.g. 0.5).
 * Used by the deposit modal before lock — must match `ensureTargetChain` (BSC testnet by default).
 */
export async function getBnbBalance(address: string): Promise<number> {
  const eth = getInjectedEthereum();
  if (!eth) throw new Error("MetaMask not found");
  await ensureTargetChain(eth);
  const provider = new BrowserProvider(eth);
  const checksummed = getAddress(address);
  const raw = await provider.getBalance(checksummed);
  return parseFloat(formatEther(raw));
}

/** ArenaEscrow.cancelMatch — creator cancels a WAITING match and refunds all depositors. */
export async function cancelMatchOnChain(onChainMatchId: bigint): Promise<string> {
  const addr = import.meta.env.VITE_CONTRACT_ADDRESS;
  if (!addr?.trim() || !String(addr).startsWith("0x")) throw new Error("VITE_CONTRACT_ADDRESS is not set or invalid");
  const eth = getInjectedEthereum();
  if (!eth) throw new Error("MetaMask not found");
  await ensureTargetChain(eth);
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new Contract(addr, ["function cancelMatch(uint256 matchId)"], signer);
  const tx = await contract.cancelMatch(onChainMatchId);
  await tx.wait();
  return tx.hash;
}

/** ArenaEscrow.claimRefund — called by a player after match cancellation to recover their stake. */
export async function claimRefundFromEscrow(onChainMatchId: bigint): Promise<string> {
  const addr = import.meta.env.VITE_CONTRACT_ADDRESS;
  if (!addr?.trim()) throw new Error("VITE_CONTRACT_ADDRESS is not set");
  const eth = getInjectedEthereum();
  if (!eth) throw new Error("MetaMask not found");
  await ensureTargetChain(eth);
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new Contract(
    addr,
    ["function claimRefund(uint256 matchId)"],
    signer,
  );
  const tx = await contract.claimRefund(onChainMatchId);
  await tx.wait();
  return tx.hash;
}

export async function connectMetaMaskAndSignOwnership(): Promise<{ address: string; signature: string }> {
  const eth = getInjectedEthereum();
  if (!eth) {
    throw new Error("No injected wallet found. Install MetaMask (or another EIP-1193 wallet).");
  }
  await ensureTargetChain(eth);
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const address = getAddress(await signer.getAddress());
  const message = buildWalletOwnershipMessage(address);
  const signature = await signer.signMessage(message);
  return { address, signature };
}
