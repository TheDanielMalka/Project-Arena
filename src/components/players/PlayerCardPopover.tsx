import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogOut,
  UserPlus,
  UserCheck,
  Clock,
  Flag,
  UserCircle2,
  Mail,
  Ban,
} from "lucide-react";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { useFriendStore } from "@/stores/friendStore";
import { useReportStore } from "@/stores/reportStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { TicketReason } from "@/types";
import { isCurrentUserSlot, slotToProfileUsername } from "@/lib/matchPlayerDisplay";

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
  const { user } = useUserStore();
  const { players } = usePlayerStore();
  const { friendships, sendFriendRequest, isIgnored, blockPlayer, unignoreUser } = useFriendStore();
  const { submitReport } = useReportStore();

  const username = slotToProfileUsername(slotValue, user?.id, user?.username);
  const isOwnSlot = isCurrentUserSlot(slotValue, user?.id, user?.username);

  const [reportStep, setReportStep] = useState<"idle" | "form" | "done">("idle");
  const [reportReason, setReportReason] = useState<TicketReason>("cheating");
  const [reportDesc, setReportDesc] = useState("");

  const profile = players.find((p) => p.username === username);

  const targetId = profile?.id ?? `u-${username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
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

  const handleAddFriend = () => {
    if (!user) return;
    const created = sendFriendRequest({
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

  const handleReport = () => {
    if (!user) return;
    submitReport({
      reporterId: user.id,
      reporterName: user.username,
      reportedId: targetId,
      reportedUsername: username,
      reason: reportReason,
      description: reportDesc,
    });
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Report Submitted",
      message: `Your report on ${username} has been sent to the moderation team. We'll review it shortly.`,
    });
    setReportStep("done");
    setTimeout(onClose, 1200);
  };

  const handleBlockPlayer = () => {
    if (!user) return;
    blockPlayer({ myId: user.id, targetUserId: targetId, targetUsername: username });
    onClose();
  };

  const handleUnignore = () => {
    unignoreUser(targetId);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Unignored",
      message: `You can interact with ${username} again.`,
    });
    onClose();
  };

  return (
    <div className="w-56 rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden">
      <div className="px-3 py-2.5 bg-secondary/40 border-b border-border/40 flex items-center gap-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center font-display text-[10px] font-bold text-primary">
            {username.slice(0, 2).toUpperCase()}
          </div>
          {!isOwnSlot && user && (
            isIgnored(targetId) ? (
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
        {isOwnSlot && enableLeaveRoom ? (
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
            ) : isIgnored(targetId) ? (
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
                <Ban className="h-3 w-3" /> Ignored
              </div>
            ) : (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-secondary/60 rounded-lg transition-colors"
                onClick={handleAddFriend}
              >
                <UserPlus className="h-3 w-3 text-primary" /> Add Friend
              </button>
            )}

            <button
              type="button"
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 rounded-lg transition-colors text-left"
              onClick={() => {
                navigate("/hub?tab=messages");
                onClose();
              }}
            >
              <Mail className="h-3 w-3" /> Messages
              {/* DB-ready: deep-link ?user=username to open DM thread */}
            </button>

            {!isIgnored(targetId) && (
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
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value as TicketReason)}
                  className="w-full text-[10px] rounded-md border border-border/50 bg-secondary/50 px-2 py-1"
                >
                  {(Object.entries(REASON_LABELS) as [TicketReason, string][]).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
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
                    onClick={handleReport}
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
        )}

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
  const top = Math.min(rect.bottom + 8, typeof window !== "undefined" ? window.innerHeight - 320 : rect.bottom + 8);
  const left = Math.min(rect.left, typeof window !== "undefined" ? window.innerWidth - 232 : rect.left);

  return (
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
    </>
  );
}
