import { useEffect, useRef } from "react";
import { useNotificationStore } from "@/stores/notificationStore";
import { toast } from "@/hooks/use-toast";

/**
 * Watches the notification store and fires toast alerts for new notifications.
 * Mount once in App.tsx.
 */
export function NotificationToastListener() {
  const notifications = useNotificationStore((s) => s.notifications);
  const prevLength = useRef(notifications.length);

  useEffect(() => {
    if (notifications.length > prevLength.current) {
      const latest = notifications[0];
      if (latest && !latest.read) {
        toast({
          title: latest.title,
          description: latest.message,
        });
      }
    }
    prevLength.current = notifications.length;
  }, [notifications]);

  return null;
}
