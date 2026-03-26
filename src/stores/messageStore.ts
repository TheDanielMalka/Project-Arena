import { create } from "zustand";
import type { DirectMessage } from "@/types";

// ─── Seed Data ────────────────────────────────────────────────
// DB-ready: replace with GET /api/messages/:friendId

const SEED_MESSAGES: Record<string, DirectMessage[]> = {
  "user-002": [
    {
      id: "msg-001",
      senderId: "user-002", senderName: "WingmanPro",
      receiverId: "user-001",
      content: "GG! That 2v2 match was intense 🔥",
      read: true,
      createdAt: "2026-03-09T10:00:00Z",
    },
    {
      id: "msg-002",
      senderId: "user-001", senderName: "ArenaPlayer_01",
      receiverId: "user-002",
      content: "Yeah! Down for a rematch tonight?",
      read: true,
      createdAt: "2026-03-09T10:02:00Z",
    },
    {
      id: "msg-003",
      senderId: "user-002", senderName: "WingmanPro",
      receiverId: "user-001",
      content: "Definitely. Let's go 5v5 this time 👊",
      read: false,
      createdAt: "2026-03-09T10:05:00Z",
    },
  ],
  "user-003": [
    {
      id: "msg-004",
      senderId: "user-003", senderName: "ShadowKill3r",
      receiverId: "user-001",
      content: "You joining the CS2 tournament next week?",
      read: true,
      createdAt: "2026-03-08T16:00:00Z",
    },
    {
      id: "msg-005",
      senderId: "user-001", senderName: "ArenaPlayer_01",
      receiverId: "user-003",
      content: "100% in. What's the buy-in?",
      read: true,
      createdAt: "2026-03-08T16:05:00Z",
    },
    {
      id: "msg-006",
      senderId: "user-001", senderName: "ArenaPlayer_01",
      receiverId: "user-003",
      content: "$50 per player. Let me know if you find 2 more for the team",
      read: true,
      createdAt: "2026-03-08T16:06:00Z",
    },
  ],
};

// ─── Store ────────────────────────────────────────────────────

interface MessageState {
  // conversations: keyed by the OTHER user's id
  conversations: Record<string, DirectMessage[]>;

  // DB-ready: replace with GET /api/messages/:friendId
  getConversation: (friendId: string) => DirectMessage[];

  // DB-ready: replace with WebSocket / POST /api/messages
  sendMessage: (params: {
    myId:       string;
    myUsername: string;
    friendId:   string;
    content:    string;
  }) => DirectMessage;

  // DB-ready: replace with PATCH /api/messages/:friendId/read
  markRead: (friendId: string) => void;

  // Count unread messages from a specific friend
  getUnreadCount: (friendId: string) => number;

  // Total unread across all conversations
  getTotalUnread: () => number;
}

export const useMessageStore = create<MessageState>((set, get) => ({
  conversations: SEED_MESSAGES,

  getConversation: (friendId) =>
    get().conversations[friendId] ?? [],

  sendMessage: ({ myId, myUsername, friendId, content }) => {
    const message: DirectMessage = {
      id:         `msg-${Date.now()}`,
      senderId:   myId,
      senderName: myUsername,
      receiverId: friendId,
      content:    content.trim(),
      read:       true, // sender always reads their own
      createdAt:  new Date().toISOString(),
    };
    set((s) => ({
      conversations: {
        ...s.conversations,
        [friendId]: [...(s.conversations[friendId] ?? []), message],
      },
    }));
    return message;
  },

  markRead: (friendId) =>
    set((s) => ({
      conversations: {
        ...s.conversations,
        [friendId]: (s.conversations[friendId] ?? []).map((m) =>
          m.receiverId !== friendId ? { ...m, read: true } : m
        ),
      },
    })),

  getUnreadCount: (friendId) =>
    (get().conversations[friendId] ?? []).filter(
      (m) => !m.read && m.senderId === friendId
    ).length,

  getTotalUnread: () =>
    Object.values(get().conversations).reduce(
      (total, msgs) => total + msgs.filter((m) => !m.read).length,
      0
    ),
}));
