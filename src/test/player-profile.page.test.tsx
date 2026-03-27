import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PlayerProfile from "@/pages/PlayerProfile";
import { useUserStore }    from "@/stores/userStore";
import { useFriendStore }  from "@/stores/friendStore";
import { useReportStore }  from "@/stores/reportStore";

// ─── Helpers ──────────────────────────────────────────────────

/** Render /players/:username with a proper route so useParams works */
function renderProfile(username: string) {
  return render(
    <MemoryRouter initialEntries={[`/players/${username}`]}>
      <Routes>
        <Route path="/players/:username" element={<PlayerProfile />} />
        <Route path="/players" element={<div>Back to Players</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  // Always start with a logged-in user (ArenaPlayer_01 / user-001)
  useUserStore.getState().login("player@arena.gg", "test");

  // Reset report store and friend store to clean state
  useReportStore.setState({ tickets: [] });
  useFriendStore.setState({
    friendships: [
      {
        id: "fr-001", initiatorId: "user-001", receiverId: "user-002",
        friendId: "user-002", friendUsername: "WingmanPro", friendArenaId: "ARENA-WP0002",
        friendAvatarInitials: "WP", friendRank: "Gold II", friendTier: "Gold",
        friendPreferredGame: "Valorant", status: "accepted",
        createdAt: "2026-03-01T10:00:00Z", updatedAt: "2026-03-01T10:05:00Z",
      },
    ],
  });
});

// ─── Known player — ShadowKill3r (Diamond) ────────────────────

describe("PlayerProfile — known player (ShadowKill3r)", () => {
  it("renders the player username", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
  });

  it("shows rank badge (Diamond I)", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getByText(/Diamond I/i)).toBeInTheDocument();
  });

  it("shows preferred game (CS2)", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getAllByText(/CS2/i).length).toBeGreaterThan(0);
  });

  it("shows win rate stat card", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getAllByText(/win rate/i).length).toBeGreaterThan(0);
  });

  it("shows match count stat card", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getAllByText(/matches/i).length).toBeGreaterThan(0);
  });

  it("shows wins stat card", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getAllByText(/wins/i).length).toBeGreaterThan(0);
  });

  it("shows earnings stat card (DB: transactions.amount WHERE type=match_win)", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getAllByText(/earnings/i).length).toBeGreaterThan(0);
  });

  it("shows win/loss progress bar with W and L labels", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getByText(/95W/)).toBeInTheDocument();
    expect(screen.getByText(/39L/)).toBeInTheDocument();
  });

  it("shows total matches and win rate summary in bar", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getByText(/134 total matches/i)).toBeInTheDocument();
    expect(screen.getByText(/70\.9% win rate/i)).toBeInTheDocument();
  });

  it("shows Member since info", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getByText(/December 2025/i)).toBeInTheDocument();
  });

  it("shows Back to Players button", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getByRole("button", { name: /back to players/i })).toBeInTheDocument();
  });

  it("shows Add Friend button (not self, not already friends)", () => {
    renderProfile("ShadowKill3r");
    // ShadowKill3r is NOT in the reset friendships list → "Add Friend" should appear
    expect(screen.getByRole("button", { name: /add friend/i })).toBeInTheDocument();
  });

  it("shows Report button", () => {
    renderProfile("ShadowKill3r");
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });
});

// ─── Known player — WingmanPro (Gold, already a friend) ───────

describe("PlayerProfile — WingmanPro (existing friend)", () => {
  it("shows Friends button (disabled) when already friends", () => {
    renderProfile("WingmanPro");
    // WingmanPro is in friendships as "accepted" → shows disabled Friends button
    const friendsBtn = screen.getByRole("button", { name: /friends/i });
    expect(friendsBtn).toBeInTheDocument();
    expect(friendsBtn).toBeDisabled();
  });

  it("shows Report button even for existing friends", () => {
    renderProfile("WingmanPro");
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });

  it("shows Gold II rank", () => {
    renderProfile("WingmanPro");
    expect(screen.getByText(/Gold II/i)).toBeInTheDocument();
  });

  it("shows Valorant as preferred game", () => {
    renderProfile("WingmanPro");
    expect(screen.getAllByText(/Valorant/i).length).toBeGreaterThan(0);
  });
});

// ─── Status badges ─────────────────────────────────────────────

describe("PlayerProfile — status badges (DB: users.status CHECK constraint)", () => {
  it("shows Banned badge for BlazeFury (status=banned)", () => {
    renderProfile("BlazeFury");
    expect(screen.getByText(/banned/i)).toBeInTheDocument();
  });

  it("shows Flagged badge for PhantomAce (status=flagged)", () => {
    renderProfile("PhantomAce");
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
  });

  it("shows Flagged badge for xDragon99 (status=flagged — suspicious win rate)", () => {
    renderProfile("xDragon99");
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
  });

  it("active players show no status badge", () => {
    renderProfile("NovaBlade");
    expect(screen.queryByText(/banned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/flagged/i)).not.toBeInTheDocument();
  });
});

// ─── Self profile — action buttons hidden ─────────────────────

describe("PlayerProfile — own profile (isSelf detection)", () => {
  it("hides Add Friend and Report buttons when viewing own profile", () => {
    // Make the logged-in user's username match a seed player
    useUserStore.getState().updateProfile({ username: "NovaBlade" });

    renderProfile("NovaBlade");

    // Action buttons (Add Friend / Report) must NOT appear for own profile
    expect(screen.queryByRole("button", { name: /add friend/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /report/i })).not.toBeInTheDocument();
  });
});

// ─── Unknown player ────────────────────────────────────────────

describe("PlayerProfile — player not found", () => {
  it("shows 'Player not found' message for unknown username", () => {
    renderProfile("GhostPlayer_404");
    expect(screen.getByText(/player not found/i)).toBeInTheDocument();
  });

  it("shows Back to Players button even when player not found", () => {
    renderProfile("GhostPlayer_404");
    expect(screen.getByRole("button", { name: /back to players/i })).toBeInTheDocument();
  });
});

// ─── Report modal integration ─────────────────────────────────

describe("PlayerProfile — Report modal (POST /api/reports — DB-ready)", () => {
  it("opens report modal on Report button click", () => {
    renderProfile("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(screen.getByText(/report player/i)).toBeInTheDocument();
  });

  it("report modal shows the target player name", () => {
    renderProfile("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
  });

  it("Submit Report button is disabled when reason and description are empty", () => {
    renderProfile("NovaBlade");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const submitBtn = screen.getByRole("button", { name: /submit report/i });
    expect(submitBtn).toBeDisabled();
  });

  it("report modal can be cancelled without submitting", () => {
    renderProfile("NovaBlade");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useReportStore.getState().tickets).toHaveLength(0);
  });
});

// ─── Friend request modal integration ─────────────────────────

describe("PlayerProfile — Friend Request modal (POST /api/friends — DB-ready)", () => {
  it("opens friend request modal on Add Friend click", () => {
    renderProfile("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    expect(screen.getByText(/send friend request/i)).toBeInTheDocument();
  });

  it("friend request modal shows target player and arenaId", () => {
    renderProfile("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/ARENA-SK0003/i)).toBeInTheDocument();
  });

  it("friend request modal has optional message textarea", () => {
    renderProfile("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    expect(screen.getByPlaceholderText(/Hey! Want to play together|Add a message/i)).toBeInTheDocument();
  });

  it("sends friend request and stores it (→ POST /api/friends in DB)", () => {
    renderProfile("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    fireEvent.click(screen.getByRole("button", { name: /send request|send/i }));
    // friendStore should now have a pending request for ShadowKill3r (user-003)
    const shadowFr = useFriendStore.getState().friendships.find(
      (fr) => fr.friendId === "user-003"
    );
    expect(shadowFr).toBeDefined();
    expect(shadowFr?.status).toBe("pending");
  });

  it("after sending request button changes to Pending (cancel state)", () => {
    renderProfile("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    fireEvent.click(screen.getByRole("button", { name: /send request|send/i }));
    // Re-render to reflect new store state — use cleanup + fresh render
    const { unmount } = renderProfile("ShadowKill3r");
    // Multiple renders may coexist; verify at least one Pending button exists
    expect(screen.getAllByRole("button", { name: /pending/i }).length).toBeGreaterThan(0);
    unmount();
  });
});
