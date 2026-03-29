import { describe, it, expect, beforeEach } from "vitest";
import { useFriendStore } from "@/stores/friendStore";

beforeEach(() => {
  useFriendStore.setState({ friendships: [], ignoredUsers: [] });
});

describe("friendStore — sendFriendRequest", () => {
  it("creates a pending friendship", () => {
    const store = useFriendStore.getState();
    const f = store.sendFriendRequest({
      myId: "user-001", myUsername: "Player", myArenaId: "ARENA-000001",
      myAvatarInitials: "PL", myRank: "Gold I", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "user-002", targetUsername: "WingmanPro", targetArenaId: "ARENA-WP0002",
      targetAvatarInitials: "WP", targetRank: "Gold II", targetTier: "Gold", targetPreferredGame: "Valorant",
    });
    expect(f.status).toBe("pending");
    expect(f.initiatorId).toBe("user-001");
    expect(f.friendId).toBe("user-002");
    expect(f.friendUsername).toBe("WingmanPro");
    expect(f.friendArenaId).toBe("ARENA-WP0002");
  });

  it("adds friendship to store", () => {
    useFriendStore.getState().sendFriendRequest({
      myId: "user-001", myUsername: "A", myArenaId: "ARENA-000001",
      myAvatarInitials: "A", myRank: "Gold", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "user-002", targetUsername: "B", targetArenaId: "ARENA-000002",
      targetAvatarInitials: "B", targetRank: "Silver", targetTier: "Silver", targetPreferredGame: "CS2",
    });
    expect(useFriendStore.getState().friendships).toHaveLength(1);
  });
});

describe("friendStore — acceptRequest", () => {
  it("changes status to accepted", () => {
    const store = useFriendStore.getState();
    const f = store.sendFriendRequest({
      myId: "user-002", myUsername: "B", myArenaId: "ARENA-000002",
      myAvatarInitials: "B", myRank: "Gold", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "user-001", targetUsername: "A", targetArenaId: "ARENA-000001",
      targetAvatarInitials: "A", targetRank: "Gold", targetTier: "Gold", targetPreferredGame: "CS2",
    });
    useFriendStore.getState().acceptRequest(f.id);
    const updated = useFriendStore.getState().friendships.find((fr) => fr.id === f.id);
    expect(updated?.status).toBe("accepted");
    expect(updated?.updatedAt).toBeTruthy();
  });
});

describe("friendStore — declineRequest / removeFriend", () => {
  it("declineRequest removes the friendship", () => {
    const f = useFriendStore.getState().sendFriendRequest({
      myId: "u1", myUsername: "A", myArenaId: "ARENA-000001",
      myAvatarInitials: "A", myRank: "Gold", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "u2", targetUsername: "B", targetArenaId: "ARENA-000002",
      targetAvatarInitials: "B", targetRank: "Silver", targetTier: "Silver", targetPreferredGame: "Valorant",
    });
    useFriendStore.getState().declineRequest(f.id);
    expect(useFriendStore.getState().friendships).toHaveLength(0);
  });

  it("removeFriend removes accepted friendship", () => {
    const f = useFriendStore.getState().sendFriendRequest({
      myId: "u1", myUsername: "A", myArenaId: "ARENA-000001",
      myAvatarInitials: "A", myRank: "Gold", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "u2", targetUsername: "B", targetArenaId: "ARENA-000002",
      targetAvatarInitials: "B", targetRank: "Silver", targetTier: "Silver", targetPreferredGame: "Valorant",
    });
    useFriendStore.getState().acceptRequest(f.id);
    useFriendStore.getState().removeFriend("u2");
    expect(useFriendStore.getState().friendships.find((fr) => fr.friendId === "u2")).toBeUndefined();
  });
});

describe("friendStore — derived selectors", () => {
  const setup = () => {
    // Add one accepted, one pending sent, one pending received
    const s = useFriendStore.getState();
    // accepted
    const f1 = s.sendFriendRequest({
      myId: "user-001", myUsername: "Me", myArenaId: "ARENA-ME001",
      myAvatarInitials: "ME", myRank: "Gold", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "user-002", targetUsername: "Friend1", targetArenaId: "ARENA-F1",
      targetAvatarInitials: "F1", targetRank: "Gold", targetTier: "Gold", targetPreferredGame: "CS2",
    });
    useFriendStore.getState().acceptRequest(f1.id);
    // pending sent
    useFriendStore.getState().sendFriendRequest({
      myId: "user-001", myUsername: "Me", myArenaId: "ARENA-ME001",
      myAvatarInitials: "ME", myRank: "Gold", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "user-003", targetUsername: "Target", targetArenaId: "ARENA-T1",
      targetAvatarInitials: "T1", targetRank: "Silver", targetTier: "Silver", targetPreferredGame: "Valorant",
    });
    // pending received (user-004 sent to user-001)
    useFriendStore.setState((s2) => ({
      friendships: [...s2.friendships, {
        id: "fr-recv", initiatorId: "user-004", receiverId: "user-001",
        friendId: "user-004", friendUsername: "Sender", friendArenaId: "ARENA-S1",
        friendAvatarInitials: "S1", friendRank: "Platinum", friendTier: "Platinum",
        friendPreferredGame: "CS2", status: "pending" as const, createdAt: new Date().toISOString(),
      }],
    }));
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
    expect(pending[0].initiatorId).toBe("user-004");
  });

  it("getPendingSent returns requests I initiated", () => {
    setup();
    const sent = useFriendStore.getState().getPendingSent("user-001");
    expect(sent).toHaveLength(1);
    expect(sent[0].friendUsername).toBe("Target");
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

describe("friendStore — blockPlayer", () => {
  it("removes accepted friend and adds ignored ref", () => {
    useFriendStore.setState({ friendships: [], ignoredUsers: [] });
    const f = useFriendStore.getState().sendFriendRequest({
      myId: "a", myUsername: "A", myArenaId: "ARENA-A",
      myAvatarInitials: "A", myRank: "Gold", myTier: "Gold", myPreferredGame: "CS2",
      targetId: "b", targetUsername: "B", targetArenaId: "ARENA-B",
      targetAvatarInitials: "B", targetRank: "Gold", targetTier: "Gold", targetPreferredGame: "CS2",
    });
    useFriendStore.getState().acceptRequest(f!.id);
    expect(useFriendStore.getState().getFriends()).toHaveLength(1);
    useFriendStore.getState().blockPlayer({
      myId: "a",
      targetUserId: "b",
      targetUsername: "B",
      quiet: true,
    });
    expect(useFriendStore.getState().getFriends()).toHaveLength(0);
    expect(useFriendStore.getState().isIgnored("b")).toBe(true);
  });
});
