import { create } from "zustand";
import type { InboxMessage } from "@/types";
import {
  apiDeleteInbox,
  apiGetInboxUnreadCount,
  apiListInbox,
  apiPatchInboxRead,
  apiPatchInboxReadAll,
  apiPostInbox,
} from "@/lib/engine-api";
import { usePlayerStore } from "@/stores/playerStore";
import { useUserStore } from "@/stores/userStore";

interface InboxState {
  messages: InboxMessage[];
  /** From GET /inbox/unread-count — authoritative for badges vs truncated list. */
  unreadCount: number;

  composePrefillArenaId?: string;
  setComposePrefill: (arenaId: string | undefined) => void;

  /** Clear local inbox (e.g. on logout). */
  resetInboxLocal: () => void;

  /** GET /inbox?unread_only=false&limit=30 + unread-count */
  refreshInbox: (token?: string | null) => Promise<void>;
  /** GET /inbox/unread-count only — sidebar badge */
  refreshUnreadBadge: (token?: string | null) => Promise<void>;

  sendInboxMessage: (params: {
    myId: string;
    myName: string;
    myArenaId: string;
    targetArenaId: string;
    subject: string;
    content: string;
  }) => Promise<{ success: boolean; error?: string }>;

  markRead: (messageId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  getUnread: () => InboxMessage[];
  getTotalUnread: () => number;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  messages: [],
  unreadCount: 0,
  composePrefillArenaId: undefined,
  setComposePrefill: (arenaId) => set({ composePrefillArenaId: arenaId }),

  resetInboxLocal: () => set({ messages: [], unreadCount: 0 }),

  refreshUnreadBadge: async (token) => {
    const t = token ?? useUserStore.getState().token;
    if (!t) return;
    const c = await apiGetInboxUnreadCount(t);
    if (c !== null) set({ unreadCount: c });
  },

  refreshInbox: async (token) => {
    const t = token ?? useUserStore.getState().token;
    const user = useUserStore.getState().user;
    if (!t || !user) return;
    const [list, count] = await Promise.all([
      apiListInbox({ token: t, receiverId: user.id, unreadOnly: false, limit: 30 }),
      apiGetInboxUnreadCount(t),
    ]);
    if (list !== null) set({ messages: list });
    if (count !== null) set({ unreadCount: count });
  },

  sendInboxMessage: async ({ targetArenaId, subject, content }) => {
    const token = useUserStore.getState().token;
    if (!token) return { success: false, error: "Not signed in" };

    const target = usePlayerStore.getState().players.find(
      (p) => p.arenaId.toLowerCase() === targetArenaId.trim().toLowerCase(),
    );
    if (!target) {
      return { success: false, error: `No player found with Arena ID "${targetArenaId.trim()}"` };
    }

    const sub = subject.trim();
    const con = content.trim();
    if (!sub || !con) return { success: false, error: "Subject and message are required" };

    const res = await apiPostInbox(token, { receiver_id: target.id, subject: sub, content: con });
    if ("error" in res) return { success: false, error: res.error };
    return { success: true };
  },

  markRead: async (messageId) => {
    const token = useUserStore.getState().token;
    const prev = get().messages.find((m) => m.id === messageId);
    if (!prev || prev.deleted) return;

    if (!prev.read) {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? { ...m, read: true } : m)),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }));
    }

    if (token) {
      const ok = await apiPatchInboxRead(token, messageId);
      if (!ok) void get().refreshInbox(token);
    }
  },

  markAllRead: async () => {
    const token = useUserStore.getState().token;
    set((s) => ({
      messages: s.messages.map((m) => ({ ...m, read: true })),
      unreadCount: 0,
    }));
    if (token) {
      const ok = await apiPatchInboxReadAll(token);
      if (!ok) void get().refreshInbox(token);
    }
  },

  deleteMessage: async (messageId) => {
    const token = useUserStore.getState().token;
    const prev = get().messages.find((m) => m.id === messageId);
    const wasUnread = Boolean(prev && !prev.read && !prev.deleted);

    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, deleted: true } : m)),
      unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
    }));

    if (token) {
      const ok = await apiDeleteInbox(token, messageId);
      if (!ok) void get().refreshInbox(token);
    }
  },

  getUnread: () => get().messages.filter((m) => !m.read && !m.deleted),

  getTotalUnread: () => get().unreadCount,
}));
