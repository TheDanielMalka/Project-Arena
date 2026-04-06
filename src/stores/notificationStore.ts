import { create } from "zustand";
import type { NotificationType, Notification } from "@/types";
import {
  apiGetNotifications,
  apiMarkNotificationRead,
  apiMarkAllNotificationsRead,
  apiDeleteNotification,
  type ApiNotificationRow,
} from "@/lib/engine-api";

// Re-export so consumers can import from either path
export type { NotificationType, Notification };

function mapApiRowToNotification(row: ApiNotificationRow): Notification {
  return {
    id:        row.id,
    type:      row.type as NotificationType,
    title:     row.title,
    message:   row.message,
    timestamp: row.created_at ? new Date(row.created_at) : new Date(),
    read:      row.read,
    metadata:  row.metadata ?? undefined,
  };
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  /**
   * Fetch notifications from GET /notifications and replace local state.
   * Call once after login to hydrate the store from the real DB.
   * DB-ready: SELECT from notifications WHERE user_id = me ORDER BY created_at DESC.
   */
  fetchNotifications: (token: string) => Promise<void>;
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => void;
  /** Optimistic mark-as-read — fires PATCH /notifications/:id/read in background. */
  markAsRead: (id: string, token?: string | null) => void;
  /** Optimistic mark-all-read — fires PATCH /notifications/read-all in background. */
  markAllAsRead: (token?: string | null) => void;
  /** Optimistic remove — fires DELETE /notifications/:id in background. */
  removeNotification: (id: string, token?: string | null) => void;
  clearAll: () => void;
}

let idCounter = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  // Start empty — fetchNotifications() populates from the real DB after login.
  notifications: [],
  unreadCount: 0,

  fetchNotifications: async (token) => {
    const rows = await apiGetNotifications(token, { limit: 50 });
    if (!rows) return;  // network error — keep existing state
    const notifications = rows.map(mapApiRowToNotification);
    const unreadCount   = notifications.filter((n) => !n.read).length;
    set({ notifications, unreadCount });
  },

  addNotification: (notification) => {
    const newNotif: Notification = {
      ...notification,
      id:        `notif-${++idCounter}`,
      timestamp: new Date(),
      read:      false,
    };
    set((state) => ({
      notifications: [newNotif, ...state.notifications],
      unreadCount:   state.unreadCount + 1,
    }));
  },

  markAsRead: (id, token) => {
    // Optimistic update — fire & forget API call in background
    if (token) void apiMarkNotificationRead(token, id);
    set((state) => {
      const wasUnread = state.notifications.find((n) => n.id === id && !n.read);
      return {
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: wasUnread ? state.unreadCount - 1 : state.unreadCount,
      };
    });
  },

  markAllAsRead: (token) => {
    if (token) void apiMarkAllNotificationsRead(token);
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount:   0,
    }));
  },

  removeNotification: (id, token) => {
    if (token) void apiDeleteNotification(token, id);
    set((state) => {
      const removed = state.notifications.find((n) => n.id === id);
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount:   removed && !removed.read ? state.unreadCount - 1 : state.unreadCount,
      };
    });
  },

  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}));
