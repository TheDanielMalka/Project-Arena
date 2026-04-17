import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  LogOut,
  UserPlus,
  UserCheck,
  Clock,
  Flag,
  UserCircle2,
  MessageSquare,
  Send,
  Ban,
} from "lucide-react";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { ignoredRefMatchesContext, useFriendStore } from "@/stores/friendStore";
import { useReportStore } from "@/stores/reportStore";
import { apiSubmitSupportTicket } from "@/lib/engine-api";
import { usePlayerStore } from "@/stores/playerStore";
import { useMessageStore } from "@/stores/messageStore";
import type { TicketReason } from "@/types";
import {
  isCurrentUserSlot,
  resolveRosterProfile,
  rosterDisplayUsername,
  syntheticUserIdFromDisplayKey,
} from "@/lib/matchPlayerDisplay";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

// Mini-profile card when clicking a player in lobby / history / recent matches
// DB-ready: GET /api/players/:username — POST /api/friends — POST /api/reports
export function PlayerCardPopover({
  slotValue,
  onClose,
  onLeaveRoom = () => {},
  enableLeaveRoom = true,
}: {
  /** Raw roster value from match (user id or username) */
  slotValue: string;
  onClose: () => void;
  onLeaveRoom?: () => void;
  /** false in History / Dashboard — no "Leave Room" */
  enableLeaveRoom?: boolean;
}) {
  const navigate = useNavigate();
  const { user, token } = useUserStore();
  const { players, fetchPublicPlayerById } = usePlayerStore();
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const ignoredUsers = useFriendStore((s) => s.ignoredUsers);
  const friendships = useFriendStore((s) => s.friendships);
  const sendFriendRequest = useFriendStore((s) => s.sendFriendRequest);
  const blockPlayer = useFriendStore((s) => s.blockPlayer);
  const unignoreForRoster = useFriendStore((s) => s.unignoreForRoster);
  const { submitReport } = useReportStore();

  type PopoverTab = "actions" | "message";
  const [tab, setTab] = useState<PopoverTab>("actions");
  const [msgText, setMsgText] = useState("");
  const [msgSent, setMsgSent] = useState(false);
  const msgRef = useRef<HTMLTextAreaElement>(null);

  const isOwnSlot = isCurrentUserSlot(slotValue, user?.id, user?.username);
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    slotValue.trim(),
  );

  useEffect(() => {
    if (!looksLikeUuid || isOwnSlot) return;
    void fetchPublicPlayerById(slotValue.trim(), token ?? null);
  }, [looksLikeUuid, isOwnSlot, slotValue, token, fetchPublicPlayerById]);

  const profile = resolveRosterProfile(slotValue, user?.id, user?.username, players);
  const username = rosterDisplayUsername(slotValue, user?.id, user?.username, players);

  const [reportStep, setReportStep] = useState<"idle" | "form" | "done">("idle");
  const [reportReason, setReportReason] = useState<TicketReason>("cheating");
  const [reportDesc, setReportDesc] = useState("");

  const targetId = profile?.id ?? syntheticUserIdFromDisplayKey(username);
  const targetArenaId = profile?.arenaId ?? `ARENA-${username.slice(0, 2).toUpperCase()}`;
  const targetInitials = profile?.avatarInitials ?? username.slice(0, 2).toUpperCase();
  const targetRank = profile?.rank ?? "—";
  const targetTier = profile?.tier ?? "—";
  const targetGame = profile?.preferredGame ?? "—";

  const existingFr = friendships.find((f) => f.friendId === targetId);
  const isFriend = existingFr?.status === "accepted";
  const isPending = existingFr?.status === "pending";

  const REASON_LABELS: Record<TicketReason, string> = {
    cheating: "Cheating / Hacking",
    harassment: "Harassment",
    fake_screenshot: "Fake Screenshot",
    disconnect_abuse: "Disconnect Abuse",
    other: "Other",
  };

  const handleAddFriend = async () => {
    if (!user) return;
    const created = await sendFriendRequest({
      myId: user.id,
      myUsername: user.username,
      myArenaId: user.arenaId,
      myAvatarInitials: user.avatarInitials,
      myRank: user.rank,
      myTier: user.tier,
      myPreferredGame: user.preferredGame,
      targetId,
      targetUsername: username,
      targetArenaId,
      targetAvatarInitials: targetInitials,
      targetRank,
      targetTier,
      targetPreferredGame: targetGame,
    });
    if (!created) return;
    useNotificationStore.getState().addNotification({
      type: "friend_request",
      title: "Friend Request Sent",
      message: `Your friend request to ${username} was sent. You'll be notified when they accept.`,
    });
    onClose();
  };

  const handleReport = async () => {
    if (!user) return;
    const tkn = useUserStore.getState().token ?? "";
    const result = await apiSubmitSupportTicket(tkn, {
      reason: reportReason,
      description: reportDesc.trim() || reportReason,
      category: "player_report",
      reported_id: targetId,
    });
    if (result.ok) {
      submitReport({
        reporterId: user.id,
        reporterName: user.username,
        reportedId: targetId,
        reportedUsername: username,
        reason: reportReason,
        description: reportDesc,
      });
    }
    useNotificationStore.getState().addNotification({
      type: "system",
      title: result.ok ? "Report Submitted" : "Report Failed",
      message: result.ok
        ? `Your report on ${username} has been sent to the moderation team.`
        : ("detail" in result ? result.detail : "Could not submit report."),
    });
    setReportStep("done");
    setTimeout(onClose, 1200);
  };

  const handleBlockPlayer = () => {
    if (!user) return;
    void blockPlayer({
      myId: user.id,
      targetUserId: targetId,
      targetUsername: username,
      rosterSlot: slotValue,
    });
  };

  const rosterIgnoreCtx = useMemo(
    () => ({
      canonicalUserId: targetId,
      displayUsername: username,
      rosterSlot: slotValue,
      profileId: profile?.id,
    }),
    [targetId, username, slotValue, profile?.id]
  );

  const targetIgnored = useMemo(
    () => ignoredUsers.some((u) => ignoredRefMatchesContext(rosterIgnoreCtx, u)),
    [ignoredUsers, rosterIgnoreCtx]
  );

  const handleUnignore = () => {
    unignoreForRoster(rosterIgnoreCtx);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Unignored",
      message: `You can interact with ${username} again.`,
    });
  };

  const handleSendMessage = async () => {
    if (!user || !msgText.trim()) return;
    const sent = await sendMessage({
      myId: user.id,
      myUsername: user.username,
      friendId: targetId,
      content: msgText.trim(),
    });
    if (!sent) return;
    setMsgSent(true);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Message Sent",
      message: `Your message was delivered to ${username}`,
    });
  };

  return (
    <div className="w-56 rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden">
      <div className="px-3 py-2.5 bg-secondary/40 border-b border-border/40 flex items-center gap-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center font-display text-[10px] font-bold text-primary">
            {username.slice(0, 2).toUpperCase()}
          </div>
          {!isOwnSlot && user && (
            targetIgnored ? (
              <button
                type="button"
                title="Unignore"
                onClick={handleUnignore}
                className="h-7 w-7 rounded-lg border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                title="Ignore player"
                onClick={handleBlockPlayer}
                className="h-7 w-7 rounded-lg border border-destructive/25 flex items-center justify-center text-destructive/80 hover:bg-destructive/10 transition-colors"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            )
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold font-display truncate">{username}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {profile?.rank ?? "—"} · {profile?.preferredGame ?? "—"}
          </p>
        </div>
      </div>

      <div className="p-2 space-y-1">
        {!isOwnSlot && tab === "message" ? (
          <div className="space-y-2">
            {!msgSent ? (
              <>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-display">
                  Message to {username}
                </p>
                <Textarea
                  ref={msgRef}
                  placeholder="Type your message…"
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="bg-secondary/50 border-border/50 resize-none text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && msgText.trim()) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                />
                <p className="text-[9px] text-muted-foreground text-right">{msgText.length}/500 · Ctrl+Enter to send</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 px-1"
                    onClick={() => setTab("actions")}
                  >
                    ← Back
                  </button>
                  {!targetIgnored && !isFriend && !isPending && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0 border-primary/30 text-primary gap-1"
                      onClick={() => void handleAddFriend()}
                    >
                      <UserPlus className="h-3 w-3" /> Add Friend
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="flex-1 min-w-[6rem] h-7 text-xs gap-1.5"
                    disabled={!msgText.trim()}
                    onClick={() => void handleSendMessage()}
                  >
                    <Send className="h-3.5 w-3.5" /> Send
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-2 space-y-2">
                <p className="text-xs font-display font-semibold text-primary">Sent!</p>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setTab("actions"); setMsgText(""); setMsgSent(false); }}
                >
                  ← Back to actions
                </button>
              </div>
            )}
          </div>
        ) : null}

        {tab === "actions" ? (
        isOwnSlot && enableLeaveRoom ? (
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
            onClick={() => {
              onClose();
              onLeaveRoom();
            }}
          >
            <LogOut className="h-3 w-3" /> Leave Room
          </button>
        ) : isOwnSlot && !enableLeaveRoom ? (
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 rounded-lg transition-colors text-left"
            onClick={() => {
              navigate("/profile");
              onClose();
            }}
          >
            <UserCircle2 className="h-3 w-3" /> My Profile
          </button>
        ) : (
          <>
            {isFriend ? (
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
                <UserCheck className="h-3 w-3" /> Friends
              </div>
            ) : isPending ? (
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> Request Sent
              </div>
            ) : targetIgnored ? (
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
                <Ban className="h-3 w-3" /> Ignored
              </div>
            ) : (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-secondary/60 rounded-lg transition-colors"
                onClick={() => void handleAddFriend()}
              >
                <UserPlus className="h-3 w-3 text-primary" /> Add Friend
              </button>
            )}

            <button
              type="button"
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-primary/10 text-primary rounded-lg transition-colors text-left"
              onClick={() => {
                setTab("message");
                setMsgSent(false);
                setMsgText("");
                setTimeout(() => msgRef.current?.focus(), 50);
              }}
            >
              <MessageSquare className="h-3 w-3" /> Send Message
            </button>

            {!targetIgnored && (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-destructive/80 hover:bg-destructive/10 rounded-lg transition-colors"
                onClick={handleBlockPlayer}
              >
                <Ban className="h-3 w-3" /> Ignore player
              </button>
            )}

            {reportStep === "idle" && (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-destructive/70 hover:bg-destructive/10 hover:text-destructive rounded-lg transition-colors"
                onClick={() => setReportStep("form")}
              >
                <Flag className="h-3 w-3" /> Report
              </button>
            )}

            {reportStep === "form" && (
              <div className="space-y-1.5 pt-1">
                <Select
                  value={reportReason}
                  onValueChange={(v) => setReportReason(v as TicketReason)}
                >
                  <SelectTrigger className="h-8 min-h-8 py-1 text-[10px] border-border/50 bg-secondary/60 text-foreground ring-offset-card focus:ring-2 focus:ring-primary/35 focus:ring-offset-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="z-[80] max-h-48 border-border/60 bg-card text-foreground shadow-2xl [&_[data-highlighted]]:!bg-primary/18 [&_[data-highlighted]]:!text-foreground"
                  >
                    {(Object.entries(REASON_LABELS) as [TicketReason, string][]).map(([k, v]) => (
                      <SelectItem
                        key={k}
                        value={k}
                        className="text-[10px] py-1.5 focus:bg-primary/15 focus:text-foreground data-[state=checked]:bg-primary/12"
                      >
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <textarea
                  value={reportDesc}
                  onChange={(e) => setReportDesc(e.target.value)}
                  placeholder="Brief description…"
                  rows={2}
                  className="w-full text-[10px] rounded-md border border-border/50 bg-secondary/50 px-2 py-1 resize-none"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={!reportDesc.trim()}
                    onClick={() => void handleReport()}
                    className="flex-1 text-[10px] bg-destructive text-destructive-foreground rounded-md py-1 disabled:opacity-40"
                  >
                    Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportStep("idle")}
                    className="text-[10px] px-2 rounded-md border border-border/40 hover:bg-secondary/60"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            {reportStep === "done" && (
              <p className="text-[10px] text-primary px-2.5 py-1.5">✓ Report submitted</p>
            )}
          </>
        )
        ) : null}

        {!isOwnSlot && (
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 rounded-lg transition-colors text-left"
            onClick={() => {
              navigate(`/players/${encodeURIComponent(username)}`);
              onClose();
            }}
          >
            <UserCircle2 className="h-3 w-3" /> View Profile
          </button>
        )}
      </div>
    </div>
  );
}

/** Fixed positioning + backdrop — same pattern as Match Lobby */
export function PlayerPopoverLayer({
  open,
  slotValue,
  rect,
  onClose,
  onLeaveRoom,
  enableLeaveRoom,
}: {
  open: boolean;
  slotValue: string | null;
  rect: DOMRect | null;
  onClose: () => void;
  onLeaveRoom?: () => void;
  enableLeaveRoom?: boolean;
}) {
  if (!open || !slotValue || !rect) return null;
  const POPOVER_W = 232;
  const POPOVER_H = 300;
  const gutter = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  let top = rect.bottom + gutter;
  if (top + POPOVER_H > vh - gutter) {
    const above = rect.top - POPOVER_H - gutter;
    if (above >= gutter) top = above;
    else top = Math.max(gutter, vh - POPOVER_H - gutter);
  }

  const left = Math.max(gutter, Math.min(rect.left, vw - POPOVER_W - gutter));

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={onClose} aria-hidden />
      <div className="fixed z-[71]" style={{ top, left }}>
        <PlayerCardPopover
          slotValue={slotValue}
          onClose={onClose}
          onLeaveRoom={onLeaveRoom}
          enableLeaveRoom={enableLeaveRoom}
        />
      </div>
    </>,
    document.body,
  );
}
