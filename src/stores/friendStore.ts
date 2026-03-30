import { create } from "zustand";
import type { Friendship, FriendshipStatus } from "@/types";
import { syntheticUserIdFromDisplayKey } from "@/lib/matchPlayerDisplay";
import { useNotificationStore } from "@/stores/notificationStore";

// ─── Seed Data ────────────────────────────────────────────────
// From the perspective of user-001 (ArenaPlayer_01 / ARENA-AP0001)
// DB-ready: replace with GET /api/friends and GET /api/friends/requests

const SEED_FRIENDSHIPS: Friendship[] = [
  // ── Accepted friends ──
  {
    id: "fr-001",
    initiatorId: "user-001",
    receiverId:  "user-002",
    friendId:    "user-002",
    friendUsername:       "WingmanPro",
    friendArenaId:        "ARENA-WP0002",
    friendAvatarInitials: "WP",
    friendRank:           "Gold II",
    friendTier:           "Gold",
    friendPreferredGame:  "Valorant",
    status: "accepted",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:05:00Z",
  },
  {
    id: "fr-002",
    initiatorId: "user-003",
    receiverId:  "user-001",
    friendId:    "user-003",
    friendUsername:       "ShadowKill3r",
    friendArenaId:        "ARENA-SK0003",
    friendAvatarInitials: "SK",
    friendRank:           "Diamond I",
    friendTier:           "Diamond",
    friendPreferredGame:  "CS2",
    status: "accepted",
    createdAt: "2026-03-05T14:30:00Z",
    updatedAt: "2026-03-05T15:00:00Z",
  },
  // ── Pending received (they sent to us) ──
  {
    id: "fr-003",
    initiatorId: "user-004",
    receiverId:  "user-001",
    friendId:    "user-004",
    friendUsername:       "NovaBlade",
    friendArenaId:        "ARENA-NB0004",
    friendAvatarInitials: "NB",
    friendRank:           "Platinum III",
    friendTier:           "Platinum",
    friendPreferredGame:  "CS2",
    status: "pending",
    createdAt: "2026-03-09T08:00:00Z",
  },
  // ── Pending sent (we sent to them) ──
  {
    id: "fr-004",
    initiatorId: "user-001",
    receiverId:  "user-008",
    friendId:    "user-008",
    friendUsername:       "CyberWolf",
    friendArenaId:        "ARENA-CW0009",
    friendAvatarInitials: "CW",
    friendRank:           "Gold II",
    friendTier:           "Gold",
    friendPreferredGame:  "Valorant",
    status: "pending",
    createdAt: "2026-03-09T11:00:00Z",
  },
];

// ─── Store ────────────────────────────────────────────────────

/** Users I ignored — no friend requests or DMs from them in this client (DB-ready: server enforces). */
export interface IgnoredUserRef {
  userId: string;
  username: string;
}

/** Match ignore rows when roster stores user id, username, or legacy synthetic ids (client-only until API is canonical). */
export interface IgnoreRosterContext {
  canonicalUserId: string;
  displayUsername: string;
  /** Raw roster cell from match UI (id or username). */
  rosterSlot: string;
  profileId?: string;
}

function idEquals(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

export function ignoredRefMatchesContext(ctx: IgnoreRosterContext, u: IgnoredUserRef): boolean {
  const ids = [ctx.canonicalUserId, ctx.rosterSlot, ctx.profileId].filter(Boolean) as string[];
  for (const id of ids) {
    if (idEquals(u.userId, id)) return true;
  }
  const un = u.username.toLowerCase();
  if (un === ctx.displayUsername.toLowerCase()) return true;
  if (un === ctx.rosterSlot.toLowerCase()) return true;

  const synFromCanonical = syntheticUserIdFromDisplayKey(ctx.canonicalUserId);
  const synFromRoster = syntheticUserIdFromDisplayKey(ctx.rosterSlot);
  const synFromDisplay = syntheticUserIdFromDisplayKey(ctx.displayUsername);
  if (u.userId === synFromCanonical || u.userId === synFromRoster || u.userId === synFromDisplay) return true;

  return false;
}

interface FriendState {
  friendships: Friendship[];
  ignoredUsers: IgnoredUserRef[];

  // Derived selectors
  getFriends:         ()                    => Friendship[];   // accepted only
  getPendingReceived: (myId: string)        => Friendship[];   // pending where I am receiver
  getPendingSent:     (myId: string)        => Friendship[];   // pending where I am initiator
  isFriend:           (friendId: string)    => boolean;
  hasPendingWith:     (friendId: string)    => boolean;
  getRelationship:    (friendId: string)    => FriendshipStatus | null;
  /** Match by canonical userId and/or display username (roster id vs username slots must both resolve). */
  isIgnored:          (userId: string, displayUsername?: string) => boolean;
  isIgnoredForRoster: (ctx: IgnoreRosterContext) => boolean;
  unignoreForRoster:  (ctx: IgnoreRosterContext) => void;

  ignoreUser:   (ref: IgnoredUserRef) => void;
  unignoreUser: (userId: string, displayUsername?: string) => void;

  /**
   * Drop pending + accepted links with target and add to ignore list.
   * DB-ready: POST /api/users/:id/block (server mirrors block + clears friend rows).
   */
  blockPlayer: (params: {
    myId: string;
    targetUserId: string;
    targetUsername: string;
    /** Raw roster slot when blocking from match UI — aligns legacy ids with canonical profile. */
    rosterSlot?: string;
    /** Skip default toast when the UI shows its own confirmation. */
    quiet?: boolean;
  }) => void;

  // DB-ready: replace with POST /api/friends/request
  sendFriendRequest: (params: {
    myId:                 string;
    myUsername:           string;
    myArenaId:            string;
    myAvatarInitials:     string;
    myRank:               string;
    myTier:               string;
    myPreferredGame:      string;
    targetId:             string;
    targetUsername:       string;
    targetArenaId:        string;
    targetAvatarInitials: string;
    targetRank:           string;
    targetTier:           string;
    targetPreferredGame:  string;
    message?:             string;
  }) => Friendship | null;

  // DB-ready: replace with PATCH /api/friends/:id/accept
  acceptRequest: (friendshipId: string) => void;

  // DB-ready: replace with DELETE /api/friends/:id
  declineRequest: (friendshipId: string) => void;

  // DB-ready: replace with DELETE /api/friends/:id
  removeFriend: (friendId: string) => void;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  friendships: SEED_FRIENDSHIPS,
  ignoredUsers: [],

  getFriends: () =>
    get().friendships.filter((f) => f.status === "accepted"),

  getPendingReceived: (myId) =>
    get().friendships.filter(
      (f) =>
        f.status === "pending" &&
        f.receiverId === myId &&
        !get().isIgnoredForRoster({
          canonicalUserId: f.initiatorId,
          displayUsername: f.friendUsername,
          rosterSlot: f.initiatorId,
          profileId: f.initiatorId,
        })
    ),

  getPendingSent: (myId) =>
    get().friendships.filter(
      (f) => f.status === "pending" && f.initiatorId === myId
    ),

  isFriend: (friendId) =>
    get().friendships.some(
      (f) => f.status === "accepted" && f.friendId === friendId
    ),

  hasPendingWith: (friendId) =>
    get().friendships.some(
      (f) => f.status === "pending" && f.friendId === friendId
    ),

  getRelationship: (friendId) => {
    const f = get().friendships.find((fr) => fr.friendId === friendId);
    return f ? f.status : null;
  },

  isIgnored: (userId, displayUsername) =>
    get().isIgnoredForRoster({
      canonicalUserId: userId,
      displayUsername: displayUsername ?? userId,
      rosterSlot: userId,
      profileId: userId,
    }),

  isIgnoredForRoster: (ctx) => get().ignoredUsers.some((u) => ignoredRefMatchesContext(ctx, u)),

  unignoreForRoster: (ctx) =>
    set((s) => ({
      ignoredUsers: s.ignoredUsers.filter((u) => !ignoredRefMatchesContext(ctx, u)),
    })),

  ignoreUser: (ref) =>
    set((s) => {
      const ctx: IgnoreRosterContext = {
        canonicalUserId: ref.userId,
        displayUsername: ref.username,
        rosterSlot: ref.userId,
        profileId: ref.userId,
      };
      if (s.ignoredUsers.some((u) => ignoredRefMatchesContext(ctx, u))) return s;
      return { ignoredUsers: [...s.ignoredUsers, ref] };
    }),

  unignoreUser: (userId, displayUsername) =>
    get().unignoreForRoster({
      canonicalUserId: userId,
      displayUsername: displayUsername ?? userId,
      rosterSlot: userId,
      profileId: userId,
    }),

  blockPlayer: ({ myId, targetUserId, targetUsername, rosterSlot, quiet }) => {
    if (targetUserId === myId) return;
    set((s) => {
      const blockCtx: IgnoreRosterContext = {
        canonicalUserId: targetUserId,
        displayUsername: targetUsername,
        rosterSlot: rosterSlot ?? targetUserId,
        profileId: targetUserId,
      };
      const friendships = s.friendships.filter(
        (f) => !ignoredRefMatchesContext(blockCtx, { userId: f.friendId, username: f.friendUsername })
      );
      const ignoredUsers = s.ignoredUsers.some((u) => ignoredRefMatchesContext(blockCtx, u))
        ? s.ignoredUsers
        : [...s.ignoredUsers, { userId: targetUserId, username: targetUsername }];
      return { friendships, ignoredUsers };
    });
    if (!quiet) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Player ignored",
        message: `${targetUsername} cannot send you friend requests or messages.`,
      });
    }
  },

  sendFriendRequest: (params) => {
    const reqCtx: IgnoreRosterContext = {
      canonicalUserId: params.targetId,
      displayUsername: params.targetUsername,
      rosterSlot: params.targetId,
      profileId: params.targetId,
    };
    if (get().ignoredUsers.some((u) => ignoredRefMatchesContext(reqCtx, u))) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Cannot send request",
        message: "You ignored this player. Unignore them in Friends first.",
      });
      return null;
    }
    const friendship: Friendship = {
      id:                   `fr-${Date.now()}`,
      initiatorId:          params.myId,
      receiverId:           params.targetId,
      friendId:             params.targetId,
      friendUsername:       params.targetUsername,
      friendArenaId:        params.targetArenaId,
      friendAvatarInitials: params.targetAvatarInitials,
      friendRank:           params.targetRank,
      friendTier:           params.targetTier,
      friendPreferredGame:  params.targetPreferredGame,
      message:              params.message,
      status:               "pending",
      createdAt:            new Date().toISOString(),
    };
    set((s) => ({ friendships: [...s.friendships, friendship] }));
    return friendship;
  },

  acceptRequest: (friendshipId) => {
    // DB-ready: PATCH /api/friends/:id/accept
    // Real DB: emits WebSocket event to initiator → they see "Your request was accepted" in their Hub inbox
    const friendship = get().friendships.find((f) => f.id === friendshipId);
    set((s) => ({
      friendships: s.friendships.map((f) =>
        f.id === friendshipId
          ? { ...f, status: "accepted" as FriendshipStatus, updatedAt: new Date().toISOString() }
          : f
      ),
    }));
    // Simulate the push notification the initiator would receive in a real multi-user system
    if (friendship) {
      useNotificationStore.getState().addNotification({
        type:    "friend_request",
        title:   "Friend Request Accepted 🎮",
        message: `${friendship.friendUsername} accepted your friend request. You are now friends!`,
      });
    }
  },

  declineRequest: (friendshipId) =>
    set((s) => ({
      friendships: s.friendships.filter((f) => f.id !== friendshipId),
    })),

  removeFriend: (friendId) =>
    set((s) => ({
      friendships: s.friendships.filter((f) => f.friendId !== friendId),
    })),
}));
