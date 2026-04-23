/**
 * UI tests for the two escrow-adjacent wallet modals (audit coverage gap).
 *
 *   - BuyArenaTokensModal: USDT tx-hash submission + AT crediting flow
 *   - WithdrawATModal:     AT burn + BNB withdrawal (1050 AT = $10),
 *                          amount validation, wallet-destination guard
 *
 * These components previously had no direct tests — only the shared
 * wallet store was tested. They are the primary entry points for moving
 * money between on-chain wallets and the Arena server, so they must
 * fail closed on malformed input and must never fire network calls
 * when state is invalid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BuyArenaTokensModal } from "@/components/wallet/BuyArenaTokensModal";
import { WithdrawATModal } from "@/components/wallet/WithdrawATModal";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { useNotificationStore } from "@/stores/notificationStore";

// ─────────────────────────────────────────────────────────────────────────────
// engine-api access.
//
// setup.ts already wraps @/lib/engine-api with vi.mock and returns vi.fn()
// implementations for the auth/profile calls (apiLogin, apiGetMe, etc.) plus
// the two AT endpoints (apiGetAtPackages, apiBuyAtPackage). Overriding
// @/lib/engine-api again with a fresh vi.mock in this file would replace the
// whole module and strip those auth mocks — login would hit the real
// network, token would stay null, the Withdraw button would stay disabled
// forever. So we re-use the existing mocks via vi.mocked(...) and add a
// module-level spy for apiWithdrawAT, which setup.ts does not mock.
// ─────────────────────────────────────────────────────────────────────────────

import * as engineApi from "@/lib/engine-api";

const apiGetAtPackages = vi.mocked(engineApi.apiGetAtPackages);
const apiBuyAtPackage = vi.mocked(engineApi.apiBuyAtPackage);
const apiWithdrawAT = vi.spyOn(engineApi, "apiWithdrawAT");

async function loginAs() {
  await useUserStore.getState().login("player@arena.gg", "test");
}

function resetWalletStore(overrides: Partial<ReturnType<typeof useWalletStore.getState>> = {}) {
  useWalletStore.setState({
    usdtBalance: 1000,
    atBalance: 5000,
    transactions: [],
    dailyBettingLimit: 500,
    dailyBettingUsed: 0,
    connectedAddress: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
    selectedNetwork: "bsc",
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BuyArenaTokensModal
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PACKAGES = [
  { at_amount: 500, usdt_price: 5, discount_pct: 0, final_price: 5 },
  { at_amount: 1000, usdt_price: 10, discount_pct: 5, final_price: 9.5 },
  { at_amount: 2500, usdt_price: 25, discount_pct: 5, final_price: 23.75 },
];

function resetApiMocks() {
  apiGetAtPackages.mockReset();
  apiGetAtPackages.mockResolvedValue({ packages: DEFAULT_PACKAGES });
  apiBuyAtPackage.mockReset();
  apiWithdrawAT.mockReset();
}

describe("BuyArenaTokensModal", () => {
  beforeEach(async () => {
    resetApiMocks();
    localStorage.clear();
    useUserStore.getState().logout();
    await loginAs();
    resetWalletStore();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the package grid once apiGetAtPackages resolves", async () => {
    render(<BuyArenaTokensModal open onClose={() => {}} />);
    await waitFor(() => expect(apiGetAtPackages).toHaveBeenCalled());
    // Package cards render as <button type="button"> — three distinct buttons.
    const cards = await screen.findAllByRole("button", { name: /AT\s+List/i });
    const labels = cards.map((b) => (b.textContent ?? "").replace(/\s+/g, " "));
    expect(labels.some((t) => t.includes("500 AT"))).toBe(true);
    expect(labels.some((t) => t.includes("1,000 AT"))).toBe(true);
    expect(labels.some((t) => t.includes("2,500 AT"))).toBe(true);
  });

  it("shows an error state when apiGetAtPackages returns null (network error)", async () => {
    apiGetAtPackages.mockResolvedValueOnce(null);
    render(<BuyArenaTokensModal open onClose={() => {}} />);
    expect(await screen.findByText(/could not load packages/i)).toBeInTheDocument();
  });

  it("rejects a malformed tx hash before hitting the network (fail-closed)", async () => {
    render(<BuyArenaTokensModal open onClose={() => {}} />);
    await screen.findAllByRole("button", { name: /AT\s+List/i });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const input = await screen.findByPlaceholderText("0x…");
    fireEvent.change(input, { target: { value: "not-a-hash" } });
    fireEvent.click(screen.getByRole("button", { name: /submit.*credit at/i }));

    expect(await screen.findByText(/valid BSC transaction hash/i)).toBeInTheDocument();
    expect(apiBuyAtPackage).not.toHaveBeenCalled();
  });

  it("submits a correctly-formatted tx hash to apiBuyAtPackage", async () => {
    apiBuyAtPackage.mockResolvedValueOnce({
      ok: true, at_balance: 6000, at_credited: 500, usdt_spent: 5, discount_pct: 0,
    });
    render(<BuyArenaTokensModal open onClose={() => {}} />);
    await screen.findAllByRole("button", { name: /AT\s+List/i });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const input = await screen.findByPlaceholderText("0x…");
    const validHash = "0x" + "a".repeat(64);
    fireEvent.change(input, { target: { value: validHash } });
    fireEvent.click(screen.getByRole("button", { name: /submit.*credit at/i }));

    await waitFor(() => expect(apiBuyAtPackage).toHaveBeenCalledTimes(1));
    const call = apiBuyAtPackage.mock.calls[0];
    expect(call[1]).toEqual({ tx_hash: validHash, at_amount: 500 });
  });

  it("shows server error and stays on confirm step when purchase fails", async () => {
    apiBuyAtPackage.mockResolvedValueOnce({
      ok: false, status: 409, detail: "Transaction already processed",
    });
    render(<BuyArenaTokensModal open onClose={() => {}} />);
    await screen.findAllByRole("button", { name: /AT\s+List/i });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const input = await screen.findByPlaceholderText("0x…");
    fireEvent.change(input, { target: { value: "0x" + "b".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: /submit.*credit at/i }));

    expect(await screen.findByText(/transaction already processed/i)).toBeInTheDocument();
    // Input is still visible → we stayed on step 'confirm', not 'success'.
    expect(screen.getByPlaceholderText("0x…")).toBeInTheDocument();
  });

  it("shows success summary with credited AT after a successful purchase", async () => {
    apiBuyAtPackage.mockResolvedValueOnce({
      ok: true, at_balance: 1500, at_credited: 1000, usdt_spent: 9.5, discount_pct: 5,
    });
    render(<BuyArenaTokensModal open onClose={() => {}} />);
    const cards = await screen.findAllByRole("button", { name: /AT\s+List/i });
    // Select the 1000 AT package explicitly.
    const card1k = cards.find((b) => (b.textContent ?? "").includes("1,000 AT"))!;
    fireEvent.click(card1k);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const input = await screen.findByPlaceholderText("0x…");
    fireEvent.change(input, { target: { value: "0x" + "c".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: /submit.*credit at/i }));

    expect(await screen.findByText(/AT credited/i)).toBeInTheDocument();
    expect(screen.getByText(/\+1,000 AT/)).toBeInTheDocument();
    expect(screen.getByText(/\$9\.50/)).toBeInTheDocument();
  });

  it("deduplicates packages returned with duplicate at_amount keys", async () => {
    apiGetAtPackages.mockResolvedValueOnce({
      packages: [
        { at_amount: 500, usdt_price: 5, discount_pct: 0, final_price: 5 },
        { at_amount: 500, usdt_price: 5, discount_pct: 0, final_price: 5 },
        { at_amount: 1000, usdt_price: 10, discount_pct: 0, final_price: 10 },
      ],
    });
    render(<BuyArenaTokensModal open onClose={() => {}} />);
    const cards = await screen.findAllByRole("button", { name: /AT\s+List/i });
    const cards500 = cards.filter((b) => (b.textContent ?? "").includes("500 AT"));
    expect(cards500.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WithdrawATModal
// ─────────────────────────────────────────────────────────────────────────────

describe("WithdrawATModal", () => {
  beforeEach(async () => {
    resetApiMocks();
    localStorage.clear();
    useUserStore.getState().logout();
    await loginAs();
    resetWalletStore();
    useNotificationStore.setState({ notifications: [] });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders nothing when open=false", () => {
    const { container } = render(<WithdrawATModal open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows destination wallet short-address and AT balance", () => {
    render(<WithdrawATModal open onClose={() => {}} />);
    // shortAddr format: first 8 chars + "..." + last 6 chars.
    expect(screen.getByText(/0x7a3F9c\.\.\.5E6f7A/)).toBeInTheDocument();
    expect(screen.getByText(/5,000 AT/)).toBeInTheDocument();
  });

  it("disables the withdraw button when no wallet is connected", () => {
    resetWalletStore({ connectedAddress: null });
    useUserStore.setState((s) =>
      s.user ? { user: { ...s.user, walletAddress: null, walletShort: "" } } : {}
    );
    render(<WithdrawATModal open onClose={() => {}} />);
    expect(screen.getByText(/no wallet connected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeDisabled();
  });

  it("blocks submission when AT amount is below the minimum chunk", () => {
    render(<WithdrawATModal open onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/^1050, 2100/);
    // Min chunk = 1050. 500 is below min.
    fireEvent.change(input, { target: { value: "500" } });
    expect(screen.getByText(/invalid amount/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeDisabled();
  });

  it("blocks submission when AT amount is not a multiple of 1050", () => {
    render(<WithdrawATModal open onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/^1050, 2100/);
    fireEvent.change(input, { target: { value: "1150" } }); // 1150 % 1050 ≠ 0
    expect(screen.getByText(/invalid amount/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeDisabled();
  });

  it("blocks submission when balance is insufficient", () => {
    resetWalletStore({ atBalance: 500 });
    render(<WithdrawATModal open onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/^1050, 2100/);
    fireEvent.change(input, { target: { value: "1050" } });
    expect(screen.getByText(/insufficient at/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeDisabled();
  });

  it("blocks submission above the 10,000 AT daily limit", () => {
    resetWalletStore({ atBalance: 50_000 });
    render(<WithdrawATModal open onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/^1050, 2100/);
    // 10500 is a multiple of 1050 AND > 10,000 daily cap.
    fireEvent.change(input, { target: { value: "10500" } });
    expect(screen.getByText(/exceeds daily limit/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeDisabled();
  });

  it("Max button snaps to the largest valid multiple of 1050 under balance", () => {
    resetWalletStore({ atBalance: 2500 }); // floor(2500/1050)*1050 = 2100
    render(<WithdrawATModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /max/i }));
    const input = screen.getByPlaceholderText(/^1050, 2100/) as HTMLInputElement;
    expect(input.value).toBe("2100");
  });

  it("submits a valid amount to apiWithdrawAT", async () => {
    apiWithdrawAT.mockResolvedValueOnce({
      ok: true, at_burned: 1050, usdt_value: 10,
      wallet_address: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
      at_balance: 3950, daily_remaining: 8950, rate: "105 AT = $1 USDT",
    });
    const onClose = vi.fn();
    render(<WithdrawATModal open onClose={onClose} />);
    const input = screen.getByPlaceholderText(/^1050, 2100/);
    fireEvent.change(input, { target: { value: "1050" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    });
    await waitFor(() => expect(apiWithdrawAT).toHaveBeenCalledTimes(1));
    const call = apiWithdrawAT.mock.calls[0];
    expect(call[1]).toEqual({ at_amount: 1050 });
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces server failure via notification and keeps the modal open", async () => {
    apiWithdrawAT.mockResolvedValueOnce({
      ok: false, status: 429, detail: "Daily limit reached",
    });
    const onClose = vi.fn();
    render(<WithdrawATModal open onClose={onClose} />);
    const input = screen.getByPlaceholderText(/^1050, 2100/);
    fireEvent.change(input, { target: { value: "1050" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    });
    await waitFor(() => expect(apiWithdrawAT).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    const notes = useNotificationStore.getState().notifications;
    expect(notes.some((n) => /withdrawal failed/i.test(n.title))).toBe(true);
    expect(notes.some((n) => /daily limit reached/i.test(n.message ?? ""))).toBe(true);
  });

  it("shows converted USDT preview for a valid AT amount", () => {
    render(<WithdrawATModal open onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/^1050, 2100/);
    fireEvent.change(input, { target: { value: "2100" } });
    // 2100 AT / 105 = 20 USDT
    const previews = screen.getAllByText(/\$20\.00 USDT/);
    expect(previews.length).toBeGreaterThan(0);
    const previewBlock = previews[0]!.closest("div");
    expect(previewBlock && within(previewBlock).getByText(/2,100 AT/)).toBeTruthy();
  });
});
