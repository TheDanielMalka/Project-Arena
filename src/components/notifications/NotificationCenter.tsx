import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, CheckCheck, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import {
  useNotificationStore,
  type Notification,
  type NotificationType,
} from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { apiRespondToNotification, apiJoinMatch } from "@/lib/engine-api";
import { cn } from "@/lib/utils";

const typeStyles: Record<NotificationType, string> = {
  match_result:   "border-l-arena-neon",
  payout:         "border-l-arena-gold",
  system:         "border-l-arena-cyan",
  dispute:        "border-l-arena-orange",
  match_invite:   "border-l-arena-purple",
  escrow:         "border-l-arena-gold",
  friend_request: "border-l-primary",
};

const typeRoutes: Record<NotificationType, string> = {
  match_result:   "/history",
  payout:         "/wallet",
  system:         "/dashboard",
  dispute:        "/admin",
  match_invite:   "/lobby",
  escrow:         "/wallet",
  friend_request: "/hub",   // DB-ready: routes to Hub → Friends tab
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
  onAcceptInvite,
  acceptingId,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  onRemove: (id: string) => void;
  onNavigate: (type: NotificationType) => void;
  onAcceptInvite?: (notifId: string) => void;
  acceptingId?: string | null;
}) {
  const isInvite = notification.type === "match_invite";
  const isAccepting = acceptingId === notification.id;

  return (
    <div
      className={cn(
        "relative px-4 py-3 border-l-2 transition-colors group hover:bg-secondary/80",
        typeStyles[notification.type],
        notification.read
          ? "bg-transparent opacity-60"
          : "bg-secondary/50",
        !isInvite && "cursor-pointer",
      )}
      onClick={() => {
        if (isInvite) return;
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
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-4 break-words [overflow-wrap:anywhere] leading-snug">
            {notification.message}
          </p>
          <span className="text-[10px] text-muted-foreground/60 mt-1 block">
            {timeAgo(notification.timestamp)}
          </span>
          {isInvite && onAcceptInvite && (
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                disabled={isAccepting}
                onClick={(e) => {
                  e.stopPropagation();
                  onRead(notification.id);
                  onAcceptInvite(notification.id);
                }}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-primary/10 border border-primary/30 text-primary text-[10px] font-bold hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {isAccepting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Accept
              </button>
              <button
                type="button"
                disabled={isAccepting}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(notification.id);
                }}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-secondary border border-border text-muted-foreground text-[10px] font-bold hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Decline
              </button>
            </div>
          )}
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
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead, removeNotification, clearAll } =
    useNotificationStore();
  const token = useUserStore((s) => s.token);

  const handleNavigate = (type: NotificationType) => {
    setOpen(false);
    const route = typeRoutes[type];
    if (route) navigate(route);
  };

  const handleAcceptInvite = async (notifId: string) => {
    if (!token) return;
    setAcceptingId(notifId);
    try {
      const r = await apiRespondToNotification(token, notifId, "accept");
      if (!r) {
        toast.error("Failed to accept invite. Please try again.");
        return;
      }
      if (!r.match_id) {
        toast.error("Invite expired or already accepted.");
        removeNotification(notifId);
        return;
      }
      const joinRes = await apiJoinMatch(token, r.match_id, {
        team: (r.your_team as "A" | "B" | undefined) ?? undefined,
      });
      if (joinRes.ok === false) {
        toast.error(joinRes.detail ?? "Could not join match.");
        return;
      }
      useMatchStore.getState().setActiveRoomId(r.match_id);
      const inviterName = r.inviter_username ?? "your friend";
      toast.success(`Joined match vs ${inviterName}`);
      removeNotification(notifId);
      setOpen(false);
      navigate(`/match/${r.match_id}`);
    } finally {
      setAcceptingId(null);
    }
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
        collisionPadding={16}
        className="w-[min(440px,calc(100vw-1.25rem))] max-w-[calc(100vw-1.25rem)] p-0 border-border bg-card shadow-2xl overflow-hidden rounded-lg z-[220]"
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
                onClick={() => markAllAsRead()}
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
        <ScrollArea
          className={cn(
            notifications.length === 0
              ? "max-h-[200px]"
              : "h-[min(360px,calc(100dvh-11rem))]",
          )}
        >
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
                  onAcceptInvite={handleAcceptInvite}
                  acceptingId={acceptingId}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
