/**
 * Unit tests for src/lib/metamaskBsc.ts (audit coverage gap — 2026-04-20).
 *
 * The wallet/escrow flow had zero direct unit tests: `metamaskBsc.ts` was
 * only imported by stores that mocked its exports. This file exercises the
 * security-critical pure paths:
 *
 *   - EIP-155 chain-id resolution (env override + fallback to BSC Testnet 97)
 *   - Injected-provider discovery (MetaMask priority among multi-providers)
 *   - `ensureTargetChain` — switch → add-on-4902 → re-throw other RPC errors
 *   - `buildWalletOwnershipMessage` — stable EIP-191 format with checksum
 *   - `connectMetaMaskAndSignOwnership` — fails closed when no wallet injected
 *
 * Paths that require real `BrowserProvider`/`Contract` RPC (depositToEscrow,
 * createMatchOnChain, getBnbBalance) are covered by the higher-level store
 * tests in `wallet-store.test.ts` via module mocks; unit-testing them here
 * would duplicate that coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWalletOwnershipMessage,
  connectMetaMaskAndSignOwnership,
  ensureTargetChain,
  getArenaTargetChainId,
  getInjectedEthereum,
  type EthereumProvider,
} from "@/lib/metamaskBsc";

type GlobalWithEthereum = typeof globalThis & { ethereum?: unknown };

function setWindowEthereum(eth: unknown): void {
  (globalThis as GlobalWithEthereum).ethereum = eth;
}

function clearWindowEthereum(): void {
  delete (globalThis as GlobalWithEthereum).ethereum;
}

function mockRequest(impl: (args: { method: string; params?: unknown[] }) => Promise<unknown>) {
  return vi.fn(impl);
}

// ─────────────────────────────────────────────────────────────────────────────
// getArenaTargetChainId
// ─────────────────────────────────────────────────────────────────────────────

describe("getArenaTargetChainId", () => {
  const originalEnv = { ...import.meta.env };

  afterEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = originalEnv.VITE_CHAIN_ID;
  });

  it("returns 97 (BSC Testnet) when VITE_CHAIN_ID is unset", () => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = undefined;
    expect(getArenaTargetChainId()).toBe(97);
  });

  it("returns 97 when VITE_CHAIN_ID is empty string", () => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "";
    expect(getArenaTargetChainId()).toBe(97);
  });

  it("returns parsed chain id for valid number", () => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "56";
    expect(getArenaTargetChainId()).toBe(56);
  });

  it("falls back to 97 when VITE_CHAIN_ID is non-numeric", () => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "not-a-chain";
    expect(getArenaTargetChainId()).toBe(97);
  });

  it("falls back to 97 when VITE_CHAIN_ID is 0 or negative", () => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "0";
    expect(getArenaTargetChainId()).toBe(97);
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "-1";
    expect(getArenaTargetChainId()).toBe(97);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getInjectedEthereum
// ─────────────────────────────────────────────────────────────────────────────

describe("getInjectedEthereum", () => {
  afterEach(() => {
    clearWindowEthereum();
  });

  it("returns null when no provider is injected", () => {
    clearWindowEthereum();
    expect(getInjectedEthereum()).toBeNull();
  });

  it("returns null when injected object has no request()", () => {
    setWindowEthereum({ isMetaMask: true });
    expect(getInjectedEthereum()).toBeNull();
  });

  it("returns the single injected provider when providers[] missing", () => {
    const eth = { request: vi.fn(), isMetaMask: true };
    setWindowEthereum(eth);
    expect(getInjectedEthereum()).toBe(eth);
  });

  it("selects MetaMask among multiple providers", () => {
    const coinbase = { request: vi.fn(), isMetaMask: false };
    const mm = { request: vi.fn(), isMetaMask: true };
    setWindowEthereum({ request: vi.fn(), providers: [coinbase, mm] });
    expect(getInjectedEthereum()).toBe(mm);
  });

  it("falls back to first provider when none identify as MetaMask", () => {
    const walletA = { request: vi.fn(), isMetaMask: false };
    const walletB = { request: vi.fn(), isMetaMask: false };
    setWindowEthereum({ request: vi.fn(), providers: [walletA, walletB] });
    expect(getInjectedEthereum()).toBe(walletA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureTargetChain
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureTargetChain", () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "97";
  });

  afterEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = originalEnv.VITE_CHAIN_ID;
  });

  it("calls wallet_switchEthereumChain with hex chain id", async () => {
    const req = mockRequest(async () => null);
    const eth: EthereumProvider = { request: req };
    await ensureTargetChain(eth);
    expect(req).toHaveBeenCalledTimes(1);
    const call = req.mock.calls[0]![0];
    expect(call.method).toBe("wallet_switchEthereumChain");
    expect(call.params).toEqual([{ chainId: "0x61" }]); // 97 → 0x61
  });

  it("adds the chain when wallet rejects with code 4902 (unknown chain)", async () => {
    const req = mockRequest(async ({ method }) => {
      if (method === "wallet_switchEthereumChain") {
        const e = new Error("Unknown chain");
        (e as { code?: number }).code = 4902;
        throw e;
      }
      return null;
    });
    await ensureTargetChain({ request: req });
    expect(req).toHaveBeenCalledTimes(2);
    const addCall = req.mock.calls[1]![0];
    expect(addCall.method).toBe("wallet_addEthereumChain");
    const addedChain = (addCall.params as Array<{ chainId: string; chainName: string }>)[0]!;
    expect(addedChain.chainId).toBe("0x61");
    expect(addedChain.chainName).toMatch(/BNB Smart Chain Testnet/i);
  });

  it("propagates non-4902 errors (user rejection, RPC failure, etc.)", async () => {
    const req = mockRequest(async () => {
      const e = new Error("User rejected request");
      (e as { code?: number }).code = 4001;
      throw e;
    });
    await expect(ensureTargetChain({ request: req })).rejects.toThrow(/user rejected/i);
    expect(req).toHaveBeenCalledTimes(1); // never attempted add
  });

  it("computes hex correctly for non-BSC chains", async () => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "56";
    const req = mockRequest(async () => null);
    await ensureTargetChain({ request: req });
    expect(req.mock.calls[0]![0].params).toEqual([{ chainId: "0x38" }]); // 56 → 0x38
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildWalletOwnershipMessage
// ─────────────────────────────────────────────────────────────────────────────

describe("buildWalletOwnershipMessage", () => {
  const originalEnv = { ...import.meta.env };
  const LOWER = "0x7a3f9c2e1b8d4a5c6f7e8d9b0c1a2b3c4d5e6f7a";
  // EIP-55 checksum computed by ethers' getAddress — assert derivation is applied
  // rather than hard-coding a specific casing (which is easy to get wrong).
  const CHECKSUM = "0x7A3f9C2e1B8D4a5c6F7e8D9B0c1A2b3C4d5e6f7a";

  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = "97";
    (import.meta.env as Record<string, unknown>).VITE_CONTRACT_ADDRESS =
      "0x47bB9861263A1AB7dAF2353765e0fd3118b71d38";
  });

  afterEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_CHAIN_ID = originalEnv.VITE_CHAIN_ID;
    (import.meta.env as Record<string, unknown>).VITE_CONTRACT_ADDRESS =
      originalEnv.VITE_CONTRACT_ADDRESS;
  });

  it("includes all required claims in fixed order", () => {
    const msg = buildWalletOwnershipMessage(LOWER);
    const lines = msg.split("\n");
    expect(lines[0]).toBe("ProjectArena — prove wallet ownership");
    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(/^wallet_address: 0x[0-9a-fA-F]{40}$/);
    expect(lines[3]).toBe("chain_id: 97");
    expect(lines[4]).toMatch(/^contract: 0x[0-9a-fA-F]{40}$/);
    expect(lines[5]).toMatch(/^nonce: \d+$/);
  });

  it("normalises the wallet address via EIP-55 checksum (not raw lowercase)", async () => {
    const { getAddress } = await import("ethers");
    const msg = buildWalletOwnershipMessage(LOWER);
    expect(msg).toContain(`wallet_address: ${getAddress(LOWER)}`);
    // Sanity: derivation should not be a passthrough — it must add mixed case.
    expect(msg).not.toContain(`wallet_address: ${LOWER}`);
    // And our frozen expectation aligns with the ethers computation.
    expect(getAddress(LOWER)).toBe(CHECKSUM);
  });

  it("embeds the configured contract address", () => {
    const msg = buildWalletOwnershipMessage(LOWER);
    expect(msg).toContain("contract: 0x47bB9861263A1AB7dAF2353765e0fd3118b71d38");
  });

  it("produces a fresh nonce per call (anti-replay)", async () => {
    const a = buildWalletOwnershipMessage(LOWER);
    // Advance Date.now so the nonce (ms timestamp) differs reliably even on fast clocks.
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now + 10);
    const b = buildWalletOwnershipMessage(LOWER);
    vi.useRealTimers();
    const nonceA = a.match(/nonce: (\d+)/)![1]!;
    const nonceB = b.match(/nonce: (\d+)/)![1]!;
    expect(nonceA).not.toBe(nonceB);
  });

  it("throws when given a syntactically invalid address (ethers getAddress rejects)", () => {
    expect(() => buildWalletOwnershipMessage("not-an-address")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// connectMetaMaskAndSignOwnership — fail-closed guard
// ─────────────────────────────────────────────────────────────────────────────

describe("connectMetaMaskAndSignOwnership", () => {
  afterEach(() => {
    clearWindowEthereum();
  });

  it("throws a clear error when no wallet is injected", async () => {
    clearWindowEthereum();
    await expect(connectMetaMaskAndSignOwnership()).rejects.toThrow(
      /no injected wallet/i,
    );
  });
});
