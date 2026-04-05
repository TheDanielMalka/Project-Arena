import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PlayerProfile from "@/pages/PlayerProfile";
import { useUserStore }    from "@/stores/userStore";
import { useFriendStore }  from "@/stores/friendStore";
import { useReportStore }  from "@/stores/reportStore";
import { friendApiFixture } from "@/test/friendApiFixture";

// ─── Helpers ──────────────────────────────────────────────────

/** Render profile route and wait until async fetch finishes (or not-found). */
async function renderProfileReady(username: string) {
  render(
    <MemoryRouter initialEntries={[`/players/${username}`]}>
      <Routes>
        <Route path="/players/:username" element={<PlayerProfile />} />
        <Route path="/players" element={<div>Back to Players</div>} />
      </Routes>
    </MemoryRouter>,
  );
  if (username === "GhostPlayer_404") {
    await waitFor(() => {
      expect(screen.getByText(/player not found/i)).toBeInTheDocument();
    });
    return;
  }
  await waitFor(() => {
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
}

beforeEach(async () => {
  // Always start with a logged-in user (ArenaPlayer_01 / user-001)
  await useUserStore.getState().login("player@arena.gg", "test");

  // Reset report store and friend store to clean state
  useReportStore.setState({ tickets: [] });
  friendApiFixture.friends = [
    { user_id: "user-002", username: "WingmanPro", arena_id: "ARENA-WP0002", avatar: null, equipped_badge_icon: null },
  ];
  friendApiFixture.incoming = [];
  friendApiFixture.outgoing = [];
  useFriendStore.setState({ ignoredUsers: [] });
  await useFriendStore.getState().fetchSocialFromServer();
});

// ─── Known player — ShadowKill3r (Diamond) ────────────────────

describe("PlayerProfile — known player (ShadowKill3r)", () => {
  it("renders the player username", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
  });

  it("shows rank badge (Diamond I)", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getByText(/Diamond I/i)).toBeInTheDocument();
  });

  it("shows preferred game (CS2)", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getAllByText(/CS2/i).length).toBeGreaterThan(0);
  });

  it("shows win rate stat card", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getAllByText(/win rate/i).length).toBeGreaterThan(0);
  });

  it("shows match count stat card", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getAllByText(/matches/i).length).toBeGreaterThan(0);
  });

  it("shows wins stat card", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getAllByText(/wins/i).length).toBeGreaterThan(0);
  });

  it("shows earnings stat card (DB: transactions.amount WHERE type=match_win)", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getAllByText(/earnings/i).length).toBeGreaterThan(0);
  });

  it("shows win/loss progress bar with W and L labels", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getByText(/95W/)).toBeInTheDocument();
    expect(screen.getByText(/39L/)).toBeInTheDocument();
  });

  it("shows total matches and win rate summary in bar", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getByText(/134 total matches/i)).toBeInTheDocument();
    expect(screen.getByText(/70\.9% win rate/i)).toBeInTheDocument();
  });

  it("shows Member since info", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getByText(/December 2025/i)).toBeInTheDocument();
  });

  it("shows Back to Players button", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getByRole("button", { name: /back to players/i })).toBeInTheDocument();
  });

  it("shows Add Friend button (not self, not already friends)", async () => {
    await renderProfileReady("ShadowKill3r");
    // ShadowKill3r is NOT in the reset friendships list → "Add Friend" should appear
    expect(screen.getByRole("button", { name: /add friend/i })).toBeInTheDocument();
  });

  it("shows Report button", async () => {
    await renderProfileReady("ShadowKill3r");
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });
});

// ─── Known player — WingmanPro (Gold, already a friend) ───────

describe("PlayerProfile — WingmanPro (existing friend)", () => {
  it("shows Friends button (disabled) when already friends", async () => {
    await renderProfileReady("WingmanPro");
    // WingmanPro is in friendships as "accepted" → shows disabled Friends button
    const friendsBtn = screen.getByRole("button", { name: /friends/i });
    expect(friendsBtn).toBeInTheDocument();
    expect(friendsBtn).toBeDisabled();
  });

  it("shows Report button even for existing friends", async () => {
    await renderProfileReady("WingmanPro");
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });

  it("shows Gold II rank", async () => {
    await renderProfileReady("WingmanPro");
    expect(screen.getByText(/Gold II/i)).toBeInTheDocument();
  });

  it("shows Valorant as preferred game", async () => {
    await renderProfileReady("WingmanPro");
    expect(screen.getAllByText(/Valorant/i).length).toBeGreaterThan(0);
  });
});

// ─── Status badges ─────────────────────────────────────────────

describe("PlayerProfile — status badges (DB: users.status CHECK constraint)", () => {
  it("shows Banned badge for BlazeFury (status=banned)", async () => {
    await renderProfileReady("BlazeFury");
    expect(screen.getByText(/banned/i)).toBeInTheDocument();
  });

  it("shows Flagged badge for PhantomAce (status=flagged)", async () => {
    await renderProfileReady("PhantomAce");
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
  });

  it("shows Flagged badge for xDragon99 (status=flagged — suspicious win rate)", async () => {
    await renderProfileReady("xDragon99");
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
  });

  it("active players show no status badge", async () => {
    await renderProfileReady("NovaBlade");
    expect(screen.queryByText(/banned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/flagged/i)).not.toBeInTheDocument();
  });
});

// ─── Self profile — action buttons hidden ─────────────────────

describe("PlayerProfile — own profile (isSelf detection)", () => {
  it("hides Add Friend and Report buttons when viewing own profile", async () => {
    // Make the logged-in user's username match a seed player
    useUserStore.getState().updateProfile({ username: "NovaBlade" });

    await renderProfileReady("NovaBlade");

    // Action buttons (Add Friend / Report) must NOT appear for own profile
    expect(screen.queryByRole("button", { name: /add friend/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /report/i })).not.toBeInTheDocument();
  });
});

// ─── Unknown player ────────────────────────────────────────────

describe("PlayerProfile — player not found", () => {
  it("shows 'Player not found' message for unknown username", async () => {
    await renderProfileReady("GhostPlayer_404");
    expect(screen.getByText(/player not found/i)).toBeInTheDocument();
  });

  it("shows Back to Players button even when player not found", async () => {
    await renderProfileReady("GhostPlayer_404");
    expect(screen.getByRole("button", { name: /back to players/i })).toBeInTheDocument();
  });
});

// ─── Report modal integration ─────────────────────────────────

describe("PlayerProfile — Report modal (POST /api/reports — DB-ready)", () => {
  it("opens report modal on Report button click", async () => {
    await renderProfileReady("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(screen.getByText(/report player/i)).toBeInTheDocument();
  });

  it("report modal shows the target player name", async () => {
    await renderProfileReady("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
  });

  it("Submit Report button is disabled when reason and description are empty", async () => {
    await renderProfileReady("NovaBlade");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const submitBtn = screen.getByRole("button", { name: /submit report/i });
    expect(submitBtn).toBeDisabled();
  });

  it("report modal can be cancelled without submitting", async () => {
    await renderProfileReady("NovaBlade");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useReportStore.getState().tickets).toHaveLength(0);
  });
});

// ─── Friend request modal integration ─────────────────────────

describe("PlayerProfile — Friend Request modal (POST /api/friends — DB-ready)", () => {
  it("opens friend request modal on Add Friend click", async () => {
    await renderProfileReady("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    expect(screen.getByText(/send friend request/i)).toBeInTheDocument();
  });

  it("friend request modal shows target player and arenaId", async () => {
    await renderProfileReady("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/ARENA-SK0003/i)).toBeInTheDocument();
  });

  it("friend request modal has optional message textarea", async () => {
    await renderProfileReady("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    expect(screen.getByPlaceholderText(/Hey! Want to play together|Add a message/i)).toBeInTheDocument();
  });

  it("sends friend request and stores it (→ POST /api/friends in DB)", async () => {
    await renderProfileReady("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    fireEvent.click(screen.getByRole("button", { name: /send request|send/i }));
    await waitFor(() => {
      const shadowFr = useFriendStore.getState().friendships.find((fr) => fr.friendId === "user-003");
      expect(shadowFr).toBeDefined();
      expect(shadowFr?.status).toBe("pending");
    });
  });

  it("after sending request button changes to Pending (cancel state)", async () => {
    await renderProfileReady("ShadowKill3r");
    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));
    fireEvent.click(screen.getByRole("button", { name: /send request|send/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /pending/i }).length).toBeGreaterThan(0);
    });
  });
});
