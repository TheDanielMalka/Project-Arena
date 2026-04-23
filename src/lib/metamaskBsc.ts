/**
 * Blockchain interaction layer — MetaMask extension (desktop) AND
 * WalletConnect / MetaMask Mobile / Trust Wallet / Coinbase Wallet (mobile).
 *
 * Public API is identical to the old ethers-only version so all callers
 * (walletStore, MatchLobby) import without changes.
 *
 * Internally uses wagmi @wagmi/core actions that work outside React
 * (no hooks, no context) — safe to call from Zustand store actions.
 */

import {
  getAccount,
  signMessage,
  switchChain,
  writeContract,
  waitForTransactionReceipt,
  getBalance,
} from "@wagmi/core";
import { getAddress, parseEther, formatEther } from "viem";
import { parseEventLogs } from "viem";
import { wagmiConfig, web3modal, bscTestnet, bscMainnet } from "./wagmiConfig";
import { ARENA_ESCROW_ABI } from "./contractAbi";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fetch live BNB/USD price — Binance primary, CoinGecko fallback. */
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

/** EIP-155 chain id — default 97 (BSC Testnet). Override with `VITE_CHAIN_ID`. */
export function getArenaTargetChainId(): number {
  const raw = import.meta.env.VITE_CHAIN_ID;
  const n = raw !== undefined && raw !== "" ? Number.parseInt(String(raw), 10) : 97;
  return Number.isFinite(n) && n > 0 ? n : 97;
}

/** Human-readable EIP-191 ownership message — signed by user to prove key control. */
export function buildWalletOwnershipMessage(walletAddress: string): string {
  const contract = import.meta.env.VITE_CONTRACT_ADDRESS ?? "";
  const chainId  = getArenaTargetChainId();
  const nonce    = `${Date.now()}`;
  const checksummed = getAddress(walletAddress as `0x${string}`);
  return [
    "ProjectArena — prove wallet ownership",
    "",
    `wallet_address: ${checksummed}`,
    `chain_id: ${chainId}`,
    `contract: ${contract}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

/**
 * Ensure the connected wallet is on the target Arena chain.
 * Triggers a "switch network" prompt in the wallet if needed.
 */
async function ensureTargetChain(): Promise<void> {
  const targetId = getArenaTargetChainId();
  const account  = getAccount(wagmiConfig);
  if (account.chainId === targetId) return;
  const chain = targetId === 56 ? bscMainnet : bscTestnet;
  await switchChain(wagmiConfig, { chainId: chain.id });
}

function getContractAddress(): `0x${string}` {
  const addr = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined;
  if (!addr?.trim() || !addr.startsWith("0x")) {
    throw new Error("VITE_CONTRACT_ADDRESS is not set or invalid");
  }
  return addr as `0x${string}`;
}

// ─── Connect & Sign ─────────────────────────────────────────────────────────

/**
 * Open wallet selection modal (QR on desktop, deep-link on mobile),
 * wait for the user to connect, then sign an EIP-191 ownership message.
 *
 * On desktop MetaMask extension: no QR — MetaMask pops up directly.
 * On mobile: WalletConnect QR / deep-link → MetaMask Mobile / Trust Wallet etc.
 */
export async function connectMetaMaskAndSignOwnership(): Promise<{ address: string; signature: string }> {
  await web3modal.open({ view: "Connect" });

  const account = getAccount(wagmiConfig);
  if (!account.address) {
    throw new Error("No wallet connected — modal was dismissed.");
  }

  await ensureTargetChain();

  const message   = buildWalletOwnershipMessage(account.address);
  const signature = await signMessage(wagmiConfig, {
    account: account.address,
    message,
  });

  return { address: account.address, signature };
}

// ─── Contract writes ─────────────────────────────────────────────────────────

/** ArenaEscrow.joinMatch — pay stakeWei as native BNB/tBNB. */
export async function depositToEscrow(
  onChainMatchId: bigint,
  team: 0 | 1,
  stakeWei: bigint,
): Promise<string> {
  await ensureTargetChain();
  const hash = await writeContract(wagmiConfig, {
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "joinMatch",
    args:         [onChainMatchId, team],
    value:        stakeWei,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * ArenaEscrow.createMatch — host creates on-chain room, pays stake.
 * Returns txHash + the matchId extracted from the MatchCreated event.
 */
export async function createMatchOnChain(
  teamSize: number,
  stakeEther: number,
): Promise<{ txHash: string; onChainMatchId: bigint }> {
  await ensureTargetChain();
  const stakeWei = parseEther(stakeEther.toFixed(8) as `${number}`);
  const hash = await writeContract(wagmiConfig, {
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "createMatch",
    args:         [teamSize],
    value:        stakeWei,
  });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

  const logs = parseEventLogs({
    abi:       ARENA_ESCROW_ABI,
    eventName: "MatchCreated",
    logs:      receipt.logs,
  });

  if (!logs.length || logs[0].args.matchId === undefined) {
    throw new Error("MatchCreated event not found in transaction receipt");
  }

  return { txHash: hash, onChainMatchId: logs[0].args.matchId };
}

/** ArenaEscrow.cancelMatch — creator refunds all WAITING depositors. */
export async function cancelMatchOnChain(onChainMatchId: bigint): Promise<string> {
  await ensureTargetChain();
  const hash = await writeContract(wagmiConfig, {
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "cancelMatch",
    args:         [onChainMatchId],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** ArenaEscrow.cancelWaiting — any depositor after WAITING_TIMEOUT (1 hour). */
export async function cancelWaitingOnChain(onChainMatchId: bigint): Promise<string> {
  await ensureTargetChain();
  const hash = await writeContract(wagmiConfig, {
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "cancelWaiting",
    args:         [onChainMatchId],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** ArenaEscrow.claimRefund — any player after 2-hour ACTIVE timeout. */
export async function claimRefundFromEscrow(onChainMatchId: bigint): Promise<string> {
  await ensureTargetChain();
  const hash = await writeContract(wagmiConfig, {
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "claimRefund",
    args:         [onChainMatchId],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

// ─── Read ────────────────────────────────────────────────────────────────────

/** Native BNB/tBNB balance of address on the Arena target chain. */
export async function getBnbBalance(address: string): Promise<number> {
  const data = await getBalance(wagmiConfig, {
    address: getAddress(address as `0x${string}`),
    chainId: getArenaTargetChainId(),
  });
  return parseFloat(formatEther(data.value));
}

// ─── Legacy type exports (kept for backwards-compat with any type imports) ──

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
}

/** @deprecated Use wagmiConfig directly — only kept for old type references. */
export function getInjectedEthereum(): EthereumProvider | null {
  const g = globalThis as unknown as { ethereum?: EthereumProvider };
  return g.ethereum?.request ? g.ethereum : null;
}
