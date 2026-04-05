import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ApiFriendRow, ApiFriendRequestRow } from "@/lib/engine-api";

const apiState = vi.hoisted(() => ({
  friends: [] as ApiFriendRow[],
  incoming: [] as ApiFriendRequestRow[],
  outgoing: [] as ApiFriendRequestRow[],
  reset() {
    this.friends = [];
    this.incoming = [];
    this.outgoing = [];
  },
}));

vi.mock("@/stores/userStore", () => ({
  useUserStore: {
    getState: () => ({
      token: "tok",
      user: { id: "user-001", username: "Me" },
    }),
  },
}));

vi.mock("@/lib/engine-api", () => ({
  apiListFriends: vi.fn(async () => [...apiState.friends]),
  apiListFriendRequests: vi.fn(async () => ({
    incoming: [...apiState.incoming],
    outgoing: [...apiState.outgoing],
  })),
  apiSendFriendRequest: vi.fn(async (_t: string, user_id: string) => {
    apiState.outgoing.push({
      request_id: `r-${user_id}`,
      user_id,
      username: user_id === "user-002" ? "WingmanPro" : "B",
      arena_id: user_id === "user-002" ? "ARENA-WP0002" : "ARENA-000002",
      avatar: null,
      message: null,
      created_at: new Date().toISOString(),
    });
    return { ok: true as const };
  }),
  apiAcceptFriendRequest: vi.fn(async (_t: string, from_user_id: string) => {
    const i = apiState.incoming.findIndex((r) => r.user_id === from_user_id);
    if (i >= 0) {
      const row = apiState.incoming[i]!;
      apiState.incoming.splice(i, 1);
      apiState.friends.push({
        user_id: row.user_id,
        username: row.username,
        arena_id: row.arena_id,
        avatar: row.avatar,
        equipped_badge_icon: null,
      });
    }
    return { ok: true as const };
  }),
  apiRejectFriendRequest: vi.fn(async (_t: string, from_user_id: string) => {
    apiState.incoming = apiState.incoming.filter((r) => r.user_id !== from_user_id);
    return { ok: true as const };
  }),
  apiRemoveFriend: vi.fn(async (_t: string, user_id: string) => {
    apiState.outgoing = apiState.outgoing.filter((r) => r.user_id !== user_id);
    apiState.friends = apiState.friends.filter((f) => f.user_id !== user_id);
    return { ok: true as const };
  }),
  apiBlockUser: vi.fn(async (_t: string, user_id: string) => {
    apiState.friends = apiState.friends.filter((f) => f.user_id !== user_id);
    apiState.incoming = apiState.incoming.filter((r) => r.user_id !== user_id);
    apiState.outgoing = apiState.outgoing.filter((r) => r.user_id !== user_id);
    return { ok: true as const };
  }),
}));

import { ignoredRefMatchesContext, useFriendStore } from "@/stores/friendStore";

beforeEach(() => {
  apiState.reset();
  useFriendStore.setState({ friendships: [], ignoredUsers: [] });
});

describe("friendStore — sendFriendRequest", () => {
  it("creates a pending friendship", async () => {
    const store = useFriendStore.getState();
    const f = await store.sendFriendRequest({
      myId: "user-001",
      myUsername: "Player",
      myArenaId: "ARENA-000001",
      myAvatarInitials: "PL",
      myRank: "Gold I",
      myTier: "Gold",
      myPreferredGame: "CS2",
      targetId: "user-002",
      targetUsername: "WingmanPro",
      targetArenaId: "ARENA-WP0002",
      targetAvatarInitials: "WP",
      targetRank: "Gold II",
      targetTier: "Gold",
      targetPreferredGame: "Valorant",
    });
    expect(f).not.toBeNull();
    expect(f!.status).toBe("pending");
    expect(f!.initiatorId).toBe("user-001");
    expect(f!.friendId).toBe("user-002");
    expect(f!.friendUsername).toBe("WingmanPro");
    expect(f!.friendArenaId).toBe("ARENA-WP0002");
  });

  it("adds friendship to store", async () => {
    await useFriendStore.getState().sendFriendRequest({
      myId: "user-001",
      myUsername: "A",
      myArenaId: "ARENA-000001",
      myAvatarInitials: "A",
      myRank: "Gold",
      myTier: "Gold",
      myPreferredGame: "CS2",
      targetId: "user-002",
      targetUsername: "B",
      targetArenaId: "ARENA-000002",
      targetAvatarInitials: "B",
      targetRank: "Silver",
      targetTier: "Silver",
      targetPreferredGame: "CS2",
    });
    expect(useFriendStore.getState().friendships).toHaveLength(1);
  });
});

describe("friendStore — acceptRequest", () => {
  it("changes status to accepted", async () => {
    apiState.incoming.push({
      request_id: "fr-in",
      user_id: "user-002",
      username: "B",
      arena_id: "ARENA-000002",
      avatar: null,
      message: null,
      created_at: new Date().toISOString(),
    });
    await useFriendStore.getState().fetchSocialFromServer();
    const pending = useFriendStore.getState().getPendingReceived("user-001");
    expect(pending).toHaveLength(1);
    await useFriendStore.getState().acceptRequest(pending[0]!.id);
    expect(useFriendStore.getState().getFriends().some((x) => x.friendId === "user-002")).toBe(true);
  });
});

describe("friendStore — declineRequest / removeFriend", () => {
  it("declineRequest removes an incoming pending row", async () => {
    apiState.incoming.push({
      request_id: "fr-x",
      user_id: "u2",
      username: "B",
      arena_id: "ARENA-000002",
      avatar: null,
      message: null,
      created_at: new Date().toISOString(),
    });
    await useFriendStore.getState().fetchSocialFromServer();
    const f = useFriendStore.getState().friendships[0]!;
    await useFriendStore.getState().declineRequest(f.id);
    expect(useFriendStore.getState().friendships).toHaveLength(0);
  });

  it("removeFriend removes accepted friendship", async () => {
    apiState.friends.push({
      user_id: "u2",
      username: "B",
      arena_id: "ARENA-000002",
      avatar: null,
      equipped_badge_icon: null,
    });
    await useFriendStore.getState().fetchSocialFromServer();
    await useFriendStore.getState().removeFriend("u2");
    expect(useFriendStore.getState().friendships.find((fr) => fr.friendId === "u2")).toBeUndefined();
  });
});

describe("friendStore — derived selectors", () => {
  const setup = () => {
    useFriendStore.setState({
      friendships: [
        {
          id: "acc-2",
          initiatorId: "user-002",
          receiverId: "user-001",
          friendId: "user-002",
          friendUsername: "Friend1",
          friendArenaId: "ARENA-F1",
          friendAvatarInitials: "F1",
          friendRank: "—",
          friendTier: "—",
          friendPreferredGame: "CS2",
          status: "accepted",
          createdAt: new Date().toISOString(),
        },
        {
          id: "out-1",
          initiatorId: "user-001",
          receiverId: "user-003",
          friendId: "user-003",
          friendUsername: "Target",
          friendArenaId: "ARENA-T1",
          friendAvatarInitials: "T1",
          friendRank: "—",
          friendTier: "—",
          friendPreferredGame: "Valorant",
          status: "pending",
          createdAt: new Date().toISOString(),
        },
        {
          id: "fr-recv",
          initiatorId: "user-004",
          receiverId: "user-001",
          friendId: "user-004",
          friendUsername: "Sender",
          friendArenaId: "ARENA-S1",
          friendAvatarInitials: "S1",
          friendRank: "Platinum",
          friendTier: "Platinum",
          friendPreferredGame: "CS2",
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      ],
      ignoredUsers: [],
    });
  };

  it("getFriends returns only accepted", () => {
    setup();
    const friends = useFriendStore.getState().getFriends();
    expect(friends.every((f) => f.status === "accepted")).toBe(true);
    expect(friends).toHaveLength(1);
  });

  it("getPendingReceived returns requests where I am receiver", () => {
    setup();
    const pending = useFriendStore.getState().getPendingReceived("user-001");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.initiatorId).toBe("user-004");
  });

  it("getPendingSent returns requests I initiated", () => {
    setup();
    const sent = useFriendStore.getState().getPendingSent("user-001");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.friendUsername).toBe("Target");
  });

  it("isFriend returns true for accepted friend", () => {
    setup();
    expect(useFriendStore.getState().isFriend("user-002")).toBe(true);
  });

  it("isFriend returns false for non-friend", () => {
    setup();
    expect(useFriendStore.getState().isFriend("user-999")).toBe(false);
  });

  it("hasPendingWith returns true for pending friendId", () => {
    setup();
    expect(useFriendStore.getState().hasPendingWith("user-003")).toBe(true);
  });

  it("getRelationship returns correct status", () => {
    setup();
    expect(useFriendStore.getState().getRelationship("user-002")).toBe("accepted");
    expect(useFriendStore.getState().getRelationship("user-003")).toBe("pending");
    expect(useFriendStore.getState().getRelationship("user-999")).toBeNull();
  });
});

describe("friendStore — isIgnored / unignoreUser (id + username)", () => {
  it("isIgnored matches by display username when canonical id differs", () => {
    useFriendStore.setState({
      ignoredUsers: [{ userId: "legacy-wrong-id", username: "NightHawk" }],
    });
    expect(useFriendStore.getState().isIgnored("user-010", "NightHawk")).toBe(true);
    expect(useFriendStore.getState().isIgnored("user-010")).toBe(false);
  });

  it("unignoreUser removes row matching userId or display username", () => {
    useFriendStore.setState({
      ignoredUsers: [{ userId: "legacy-wrong-id", username: "NightHawk" }],
    });
    useFriendStore.getState().unignoreUser("user-010", "NightHawk");
    expect(useFriendStore.getState().ignoredUsers).toHaveLength(0);
  });

  it("legacy synthetic id + raw id username matches roster opened by display name", () => {
    useFriendStore.setState({
      ignoredUsers: [{ userId: "u-user010", username: "user-010" }],
    });
    const ctx = {
      canonicalUserId: "user-010",
      displayUsername: "NightHawk",
      rosterSlot: "NightHawk",
      profileId: "user-010",
    };
    expect(ignoredRefMatchesContext(ctx, { userId: "u-user010", username: "user-010" })).toBe(true);
    useFriendStore.getState().unignoreForRoster(ctx);
    expect(useFriendStore.getState().ignoredUsers).toHaveLength(0);
  });
});

describe("friendStore — blockPlayer", () => {
  it("removes accepted friend and adds ignored ref", async () => {
    apiState.friends.push({
      user_id: "b",
      username: "B",
      arena_id: "ARENA-B",
      avatar: null,
      equipped_badge_icon: null,
    });
    await useFriendStore.getState().fetchSocialFromServer();
    expect(useFriendStore.getState().getFriends()).toHaveLength(1);
    const ok = await useFriendStore.getState().blockPlayer({
      myId: "user-001",
      targetUserId: "b",
      targetUsername: "B",
      quiet: true,
    });
    expect(ok).toBe(true);
    expect(useFriendStore.getState().getFriends()).toHaveLength(0);
    expect(useFriendStore.getState().isIgnored("b")).toBe(true);
  });
});
