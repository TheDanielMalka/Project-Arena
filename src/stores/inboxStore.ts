import { create } from "zustand";
import type { InboxMessage } from "@/types";
import { usePlayerStore } from "@/stores/playerStore";

// ─── Seed Data ────────────────────────────────────────────────
// DB-ready: replace with GET /api/inbox

const SEED_INBOX: InboxMessage[] = [
  {
    id: "inb-001",
    senderId: "user-003", senderName: "ShadowKill3r", senderArenaId: "ARENA-SK0003",
    receiverId: "user-001",
    subject: "Tournament invite — CS2 5v5 Saturday",
    content: "Hey! We're putting together a team for the CS2 tournament this Saturday. Buy-in is $50 per player, winner takes 80% of the pot. You in? Let me know by Friday.",
    read: false, deleted: false,
    createdAt: "2026-03-09T09:00:00Z",
  },
  {
    id: "inb-002",
    senderId: "user-002", senderName: "WingmanPro", senderArenaId: "ARENA-WP0002",
    receiverId: "user-001",
    subject: "GG last night 🔥",
    content: "That 2v2 match was insane, you carried hard. Want to run some ranked games next week? I'll set up a custom lobby.",
    read: true, deleted: false,
    createdAt: "2026-03-08T22:00:00Z",
  },
  {
    id: "inb-003",
    senderId: "user-010", senderName: "NightHawk", senderArenaId: "ARENA-NH0011",
    receiverId: "user-001",
    subject: "Arena tip: Apex squad needed",
    content: "Looking for 3 more players for an Apex squad — $25 entry, best of 3 placement. We need someone who can fill IGL role. Interested?",
    read: true, deleted: false,
    createdAt: "2026-03-07T14:30:00Z",
  },
];

// ─── Store ────────────────────────────────────────────────────

interface InboxState {
  messages: InboxMessage[];

  // UI-only: deep-link compose target across routes (fallback if URL params are lost).
  composePrefillArenaId?: string;
  setComposePrefill: (arenaId: string | undefined) => void;

  // DB-ready: replace with POST /api/inbox
  sendInboxMessage: (params: {
    myId:         string;
    myName:       string;
    myArenaId:    string;
    targetArenaId: string;
    subject:      string;
    content:      string;
  }) => { success: boolean; error?: string; message?: InboxMessage };

  // DB-ready: replace with PATCH /api/inbox/:id/read
  markRead: (messageId: string) => void;
  markAllRead: () => void;

  // DB-ready: replace with DELETE /api/inbox/:id (soft delete)
  deleteMessage: (messageId: string) => void;

  // Derived
  getUnread: () => InboxMessage[];
  getTotalUnread: () => number;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  messages: SEED_INBOX,
  composePrefillArenaId: undefined,
  setComposePrefill: (arenaId) => set({ composePrefillArenaId: arenaId }),

  sendInboxMessage: ({ myId, myName, myArenaId, targetArenaId, subject, content }) => {
    // Validate target exists by ArenaId
    // DB-ready: replace with server-side validation GET /api/users/by-arena-id/:id
    const target = usePlayerStore.getState().players.find(
      (p) => p.arenaId.toLowerCase() === targetArenaId.trim().toLowerCase()
    );
    if (!target) {
      return { success: false, error: `No player found with Arena ID "${targetArenaId}"` };
    }
    const message: InboxMessage = {
      id:           `inb-${Date.now()}`,
      senderId:     myId,
      senderName:   myName,
      senderArenaId: myArenaId,
      receiverId:   target.id,
      subject:      subject.trim(),
      content:      content.trim(),
      read:         false,
      deleted:      false,
      createdAt:    new Date().toISOString(),
    };
    // Keep a small local inbox history (UI-only) to avoid unbounded growth.
    // DB-ready: server becomes source of truth; this is only a dev/demo cache.
    set((s) => ({ messages: [message, ...s.messages].slice(0, 20) }));
    return { success: true, message };
  },

  markRead: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, read: true } : m
      ),
    })),

  markAllRead: () =>
    set((s) => ({
      messages: s.messages.map((m) => ({ ...m, read: true })),
    })),

  deleteMessage: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, deleted: true } : m
      ),
    })),

  getUnread: () =>
    get().messages.filter((m) => !m.read && !m.deleted),

  getTotalUnread: () =>
    get().messages.filter((m) => !m.read && !m.deleted).length,
}));
