/**
 * Admin Panel — page-level tests
 *
 * DB-ready notes:
 * - All mock data mirrors the real DB schema (disputes, flagged_users, audit_logs, platform_settings)
 * - When API is connected: replace SEED_* with MSW handlers for /admin/* endpoints
 * - Field names match DB columns: createdAt → audit_logs.created_at, walletAddress → users.wallet_address
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useUserStore } from "@/stores/userStore";
import Admin from "@/pages/Admin";

// ── Wrapper ───────────────────────────────────────────────────
const renderAdmin = () =>
  render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>
  );

// ── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
  useUserStore.getState().logout();
  useUserStore.getState().login("admin@arena.gg", "test");
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — header & stats", () => {
  it("renders Admin Panel heading", () => {
    renderAdmin();
    expect(screen.getByRole("heading", { name: /admin panel/i })).toBeInTheDocument();
  });

  it("shows Restricted badge", () => {
    renderAdmin();
    expect(screen.getByText(/restricted/i)).toBeInTheDocument();
  });

  it("renders stats strip with Open Disputes label", () => {
    renderAdmin();
    expect(screen.getByText(/open disputes/i)).toBeInTheDocument();
  });

  it("renders Kill Switch button", () => {
    renderAdmin();
    expect(screen.getByRole("button", { name: /kill switch/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — disputes tab", () => {
  it("shows disputes table by default", () => {
    renderAdmin();
    expect(screen.getByPlaceholderText(/search disputes/i)).toBeInTheDocument();
  });

  it("shows seed dispute IDs", () => {
    renderAdmin();
    expect(screen.getByText("D-1051")).toBeInTheDocument();
    expect(screen.getByText("D-1050")).toBeInTheDocument();
  });

  it("filters disputes by status", () => {
    renderAdmin();
    // Click the status filter
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    const resolvedOption = screen.getByText("Resolved");
    fireEvent.click(resolvedOption);
    // Only resolved disputes should be visible (D-1045, D-1042)
    expect(screen.queryByText("D-1051")).not.toBeInTheDocument();
  });

  it("opens resolve dialog for open dispute", async () => {
    renderAdmin();
    const resolveBtn = screen.getAllByRole("button", { name: /resolve/i })[0];
    fireEvent.click(resolveBtn);
    expect(await screen.findByText(/confirm resolution/i)).toBeInTheDocument();
  });

  it("confirm resolution button is disabled without selection", async () => {
    renderAdmin();
    const resolveBtn = screen.getAllByRole("button", { name: /resolve/i })[0];
    fireEvent.click(resolveBtn);
    const confirmBtn = await screen.findByRole("button", { name: /confirm resolution/i });
    expect(confirmBtn).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — users tab", () => {
  it("shows flagged users when Users nav is clicked", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /users/i }));
    expect(screen.getByText("xDragon99")).toBeInTheDocument();
    expect(screen.getByText("BlazeFury")).toBeInTheDocument();
  });

  it("shows Ban button for flagged users", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /users/i }));
    const banBtns = screen.getAllByRole("button", { name: /ban/i });
    expect(banBtns.length).toBeGreaterThan(0);
  });

  it("shows Clear button for flagged (non-banned) users", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /users/i }));
    expect(screen.getAllByRole("button", { name: /clear/i }).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — audit log tab", () => {
  it("shows audit log entries", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /audit log/i }));
    expect(screen.getByText("RESOLVE_DISPUTE")).toBeInTheDocument();
    expect(screen.getByText("BAN_USER")).toBeInTheDocument();
  });

  it("shows export button", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /audit log/i }));
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — platform settings tab", () => {
  it("shows platform fee control", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /platform/i }));
    expect(screen.getByText(/platform fee/i)).toBeInTheDocument();
  });

  it("shows daily betting max control", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /platform/i }));
    expect(screen.getByText(/daily betting max/i)).toBeInTheDocument();
  });

  it("shows maintenance mode toggle", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /platform/i }));
    expect(screen.getByText(/maintenance mode/i)).toBeInTheDocument();
  });

  it("shows Save Platform Settings button", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /platform/i }));
    expect(screen.getByRole("button", { name: /save platform settings/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — kill switch", () => {
  it("opens kill switch confirmation dialog", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /kill switch/i }));
    expect(screen.getAllByText(/activate kill switch/i).length).toBeGreaterThan(0);
  });

  it("cancel closes kill switch dialog without activating", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /kill switch/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/deactivate freeze/i)).not.toBeInTheDocument();
  });
});
