import { create } from "zustand";
import type { NotificationType, Notification } from "@/types";

// Re-export so consumers can import from either path
export type { NotificationType, Notification };

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  // DB-ready: replace with POST /api/notifications
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => void;
  // DB-ready: replace with PATCH /api/notifications/:id/read
  markAsRead: (id: string) => void;
  // DB-ready: replace with PATCH /api/notifications/read-all
  markAllAsRead: () => void;
  // DB-ready: replace with DELETE /api/notifications/:id
  removeNotification: (id: string) => void;
  // DB-ready: replace with DELETE /api/notifications
  clearAll: () => void;
}

let idCounter = 0;

const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: "demo-1",
    type: "payout",
    title: "💰 Payout Received",
    message: "You received 0.45 ETH from Match #1042. Funds deposited to your wallet.",
    timestamp: new Date(Date.now() - 1000 * 60 * 3),
    read: false,
  },
  {
    id: "demo-2",
    type: "match_result",
    title: "🏆 Victory!",
    message: "You won the CS2 match against Team Phantom. Rating +25.",
    timestamp: new Date(Date.now() - 1000 * 60 * 18),
    read: false,
  },
  {
    id: "demo-3",
    type: "match_invite",
    title: "⚔️ Match Invite",
    message: "xDragon99 challenged you to a 1v1 Valorant duel. $50 stake.",
    timestamp: new Date(Date.now() - 1000 * 60 * 45),
    read: false,
  },
  {
    id: "demo-4",
    type: "dispute",
    title: "🚩 Dispute Opened",
    message: "Match #1038 is under review. An admin will resolve within 24h.",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    read: true,
  },
  {
    id: "demo-5",
    type: "system",
    title: "🔧 Maintenance",
    message: "Scheduled maintenance tonight 02:00-04:00 UTC. Matchmaking paused.",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
    read: true,
  },
];

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: DEMO_NOTIFICATIONS,
  unreadCount: DEMO_NOTIFICATIONS.filter((n) => !n.read).length,

  addNotification: (notification) => {
    const newNotif: Notification = {
      ...notification,
      id: `notif-${++idCounter}`,
      timestamp: new Date(),
      read: false,
    };
    set((state) => ({
      notifications: [newNotif, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    }));
  },

  markAsRead: (id) =>
    set((state) => {
      const wasUnread = state.notifications.find((n) => n.id === id && !n.read);
      return {
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: wasUnread ? state.unreadCount - 1 : state.unreadCount,
      };
    }),

  markAllAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  removeNotification: (id) =>
    set((state) => {
      const removed = state.notifications.find((n) => n.id === id);
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: removed && !removed.read ? state.unreadCount - 1 : state.unreadCount,
      };
    }),

  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}));
