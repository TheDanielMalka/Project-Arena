import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Flag, ArrowLeft, Trophy, Swords, TrendingUp, DollarSign,
  CheckCircle2, AlertTriangle, Ban, ChevronRight,
  UserPlus, UserCheck, Clock,
} from "lucide-react";
import { getRankTier } from "@/lib/rankTiers";
import { usePlayerStore } from "@/stores/playerStore";
import { useReportStore } from "@/stores/reportStore";
import { useUserStore } from "@/stores/userStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { ignoredRefMatchesContext, useFriendStore } from "@/stores/friendStore";
import type { PublicPlayerProfile, TicketReason } from "@/types";
import { cn } from "@/lib/utils";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { renderForgeShopIcon } from "@/lib/forgeItemIcon";
import { ArenaPageShell } from "@/components/visual";

// ─── Constants ────────────────────────────────────────────────

const TIER_COLOR: Record<string, string> = {
  Bronze:   "#CD7F32",
  Silver:   "#A0A0A0",
  Gold:     "#FFD700",
  Platinum: "#00C9C9",
  Diamond:  "#A855F7",
  Master:   "#FF2D55",
};

const REASON_LABELS: Record<TicketReason, string> = {
  cheating:         "Cheating / Hacking",
  harassment:       "Harassment / Threats",
  fake_screenshot:  "Fake Screenshot / Result",
  disconnect_abuse: "Disconnect Abuse / Rage-Quit",
  other:            "Other",
};

// ─── Report Modal ─────────────────────────────────────────────

type ReportStep = "form" | "success";

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  reportedId: string;
  reportedUsername: string;
}

function ReportModal({ open, onClose, reportedId, reportedUsername }: ReportModalProps) {
  const user         = useUserStore((s) => s.user);
  const submitReport = useReportStore((s) => s.submitReport);
  const addNotif     = useNotificationStore((s) => s.addNotification);

  const [step,        setStep]        = useState<ReportStep>("form");
  const [reason,      setReason]      = useState<TicketReason | "">("");
  const [description, setDescription] = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const submitTidRef = useRef<number | null>(null);
  const resetTidRef  = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (submitTidRef.current !== null) window.clearTimeout(submitTidRef.current);
      if (resetTidRef.current  !== null) window.clearTimeout(resetTidRef.current);
    };
  }, []);

  const canSubmit = reason !== "" && description.trim().length >= 10;

  const handleSubmit = () => {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    // DB-ready: replace with POST /api/reports
    if (submitTidRef.current !== null) window.clearTimeout(submitTidRef.current);
    submitTidRef.current = window.setTimeout(() => {
      submitReport({
        reporterId:        user.id,
        reporterName:      user.username,
        reportedId,
        reportedUsername,
        reason:            reason as TicketReason,
        description:       description.trim(),
      });
      addNotif({
        type:    "system",
        title:   "🚩 Report Submitted",
        message: `Your report against ${reportedUsername} has been sent to our moderation team.`,
      });
      setSubmitting(false);
      setStep("success");
      submitTidRef.current = null;
    }, 800);
  };

  const handleClose = () => {
    onClose();
    // reset after close animation
    if (resetTidRef.current !== null) window.clearTimeout(resetTidRef.current);
    resetTidRef.current = window.setTimeout(() => {
      setStep("form");
      setReason("");
      setDescription("");
      resetTidRef.current = null;
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md bg-background border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-display">
            <Flag className="h-4 w-4 text-destructive" />
            {step === "success" ? "Report Submitted" : "Report Player"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Submit a report against this player for rule violations such as cheating, harassment, or unsportsmanlike behaviour. Reports are reviewed by Arena admins within 24 hours.
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <div className="space-y-4">
            {/* Reporting whom */}
            <div className="rounded-xl border border-border/40 bg-secondary/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">Reporting</p>
              <p className="font-display text-sm font-semibold mt-0.5">{reportedUsername}</p>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Reason
              </label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as TicketReason)}
              >
                <SelectTrigger className="bg-secondary/50 border-border/50">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(REASON_LABELS) as [TicketReason, string][]).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Description
                <span className="ml-1 text-muted-foreground/60 normal-case">(min 10 characters)</span>
              </label>
              <Textarea
                placeholder="Describe what happened in detail…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="bg-secondary/50 border-border/50 resize-none text-sm"
              />
              <p className="text-[10px] text-muted-foreground text-right">
                {description.length} chars
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-border/50"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
              >
                {submitting ? "Submitting…" : "Submit Report"}
              </Button>
            </div>
          </div>
        ) : (
          /* Success state */
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <div>
              <p className="font-display font-semibold text-sm">Report sent successfully</p>
              <p className="text-xs text-muted-foreground mt-1">
                Our moderation team will review your report against{" "}
                <span className="text-foreground font-medium">{reportedUsername}</span> within 24–48 hours.
              </p>
            </div>
            <Button className="w-full mt-2" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Friend Request Modal ─────────────────────────────────────

interface FriendRequestModalProps {
  open: boolean;
  targetUsername: string;
  targetArenaId: string;
  onClose: () => void;
  onConfirm: (message: string) => void;
}

function FriendRequestModal({ open, targetUsername, targetArenaId, onClose, onConfirm }: FriendRequestModalProps) {
  const [message, setMessage] = useState("");

  const handleClose = () => {
    onClose();
    setTimeout(() => setMessage(""), 300);
  };

  const handleConfirm = () => {
    void onConfirm(message.trim());
    setMessage("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm bg-background border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-display">
            <UserPlus className="h-4 w-4 text-primary" />
            Send Friend Request
          </DialogTitle>
          <DialogDescription className="sr-only">
            Send a friend request to connect with this player on Arena. You can include an optional personal message.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-secondary/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">To</p>
            <p className="font-display text-sm font-semibold mt-0.5">{targetUsername}</p>
            <p className="font-mono text-[10px] text-primary/70">{targetArenaId}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Message <span className="normal-case text-muted-foreground/60">(optional)</span>
            </label>
            <Textarea
              placeholder="Hey! Want to play together?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={200}
              className="bg-secondary/50 border-border/50 resize-none text-sm"
            />
            <p className="text-[10px] text-muted-foreground text-right">{message.length}/200</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-border/50" onClick={handleClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleConfirm}>
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Send Request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function PlayerProfile() {
  const { username }       = useParams<{ username: string }>();
  const navigate           = useNavigate();
  const fetchPublicPlayerByUsername = usePlayerStore((s) => s.fetchPublicPlayerByUsername);
  const currentUser        = useUserStore((s) => s.user);
  const token              = useUserStore((s) => s.token);
  const getRelationship   = useFriendStore((s) => s.getRelationship);
  const sendFriendRequest = useFriendStore((s) => s.sendFriendRequest);
  const friendships       = useFriendStore((s) => s.friendships);
  const declineRequest    = useFriendStore((s) => s.declineRequest);
  const blockPlayer        = useFriendStore((s) => s.blockPlayer);
  const ignoredUsers       = useFriendStore((s) => s.ignoredUsers);
  const unignoreForRoster  = useFriendStore((s) => s.unignoreForRoster);
  const addNotif           = useNotificationStore((s) => s.addNotification);
  const [reportOpen, setReportOpen] = useState(false);
  const [frModalOpen, setFrModalOpen] = useState(false);
  const [player, setPlayer] = useState<PublicPlayerProfile | null | undefined>(undefined);

  useEffect(() => {
    const name = username?.trim();
    if (!name) {
      setPlayer(null);
      return;
    }
    const cached = usePlayerStore.getState().getPlayerByUsername(name);
    if (cached) {
      setPlayer(cached);
      return;
    }
    setPlayer(undefined);
    let cancelled = false;
    void fetchPublicPlayerByUsername(name, token).then((p) => {
      if (!cancelled) setPlayer(p ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [username, token, fetchPublicPlayerByUsername]);

  const profileIgnoreCtx = useMemo(() => {
    if (!player) return null;
    return {
      canonicalUserId: player.id,
      displayUsername: player.username,
      rosterSlot: username ?? player.username,
      profileId: player.id,
    };
  }, [player, username]);

  const profileIgnored = useMemo(() => {
    if (!profileIgnoreCtx) return false;
    return ignoredUsers.some((u) => ignoredRefMatchesContext(profileIgnoreCtx, u));
  }, [ignoredUsers, profileIgnoreCtx]);

  if (player === undefined) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center py-24">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center py-24">
        <p className="text-muted-foreground text-sm">Player not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/players")}>
          ← Back to Players
        </Button>
      </div>
    );
  }

  const tierColor   = TIER_COLOR[player.tier] ?? "#888";
  const isSelf      = currentUser?.username === player.username;
  const isInactive  = player.status !== "active";

  const handleFrConfirm = async (message: string) => {
    if (!currentUser || !player) return;
    const created = await sendFriendRequest({
      myId: currentUser.id, myUsername: currentUser.username,
      myArenaId: currentUser.arenaId, myAvatarInitials: currentUser.avatarInitials,
      myRank: currentUser.rank, myTier: currentUser.tier, myPreferredGame: currentUser.preferredGame,
      targetId: player.id, targetUsername: player.username,
      targetArenaId: player.arenaId, targetAvatarInitials: player.avatarInitials,
      targetRank: player.rank, targetTier: player.tier, targetPreferredGame: player.preferredGame,
      message: message || undefined,
    });
    if (!created) return;
    addNotif({
      type: "system",
      title: "Friend Request Sent",
      message: `Request sent to ${player.username} (${player.arenaId})`,
    });
    setFrModalOpen(false);
  };

  const statCards = [
    { label: "Win Rate",   value: `${player.stats.winRate.toFixed(1)}%`, icon: TrendingUp,   color: "text-primary" },
    { label: "Matches",    value: player.stats.matches,                   icon: Swords,       color: "text-foreground" },
    { label: "Wins",       value: player.stats.wins,                      icon: Trophy,       color: "text-arena-gold" },
    { label: "Earnings",   value: `$${player.stats.totalEarnings.toLocaleString()}`, icon: DollarSign, color: "text-primary" },
  ] as const;

  return (
    <ArenaPageShell variant="player-profile" contentClassName="max-w-3xl mx-auto space-y-6">

      {/* Back */}
      <button
        onClick={() => navigate("/players")}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Players
      </button>

      {/* Profile header card */}
      <div className="rounded-2xl border border-border/50 bg-secondary/20 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">

          {/* Avatar + info */}
          <div className="flex items-center gap-4">
            <div className="flex items-start gap-2 shrink-0">
              <div className="relative w-16 h-16 shrink-0">
                <div
                  className="w-full h-full rounded-2xl flex items-center justify-center font-display text-xl font-bold overflow-hidden"
                  style={{
                    background: `${tierColor}20`,
                    border: `2px solid ${tierColor}60`,
                    color: tierColor,
                    boxShadow: `0 0 20px ${tierColor}20`,
                  }}
                >
                  {player.avatar && player.avatar !== "initials"
                    ? player.avatar.startsWith("upload:")
                      ? <img src={player.avatar.slice(7)} className="w-full h-full object-cover" alt="" />
                      : (() => {
                        const u = getAvatarImageUrlFromStorage(player.avatar);
                        return u ? <img src={u} className={cn("h-full w-full", identityPortraitCropClassName)} alt="" decoding="async" /> : <span className="text-2xl">{player.avatar}</span>;
                      })()
                    : player.avatarInitials}
                </div>
                {player.leaderboardRank && (() => {
                  const tier = getRankTier(player.leaderboardRank);
                  if (!tier) return null;
                  return (
                    <div
                      className={`absolute -top-1 -right-1 z-[2] w-5 h-5 rounded-full flex items-center justify-center ${tier.color}`}
                      style={{ background: "hsl(var(--card))", border: "1.5px solid currentColor" }}
                      title={`Rank #${player.leaderboardRank}`}
                    >
                      <tier.Icon className="h-2.5 w-2.5" />
                    </div>
                  );
                })()}
                {player.equippedBadgeIcon?.startsWith("badge:") && (
                  <div
                    className="absolute bottom-0.5 right-0.5 z-[3] h-[18px] w-[18px] overflow-hidden rounded-full ring-2 ring-background shadow-sm"
                    title="Forge ring badge"
                  >
                    {renderForgeShopIcon(player.equippedBadgeIcon, "sm", "pin")}
                  </div>
                )}
              </div>
              {!isSelf && currentUser && (
                profileIgnored ? (
                  <button
                    type="button"
                    title="Unignore player"
                    onClick={() => {
                      if (profileIgnoreCtx) unignoreForRoster(profileIgnoreCtx);
                      addNotif({
                        type: "system",
                        title: "Unignored",
                        message: `You can interact with ${player.username} again.`,
                      });
                    }}
                    className="mt-0.5 h-8 w-8 rounded-lg border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    title="Ignore player"
                    onClick={() => {
                      if (!currentUser) return;
                      void blockPlayer({
                        myId: currentUser.id,
                        targetUserId: player.id,
                        targetUsername: player.username,
                        rosterSlot: username ?? player.username,
                      });
                    }}
                    className="mt-0.5 h-8 w-8 rounded-lg border border-destructive/25 flex items-center justify-center text-destructive/80 hover:bg-destructive/10 transition-colors shrink-0"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                )
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-xl font-bold">{player.username}</h1>
                {/* Leaderboard rank tier icon — only shown if player is top 50 */}
                {player.leaderboardRank && (() => {
                  const tier = getRankTier(player.leaderboardRank);
                  if (!tier) return null;
                  return (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-display font-bold uppercase tracking-widest ${tier.color}`}
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid currentColor", opacity: 0.9 }}
                      title={`Global Rank #${player.leaderboardRank} — ${tier.label}`}
                    >
                      <tier.Icon className={tier.iconSize} />
                      #{player.leaderboardRank} {tier.label}
                    </span>
                  );
                })()}
                {isInactive && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      player.status === "banned"
                        ? "border-destructive/50 text-destructive"
                        : "border-arena-orange/50 text-arena-orange"
                    )}
                  >
                    {player.status === "banned" ? (
                      <><Ban className="h-2.5 w-2.5 mr-1" />Banned</>
                    ) : (
                      <><AlertTriangle className="h-2.5 w-2.5 mr-1" />Flagged</>
                    )}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    color: tierColor,
                    background: `${tierColor}18`,
                    border: `1px solid ${tierColor}35`,
                  }}
                >
                  {player.rank}
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{player.preferredGame}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">Member since {player.memberSince}</span>
              </div>
            </div>
          </div>

          {/* Action buttons — hidden for own profile */}
          {!isSelf && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Friend button */}
              {(() => {
                const rel = getRelationship(player.id);
                if (rel === "accepted") {
                  return (
                    <Button variant="outline" size="sm" className="border-primary/30 text-primary gap-1.5" disabled>
                      <UserCheck className="h-3.5 w-3.5" /> Friends
                    </Button>
                  );
                }
                if (rel === "pending") {
                  const f = friendships.find((fr) => fr.friendId === player.id && fr.status === "pending");
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border/50 text-muted-foreground hover:text-destructive hover:border-destructive/40 gap-1.5"
                      onClick={() => f && void declineRequest(f.id)}
                      title="Cancel friend request"
                    >
                      <Clock className="h-3.5 w-3.5" /> Pending ×
                    </Button>
                  );
                }
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-primary/30 text-primary hover:bg-primary/10 gap-1.5"
                    onClick={() => setFrModalOpen(true)}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Add Friend
                  </Button>
                );
              })()}
              {currentUser && !isSelf && (
                profileIgnored ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border/50 text-muted-foreground gap-1.5"
                    onClick={() => {
                      if (profileIgnoreCtx) unignoreForRoster(profileIgnoreCtx);
                      addNotif({
                        type: "system",
                        title: "Unignored",
                        message: `You can interact with ${player.username} again.`,
                      });
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" /> Unignore
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-1.5"
                    onClick={() =>
                      void blockPlayer({
                        myId: currentUser.id,
                        targetUserId: player.id,
                        targetUsername: player.username,
                        rosterSlot: username ?? player.username,
                      })
                    }
                  >
                    <Ban className="h-3.5 w-3.5" /> Ignore
                  </Button>
                )
              )}
              {/* Report button */}
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/60 gap-1.5"
                onClick={() => setReportOpen(true)}
              >
                <Flag className="h-3.5 w-3.5" />
                Report
                <ChevronRight className="h-3 w-3 opacity-50" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-xl border border-border/40 bg-secondary/20 px-4 py-4 flex flex-col items-center gap-1.5"
          >
            <Icon className={cn("h-5 w-5", color)} />
            <p className={cn("font-display text-lg font-bold tabular-nums", color)}>
              {value}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
          </div>
        ))}
      </div>

      {/* Win / Loss bar */}
      <div className="rounded-xl border border-border/40 bg-secondary/20 p-4 space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="font-medium text-primary">{player.stats.wins}W</span>
          <span className="font-medium text-destructive">{player.stats.losses}L</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden flex">
          <div
            className="h-full bg-primary rounded-l-full transition-all duration-700"
            style={{ width: `${player.stats.winRate}%` }}
          />
          <div className="h-full bg-destructive/60 flex-1 rounded-r-full" />
        </div>
        <p className="text-[10px] text-muted-foreground text-center">
          {player.stats.matches} total matches — {player.stats.winRate.toFixed(1)}% win rate
        </p>
      </div>

      {/* Report modal */}
      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        reportedId={player.id}
        reportedUsername={player.username}
      />
      <FriendRequestModal
        open={frModalOpen}
        targetUsername={player.username}
        targetArenaId={player.arenaId}
        onClose={() => setFrModalOpen(false)}
        onConfirm={handleFrConfirm}
      />
    </ArenaPageShell>
  );
}
