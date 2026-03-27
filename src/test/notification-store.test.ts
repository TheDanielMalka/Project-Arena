import { describe, it, expect, beforeEach } from "vitest";
import { useNotificationStore } from "@/stores/notificationStore";

// ─── Helper ───────────────────────────────────────────────────

function resetStore() {
  useNotificationStore.setState({
    notifications: [
      {
        id: "demo-1",
        type: "payout",
        title: "Payout Received",
        message: "You received 0.45 ETH from Match #1042.",
        timestamp: new Date("2026-03-27T10:00:00Z"),
        read: false,
      },
      {
        id: "demo-2",
        type: "match_result",
        title: "Victory!",
        message: "You won the CS2 match against Team Phantom.",
        timestamp: new Date("2026-03-27T09:00:00Z"),
        read: false,
      },
      {
        id: "demo-3",
        type: "system",
        title: "Maintenance",
        message: "Scheduled maintenance tonight.",
        timestamp: new Date("2026-03-27T08:00:00Z"),
        read: true,
      },
    ],
    unreadCount: 2,
  });
}

// ─── Tests ────────────────────────────────────────────────────

describe("notificationStore", () => {
  beforeEach(resetStore);

  it("initialises with correct notification count", () => {
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(3);
  });

  it("initialises with correct unreadCount", () => {
    const { unreadCount } = useNotificationStore.getState();
    expect(unreadCount).toBe(2);
  });

  it("addNotification prepends a new unread notification", () => {
    useNotificationStore.getState().addNotification({
      type: "match_invite",
      title: "Match Invite",
      message: "xDragon99 challenged you.",
    });
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toHaveLength(4);
    expect(notifications[0].title).toBe("Match Invite");
    expect(notifications[0].read).toBe(false);
    expect(unreadCount).toBe(3);
  });

  it("addNotification assigns a unique id", () => {
    useNotificationStore.getState().addNotification({ type: "system", title: "A", message: "B" });
    useNotificationStore.getState().addNotification({ type: "system", title: "C", message: "D" });
    const ids = useNotificationStore.getState().notifications.map((n) => n.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("markAsRead marks one notification read and decrements unreadCount", () => {
    useNotificationStore.getState().markAsRead("demo-1");
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications.find((n) => n.id === "demo-1")?.read).toBe(true);
    expect(unreadCount).toBe(1);
  });

  it("markAsRead on already-read notification does not change unreadCount", () => {
    useNotificationStore.getState().markAsRead("demo-3"); // already read
    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it("markAllAsRead sets all notifications to read and unreadCount to 0", () => {
    useNotificationStore.getState().markAllAsRead();
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications.every((n) => n.read)).toBe(true);
    expect(unreadCount).toBe(0);
  });

  it("removeNotification removes the notification from the list", () => {
    useNotificationStore.getState().removeNotification("demo-1");
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(2);
    expect(notifications.find((n) => n.id === "demo-1")).toBeUndefined();
  });

  it("removeNotification on unread decrements unreadCount", () => {
    useNotificationStore.getState().removeNotification("demo-2"); // unread
    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });

  it("removeNotification on read does not change unreadCount", () => {
    useNotificationStore.getState().removeNotification("demo-3"); // already read
    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it("clearAll removes all notifications and resets unreadCount", () => {
    useNotificationStore.getState().clearAll();
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toHaveLength(0);
    expect(unreadCount).toBe(0);
  });
});
