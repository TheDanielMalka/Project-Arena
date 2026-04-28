/**
 * Unit tests for src/lib/metamaskBsc.ts
 *
 * After the wagmi v2 migration, the internal implementation changed:
 *   - ensureTargetChain is now private (not exported)
 *   - getInjectedEthereum is a deprecated legacy stub
 *   - connectMetaMaskAndSignOwnership now uses wagmi + Web3Modal
 *
 * Remaining testable pure paths:
 *   - getArenaTargetChainId   — env override + fallback
 *   - getInjectedEthereum     — legacy stub still exported for back-compat
 *   - buildWalletOwnershipMessage — stable EIP-191 format with checksum
 *   - connectMetaMaskAndSignOwnership — fail-closed when modal dismissed
 *
 * Contract writes (depositToEscrow, createMatchOnChain, etc.) continue to
 * be covered by the wallet-store tests via module mocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWalletOwnershipMessage,
  connectMetaMaskAndSignOwnership,
  getArenaTargetChainId,
  getInjectedEthereum,
} from "@/lib/metamaskBsc";

type GlobalWithEthereum = typeof globalThis & { ethereum?: unknown };

function setWindowEthereum(eth: unknown): void {
  (globalThis as GlobalWithEthereum).ethereum = eth;
}
function clearWindowEthereum(): void {
  delete (globalThis as GlobalWithEthereum).ethereum;
}

// ── getArenaTargetChainId ────────────────────────────────────────────────────

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

// ── getInjectedEthereum (legacy stub) ────────────────────────────────────────

describe("getInjectedEthereum", () => {
  afterEach(() => clearWindowEthereum());

  it("returns null when no provider is injected", () => {
    clearWindowEthereum();
    expect(getInjectedEthereum()).toBeNull();
  });

  it("returns null when injected object has no request()", () => {
    setWindowEthereum({ isMetaMask: true });
    expect(getInjectedEthereum()).toBeNull();
  });

  it("returns the injected provider when request() is present", () => {
    const eth = { request: vi.fn(), isMetaMask: true };
    setWindowEthereum(eth);
    expect(getInjectedEthereum()).toBe(eth);
  });
});

// ── buildWalletOwnershipMessage ──────────────────────────────────────────────

describe("buildWalletOwnershipMessage", () => {
  const originalEnv = { ...import.meta.env };
  const LOWER = "0x7a3f9c2e1b8d4a5c6f7e8d9b0c1a2b3c4d5e6f7a";
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

  it("normalises the wallet address via EIP-55 checksum", () => {
    const msg = buildWalletOwnershipMessage(LOWER);
    expect(msg).toContain(`wallet_address: ${CHECKSUM}`);
    expect(msg).not.toContain(`wallet_address: ${LOWER}`);
  });

  it("embeds the configured contract address", () => {
    const msg = buildWalletOwnershipMessage(LOWER);
    expect(msg).toContain("contract: 0x47bB9861263A1AB7dAF2353765e0fd3118b71d38");
  });

  it("produces a fresh nonce per call (anti-replay)", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const a = buildWalletOwnershipMessage(LOWER);
    vi.setSystemTime(now + 10);
    const b = buildWalletOwnershipMessage(LOWER);
    vi.useRealTimers();
    const nonceA = a.match(/nonce: (\d+)/)![1]!;
    const nonceB = b.match(/nonce: (\d+)/)![1]!;
    expect(nonceA).not.toBe(nonceB);
  });

  it("throws when given a syntactically invalid address", () => {
    expect(() => buildWalletOwnershipMessage("not-an-address")).toThrow();
  });
});

// ── connectMetaMaskAndSignOwnership — fail-closed ────────────────────────────

describe("connectMetaMaskAndSignOwnership", () => {
  afterEach(() => {
    clearWindowEthereum();
    vi.useRealTimers();
  });

  it("throws when web3modal is dismissed without connecting a wallet", async () => {
    vi.useFakeTimers();
    const promise = connectMetaMaskAndSignOwnership();
    await vi.advanceTimersByTimeAsync(120_001);
    await expect(promise).rejects.toThrow(/no wallet connected/i);
  });
});
