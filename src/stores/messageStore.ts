import { create } from "zustand";
import type { DirectMessage } from "@/types";
import { useFriendStore } from "@/stores/friendStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import {
  apiGetMessages,
  apiMarkMessagesRead,
  apiSendMessage,
  type ApiDmRow,
} from "@/lib/engine-api";

function mapDm(
  m: ApiDmRow,
  myId: string,
  myUsername: string,
  otherDisplayName: string,
): DirectMessage {
  const isMine = m.sender_id === myId;
  return {
    id: m.id,
    senderId: m.sender_id,
    senderName: isMine ? myUsername : otherDisplayName,
    receiverId: m.receiver_id,
    content: m.content,
    read: m.read,
    createdAt: m.created_at ?? new Date().toISOString(),
  };
}

interface MessageState {
  conversations: Record<string, DirectMessage[]>;

  getConversation: (friendId: string) => DirectMessage[];

  /** GET /messages/:friendId then mark read on server */
  loadConversationForFriend: (friendId: string) => Promise<void>;

  sendMessage: (params: {
    myId: string;
    myUsername: string;
    friendId: string;
    content: string;
  }) => Promise<DirectMessage | null>;

  markRead: (friendId: string) => void;

  getUnreadCount: (friendId: string) => number;

  getTotalUnread: () => number;

  resetConversationsLocal: () => void;
}

export const useMessageStore = create<MessageState>((set, get) => ({
  conversations: {},

  getConversation: (friendId) => get().conversations[friendId] ?? [],

  loadConversationForFriend: async (friendId: string) => {
    const token = useUserStore.getState().token;
    const me = useUserStore.getState().user;
    if (!token || !me) return;

    const rows = await apiGetMessages(token, friendId, 100);
    if (rows === null) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Could not load messages",
        message: "Try again in a moment.",
      });
      return;
    }

    const friend = useFriendStore.getState().getFriends().find((f) => f.friendId === friendId);
    const otherName = friend?.friendUsername ?? "Friend";
    const msgs = rows
      .map((r) => mapDm(r, me.id, me.username, otherName))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    set((s) => ({
      conversations: { ...s.conversations, [friendId]: msgs },
    }));

    await apiMarkMessagesRead(token, friendId);
    set((s) => ({
      conversations: {
        ...s.conversations,
        [friendId]: (s.conversations[friendId] ?? []).map((m) =>
          m.senderId === friendId && m.receiverId === me.id ? { ...m, read: true } : m,
        ),
      },
    }));
  },

  sendMessage: async ({ myId, myUsername, friendId, content }) => {
    const trimmed = content.trim();
    if (!trimmed) return null;

    if (useFriendStore.getState().isIgnored(friendId)) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Message blocked",
        message: "You ignored this player. Unignore them in Friends to send messages.",
      });
      return null;
    }

    const token = useUserStore.getState().token;
    if (!token) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Sign in required",
        message: "Log in to send messages.",
      });
      return null;
    }

    const res = await apiSendMessage(token, friendId, trimmed);
    if (res.ok === false) {
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Message failed",
        message: res.detail ?? "Could not send.",
      });
      return null;
    }

    const message: DirectMessage = {
      id: res.id || `msg-${Date.now()}`,
      senderId: myId,
      senderName: myUsername,
      receiverId: friendId,
      content: trimmed,
      read: true,
      createdAt: res.created_at ?? new Date().toISOString(),
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
          m.receiverId !== friendId ? { ...m, read: true } : m,
        ),
      },
    })),

  getUnreadCount: (friendId) =>
    (get().conversations[friendId] ?? []).filter((m) => !m.read && m.senderId === friendId).length,

  getTotalUnread: () => {
    const myId = useUserStore.getState().user?.id;
    if (!myId) return 0;
    return Object.values(get().conversations).reduce(
      (total, msgs) => total + msgs.filter((m) => !m.read && m.receiverId === myId).length,
      0,
    );
  },

  resetConversationsLocal: () => set({ conversations: {} }),
}));
