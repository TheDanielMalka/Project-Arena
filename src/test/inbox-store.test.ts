import { describe, it, expect, beforeEach } from "vitest";
import { useInboxStore } from "@/stores/inboxStore";

// ─── Helper ───────────────────────────────────────────────────

function resetStore() {
  // Reset to a clean state with only unread seed message
  useInboxStore.setState({
    messages: [
      {
        id: "inb-001",
        senderId: "user-003", senderName: "ShadowKill3r", senderArenaId: "ARENA-SK0003",
        receiverId: "user-001",
        subject: "Tournament invite",
        content: "You in?",
        read: false, deleted: false,
        createdAt: "2026-03-09T09:00:00Z",
      },
      {
        id: "inb-002",
        senderId: "user-002", senderName: "WingmanPro", senderArenaId: "ARENA-WP0002",
        receiverId: "user-001",
        subject: "GG last night",
        content: "That was insane.",
        read: true, deleted: false,
        createdAt: "2026-03-08T22:00:00Z",
      },
    ],
  });
}

// ─── Tests ────────────────────────────────────────────────────

describe("inboxStore", () => {
  beforeEach(resetStore);

  it("initialises with correct message count", () => {
    const { messages } = useInboxStore.getState();
    expect(messages.length).toBe(2);
  });

  it("getTotalUnread counts only unread non-deleted", () => {
    const count = useInboxStore.getState().getTotalUnread();
    expect(count).toBe(1); // only inb-001 is unread
  });

  it("getUnread returns unread non-deleted messages", () => {
    const unread = useInboxStore.getState().getUnread();
    expect(unread).toHaveLength(1);
    expect(unread[0].id).toBe("inb-001");
  });

  it("markRead marks a message as read", () => {
    useInboxStore.getState().markRead("inb-001");
    const msg = useInboxStore.getState().messages.find((m) => m.id === "inb-001");
    expect(msg?.read).toBe(true);
    expect(useInboxStore.getState().getTotalUnread()).toBe(0);
  });

  it("markAllRead marks all messages as read", () => {
    useInboxStore.getState().markAllRead();
    const unread = useInboxStore.getState().messages.filter((m) => !m.read);
    expect(unread).toHaveLength(0);
  });

  it("deleteMessage soft-deletes (sets deleted=true)", () => {
    useInboxStore.getState().deleteMessage("inb-001");
    const msg = useInboxStore.getState().messages.find((m) => m.id === "inb-001");
    expect(msg?.deleted).toBe(true);
    // Soft-deleted unread should NOT count toward unread
    expect(useInboxStore.getState().getTotalUnread()).toBe(0);
  });

  it("deleteMessage does not remove the record from messages array", () => {
    useInboxStore.getState().deleteMessage("inb-002");
    expect(useInboxStore.getState().messages).toHaveLength(2); // still 2 rows
  });

  it("sendInboxMessage fails for unknown Arena ID", () => {
    const result = useInboxStore.getState().sendInboxMessage({
      myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
      targetArenaId: "ARENA-XXXXXX",
      subject: "Hello", content: "World",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ARENA-XXXXXX/);
  });

  it("sendInboxMessage succeeds for known Arena ID", () => {
    // ARENA-WP0002 is WingmanPro, exists in playerStore seed
    const result = useInboxStore.getState().sendInboxMessage({
      myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
      targetArenaId: "ARENA-WP0002",
      subject: "Hey", content: "Wanna play?",
    });
    expect(result.success).toBe(true);
    expect(result.message?.subject).toBe("Hey");
    // New message is prepended
    expect(useInboxStore.getState().messages[0].subject).toBe("Hey");
  });

  it("sendInboxMessage adds new message as unread", () => {
    useInboxStore.getState().sendInboxMessage({
      myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
      targetArenaId: "ARENA-WP0002",
      subject: "Test", content: "Content",
    });
    const newest = useInboxStore.getState().messages[0];
    expect(newest.read).toBe(false);
    expect(newest.deleted).toBe(false);
  });

  it("keeps at most 20 inbox messages (newest-first)", () => {
    // Seed a known player lookup
    for (let i = 0; i < 30; i++) {
      useInboxStore.getState().sendInboxMessage({
        myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
        targetArenaId: "ARENA-WP0002",
        subject: `S${i}`, content: `C${i}`,
      });
    }
    expect(useInboxStore.getState().messages.length).toBeLessThanOrEqual(20);
    // newest is last sent
    expect(useInboxStore.getState().messages[0].subject).toBe("S29");
  });

  it("Arena ID lookup is case-insensitive", () => {
    const result = useInboxStore.getState().sendInboxMessage({
      myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
      targetArenaId: "arena-wp0002", // lowercase
      subject: "Test", content: "Content",
    });
    expect(result.success).toBe(true);
  });
});
