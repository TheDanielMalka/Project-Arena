/**
 * match-lobby-mode.test.tsx
 *
 * Tests for the match format (mode) changes introduced with multi-player support.
 *
 * NOTE: Tests that require the "Custom Matches" Radix tab to be active are
 * intentionally omitted here — Radix UI Tabs does not render inactive tab
 * content in jsdom, and @testing-library/user-event is not installed.
 * Those interactions are covered by:
 *   - game-modes.config.test.ts  → all mode/game logic
 *   - match-store.test.ts        → store behavior with teamSize & depositsReceived
 *   - E2E (Playwright/Cypress)   → full tab switching flow
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MatchLobby from "@/pages/MatchLobby";
import { useMatchStore } from "@/stores/matchStore";
import { MATCH_STORE_TEST_FIXTURE } from "@/test/matchStoreFixture";

vi.mock("@/hooks/useMatchPolling", () => ({
  useMatchPolling: () => ({ pollNow: vi.fn(), resetEngineCheck: vi.fn() }),
}));

vi.mock("@/hooks/useActiveRoomServerSync", () => ({
  useActiveRoomServerSync: () => undefined,
}));

vi.mock("@/lib/engine-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine-api")>();
  return {
    ...actual,
    apiGetMe: vi.fn().mockResolvedValue(null),
  };
});

const SEED_MATCHES = MATCH_STORE_TEST_FIXTURE;

function renderLobby() {
  return render(
    <MemoryRouter>
      <MatchLobby />
    </MemoryRouter>,
  );
}

describe("MatchLobby — tab labels & public tab after mode changes", () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: SEED_MATCHES });
  });

  // ── Tab labels ────────────────────────────────────────────────────────────
  // Verifies the tab rename from "Custom 5v5" → "Custom Matches"

  it('renders "Custom Matches" tab', () => {
    renderLobby();
    const customTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.includes("Custom Matches"));
    expect(customTab).toBeDefined();
  });

  it('does NOT render a "Custom 5v5" tab', () => {
    renderLobby();
    const oldTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.includes("Custom 5v5"));
    expect(oldTab).toBeUndefined();
  });

  it("renders both Public Matches and Custom Matches tabs", () => {
    renderLobby();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.find((t) => t.textContent?.includes("Public Matches"))).toBeDefined();
    expect(tabs.find((t) => t.textContent?.includes("Custom Matches"))).toBeDefined();
    expect(tabs).toHaveLength(2);
  });

  // ── Public tab — existing behavior preserved ───────────────────────────────
  // Mode changes must not break the public lobby which is the default tab

  it("public tab is active by default and shows matches", () => {
    renderLobby();
    // Multiple elements may contain this text (live ticker + match list) — use getAllByText
    const els = screen.getAllByText("ShadowKill3r's Match");
    expect(els.length).toBeGreaterThan(0);
  });

  it("filters public matches by selected bet — $10 shows BlazeFury only", () => {
    renderLobby();
    fireEvent.click(screen.getByRole("button", { name: /\$10/ }));
    expect(screen.getByText("BlazeFury's Match")).toBeInTheDocument();
    expect(screen.queryByText("ShadowKill3r's Match")).not.toBeInTheDocument();
  });

  it("opens lobby details for a $5 match that is full", () => {
    renderLobby();
    fireEvent.click(screen.getByRole("button", { name: /\$5/ }));
    fireEvent.click(screen.getByText("NightHawk's Match"));
    expect(screen.getByText("Lobby Details")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join this lobby/i })).toBeDisabled();
  });

  // ── Seed matches with new modes ───────────────────────────────────────────
  // Verify the store contains new 2v2 and 4v4 seed matches

  it("store contains the new 2v2 seed match", () => {
    const match = useMatchStore.getState().matches.find((m) => m.id === "c4");
    expect(match).toBeDefined();
    expect(match?.mode).toBe("2v2");
    expect(match?.teamSize).toBe(2);
    expect(match?.maxPlayers).toBe(4);
    expect(match?.maxPerTeam).toBe(2);
  });

  it("store contains the new 4v4 seed match", () => {
    const match = useMatchStore.getState().matches.find((m) => m.id === "c5");
    expect(match).toBeDefined();
    expect(match?.mode).toBe("4v4");
    expect(match?.teamSize).toBe(4);
    expect(match?.maxPlayers).toBe(8);
    expect(match?.maxPerTeam).toBe(4);
  });

  it("existing 5v5 seed matches retain their team data", () => {
    const c1 = useMatchStore.getState().matches.find((m) => m.id === "c1");
    expect(c1?.mode).toBe("5v5");
    expect(c1?.teamSize).toBe(5);
    expect(c1?.maxPlayers).toBe(10);
    expect(c1?.teamA?.length).toBe(5);
  });

  it("all seed match modes are valid MatchMode values", () => {
    const validModes = ["1v1", "2v2", "4v4", "5v5"];
    useMatchStore.getState().matches.forEach((m) => {
      expect(validModes).toContain(m.mode);
    });
  });
});
