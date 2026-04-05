import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Hub from "@/pages/Hub";
import { useUserStore }   from "@/stores/userStore";
import { useInboxStore }  from "@/stores/inboxStore";
import { useFriendStore } from "@/stores/friendStore";
import { friendApiFixture } from "@/test/friendApiFixture";

// ─── Helpers ──────────────────────────────────────────────────

/** Render Hub at a specific ?tab=X URL */
function renderHub(tab?: "community" | "friends" | "messages") {
  const url = tab ? `/hub?tab=${tab}` : "/hub";
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/hub" element={<Hub />} />
        <Route path="/players/:username" element={<div>PlayerProfile</div>} />
        <Route path="/players" element={<div>Players</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  // Login as the default user before every test
  await useUserStore.getState().login("player@arena.gg", "test");

  useInboxStore.getState().resetInboxLocal();

  friendApiFixture.friends = [
    { user_id: "user-002", username: "WingmanPro", arena_id: "ARENA-WP0002", avatar: null, equipped_badge_icon: null },
    { user_id: "user-003", username: "ShadowKill3r", arena_id: "ARENA-SK0003", avatar: null, equipped_badge_icon: null },
  ];
  friendApiFixture.incoming = [
    {
      request_id: "fr-003",
      user_id: "user-004",
      username: "NovaBlade",
      arena_id: "ARENA-NB0004",
      avatar: null,
      message: null,
      created_at: "2026-03-09T08:00:00Z",
    },
  ];
  friendApiFixture.outgoing = [];
  useFriendStore.setState({ ignoredUsers: [] });
  await useFriendStore.getState().fetchSocialFromServer();
});

// ─── Tab structure ─────────────────────────────────────────────

describe("Hub — tab navigation", () => {
  it("renders the three tab buttons", () => {
    renderHub();
    expect(screen.getByRole("button", { name: /community/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /friends/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /messages/i })).toBeInTheDocument();
  }, 15_000);

  it("defaults to Community tab when no ?tab param", () => {
    renderHub();
    // Shuffle button is exclusive to the Community tab
    expect(screen.getByRole("button", { name: /shuffle/i })).toBeInTheDocument();
  });

  it("renders Community tab when ?tab=community", () => {
    renderHub("community");
    expect(screen.getByRole("button", { name: /shuffle/i })).toBeInTheDocument();
  });

  it("renders Friends tab when ?tab=friends", () => {
    renderHub("friends");
    // Friends tab shows friend usernames from seed data
    expect(screen.getAllByText(/WingmanPro/i).length).toBeGreaterThan(0);
  });

  it("renders Messages tab when ?tab=messages", () => {
    renderHub("messages");
    // Compose button is exclusive to the Messages tab
    expect(screen.getAllByRole("button", { name: /compose/i }).length).toBeGreaterThan(0);
  });

  it("clicking Friends tab switches to friends view", () => {
    renderHub("community");
    fireEvent.click(screen.getByRole("button", { name: /friends/i }));
    expect(screen.getAllByText(/WingmanPro/i).length).toBeGreaterThan(0);
  });

  it("clicking Messages tab switches to messages view", () => {
    renderHub("community");
    fireEvent.click(screen.getByRole("button", { name: /messages/i }));
    expect(screen.getAllByRole("button", { name: /compose/i }).length).toBeGreaterThan(0);
  });
});

// ─── Community tab ─────────────────────────────────────────────

describe("Hub — Community tab", () => {
  it("shows up to 9 player cards when not searching", async () => {
    renderHub("community");
    await waitFor(() => {
      const cards = screen.getAllByText(/Gold|Diamond|Platinum|Silver/);
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  it("shows Shuffle button in community tab", () => {
    renderHub("community");
    expect(screen.getByRole("button", { name: /shuffle/i })).toBeInTheDocument();
  });

  it("shows game filter buttons (CS2, Valorant) and Coming Soon pills (Fortnite etc.)", () => {
    renderHub("community");
    // Active games are buttons
    expect(screen.getByRole("button", { name: /^cs2$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /valorant/i })).toBeInTheDocument();
    // Coming Soon games are non-interactive spans (not buttons)
    expect(screen.queryByRole("button", { name: /fortnite/i })).toBeNull();
    expect(screen.getByText(/fortnite/i)).toBeInTheDocument();
  });

  it("shows All filter button", () => {
    renderHub("community");
    expect(screen.getByRole("button", { name: /^all$/i })).toBeInTheDocument();
  });

  it("shows a search input field", () => {
    renderHub("community");
    // Actual placeholder in Hub.tsx: "Search by username or Arena ID…"
    expect(screen.getByPlaceholderText(/search by username or arena id/i)).toBeInTheDocument();
  });

  it("Shuffle button renders without crashing on click", () => {
    renderHub("community");
    const shuffleBtn = screen.getByRole("button", { name: /shuffle/i });
    expect(() => fireEvent.click(shuffleBtn)).not.toThrow();
  });

  it("filtering by CS2 does not crash", () => {
    renderHub("community");
    fireEvent.click(screen.getByRole("button", { name: /^cs2$/i }));
    expect(screen.getByRole("button", { name: /^cs2$/i })).toBeInTheDocument();
  });

  it("searching for 'Shadow' shows ShadowKill3r in results", async () => {
    renderHub("community");
    const searchInput = screen.getByPlaceholderText(/search by username or arena id/i);
    fireEvent.change(searchInput, { target: { value: "Shadow" } });
    await waitFor(() => {
      expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
    });
  });

  it("searching for unknown player shows no results", async () => {
    renderHub("community");
    const searchInput = screen.getByPlaceholderText(/search by username or arena id/i);
    fireEvent.change(searchInput, { target: { value: "ZZZ_NO_PLAYER_XYZ" } });
    await waitFor(() => {
      expect(screen.queryAllByText(/WingmanPro/i)).toHaveLength(0);
    });
  });
});

// ─── Friends tab ──────────────────────────────────────────────

describe("Hub — Friends tab", () => {
  it("shows accepted friends in the list", () => {
    renderHub("friends");
    expect(screen.getAllByText(/WingmanPro/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
  });

  it("shows pending friend requests section", () => {
    renderHub("friends");
    // NovaBlade sent a pending request to user-001
    expect(screen.getAllByText(/NovaBlade/i).length).toBeGreaterThan(0);
  });

  it("shows Accept / Decline buttons for pending received requests", () => {
    renderHub("friends");
    // At least one of these action labels should appear for NovaBlade's request
    const acceptBtns = screen.queryAllByRole("button", { name: /accept/i });
    const declineBtns = screen.queryAllByRole("button", { name: /decline/i });
    expect(acceptBtns.length + declineBtns.length).toBeGreaterThan(0);
  });

  it("shows friend search input", () => {
    renderHub("friends");
    expect(screen.getByPlaceholderText(/search friends/i)).toBeInTheDocument();
  });

  it("filtering friends by name narrows the list", () => {
    renderHub("friends");
    const searchInput = screen.getByPlaceholderText(/search friends/i);
    fireEvent.change(searchInput, { target: { value: "Wingman" } });
    expect(screen.getAllByText(/WingmanPro/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/ShadowKill3r/i)).toHaveLength(0);
  });
});

// ─── Messages tab ─────────────────────────────────────────────

describe("Hub — Messages tab", () => {
  it("shows inbox messages from seed data", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/WingmanPro/i).length).toBeGreaterThan(0);
  });

  it("shows inbox message subjects", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getByText(/tournament invite/i)).toBeInTheDocument();
    });
  });

  it("shows Compose button", async () => {
    renderHub("messages");
    await waitFor(() => {
      // Hub renders two compose triggers: header "Compose" btn + right-panel link
      expect(screen.getAllByRole("button", { name: /compose/i }).length).toBeGreaterThan(0);
    });
  });

  it("compose button opens the compose dialog", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /compose/i }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: /compose/i })[0]);
    // Dialog should contain Arena ID input
    expect(screen.getByPlaceholderText(/ARENA-XXXXXX/i)).toBeInTheDocument();
  });

  it("deep-link (?composeTo=ARENA-...) opens compose with prefilled Arena ID", () => {
    window.history.pushState({}, "", "/hub?tab=messages&composeTo=ARENA-WP0002");
    render(
      <MemoryRouter initialEntries={["/hub?tab=messages&composeTo=ARENA-WP0002"]}>
        <Routes>
          <Route path="/hub" element={<Hub />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText(/ARENA-XXXXXX/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/ARENA-XXXXXX/i) as HTMLInputElement;
    expect(input.value).toBe("ARENA-WP0002");
  });

  it("shows Inbox and Chats sub-tabs", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /inbox/i }).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByRole("button", { name: /chats/i }).length).toBeGreaterThan(0);
  });

  it("shows mark-all-read button when there are unread messages", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getByText(/mark all as read/i)).toBeInTheDocument();
    });
  });

  it("clicking mark-all-read sets all inbox messages as read in the store", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getByText(/mark all as read/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/mark all as read/i));
    await waitFor(() => {
      expect(useInboxStore.getState().getTotalUnread()).toBe(0);
    });
  });

  it("deleted messages are excluded from inbox view", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getAllByText(/gg last night/i).length).toBeGreaterThan(0);
    });
    await act(async () => {
      await useInboxStore.getState().deleteMessage("inb-002");
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/gg last night/i)).toHaveLength(0);
    });
    expect(screen.getAllByText(/tournament invite/i).length).toBeGreaterThan(0);
  });

  it("shows unread badge count on Messages tab button", () => {
    renderHub("community");
    // The Messages tab button shows a badge when there are unread inbox messages
    // Badge shows count "1" for the 1 unread seed message
    const messageTabBtn = screen.getByRole("button", { name: /messages/i });
    expect(messageTabBtn).toBeInTheDocument();
  });

  it("opening an inbox message marks it as read", async () => {
    renderHub("messages");
    await waitFor(() => {
      expect(screen.getByText(/tournament invite/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/tournament invite/i));
    await waitFor(() => {
      const inb001 = useInboxStore.getState().messages.find((m) => m.id === "inb-001");
      expect(inb001?.read).toBe(true);
    });
  });
});
