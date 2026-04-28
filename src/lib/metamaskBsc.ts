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
  watchAccount,
  signMessage,
  switchChain,
  waitForTransactionReceipt,
  getBalance,
  getWalletClient,
  readContract,
  getPublicClient,
} from "@wagmi/core";
import { getAddress, parseEther, formatEther, encodeFunctionData, decodeFunctionResult } from "viem";
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
 * Ensure the connected wallet is on the target Arena chain, then return a
 * ready-to-use viem WalletClient + the connected address.
 *
 * Using the viem WalletClient for contract writes sidesteps a TypeScript
 * structural mismatch between wagmi@2's createConfig return type and the
 * WriteContractParameters overloads in @wagmi/core@2.  The address is
 * passed explicitly to writeContract (required when the WalletClient's
 * chain generic is a union — viem forces opt-in to disambiguate overloads).
 */
async function ensureTargetChain(): Promise<{ client: Awaited<ReturnType<typeof getWalletClient>>; address: `0x${string}` }> {
  const targetId = getArenaTargetChainId();
  const state    = getAccount(wagmiConfig);
  if (!state.address) throw new Error("No wallet connected");
  if (state.chainId !== targetId) {
    const chain = targetId === 56 ? bscMainnet : bscTestnet;
    await switchChain(wagmiConfig, { chainId: chain.id });
  }
  // wagmi fires watchAccount("connected") slightly before the connector object is
  // ready for getWalletClient — retry up to 8× with 250ms gaps (~2s total).
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const client = await getWalletClient(wagmiConfig);
      return { client, address: state.address };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("Wallet not ready — please try again");
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
  const current = getAccount(wagmiConfig);

  let address: `0x${string}`;
  if (current.status === "connected" && current.address) {
    address = current.address;
  } else {
    void web3modal.open({ view: "Connect" });
    address = await new Promise<`0x${string}`>((resolve, reject) => {
      let _timeout: ReturnType<typeof setTimeout> | undefined;
      let _unwatch: (() => void) | undefined;
      let _unsubModal: (() => void) | undefined;
      let modalHasOpened = false;

      const cleanup = () => {
        clearTimeout(_timeout);
        _unsubModal?.();
        _unwatch?.();
      };

      _timeout = setTimeout(() => {
        cleanup();
        reject(new Error("No wallet connected — modal was dismissed."));
      }, 120_000);

      // Reject immediately when user closes modal without connecting.
      _unsubModal = web3modal.subscribeState(({ open }) => {
        if (open) {
          modalHasOpened = true;
        } else if (modalHasOpened) {
          const acc = getAccount(wagmiConfig);
          if (acc.status === "connected" && acc.address) {
            cleanup();
            resolve(acc.address);
          } else {
            cleanup();
            reject(new Error("No wallet connected — modal was dismissed."));
          }
        }
      });

      _unwatch = watchAccount(wagmiConfig, {
        onChange(account) {
          if (account.status === "connected" && account.address) {
            cleanup();
            web3modal.close();
            resolve(account.address);
          }
        },
      });
    });
  }

  await ensureTargetChain();

  const message   = buildWalletOwnershipMessage(address);
  const signature = await signMessage(wagmiConfig, { account: address, message });

  return { address, signature };
}

// ─── Contract writes ─────────────────────────────────────────────────────────

/** ArenaEscrow.joinMatch — pay stakeWei as native BNB/tBNB. */
export async function depositToEscrow(
  onChainMatchId: bigint,
  team: 0 | 1,
  stakeWei: bigint,
): Promise<string> {
  const { client, address } = await ensureTargetChain();
  const hash = await client.writeContract({
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "joinMatch",
    args:         [onChainMatchId, team],
    value:        stakeWei,
    chain:        undefined,
    account:      address,
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
  const { client, address } = await ensureTargetChain();
  const stakeWei = parseEther(stakeEther.toFixed(8) as `${number}`);
  const hash = await client.writeContract({
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "createMatch",
    args:         [teamSize],
    value:        stakeWei,
    chain:        undefined,
    account:      address,
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
  const { client, address } = await ensureTargetChain();
  const hash = await client.writeContract({
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "cancelMatch",
    args:         [onChainMatchId],
    chain:        undefined,
    account:      address,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** ArenaEscrow.cancelWaiting — any depositor after WAITING_TIMEOUT (1 hour). */
export async function cancelWaitingOnChain(onChainMatchId: bigint): Promise<string> {
  const { client, address } = await ensureTargetChain();
  const hash = await client.writeContract({
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "cancelWaiting",
    args:         [onChainMatchId],
    chain:        undefined,
    account:      address,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** ArenaEscrow.claimRefund — any player after 2-hour ACTIVE timeout. */
export async function claimRefundFromEscrow(onChainMatchId: bigint): Promise<string> {
  const { client, address } = await ensureTargetChain();
  const hash = await client.writeContract({
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "claimRefund",
    args:         [onChainMatchId],
    chain:        undefined,
    account:      address,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * ArenaEscrow.withdraw() — pull pending balance from the pull-payment fallback ledger.
 * Only needed when a direct ETH payout failed (e.g. contract recipient with expensive receive()).
 * Returns tx hash.
 */
export async function withdrawPendingOnChain(): Promise<string> {
  const { client, address } = await ensureTargetChain();
  const hash = await client.writeContract({
    address:      getContractAddress(),
    abi:          ARENA_ESCROW_ABI,
    functionName: "withdraw",
    args:         [],
    chain:        undefined,
    account:      address,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * ArenaEscrow.pendingWithdrawals(address) — read the pull-payment credit for a wallet.
 * Returns amount in wei as bigint. Zero for normal EOA wallets (direct transfer succeeded).
 */
export async function readPendingWithdrawalsOnChain(walletAddress: string): Promise<bigint> {
  const chainId = getArenaTargetChainId() as 97 | 56;
  const publicClient = getPublicClient(wagmiConfig, { chainId });
  if (!publicClient) return 0n;
  const data = encodeFunctionData({
    abi:          ARENA_ESCROW_ABI,
    functionName: "pendingWithdrawals",
    args:         [getAddress(walletAddress as `0x${string}`)],
  });
  const { data: raw } = await publicClient.call({ to: getContractAddress(), data });
  if (!raw) return 0n;
  return decodeFunctionResult({
    abi:          ARENA_ESCROW_ABI,
    functionName: "pendingWithdrawals",
    data:         raw,
  }) as bigint;
}

// ─── Read ────────────────────────────────────────────────────────────────────

/** Native BNB/tBNB balance of address on the Arena target chain. */
export async function getBnbBalance(address: string): Promise<number> {
  const data = await getBalance(wagmiConfig, {
    address: getAddress(address as `0x${string}`),
    chainId: getArenaTargetChainId() as 97 | 56,
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
