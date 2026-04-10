/**
 * Admin Panel — page-level tests
 *
 * API mocks mirror the real DB schema (disputes, users, audit_logs, platform_config).
 * All field names match the backend contract defined in engine-api.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useUserStore } from "@/stores/userStore";
import Admin from "@/pages/Admin";

// ── API mocks ─────────────────────────────────────────────────
vi.mock("@/lib/engine-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine-api")>();
  return {
    ...actual,

    // Auth — required so useUserStore.login() resolves with a real token
    apiLogin: vi.fn().mockResolvedValue({
      access_token: "test-admin-token",
      user_id: "admin-001",
      username: "admin_root",
      email: "admin@arena.gg",
      arena_id: null,
      wallet_address: null,
    }),
    apiGetMe: vi.fn().mockResolvedValue({
      user_id: "admin-001",
      username: "admin_root",
      email: "admin@arena.gg",
      arena_id: null,
      rank: "Admin",
      wallet_address: null,
      steam_id: null,
      riot_id: null,
      xp: 0,
      wins: 0,
      losses: 0,
      avatar: null,
      avatar_bg: null,
      equipped_badge_icon: null,
      forge_unlocked_item_ids: [],
      vip_expires_at: null,
      at_balance: 0,
      role: "admin",
    }),

    apiAdminFreezeStatus: vi.fn().mockResolvedValue({ ok: true, frozen: false }),
    apiAdminFreeze: vi.fn().mockResolvedValue({ ok: true, frozen: true, message: "Frozen" }),

    apiGetPlatformConfig: vi.fn().mockResolvedValue({
      ok: true,
      fee_pct: "5",
      daily_bet_max_at: "500",
      maintenance_mode: "false",
      new_registrations: "true",
      auto_escalate_disputes: "false",
    }),
    apiUpdatePlatformConfig: vi.fn().mockResolvedValue({ ok: true, updated: true, fields: ["fee_pct"] }),

    apiAdminGetDisputes: vi.fn().mockResolvedValue({
      ok: true,
      total: 3,
      disputes: [
        {
          id: "D-1051", match_id: "M-2048",
          raised_by: "uuid-a", raised_by_username: "DUNELZ",
          reason: "Disconnect wasn't counted",
          status: "open", resolution: "pending", admin_notes: null,
          game: "CS2", bet_amount: 120, stake_currency: "AT",
          created_at: "2026-03-08T14:22:00Z", resolved_at: null,
        },
        {
          id: "D-1050", match_id: "M-2045",
          raised_by: "uuid-b", raised_by_username: "DUNELZ",
          reason: "Suspected aim-bot",
          status: "reviewing", resolution: "pending", admin_notes: null,
          game: "Valorant", bet_amount: 75, stake_currency: "AT",
          created_at: "2026-03-08T11:05:00Z", resolved_at: null,
        },
        {
          id: "D-1042", match_id: "M-2025",
          raised_by: "uuid-c", raised_by_username: "DUNELZ",
          reason: "Both players claim victory",
          status: "resolved", resolution: "refund", admin_notes: null,
          game: "CS2", bet_amount: 90, stake_currency: "AT",
          created_at: "2026-03-06T17:40:00Z", resolved_at: "2026-03-06T18:00:00Z",
        },
      ],
    }),

    apiAdminGetUsers: vi.fn().mockResolvedValue({
      ok: true,
      total: 3,
      users: [
        {
          user_id: "U-301", username: "xDragon99", email: "x@arena.gg",
          status: "flagged", rank: "Gold", at_balance: 200,
          wallet_address: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
          matches: 54, wins: 50, win_rate: 92,
          penalty_count: 0, is_suspended: true, is_banned: false,
          suspended_until: "2026-04-10T00:00:00Z", banned_at: null,
        },
        {
          user_id: "U-288", username: "BlazeFury", email: "b@arena.gg",
          status: "banned", rank: "Silver", at_balance: 0,
          wallet_address: "0x1b8E44a1C9d2F3e4A5b6C7d8E9f0A1B2C3D4E5F6",
          matches: 31, wins: 24, win_rate: 78,
          penalty_count: 3, is_suspended: false, is_banned: true,
          suspended_until: null, banned_at: "2026-03-07T08:00:00Z",
        },
        {
          user_id: "U-275", username: "StormRider", email: "s@arena.gg",
          status: "cleared", rank: "Bronze", at_balance: 50,
          wallet_address: "0x9e2D3f4A5b6C7d8E9f0A1B2C3D4E5F6A7b8C9d0E",
          matches: 120, wins: 78, win_rate: 65,
          penalty_count: 0, is_suspended: false, is_banned: false,
          suspended_until: null, banned_at: null,
        },
      ],
    }),

    apiAdminIssuePenalty: vi.fn().mockResolvedValue({
      ok: true,
      penalized: true,
      user_id: "U-301",
      offense_count: 1,
      action: "suspended_24h",
      suspended_until: "2026-04-10T00:00:00Z",
      banned_at: null,
    }),

    apiAdminGetAuditLog: vi.fn().mockResolvedValue({
      ok: true,
      total: 2,
      entries: [
        {
          id: "A-1", admin_id: "admin-001", admin_username: "admin_root",
          action: "RESOLVE_DISPUTE", target_id: "D-1042",
          notes: "Awarded win to Player B", created_at: "2026-03-07T09:20:00Z",
        },
        {
          id: "A-2", admin_id: "admin-001", admin_username: "admin_root",
          action: "BAN_USER", target_id: "U-288",
          notes: "Permanent ban — smurf accounts", created_at: "2026-03-07T08:00:00Z",
        },
      ],
    }),

    apiAdminDeclareWinner: vi.fn().mockResolvedValue({
      ok: true, declared: true, match_id: "M-2048",
      winner_id: "uuid-a", stake_currency: "AT",
    }),

    apiAdminGetFraudReport: vi.fn().mockResolvedValue({
      ok: true,
      generated_at: new Date().toISOString(),
      flagged_players: [],
      suspicious_pairs: [],
      repeat_offenders: [],
      recently_banned: [],
      summary: { total_flagged: 0, high_winrate: 0, pair_farming: 0, repeat_offenders: 0 },
    }),

    apiAdminOracleStatus: vi.fn().mockResolvedValue({
      ok: true, escrow_enabled: false,
      listener_active: false, last_block: 0, last_sync_at: null,
    }),

    apiAdminOracleSync: vi.fn().mockResolvedValue({
      ok: true, synced: true, from_block: 0, to_block: 100, events_processed: 0,
    }),

    apiAdminListSupportTickets: vi.fn().mockResolvedValue({ ok: true, tickets: [] }),
    apiAdminPatchSupportTicket: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// ── Wrapper ───────────────────────────────────────────────────
const renderAdmin = () =>
  render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>
  );

// ── Setup ─────────────────────────────────────────────────────
beforeEach(async () => {
  useUserStore.getState().logout();
  await useUserStore.getState().login("admin@arena.gg", "test");
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
  it("shows disputes search by default", () => {
    renderAdmin();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("shows dispute IDs from API", async () => {
    renderAdmin();
    expect(await screen.findByText("D-1051")).toBeInTheDocument();
    expect(await screen.findByText("D-1050")).toBeInTheDocument();
  });

  it("filters disputes by status", async () => {
    renderAdmin();
    await screen.findByText("D-1051"); // wait for data
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    const resolvedOption = screen.getByText("Resolved");
    fireEvent.click(resolvedOption);
    expect(screen.queryByText("D-1051")).not.toBeInTheDocument();
  });

  it("opens resolve dialog for open dispute", async () => {
    renderAdmin();
    await screen.findByText("D-1051"); // wait for disputes to load
    const resolveBtn = screen.getAllByRole("button", { name: /resolve/i })[0];
    fireEvent.click(resolveBtn);
    expect(await screen.findByText(/confirm resolution/i)).toBeInTheDocument();
  });

  it("confirm resolution button is disabled without selection", async () => {
    renderAdmin();
    await screen.findByText("D-1051");
    const resolveBtn = screen.getAllByRole("button", { name: /resolve/i })[0];
    fireEvent.click(resolveBtn);
    const confirmBtn = await screen.findByRole("button", { name: /confirm resolution/i });
    expect(confirmBtn).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — users tab", () => {
  it("shows users from API when Users nav is clicked", async () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /users/i }));
    expect(await screen.findByText("xDragon99")).toBeInTheDocument();
    expect(await screen.findByText("BlazeFury")).toBeInTheDocument();
  });

  it("shows Penalty button for non-banned users", async () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /users/i }));
    await screen.findByText("xDragon99");
    const penaltyBtns = screen.getAllByRole("button", { name: /penalty/i });
    expect(penaltyBtns.length).toBeGreaterThan(0);
  });

  it("shows Clear button for flagged (non-banned) users", async () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /users/i }));
    await screen.findByText("xDragon99");
    expect(screen.getAllByRole("button", { name: /clear/i }).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe("Admin Panel — audit log tab", () => {
  it("shows audit log entries from API", async () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /audit log/i }));
    expect(await screen.findByText(/resolve dispute/i)).toBeInTheDocument();
    expect(await screen.findByText(/ban user/i)).toBeInTheDocument();
  });

  it("shows export button", async () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /audit log/i }));
    await screen.findByText(/resolve dispute/i);
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
describe("Admin Panel — reports tab", () => {
  it("loads reports from API and shows empty state when none", async () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /^reports$/i }));
    expect(await screen.findByText(/no reports in the database yet/i)).toBeInTheDocument();
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
