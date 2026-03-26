import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, CheckCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  useNotificationStore,
  type Notification,
  type NotificationType,
} from "@/stores/notificationStore";
import { cn } from "@/lib/utils";

const typeStyles: Record<NotificationType, string> = {
  match_result: "border-l-arena-neon",
  payout: "border-l-arena-gold",
  system: "border-l-arena-cyan",
  dispute: "border-l-arena-orange",
  match_invite: "border-l-arena-purple",
  escrow: "border-l-arena-gold",
};

const typeRoutes: Record<NotificationType, string> = {
  match_result: "/history",
  payout: "/wallet",
  system: "/dashboard",
  dispute: "/admin",
  match_invite: "/lobby",
  escrow: "/wallet",
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationItem({
  notification,
  onRead,
  onRemove,
  onNavigate,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  onRemove: (id: string) => void;
  onNavigate: (type: NotificationType) => void;
}) {
  return (
    <div
      className={cn(
        "relative px-4 py-3 border-l-2 transition-colors cursor-pointer group hover:bg-secondary/80",
        typeStyles[notification.type],
        notification.read
          ? "bg-transparent opacity-60"
          : "bg-secondary/50"
      )}
      onClick={() => {
        if (!notification.read) onRead(notification.id);
        onNavigate(notification.type);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-display text-sm font-semibold tracking-wide truncate">
              {notification.title}
            </p>
            {!notification.read && (
              <span className="h-2 w-2 rounded-full bg-primary shrink-0 animate-pulse-glow" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {notification.message}
          </p>
          <span className="text-[10px] text-muted-foreground/60 mt-1 block">
            {timeAgo(notification.timestamp)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(notification.id);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead, removeNotification, clearAll } =
    useNotificationStore();

  const handleNavigate = (type: NotificationType) => {
    setOpen(false);
    const route = typeRoutes[type];
    if (route) navigate(route);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] font-bold bg-destructive text-destructive-foreground border-2 border-background rounded-full flex items-center justify-center"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[380px] p-0 border-border bg-card shadow-2xl"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold tracking-wide">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-primary"
                onClick={markAllAsRead}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Read all
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                onClick={clearAll}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {/* Notification List */}
        <ScrollArea className="max-h-[400px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No notifications</p>
              <p className="text-xs opacity-60">You're all caught up!</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((notif) => (
                <NotificationItem
                  key={notif.id}
                  notification={notif}
                  onRead={markAsRead}
                  onRemove={removeNotification}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
