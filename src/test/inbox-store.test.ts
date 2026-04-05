import { describe, it, expect, beforeEach } from "vitest";
import { useInboxStore } from "@/stores/inboxStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useUserStore } from "@/stores/userStore";
import { INBOX_STORE_TEST_FIXTURE } from "@/test/inboxTestFixture";

function resetStore() {
  useInboxStore.setState({
    messages: INBOX_STORE_TEST_FIXTURE.map((m) => ({ ...m })),
    unreadCount: 1,
  });
}

describe("inboxStore", () => {
  beforeEach(async () => {
    useUserStore.getState().logout();
    await useUserStore.getState().login("player@arena.gg", "test");
    usePlayerStore.setState({ players: [] });
    await usePlayerStore.getState().searchPlayers("", undefined, "token-user");
    useInboxStore.getState().resetInboxLocal();
    resetStore();
  });

  it("initialises with correct message count", () => {
    const { messages } = useInboxStore.getState();
    expect(messages.length).toBe(2);
  });

  it("getTotalUnread counts badge from server-backed field", () => {
    const count = useInboxStore.getState().getTotalUnread();
    expect(count).toBe(1);
  });

  it("getUnread returns unread non-deleted messages", () => {
    const unread = useInboxStore.getState().getUnread();
    expect(unread).toHaveLength(1);
    expect(unread[0].id).toBe("inb-001");
  });

  it("markRead marks a message as read", async () => {
    await useInboxStore.getState().markRead("inb-001");
    const msg = useInboxStore.getState().messages.find((m) => m.id === "inb-001");
    expect(msg?.read).toBe(true);
    expect(useInboxStore.getState().getTotalUnread()).toBe(0);
  });

  it("markAllRead marks all messages as read", async () => {
    await useInboxStore.getState().markAllRead();
    const unread = useInboxStore.getState().messages.filter((m) => !m.read);
    expect(unread).toHaveLength(0);
    expect(useInboxStore.getState().unreadCount).toBe(0);
  });

  it("deleteMessage soft-deletes (sets deleted=true)", async () => {
    await useInboxStore.getState().deleteMessage("inb-001");
    const msg = useInboxStore.getState().messages.find((m) => m.id === "inb-001");
    expect(msg?.deleted).toBe(true);
    expect(useInboxStore.getState().getTotalUnread()).toBe(0);
  });

  it("deleteMessage does not remove the record from messages array", async () => {
    await useInboxStore.getState().deleteMessage("inb-002");
    expect(useInboxStore.getState().messages).toHaveLength(2);
  });

  it("sendInboxMessage fails for unknown Arena ID", async () => {
    const result = await useInboxStore.getState().sendInboxMessage({
      myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
      targetArenaId: "ARENA-XXXXXX",
      subject: "Hello", content: "World",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ARENA-XXXXXX/);
  });

  it("sendInboxMessage succeeds for known Arena ID (POST /inbox)", async () => {
    const result = await useInboxStore.getState().sendInboxMessage({
      myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
      targetArenaId: "ARENA-WP0002",
      subject: "Hey", content: "Wanna play?",
    });
    expect(result.success).toBe(true);
    // Outbound mail does not appear in the sender's inbox list
    expect(useInboxStore.getState().messages.some((m) => m.subject === "Hey")).toBe(false);
  });

  it("Arena ID lookup is case-insensitive", async () => {
    const result = await useInboxStore.getState().sendInboxMessage({
      myId: "user-001", myName: "ArenaPlayer_01", myArenaId: "ARENA-AP0001",
      targetArenaId: "arena-wp0002",
      subject: "Test", content: "Content",
    });
    expect(result.success).toBe(true);
  });
});
