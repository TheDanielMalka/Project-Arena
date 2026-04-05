import { create } from "zustand";
import type { Friendship, FriendshipStatus } from "@/types";
import { syntheticUserIdFromDisplayKey } from "@/lib/matchPlayerDisplay";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import {
  apiAcceptFriendRequest,
  apiBlockUser,
  apiListFriendRequests,
  apiListFriends,
  apiRejectFriendRequest,
  apiRemoveFriend,
  apiSendFriendRequest,
  type ApiFriendRequestRow,
  type ApiFriendRow,
} from "@/lib/engine-api";

/** Users I ignored locally — block also persists on server via POST /friends/:id/block */
export interface IgnoredUserRef {
  userId: string;
  username: string;
}

export interface IgnoreRosterContext {
  canonicalUserId: string;
  displayUsername: string;
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

function initialsFromUsername(username: string): string {
  const t = username.trim();
  return (t.slice(0, 2) || "??").toUpperCase();
}

function mapAcceptedFriend(row: ApiFriendRow, me: string): Friendship {
  const uid = row.user_id;
  return {
    id: `acc-${uid}`,
    initiatorId: uid,
    receiverId: me,
    friendId: uid,
    friendUsername: row.username,
    friendArenaId: row.arena_id ?? "—",
    friendAvatarInitials: initialsFromUsername(row.username),
    friendAvatar: row.avatar ?? undefined,
    friendRank: "—",
    friendTier: "—",
    friendPreferredGame: "CS2",
    status: "accepted",
    createdAt: new Date().toISOString(),
  };
}

function mapIncomingRequest(row: ApiFriendRequestRow, me: string): Friendship {
  return {
    id: row.request_id,
    initiatorId: row.user_id,
    receiverId: me,
    friendId: row.user_id,
    friendUsername: row.username,
    friendArenaId: row.arena_id ?? "—",
    friendAvatarInitials: initialsFromUsername(row.username),
    friendAvatar: row.avatar ?? undefined,
    friendRank: "—",
    friendTier: "—",
    friendPreferredGame: "CS2",
    status: "pending",
    message: row.message ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

function mapOutgoingRequest(row: ApiFriendRequestRow, me: string): Friendship {
  return {
    id: row.request_id,
    initiatorId: me,
    receiverId: row.user_id,
    friendId: row.user_id,
    friendUsername: row.username,
    friendArenaId: row.arena_id ?? "—",
    friendAvatarInitials: initialsFromUsername(row.username),
    friendAvatar: row.avatar ?? undefined,
    friendRank: "—",
    friendTier: "—",
    friendPreferredGame: "CS2",
    status: "pending",
    message: row.message ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

interface FriendState {
  friendships: Friendship[];
  ignoredUsers: IgnoredUserRef[];

  getFriends: () => Friendship[];
  getPendingReceived: (myId: string) => Friendship[];
  getPendingSent: (myId: string) => Friendship[];
  isFriend: (friendId: string) => boolean;
  hasPendingWith: (friendId: string) => boolean;
  getRelationship: (friendId: string) => FriendshipStatus | null;
  isIgnored: (userId: string, displayUsername?: string) => boolean;
  isIgnoredForRoster: (ctx: IgnoreRosterContext) => boolean;
  unignoreForRoster: (ctx: IgnoreRosterContext) => void;

  ignoreUser: (ref: IgnoredUserRef) => void;
  unignoreUser: (userId: string, displayUsername?: string) => void;

  blockPlayer: (params: {
    myId: string;
    targetUserId: string;
    targetUsername: string;
    rosterSlot?: string;
    quiet?: boolean;
  }) => Promise<boolean>;

  sendFriendRequest: (params: {
    myId: string;
    myUsername: string;
    myArenaId: string;
    myAvatarInitials: string;
    myRank: string;
    myTier: string;
    myPreferredGame: string;
    targetId: string;
    targetUsername: string;
    targetArenaId: string;
    targetAvatarInitials: string;
    targetRank: string;
    targetTier: string;
    targetPreferredGame: string;
    message?: string;
  }) => Promise<Friendship | null>;

  acceptRequest: (friendshipId: string) => Promise<boolean>;
  declineRequest: (friendshipId: string) => Promise<boolean>;
  removeFriend: (friendId: string) => Promise<boolean>;

  /** Load friends + pending from GET /friends and GET /friends/requests */
  fetchSocialFromServer: () => Promise<void>;
  /** Clear graph (logout) */
  resetSocialLocal: () => void;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  friendships: [],
  ignoredUsers: [],

  fetchSocialFromServer: async () => {
    const token = useUserStore.getState().token;
    const me = useUserStore.getState().user?.id;
    if (!token || !me) {
      set({ friendships: [] });
      return;
    }
    const [friends, reqs] = await Promise.all([apiListFriends(token), apiListFriendRequests(token)]);
    if (!friends || !reqs) {
      set({ friendships: [] });
      return;
    }
    const list: Friendship[] = [
      ...friends.map((r) => mapAcceptedFriend(r, me)),
      ...reqs.incoming.map((r) => mapIncomingRequest(r, me)),
      ...reqs.outgoing.map((r) => mapOutgoingRequest(r, me)),
    ];
    set({ friendships: list });
  },

  resetSocialLocal: () => set({ friendships: [], ignoredUsers: [] }),

  getFriends: () => get().friendships.filter((f) => f.status === "accepted"),

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
        }),
    ),

  getPendingSent: (myId) =>
    get().friendships.filter((f) => f.status === "pending" && f.initiatorId === myId),

  isFriend: (friendId) =>
    get().friendships.some((f) => f.status === "accepted" && f.friendId === friendId),

  hasPendingWith: (friendId) =>
    get().friendships.some((f) => f.status === "pending" && f.friendId === friendId),

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

  blockPlayer: async ({ myId, targetUserId, targetUsername, rosterSlot, quiet }) => {
    if (targetUserId === myId) return false;
    const token = useUserStore.getState().token;
    if (token) {
      const r = await apiBlockUser(token, targetUserId);
      if (r.ok === false && r.detail) {
        useNotificationStore.getState().addNotification({
          type: "system",
          title: "Block failed",
          message: r.detail,
        });
        return false;
      }
    }
    const blockCtx: IgnoreRosterContext = {
      canonicalUserId: targetUserId,
      displayUsername: targetUsername,
      rosterSlot: rosterSlot ?? targetUserId,
      profileId: targetUserId,
    };
    set((s) => {
      const friendships = s.friendships.filter(
        (f) => !ignoredRefMatchesContext(blockCtx, { userId: f.friendId, username: f.friendUsername }),
      );
      const ignoredUsers = s.ignoredUsers.some((u) => ignoredRefMatchesContext(blockCtx, u))
        ? s.ignoredUsers
        : [...s.ignoredUsers, { userId: targetUserId, username: targetUsername }];
      return { friendships, ignoredUsers };
    });
    await get().fetchSocialFromServer();
    if (!quiet) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Player ignored",
        message: `${targetUsername} cannot send you friend requests or messages.`,
      });
    }
    return true;
  },

  sendFriendRequest: async (params) => {
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
    const token = useUserStore.getState().token;
    if (!token) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Sign in required",
        message: "Log in to send friend requests.",
      });
      return null;
    }
    const r = await apiSendFriendRequest(token, params.targetId, params.message ?? null);
    if (r.ok === false) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Friend request failed",
        message: r.detail ?? "Could not send request.",
      });
      return null;
    }
    await get().fetchSocialFromServer();
    const sent = get()
      .getPendingSent(params.myId)
      .find((f) => f.friendId === params.targetId);
    return sent ?? null;
  },

  acceptRequest: async (friendshipId) => {
    const me = useUserStore.getState().user?.id;
    const token = useUserStore.getState().token;
    if (!me || !token) return false;
    const f = get().friendships.find((x) => x.id === friendshipId);
    if (!f || f.status !== "pending" || f.receiverId !== me) return false;
    const r = await apiAcceptFriendRequest(token, f.initiatorId);
    if (r.ok === false) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Could not accept",
        message: r.detail ?? "Request may have expired.",
      });
      return false;
    }
    await get().fetchSocialFromServer();
    const friendship = get().friendships.find((x) => x.friendId === f.initiatorId && x.status === "accepted");
    if (friendship) {
      useNotificationStore.getState().addNotification({
        type: "friend_request",
        title: "Friend added",
        message: `You and ${friendship.friendUsername} are now friends.`,
      });
    }
    return true;
  },

  declineRequest: async (friendshipId) => {
    const me = useUserStore.getState().user?.id;
    const token = useUserStore.getState().token;
    if (!me || !token) return false;
    const f = get().friendships.find((x) => x.id === friendshipId);
    if (!f || f.status !== "pending") return false;
    /** Incoming: only receiver can POST /reject. Outgoing: cancel via DELETE /friends/:id */
    const r =
      f.receiverId === me
        ? await apiRejectFriendRequest(token, f.initiatorId)
        : f.initiatorId === me
          ? await apiRemoveFriend(token, f.friendId)
          : { ok: false as const, status: 400, detail: "Invalid request" };
    if (r.ok === false) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Could not update request",
        message: r.detail ?? "Try again.",
      });
      return false;
    }
    await get().fetchSocialFromServer();
    return true;
  },

  removeFriend: async (friendId) => {
    const token = useUserStore.getState().token;
    if (!token) return false;
    const r = await apiRemoveFriend(token, friendId);
    if (r.ok === false) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Could not remove friend",
        message: r.detail ?? "Try again.",
      });
      return false;
    }
    await get().fetchSocialFromServer();
    return true;
  },
}));

/** After login — dynamic import from userStore avoids circular init issues */
export async function syncFriendsFromServer(): Promise<void> {
  await useFriendStore.getState().fetchSocialFromServer();
}
