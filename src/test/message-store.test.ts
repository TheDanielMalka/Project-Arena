import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/stores/userStore", () => ({
  useUserStore: {
    getState: () => ({
      token: "tok",
      user: { id: "user-001", username: "ArenaPlayer_01" },
    }),
  },
}));

vi.mock("@/lib/engine-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine-api")>();
  return {
    ...actual,
    apiSendMessage: vi.fn(async () => ({
      ok: true as const,
      id: "api-msg-1",
      created_at: new Date().toISOString(),
    })),
  };
});

import { useMessageStore } from "@/stores/messageStore";
import { useFriendStore } from "@/stores/friendStore";

beforeEach(() => {
  useMessageStore.setState({ conversations: {} });
  useFriendStore.setState({ ignoredUsers: [] });
});

describe("messageStore — sendMessage", () => {
  it("creates a message and adds to conversation", async () => {
    const store = useMessageStore.getState();
    const msg = await store.sendMessage({
      myId: "user-001",
      myUsername: "ArenaPlayer_01",
      friendId: "user-002",
      content: "Hey! GG last match",
    });
    expect(msg).not.toBeNull();
    expect(msg!.senderId).toBe("user-001");
    expect(msg!.senderName).toBe("ArenaPlayer_01");
    expect(msg!.receiverId).toBe("user-002");
    expect(msg!.content).toBe("Hey! GG last match");
    expect(msg!.read).toBe(true);
    expect(msg!.id).toBeTruthy();
  });

  it("appends to existing conversation", async () => {
    const store = useMessageStore.getState();
    await store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u2", content: "First message here" });
    await store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u2", content: "Second message here" });
    const msgs = useMessageStore.getState().getConversation("u2");
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toBe("Second message here");
  });

  it("different friends have separate conversations", async () => {
    const store = useMessageStore.getState();
    await store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u2", content: "To friend two" });
    await store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u3", content: "To friend three" });
    expect(useMessageStore.getState().getConversation("u2")).toHaveLength(1);
    expect(useMessageStore.getState().getConversation("u3")).toHaveLength(1);
  });

  it("returns null when friend is ignored", async () => {
    useFriendStore.getState().ignoreUser({ userId: "u2", username: "Blocked" });
    const out = await useMessageStore.getState().sendMessage({
      myId: "u1",
      myUsername: "A",
      friendId: "u2",
      content: "Hi",
    });
    expect(out).toBeNull();
    expect(useMessageStore.getState().getConversation("u2")).toHaveLength(0);
  });
});

describe("messageStore — getConversation", () => {
  it("returns empty array for unknown friend", () => {
    const msgs = useMessageStore.getState().getConversation("unknown");
    expect(msgs).toEqual([]);
  });
});

describe("messageStore — markRead", () => {
  it("marks unread messages from friend as read", () => {
    useMessageStore.setState({
      conversations: {
        u2: [
          {
            id: "m1",
            senderId: "u2",
            senderName: "Friend",
            receiverId: "u1",
            content: "You there?",
            read: false,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(useMessageStore.getState().getUnreadCount("u2")).toBe(1);
    useMessageStore.getState().markRead("u2");
    const msgs = useMessageStore.getState().getConversation("u2");
    expect(msgs[0]!.read).toBe(true);
  });
});

describe("messageStore — unread counts", () => {
  it("getUnreadCount returns count of unread from friend", () => {
    useMessageStore.setState({
      conversations: {
        u2: [
          { id: "m1", senderId: "u2", senderName: "B", receiverId: "u1", content: "Msg 1", read: false, createdAt: new Date().toISOString() },
          { id: "m2", senderId: "u2", senderName: "B", receiverId: "u1", content: "Msg 2", read: false, createdAt: new Date().toISOString() },
          { id: "m3", senderId: "u1", senderName: "A", receiverId: "u2", content: "My msg", read: true, createdAt: new Date().toISOString() },
        ],
      },
    });
    expect(useMessageStore.getState().getUnreadCount("u2")).toBe(2);
  });

  it("getTotalUnread sums unread where current user is receiver", () => {
    useMessageStore.setState({
      conversations: {
        u2: [{ id: "m1", senderId: "u2", senderName: "B", receiverId: "user-001", content: "Hi", read: false, createdAt: new Date().toISOString() }],
        u3: [{ id: "m2", senderId: "u3", senderName: "C", receiverId: "user-001", content: "Hey", read: false, createdAt: new Date().toISOString() }],
      },
    });
    expect(useMessageStore.getState().getTotalUnread()).toBe(2);
  });

  it("getTotalUnread returns 0 when all read for me as receiver", () => {
    useMessageStore.setState({
      conversations: {
        u2: [{ id: "m1", senderId: "user-001", senderName: "A", receiverId: "u2", content: "Hi", read: true, createdAt: new Date().toISOString() }],
      },
    });
    expect(useMessageStore.getState().getTotalUnread()).toBe(0);
  });
});
