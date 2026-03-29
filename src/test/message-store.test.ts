import { describe, it, expect, beforeEach } from "vitest";
import { useMessageStore } from "@/stores/messageStore";
import { useFriendStore } from "@/stores/friendStore";

beforeEach(() => {
  useMessageStore.setState({ conversations: {} });
  useFriendStore.setState({ ignoredUsers: [] });
});

describe("messageStore — sendMessage", () => {
  it("creates a message and adds to conversation", () => {
    const store = useMessageStore.getState();
    const msg = store.sendMessage({
      myId: "user-001", myUsername: "ArenaPlayer_01",
      friendId: "user-002", content: "Hey! GG last match",
    });
    expect(msg.senderId).toBe("user-001");
    expect(msg.senderName).toBe("ArenaPlayer_01");
    expect(msg.receiverId).toBe("user-002");
    expect(msg.content).toBe("Hey! GG last match");
    expect(msg.read).toBe(true);
    expect(msg.id).toBeTruthy();
  });

  it("appends to existing conversation", () => {
    const store = useMessageStore.getState();
    store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u2", content: "First message here" });
    store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u2", content: "Second message here" });
    const msgs = useMessageStore.getState().getConversation("u2");
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toBe("Second message here");
  });

  it("different friends have separate conversations", () => {
    const store = useMessageStore.getState();
    store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u2", content: "To friend two" });
    store.sendMessage({ myId: "u1", myUsername: "A", friendId: "u3", content: "To friend three" });
    expect(useMessageStore.getState().getConversation("u2")).toHaveLength(1);
    expect(useMessageStore.getState().getConversation("u3")).toHaveLength(1);
  });

  it("returns null when friend is ignored", () => {
    useFriendStore.getState().ignoreUser({ userId: "u2", username: "Blocked" });
    const out = useMessageStore.getState().sendMessage({
      myId: "u1", myUsername: "A", friendId: "u2", content: "Hi",
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
    // Simulate receiving a message (from friend, unread)
    useMessageStore.setState({
      conversations: {
        "u2": [{
          id: "m1", senderId: "u2", senderName: "Friend",
          receiverId: "u1", content: "You there?",
          read: false, createdAt: new Date().toISOString(),
        }],
      },
    });
    expect(useMessageStore.getState().getUnreadCount("u2")).toBe(1);
    useMessageStore.getState().markRead("u2");
    // markRead marks messages where receiverId !== friendId (i.e., received by us)
    // After markRead, messages from u2 should be read
    // Note: markRead marks msgs where m.receiverId !== friendId
    // For received msgs: senderId=u2, receiverId=u1 → receiverId(u1) !== friendId(u2) → gets marked read
    const msgs = useMessageStore.getState().getConversation("u2");
    expect(msgs[0].read).toBe(true);
  });
});

describe("messageStore — unread counts", () => {
  it("getUnreadCount returns count of unread from friend", () => {
    useMessageStore.setState({
      conversations: {
        "u2": [
          { id: "m1", senderId: "u2", senderName: "B", receiverId: "u1", content: "Msg 1", read: false, createdAt: new Date().toISOString() },
          { id: "m2", senderId: "u2", senderName: "B", receiverId: "u1", content: "Msg 2", read: false, createdAt: new Date().toISOString() },
          { id: "m3", senderId: "u1", senderName: "A", receiverId: "u2", content: "My msg", read: true,  createdAt: new Date().toISOString() },
        ],
      },
    });
    expect(useMessageStore.getState().getUnreadCount("u2")).toBe(2);
  });

  it("getTotalUnread sums across all conversations", () => {
    useMessageStore.setState({
      conversations: {
        "u2": [{ id: "m1", senderId: "u2", senderName: "B", receiverId: "u1", content: "Hi", read: false, createdAt: new Date().toISOString() }],
        "u3": [{ id: "m2", senderId: "u3", senderName: "C", receiverId: "u1", content: "Hey", read: false, createdAt: new Date().toISOString() }],
      },
    });
    expect(useMessageStore.getState().getTotalUnread()).toBe(2);
  });

  it("getTotalUnread returns 0 when all read", () => {
    useMessageStore.setState({
      conversations: {
        "u2": [{ id: "m1", senderId: "u1", senderName: "A", receiverId: "u2", content: "Hi", read: true, createdAt: new Date().toISOString() }],
      },
    });
    expect(useMessageStore.getState().getTotalUnread()).toBe(0);
  });
});
