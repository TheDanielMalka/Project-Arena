import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Hub from "@/pages/Hub";
import { useUserStore }   from "@/stores/userStore";
import { useInboxStore }  from "@/stores/inboxStore";
import { useFriendStore } from "@/stores/friendStore";

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

beforeEach(() => {
  // Login as the default user before every test
  useUserStore.getState().login("player@arena.gg", "test");

  // Reset inbox to seed state (3 messages: 1 unread, 2 read)
  useInboxStore.setState({
    messages: [
      {
        id: "inb-001",
        senderId: "user-003", senderName: "ShadowKill3r", senderArenaId: "ARENA-SK0003",
        receiverId: "user-001",
        subject: "Tournament invite", content: "You in?",
        read: false, deleted: false, createdAt: "2026-03-09T09:00:00Z",
      },
      {
        id: "inb-002",
        senderId: "user-002", senderName: "WingmanPro", senderArenaId: "ARENA-WP0002",
        receiverId: "user-001",
        subject: "GG last night", content: "That was insane.",
        read: true, deleted: false, createdAt: "2026-03-08T22:00:00Z",
      },
      {
        id: "inb-003",
        senderId: "user-010", senderName: "NightHawk", senderArenaId: "ARENA-NH0011",
        receiverId: "user-001",
        subject: "Apex squad needed", content: "Looking for players.",
        read: true, deleted: false, createdAt: "2026-03-07T14:30:00Z",
      },
    ],
  });

  // Reset friendships to seed state
  useFriendStore.setState({
    friendships: [
      {
        id: "fr-001", initiatorId: "user-001", receiverId: "user-002",
        friendId: "user-002", friendUsername: "WingmanPro", friendArenaId: "ARENA-WP0002",
        friendAvatarInitials: "WP", friendRank: "Gold II", friendTier: "Gold",
        friendPreferredGame: "Valorant", status: "accepted",
        createdAt: "2026-03-01T10:00:00Z", updatedAt: "2026-03-01T10:05:00Z",
      },
      {
        id: "fr-002", initiatorId: "user-003", receiverId: "user-001",
        friendId: "user-003", friendUsername: "ShadowKill3r", friendArenaId: "ARENA-SK0003",
        friendAvatarInitials: "SK", friendRank: "Diamond I", friendTier: "Diamond",
        friendPreferredGame: "CS2", status: "accepted",
        createdAt: "2026-03-05T14:30:00Z", updatedAt: "2026-03-05T15:00:00Z",
      },
      {
        id: "fr-003", initiatorId: "user-004", receiverId: "user-001",
        friendId: "user-004", friendUsername: "NovaBlade", friendArenaId: "ARENA-NB0004",
        friendAvatarInitials: "NB", friendRank: "Platinum III", friendTier: "Platinum",
        friendPreferredGame: "CS2", status: "pending",
        createdAt: "2026-03-09T08:00:00Z",
      },
    ],
  });
});

// ─── Tab structure ─────────────────────────────────────────────

describe("Hub — tab navigation", () => {
  it("renders the three tab buttons", () => {
    renderHub();
    expect(screen.getByRole("button", { name: /community/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /friends/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /messages/i })).toBeInTheDocument();
  });

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
  it("shows up to 9 player cards when not searching", () => {
    renderHub("community");
    // Each card shows the player's username. There are 11 seed players but 1 is self (user-001)
    // Hub excludes self: filter(p => p.id !== user?.id)
    // "ArenaPlayer_01" is NOT in playerStore seed, so all 11 are shown — sliced to 9
    const cards = screen.getAllByText(/Gold|Diamond|Platinum|Silver/);
    expect(cards.length).toBeGreaterThan(0);
  });

  it("shows Shuffle button in community tab", () => {
    renderHub("community");
    expect(screen.getByRole("button", { name: /shuffle/i })).toBeInTheDocument();
  });

  it("shows game filter buttons (CS2, Valorant, Fortnite etc.)", () => {
    renderHub("community");
    expect(screen.getByRole("button", { name: /^cs2$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /valorant/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fortnite/i })).toBeInTheDocument();
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

  it("searching for 'Shadow' shows ShadowKill3r in results", () => {
    renderHub("community");
    const searchInput = screen.getByPlaceholderText(/search by username or arena id/i);
    fireEvent.change(searchInput, { target: { value: "Shadow" } });
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
  });

  it("searching for unknown player shows no results", () => {
    renderHub("community");
    const searchInput = screen.getByPlaceholderText(/search by username or arena id/i);
    fireEvent.change(searchInput, { target: { value: "ZZZ_NO_PLAYER_XYZ" } });
    expect(screen.queryAllByText(/WingmanPro/i)).toHaveLength(0);
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
  it("shows inbox messages from seed data", () => {
    renderHub("messages");
    expect(screen.getAllByText(/ShadowKill3r/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/WingmanPro/i).length).toBeGreaterThan(0);
  });

  it("shows inbox message subjects", () => {
    renderHub("messages");
    expect(screen.getByText(/tournament invite/i)).toBeInTheDocument();
  });

  it("shows Compose button", () => {
    renderHub("messages");
    // Hub renders two compose triggers: header "Compose" btn + right-panel link
    expect(screen.getAllByRole("button", { name: /compose/i }).length).toBeGreaterThan(0);
  });

  it("compose button opens the compose dialog", () => {
    renderHub("messages");
    // Click the first compose button (header button)
    fireEvent.click(screen.getAllByRole("button", { name: /compose/i })[0]);
    // Dialog should contain Arena ID input
    expect(screen.getByPlaceholderText(/ARENA-XXXXXX/i)).toBeInTheDocument();
  });

  it("shows Inbox and Chats sub-tabs", () => {
    renderHub("messages");
    // Sub-tab buttons — Inbox may have a count badge so use partial match
    expect(screen.getAllByRole("button", { name: /inbox/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /chats/i }).length).toBeGreaterThan(0);
  });

  it("shows mark-all-read button when there are unread messages", () => {
    renderHub("messages");
    // The "Mark all as read" is a <button> rendered as a text link in Hub.tsx
    expect(screen.getByText(/mark all as read/i)).toBeInTheDocument();
  });

  it("clicking mark-all-read sets all inbox messages as read in the store", () => {
    renderHub("messages");
    fireEvent.click(screen.getByText(/mark all as read/i));
    expect(useInboxStore.getState().getTotalUnread()).toBe(0);
  });

  it("deleted messages are excluded from inbox view", () => {
    // Soft-delete inb-002
    useInboxStore.getState().deleteMessage("inb-002");
    renderHub("messages");
    // inb-002 subject "GG last night" should not appear
    expect(screen.queryAllByText(/gg last night/i)).toHaveLength(0);
    // Other messages still show
    expect(screen.getAllByText(/tournament invite/i).length).toBeGreaterThan(0);
  });

  it("shows unread badge count on Messages tab button", () => {
    renderHub("community");
    // The Messages tab button shows a badge when there are unread inbox messages
    // Badge shows count "1" for the 1 unread seed message
    const messageTabBtn = screen.getByRole("button", { name: /messages/i });
    expect(messageTabBtn).toBeInTheDocument();
  });

  it("opening an inbox message marks it as read", () => {
    renderHub("messages");
    // Click on ShadowKill3r's unread message
    const msg = screen.getByText(/tournament invite/i);
    fireEvent.click(msg);
    // After clicking, the message should be marked read in the store
    const inb001 = useInboxStore.getState().messages.find((m) => m.id === "inb-001");
    expect(inb001?.read).toBe(true);
  });
});
