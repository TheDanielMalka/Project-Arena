import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Trophy, Flame, Crown, ChevronUp, ChevronDown, ChevronRight, Minus, Zap, TrendingUp,
  Star, Gem, Shield, UserPlus, UserCheck, Clock, MessageSquare, Flag,
  ExternalLink, Send, CheckCircle2, Ban, Radio, Crosshair, Cpu,
} from "lucide-react";
import { useUserStore }         from "@/stores/userStore";
import { ignoredRefMatchesContext, useFriendStore } from "@/stores/friendStore";
import { useMessageStore }      from "@/stores/messageStore";
import { useReportStore }       from "@/stores/reportStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { getRankTier, RANK_TIERS } from "@/lib/rankTiers";
import type { LeaderboardPlayerRow, TicketReason } from "@/types";
import { apiGetLeaderboard, apiSubmitSupportTicket } from "@/lib/engine-api";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { renderForgeShopIcon } from "@/lib/forgeItemIcon";
import { cn } from "@/lib/utils";
import { ArenaPageShell } from "@/components/visual";

type LeaderboardEntry = LeaderboardPlayerRow;

// All defined game tabs (order matters for display)
const GAME_TABS = ["all", "CS2", "Valorant", "Fortnite", "Apex Legends"] as const;
type GameTab = typeof GAME_TABS[number];

const LB_NAV = [
  { id: "board" as const, icon: Trophy, label: "Live Board", short: "LIVE", desc: "Podium · roster · live sync" },
  { id: "tiers" as const, icon: Crown, label: "Rank Matrix", short: "RNK", desc: "Tier classification" },
  { id: "intel" as const, icon: Radio, label: "Intel Uplink", short: "INT", desc: "Ops brief · rules" },
] as const;
type LbSectionId = (typeof LB_NAV)[number]["id"];

const PLACEHOLDER_LEADER: LeaderboardEntry = {
  id: "—",
  arenaId: "—",
  rank: 1,
  username: "—",
  wins: 0,
  losses: 0,
  winRate: 0,
  earnings: 0,
  streak: 0,
  change: "same",
  game: "CS2",
};

// ─── Config ───────────────────────────────────────────────────

const podiumConfig = {
  1: { glow: "shadow-[0_0_28px_hsl(43_96%_56%/0.35)]", border: "border-arena-gold/60",       bg: "bg-arena-gold/5",   label: "text-arena-gold",       mt: "mt-0" },
  2: { glow: "shadow-[0_0_16px_hsl(220_9%_70%/0.2)]",  border: "border-muted-foreground/40", bg: "bg-secondary/40",   label: "text-muted-foreground", mt: "mt-5" },
  3: { glow: "shadow-[0_0_16px_hsl(25_95%_53%/0.2)]",  border: "border-arena-orange/40",     bg: "bg-arena-orange/5", label: "text-arena-orange",     mt: "mt-9" },
} as const;

const REASON_LABELS: Record<TicketReason, string> = {
  cheating:         "Cheating / Hacking",
  harassment:       "Harassment / Threats",
  fake_screenshot:  "Fake Screenshot / Result",
  disconnect_abuse: "Disconnect Abuse / Rage-Quit",
  other:            "Other",
};

const gameColor: Record<string, string> = {
  "CS2": "#F97316", "Valorant": "#EF4444", "Fortnite": "#38BDF8",
  "Apex Legends": "#6366F1", "PUBG": "#F59E0B",
};

// ─── Helpers ─────────────────────────────────────────────────

const avatarRing = (wr: number) => {
  if (wr >= 80) return "ring-2 ring-arena-gold/70";
  if (wr >= 70) return "ring-2 ring-primary/60";
  if (wr >= 60) return "ring-2 ring-arena-cyan/50";
  return "ring-1 ring-border";
};

const avatarBg = (username: string) => {
  const colors = ["bg-primary/20", "bg-arena-purple/20", "bg-arena-cyan/20", "bg-arena-orange/20", "bg-arena-gold/20"];
  return colors[username.charCodeAt(0) % colors.length];
};

const rankBorder = (rank: number) => {
  if (rank === 1) return "border-l-[3px] border-l-arena-gold";
  if (rank === 2) return "border-l-[3px] border-l-muted-foreground/60";
  if (rank === 3) return "border-l-[3px] border-l-arena-orange";
  return "border-l-[3px] border-l-transparent";
};

const StreakDots = ({ streak }: { streak: number }) => (
  <span className="flex items-center gap-0.5">
    {streak === 0
      ? <span className="text-[10px] text-muted-foreground/40 font-mono">—</span>
      : Array.from({ length: Math.min(streak, 5) }).map((_, i) => (
          <Flame key={i} className="h-2.5 w-2.5 text-arena-orange" style={{ opacity: 1 - i * 0.12 }} />
        ))
    }
    {streak > 5 && <span className="text-[9px] text-arena-orange font-mono">+{streak - 5}</span>}
  </span>
);

// ─── Player Action Popover ────────────────────────────────────

type PopoverTab = "actions" | "message" | "report";

interface PlayerActionPopoverProps {
  player: LeaderboardEntry;
  children: React.ReactNode;
}

function PlayerActionPopover({ player, children }: PlayerActionPopoverProps) {
  const navigate     = useNavigate();
  const currentUser  = useUserStore((s) => s.user);
  const getRelationship  = useFriendStore((s) => s.getRelationship);
  const sendFriendRequest = useFriendStore((s) => s.sendFriendRequest);
  const friendships  = useFriendStore((s) => s.friendships);
  const declineRequest = useFriendStore((s) => s.declineRequest);
  const blockPlayer       = useFriendStore((s) => s.blockPlayer);
  const ignoredUsers      = useFriendStore((s) => s.ignoredUsers);
  const unignoreForRoster = useFriendStore((s) => s.unignoreForRoster);
  const sendMessage  = useMessageStore((s) => s.sendMessage);
  const submitReport = useReportStore((s) => s.submitReport);
  const addNotif     = useNotificationStore((s) => s.addNotification);

  const [open, setOpen]   = useState(false);
  const [tab, setTab]     = useState<PopoverTab>("actions");
  const [msgText, setMsgText] = useState("");
  const [msgSent, setMsgSent] = useState(false);
  const [reason, setReason]   = useState<TicketReason | "">("");
  const [reportDesc, setReportDesc] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const msgRef = useRef<HTMLTextAreaElement>(null);

  const isSelf = currentUser?.username === player.username;
  const rel    = getRelationship(player.id);
  const tier   = getRankTier(player.rank);

  const playerIgnoreCtx = useMemo(
    () => ({
      canonicalUserId: player.id,
      displayUsername: player.username,
      rosterSlot: player.username,
      profileId: player.id,
    }),
    [player.id, player.username]
  );
  const playerIgnored = useMemo(
    () => ignoredUsers.some((u) => ignoredRefMatchesContext(playerIgnoreCtx, u)),
    [ignoredUsers, playerIgnoreCtx]
  );

  const resetPopover = () => {
    setTab("actions");
    setMsgText(""); setMsgSent(false);
    setReason(""); setReportDesc(""); setReportSubmitting(false); setReportDone(false);
  };

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) setTimeout(resetPopover, 200);
  };

  // ── Friend ──────────────────────────────────────────────────
  const handleAddFriend = async () => {
    if (!currentUser) return;
    const created = await sendFriendRequest({
      myId: currentUser.id, myUsername: currentUser.username,
      myArenaId: currentUser.arenaId, myAvatarInitials: currentUser.avatarInitials,
      myRank: currentUser.rank, myTier: currentUser.tier, myPreferredGame: currentUser.preferredGame,
      targetId: player.id, targetUsername: player.username,
      targetArenaId: player.arenaId, targetAvatarInitials: player.username.slice(0, 2).toUpperCase(),
      targetRank: "—", targetTier: "—", targetPreferredGame: player.game,
    });
    if (!created) return;
    addNotif({ type: "system", title: "Friend Request Sent", message: `Request sent to ${player.username}` });
  };

  const handleCancelRequest = () => {
    const f = friendships.find((fr) => fr.friendId === player.id && fr.status === "pending");
    if (f) void declineRequest(f.id);
  };

  // ── Message ─────────────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!currentUser || !msgText.trim()) return;
    const sent = await sendMessage({ myId: currentUser.id, myUsername: currentUser.username, friendId: player.id, content: msgText.trim() });
    if (!sent) return;
    setMsgSent(true);
    addNotif({ type: "system", title: "Message Sent", message: `Your message was delivered to ${player.username}` });
  };

  const handleBlockFromPopover = () => {
    if (!currentUser) return;
    void (async () => {
      await blockPlayer({
        myId: currentUser.id,
        targetUserId: player.id,
        targetUsername: player.username,
        rosterSlot: player.username,
      });
      setOpen(false);
    })();
  };

  const handleUnignoreFromPopover = () => {
    unignoreForRoster(playerIgnoreCtx);
    addNotif({ type: "system", title: "Unignored", message: `You can interact with ${player.username} again.` });
    setOpen(false);
  };

  // ── Report ──────────────────────────────────────────────────
  const handleReport = async () => {
    if (!currentUser || !reason || reportDesc.trim().length < 10) return;
    setReportSubmitting(true);
    const token = useUserStore.getState().token ?? "";
    const result = await apiSubmitSupportTicket(token, {
      reason: reason as TicketReason,
      description: reportDesc.trim(),
      category: "player_report",
      reported_id: player.id,
    });
    if (result.ok) {
      submitReport({
        reporterId: currentUser.id, reporterName: currentUser.username,
        reportedId: player.id, reportedUsername: player.username,
        reason: reason as TicketReason, description: reportDesc.trim(),
      });
    }
    addNotif({
      type: "system",
      title: result.ok ? "🚩 Report Submitted" : "Report Failed",
      message: result.ok
        ? `Report against ${player.username} sent to moderation.`
        : ("detail" in result ? result.detail : "Could not submit report."),
    });
    setReportSubmitting(false);
    setReportDone(true);
  };

  // ─────────────────────────────────────────────────────────────

  const tierColorHex: Record<string, string> = {
    "text-arena-gold": "#FFD700", "text-slate-300": "#CBD5E1",
    "text-arena-orange": "#F97316", "text-arena-cyan": "#22D3EE",
    "text-arena-purple": "#A855F7", "text-arena-gold/60": "#FFD700",
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent
        className="w-64 p-0 bg-card border-border/60 shadow-2xl overflow-hidden"
        align="start"
        side="right"
        sideOffset={8}
      >
        {/* ── Header ── */}
        <div
          className="relative px-4 pt-4 pb-3 border-b border-border/40"
          style={{
            background: tier
              ? `linear-gradient(135deg, ${tierColorHex[tier.color] ?? "#888"}08 0%, transparent 70%)`
              : undefined,
          }}
        >
          {/* Tier badge top-right */}
          {tier && (
            <div className={`absolute top-3 right-3 flex items-center gap-1 ${tier.color}`}>
              <tier.Icon className={tier.iconSize} />
              <span className="font-display text-[9px] font-bold uppercase tracking-widest opacity-80">{tier.label}</span>
            </div>
          )}

          {/* Avatar + identity */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="relative w-10 h-10 shrink-0">
                <div className={`w-full h-full rounded-xl flex items-center justify-center font-display text-sm font-bold overflow-hidden ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}>
                  {player.avatar && player.avatar !== "initials"
                    ? player.avatar.startsWith("upload:")
                      ? <img src={player.avatar.slice(7)} className={cn("h-full w-full", identityPortraitCropClassName)} alt="" />
                      : (() => {
                        const u = getAvatarImageUrlFromStorage(player.avatar);
                        return u ? <img src={u} className={cn("h-full w-full", identityPortraitCropClassName)} alt="" decoding="async" /> : <span className="text-lg">{player.avatar}</span>;
                      })()
                    : player.username.slice(0, 2)}
                </div>
                {player.equippedBadgeIcon?.startsWith("badge:") && (
                  <div className="absolute -bottom-0.5 -right-0.5 z-[1] h-4 w-4 overflow-hidden rounded-full ring-2 ring-background shadow-sm">
                    {renderForgeShopIcon(player.equippedBadgeIcon, "sm", "pin")}
                  </div>
                )}
              </div>
              {!isSelf && currentUser && (
                playerIgnored ? (
                  <button
                    type="button"
                    title="Unignore player"
                    onClick={handleUnignoreFromPopover}
                    className="h-8 w-8 rounded-lg border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    title="Ignore player"
                    onClick={handleBlockFromPopover}
                    className="h-8 w-8 rounded-lg border border-destructive/25 flex items-center justify-center text-destructive/80 hover:bg-destructive/10 transition-colors"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                )
              )}
            </div>
            <div className="min-w-0">
              <p className="font-display font-bold text-sm leading-tight truncate">{player.username}</p>
              <p className="font-mono text-[10px] text-primary/60 leading-tight">{player.arenaId}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="font-mono text-[10px] text-muted-foreground">{player.winRate}% WR</span>
                <span className="text-muted-foreground/40 text-[10px]">·</span>
                <span className="font-mono text-[10px]" style={{ color: gameColor[player.game] ?? "#888" }}>{player.game}</span>
              </div>
            </div>
          </div>

          {/* Quick stats row */}
          <div className="flex items-center gap-3 mt-2.5 text-center">
            {[
              { label: "Rank", value: `#${player.rank}` },
              { label: "Wins", value: player.wins },
              { label: "Losses", value: player.losses },
            ].map(({ label, value }) => (
              <div key={label} className="flex-1">
                <p className="font-display text-xs font-bold">{value}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3 py-3">

          {/* ── Tab: actions ── */}
          {tab === "actions" && (
            <div className="space-y-1.5">
              {/* View Profile */}
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left hover:bg-secondary/60 transition-colors"
                onClick={() => { navigate(`/players/${player.username}`); setOpen(false); }}
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                View Profile
              </button>

              {!isSelf && (
                <>
                  {/* Message */}
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left hover:bg-primary/10 text-primary transition-colors"
                    onClick={() => { setTab("message"); setTimeout(() => msgRef.current?.focus(), 50); }}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Send Message
                  </button>

                  {/* Friend */}
                  {rel === "accepted" ? (
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground cursor-default">
                      <UserCheck className="h-3.5 w-3.5 text-primary" />
                      <span className="text-primary">Already Friends</span>
                    </div>
                  ) : rel === "pending" ? (
                    <button
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={handleCancelRequest}
                    >
                      <Clock className="h-3.5 w-3.5" />
                      Pending — Cancel Request
                    </button>
                  ) : (
                    <button
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left hover:bg-primary/10 text-primary transition-colors"
                      onClick={() => { void handleAddFriend(); setOpen(false); }}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add Friend
                    </button>
                  )}

                  {playerIgnored ? (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left hover:bg-secondary/60 text-muted-foreground transition-colors"
                      onClick={handleUnignoreFromPopover}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Unignore player
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left hover:bg-destructive/10 text-destructive/80 transition-colors"
                      onClick={handleBlockFromPopover}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Ignore player
                    </button>
                  )}

                  {/* Report */}
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left hover:bg-destructive/10 text-destructive/70 hover:text-destructive transition-colors"
                    onClick={() => setTab("report")}
                  >
                    <Flag className="h-3.5 w-3.5" />
                    Report Player
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Tab: message ── */}
          {tab === "message" && (
            <div className="space-y-2">
              {!msgSent ? (
                <>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-display">
                    Message to {player.username}
                  </p>
                  <Textarea
                    ref={msgRef}
                    placeholder="Type your message…"
                    value={msgText}
                    onChange={(e) => setMsgText(e.target.value)}
                    rows={3}
                    maxLength={500}
                    className="bg-secondary/50 border-border/50 resize-none text-sm text-xs"
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
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 px-1"
                      onClick={() => setTab("actions")}
                    >← Back</button>
                    {rel !== "accepted" && rel !== "pending" && !playerIgnored && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0 border-primary/30 text-primary gap-1"
                        onClick={() => { void handleAddFriend(); setOpen(false); }}
                      >
                        <UserPlus className="h-3 w-3" /> Add Friend
                      </Button>
                    )}
                    {playerIgnored ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0"
                        onClick={handleUnignoreFromPopover}
                      >
                        Unignore
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0 border-destructive/35 text-destructive hover:bg-destructive/10 gap-1"
                        onClick={handleBlockFromPopover}
                      >
                        <Ban className="h-3 w-3" /> Ignore
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="flex-1 min-w-[6rem] h-7 text-xs gap-1.5"
                      disabled={!msgText.trim()}
                      onClick={() => void handleSendMessage()}
                    >
                      <Send className="h-3 w-3" /> Send
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 space-y-2">
                  <CheckCircle2 className="h-8 w-8 text-primary mx-auto" />
                  <p className="font-display text-sm font-semibold">Message Sent!</p>
                  <p className="text-[10px] text-muted-foreground">Check Hub → Messages to see your conversation.</p>
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-1" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: report ── */}
          {tab === "report" && (
            <div className="space-y-2">
              {!reportDone ? (
                <>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-display">
                    Report {player.username}
                  </p>
                  <Select value={reason} onValueChange={(v) => setReason(v as TicketReason)}>
                    <SelectTrigger className="h-7 text-xs bg-secondary/50 border-border/50">
                      <SelectValue placeholder="Select reason…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(REASON_LABELS) as [TicketReason, string][]).map(([k, l]) => (
                        <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    placeholder="Describe what happened… (min 10 chars)"
                    value={reportDesc}
                    onChange={(e) => setReportDesc(e.target.value)}
                    rows={3}
                    className="bg-secondary/50 border-border/50 resize-none text-xs"
                  />
                  <div className="flex gap-1.5">
                    <button className="flex-1 text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors" onClick={() => setTab("actions")}>← Back</button>
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs bg-destructive hover:bg-destructive/90"
                      disabled={!reason || reportDesc.trim().length < 10 || reportSubmitting}
                      onClick={() => void handleReport()}
                    >
                      {reportSubmitting ? "Sending…" : "Submit"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 space-y-2">
                  <CheckCircle2 className="h-8 w-8 text-primary mx-auto" />
                  <p className="font-display text-sm font-semibold">Report Submitted</p>
                  <p className="text-[10px] text-muted-foreground">Our moderation team will review within 24–48h.</p>
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-1" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Section panels (display-only; no API / store side effects) ─

function TierMatrixPanel() {
  return (
    <div className="space-y-4">
      <div className="tactical-hud-arena relative overflow-hidden border border-arena-cyan/22 p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06] tactical-hud-scanlines motion-reduce:opacity-[0.02]" aria-hidden />
        <span className="pointer-events-none absolute right-3 top-2.5 font-hud text-[7px] uppercase tracking-[0.38em] text-arena-cyan/45">
          TIER_MATRIX · V1
        </span>
        <h2 className="relative z-[1] mb-4 flex items-center gap-2 font-hud text-[11px] font-bold uppercase tracking-[0.28em] text-foreground">
          <Crosshair className="h-4 w-4 text-arena-cyan" />
          Rank protocol
        </h2>
        <div className="relative z-[1] grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {RANK_TIERS.map((tier) => {
            const Ic = tier.Icon;
            const band = tier.min === tier.max ? `#${tier.min}` : `#${tier.min}–${tier.max}`;
            return (
              <div
                key={tier.label}
                className="tactical-hud-slot-cut tactical-hud-slot-glow group border border-white/[0.09] bg-gradient-to-br from-black/55 to-black/30 p-3.5 transition-[box-shadow,border-color] hover:border-arena-cyan/35"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className={cn("flex items-center gap-2", tier.color)}>
                    <Ic className={tier.iconSize} />
                    <span className="font-hud text-[10px] font-bold uppercase tracking-[0.2em]">{tier.label}</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/55">{band}</span>
                </div>
                <div className="h-px w-full bg-gradient-to-r from-arena-cyan/25 via-transparent to-primary/15" />
                <p className="mt-2 font-hud text-[8px] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground/50">
                  Ladder slice · icon binds to live rank from GET /leaderboard
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IntelFeedPanel({
  timeRange,
  entryCount,
  activeGameTab,
}: {
  timeRange: "weekly" | "monthly" | "alltime";
  entryCount: number;
  activeGameTab: string;
}) {
  const rangeLabel = timeRange === "alltime" ? "ALL_TIME" : timeRange.toUpperCase();
  const lines = useMemo(
    () => [
      { k: "SRC", t: "Verified match ledger → aggregated wins/losses per player." },
      { k: "WR", t: "Win rate = wins ÷ (wins + losses) for the selected season slice." },
      { k: "Δ", t: "Movement glyph vs previous poll — cosmetic until full history API lands." },
      { k: "STR", t: "Streak flame caps at 5 visible pips; overflow shown as +N." },
      { k: "PRIV", t: "Message / friend / report actions respect ignore + friendship state." },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="tactical-hud-shell tactical-hud-shell--idle relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 tactical-hud-grid opacity-[0.2] motion-reduce:opacity-[0.08]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] tactical-hud-scanlines motion-reduce:opacity-[0.02]" aria-hidden />
        <div className="tactical-hud-bracket tactical-hud-bracket-tl" aria-hidden />
        <div className="tactical-hud-bracket tactical-hud-bracket-tr" aria-hidden />
        <div className="tactical-hud-bracket tactical-hud-bracket-bl" aria-hidden />
        <div className="tactical-hud-bracket tactical-hud-bracket-br" aria-hidden />
        <div className="relative z-[1] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-arena-cyan/15 pb-3">
            <h2 className="flex items-center gap-2 font-hud text-[11px] font-bold uppercase tracking-[0.26em] text-foreground">
              <Cpu className="h-4 w-4 text-arena-cyan" />
              Intel uplink
            </h2>
            <div className="flex flex-wrap gap-2">
              <span className="tactical-hud-chip border border-arena-cyan/30 bg-arena-cyan/10 px-2 py-0.5 font-hud text-[8px] uppercase tracking-[0.2em] text-arena-cyan/90">
                RNG: {rangeLabel}
              </span>
              <span className="tactical-hud-chip border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                ROWS_IN_VIEW: {entryCount}
              </span>
              <span className="tactical-hud-chip border border-primary/35 bg-primary/10 px-2 py-0.5 font-mono text-[9px] text-primary/90">
                CH: {activeGameTab === "all" ? "OMNI" : activeGameTab}
              </span>
            </div>
          </div>
          <ul className="space-y-2.5">
            {lines.map(({ k, t }, i) => (
              <li
                key={k}
                className="tactical-hud-slot-cut flex gap-3 border border-white/[0.06] bg-black/35 px-3 py-2.5"
              >
                <span className="font-mono text-[9px] text-arena-gold/80 w-8 shrink-0 pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <span className="font-hud text-[8px] font-bold uppercase tracking-[0.28em] text-arena-cyan/70">{k}</span>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/90">{t}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

const Leaderboard = () => {
  const [section, setSection] = useState<LbSectionId>("board");
  const [timeRange, setTimeRange] = useState<"weekly" | "monthly" | "alltime">("weekly");
  const [tab, setTab] = useState<GameTab>("all");
  const [entriesByTab, setEntriesByTab] = useState<Partial<Record<GameTab, LeaderboardEntry[]>>>({});
  const [selectedTopPlayer, setSelectedTopPlayer] = useState<LeaderboardEntry>(PLACEHOLDER_LEADER);
  const [expandedRowPlayer, setExpandedRowPlayer] = useState<string | null>(null);

  const loadLeaderboard = useCallback(() => {
    if (tab === "Fortnite" || tab === "Apex Legends") {
      setEntriesByTab((prev) => ({ ...prev, [tab]: [] }));
      return;
    }
    void apiGetLeaderboard({
      game: tab === "all" ? undefined : tab,
      limit: 50,
      range: timeRange,
    }).then((rows) => {
      setEntriesByTab((prev) => ({ ...prev, [tab]: rows ?? [] }));
    });
  }, [tab, timeRange]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    const id = window.setInterval(() => loadLeaderboard(), 60_000);
    return () => window.clearInterval(id);
  }, [loadLeaderboard]);

  const tabFetched = entriesByTab[tab];
  const entries = tabFetched ?? [];

  useEffect(() => {
    if (!entries.length) return;
    setSelectedTopPlayer((prev) =>
      entries.some((e) => e.id === prev.id) ? prev : entries[0],
    );
  }, [entries, tab]);

  const matchesPlayed      = selectedTopPlayer.wins + selectedTopPlayer.losses;
  const avgEarningsPerMatch = matchesPlayed > 0 ? selectedTopPlayer.earnings / matchesPlayed : 0;

  const boardSysRef = useMemo(() => {
    const salt = `${tab}:${timeRange}:${entries.length}`;
    let h = 0;
    for (let i = 0; i < salt.length; i++) h = (Math.imul(31, h) + salt.charCodeAt(i)) >>> 0;
    return `REF_${(h & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
  }, [tab, timeRange, entries.length]);

  return (
    <ArenaPageShell variant="leaderboard" contentClassName="space-y-4">
      {/* Command banner — global HUD chrome (all sections) */}
      <div className="tactical-hud-shell tactical-hud-shell--idle relative mb-2 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] tactical-hud-scanlines motion-reduce:opacity-[0.03]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 tactical-hud-grid opacity-[0.22] motion-reduce:opacity-[0.1]" aria-hidden />
        <div className="tactical-hud-rail-v motion-reduce:opacity-20" aria-hidden />
        <div className="tactical-hud-bracket tactical-hud-bracket-tl" aria-hidden />
        <div className="tactical-hud-bracket tactical-hud-bracket-tr" aria-hidden />
        <span className="pointer-events-none absolute left-10 top-2.5 z-[2] font-hud text-[7px] uppercase tracking-[0.35em] text-arena-cyan/55 sm:text-[8px]">
          SYS_{boardSysRef}
        </span>
        <span className="pointer-events-none absolute right-10 top-2.5 z-[2] font-hud text-[7px] uppercase tracking-[0.28em] text-muted-foreground/40 sm:text-[8px]">
          ARENA_LADDER · SYNC 60S
        </span>
        <div className="relative z-[1] flex flex-col gap-3 px-4 pb-4 pt-8 sm:flex-row sm:items-end sm:justify-between sm:px-5 sm:pb-5 sm:pt-9">
          <div>
            <p className="font-hud text-[8px] uppercase tracking-[0.42em] text-muted-foreground/50">Global standings</p>
            <h1 className="mt-1 flex items-center gap-3 font-display text-2xl font-black uppercase tracking-[0.18em] text-foreground sm:text-3xl">
              <Trophy className="h-7 w-7 shrink-0 text-arena-gold drop-shadow-[0_0_18px_hsl(43_96%_56%/0.35)]" />
              Leaderboard
            </h1>
            <p className="mt-1 max-w-xl font-hud text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
              Tactical roster · podium lock · per-game channels — pick a deck on the left.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tactical-hud-chip border border-orange-400/35 bg-orange-500/[0.08] px-2 py-1 font-hud text-[8px] font-bold uppercase tracking-[0.2em] text-orange-300">
              TOP 50 · LIVE
            </span>
            <span className="tactical-hud-chip border border-arena-cyan/30 bg-arena-cyan/[0.07] px-2 py-1 font-mono text-[9px] text-arena-cyan/85">
              SEC_{section.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Admin-style section nav + panel */}
      <div className="flex min-h-[520px] flex-col gap-4 lg:flex-row lg:gap-0">
        <nav
          aria-label="Leaderboard sections"
          className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-arena-cyan/12 pb-2 lg:w-[172px] lg:flex-col lg:border-b-0 lg:border-r lg:pr-3 lg:pb-0"
        >
          {LB_NAV.map(({ id, icon: Icon, label, short, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                "group flex min-w-[7.5rem] flex-1 items-center gap-2.5 rounded-none border px-3 py-2.5 text-left transition-all lg:min-w-0 lg:flex-none",
                "tactical-hud-slot-cut",
                section === id
                  ? "border-arena-cyan/45 bg-arena-cyan/[0.08] text-foreground shadow-[0_0_20px_-6px_hsl(var(--arena-cyan)/0.35)]"
                  : "border-transparent bg-black/20 text-muted-foreground hover:border-white/10 hover:bg-secondary/30 hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", section === id ? "text-arena-cyan" : "text-muted-foreground group-hover:text-foreground")} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-1">
                  <span className="font-hud text-[10px] font-bold uppercase tracking-[0.16em] lg:text-[11px]">{label}</span>
                  <span className="font-mono text-[8px] text-muted-foreground/50 lg:hidden">{short}</span>
                </span>
                <span className="mt-0.5 hidden font-hud text-[7px] uppercase tracking-[0.2em] text-muted-foreground/45 lg:block">{desc}</span>
              </span>
              {section === id && <ChevronRight className="hidden h-3 w-3 shrink-0 text-arena-cyan/60 lg:block" />}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-4 lg:pl-5">
          {section === "board" && (
            <>
      {/* Time range (board only) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <span className="font-hud text-[8px] uppercase tracking-[0.3em] text-muted-foreground/50 sm:mr-auto">Season slice</span>
        <div className="flex flex-wrap gap-1.5">
          {(["weekly", "monthly", "alltime"] as const).map((range) => (
            <Button
              key={range}
              size="sm"
              variant={timeRange === range ? "default" : "outline"}
              onClick={() => setTimeRange(range)}
              className="h-7 px-3 font-hud text-[9px] uppercase tracking-[0.14em]"
            >
              {range === "alltime" ? "All Time" : range.charAt(0).toUpperCase() + range.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* ── COMPACT PODIUM ── */}
      {entries.length >= 3 && (
      <div className="grid grid-cols-3 gap-2">
        {([entries[1], entries[0], entries[2]] as LeaderboardEntry[]).map((player, idx) => {
          const podiumRank = [2, 1, 3][idx] as 1 | 2 | 3;
          const cfg = podiumConfig[podiumRank];
          const isSelected = selectedTopPlayer.username === player.username;
          const tier = getRankTier(podiumRank);
          return (
            <div
              key={player.username}
              data-testid={`podium-card-${player.username}`}
              onClick={() => setSelectedTopPlayer(player)}
              className={cn(
                "tactical-hud-slot-cut tactical-hud-slot-glow relative cursor-pointer overflow-hidden border transition-all duration-200",
                cfg.border,
                cfg.bg,
                cfg.glow,
                cfg.mt,
                isSelected
                  ? "scale-[1.02] shadow-[0_0_28px_-8px_hsl(var(--primary)/0.45)] ring-1 ring-arena-cyan/40"
                  : "hover:scale-[1.01] hover:shadow-[0_0_22px_-10px_hsl(var(--arena-cyan)/0.2)]",
              )}
            >
              {/* Rank number in background */}
              <span className="absolute bottom-1 right-2 font-display font-black text-5xl text-white/[0.04] select-none leading-none">
                {String(podiumRank).padStart(2, "0")}
              </span>

              <div className="flex flex-col items-center gap-1.5 px-3 py-3">
                {/* Tier icon above avatar */}
                {tier && <tier.Icon className={`${tier.iconSize} ${tier.color}`} />}

                {/* Avatar */}
                <PlayerActionPopover player={player}>
                  <div
                    className="relative w-9 h-9 shrink-0 cursor-pointer hover:scale-110 transition-transform"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className={`w-full h-full rounded-full flex items-center justify-center font-display text-sm font-bold overflow-hidden ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}
                    >
                      {player.avatar && player.avatar !== "initials"
                        ? player.avatar.startsWith("upload:")
                          ? <img src={player.avatar.slice(7)} className={cn("h-full w-full", identityPortraitCropClassName)} alt={player.username} decoding="async" />
                          : (() => {
                            const u = getAvatarImageUrlFromStorage(player.avatar);
                            return u ? <img src={u} className={cn("h-full w-full", identityPortraitCropClassName)} alt="" decoding="async" /> : <span className="text-lg">{player.avatar}</span>;
                          })()
                        : player.username.slice(0, 2)
                      }
                    </div>
                    {player.equippedBadgeIcon?.startsWith("badge:") && (
                      <div className="absolute bottom-0 right-0 z-[1] h-3.5 w-3.5 overflow-hidden rounded-full ring-2 ring-background shadow-sm pointer-events-none">
                        {renderForgeShopIcon(player.equippedBadgeIcon, "sm", "pin")}
                      </div>
                    )}
                  </div>
                </PlayerActionPopover>

                {/* Username — clickable for popover */}
                <PlayerActionPopover player={player}>
                  <button
                    className={`font-display font-bold text-sm leading-tight hover:text-primary transition-colors`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {player.username}
                  </button>
                </PlayerActionPopover>

                {/* Tier label */}
                {tier && (
                  <span className={`font-display text-[9px] font-bold uppercase tracking-widest ${tier.color} opacity-80`}>
                    {tier.label}
                  </span>
                )}

                <p className={`font-display text-base font-black ${cfg.label}`}>${player.earnings.toLocaleString()}</p>

                {/* WR bar */}
                <div className="w-full h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-primary/70 rounded-full" style={{ width: `${player.winRate}%` }} />
                </div>

                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/30 text-primary font-mono">
                    {player.winRate}%
                  </Badge>
                  {player.streak > 0 && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-arena-orange/30 text-arena-orange gap-0.5">
                      <Flame className="h-2.5 w-2.5" />{player.streak}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
      {entries.length > 0 && entries.length < 3 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Not enough ranked players for the podium yet.
        </p>
      )}
      {tabFetched !== undefined && entries.length === 0 && (tab === "Fortnite" || tab === "Apex Legends") && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Coming soon — leaderboard for this game is not live yet.
        </p>
      )}
      {tabFetched !== undefined && entries.length === 0 && tab !== "Fortnite" && tab !== "Apex Legends" && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No leaderboard data yet.
        </p>
      )}

      {/* ── COMPACT QUICK STATS ── */}
      <div className="tactical-hud-arena relative overflow-hidden border border-primary/25 bg-primary/[0.07] px-4 py-3 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12),0_0_32px_-14px_hsl(var(--primary)/0.15)]">
        <div className="pointer-events-none absolute right-2 top-2 font-hud text-[6px] uppercase tracking-[0.35em] text-muted-foreground/35">
          QSTAT_V2
        </div>
        <span className="sr-only">{selectedTopPlayer.username} - Quick Stats (Top 3)</span>
        <div className="relative z-[1] flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Player identity */}
          <div className="flex items-center gap-2 shrink-0">
            <Zap className="h-3.5 w-3.5 text-arena-gold" />
            <span className="font-display text-xs font-bold tracking-widest uppercase text-muted-foreground">
              {selectedTopPlayer.username}
            </span>
            <span className="text-muted-foreground/40 text-xs hidden sm:inline">·</span>
            <span className="text-xs text-muted-foreground hidden sm:inline font-mono">{selectedTopPlayer.game}</span>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
            <span className="text-muted-foreground">Matches <span className="text-foreground font-bold">{matchesPlayed}</span></span>
            <span className="text-muted-foreground">W <span className="text-primary font-bold">{selectedTopPlayer.wins}</span></span>
            <span className="text-muted-foreground">L <span className="text-destructive font-bold">{selectedTopPlayer.losses}</span></span>
            <span className="text-muted-foreground">WR <span className="text-foreground font-bold">{selectedTopPlayer.winRate}%</span></span>
            <span className="text-muted-foreground"><span className="sr-only">Avg $ / Match</span>Avg <span className="text-arena-gold font-bold">${avgEarningsPerMatch.toFixed(2)}</span></span>
          </div>

          {/* Win/Loss visual bar */}
          <div className="sm:ml-auto flex items-center gap-1.5 shrink-0">
            <div className="w-24 h-1.5 rounded-full overflow-hidden bg-destructive/20">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${selectedTopPlayer.winRate}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5">
              <TrendingUp className="h-3 w-3 text-primary" />
              <StreakDots streak={selectedTopPlayer.streak} />
            </span>
          </div>
        </div>
      </div>

      {/* ── TABLE ── */}
      {/* DB-ready: tab change triggers GET /api/leaderboard?game={tab}&range={timeRange} */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as GameTab)} className="w-full">
        {/* DB-ready: tabs driven by games.enabled — Coming Soon games non-selectable until Client supports them */}
        <TabsList className="arena-hud-tabs-list h-auto min-h-8 w-full flex-wrap justify-start gap-0.5 sm:w-auto">
          {(GAME_TABS as readonly string[]).map((tabName) => {
            const isLive = tabName === "all" || tabName === "CS2" || tabName === "Valorant";
            return isLive ? (
              <TabsTrigger key={tabName} value={tabName}
                className="arena-hud-tabs-trigger h-7 px-3 data-[state=active]:text-primary-foreground">
                {tabName === "all" ? "All Games" : tabName}
              </TabsTrigger>
            ) : (
              <div key={tabName}
                className="inline-flex items-center gap-1 h-6 px-3 font-display text-xs text-muted-foreground/40 cursor-not-allowed select-none">
                {tabName}
                <span className="text-[8px] font-bold tracking-wide text-muted-foreground/30">SOON</span>
              </div>
            );
          })}
        </TabsList>

        {(GAME_TABS as readonly string[]).map((tabKey) => {
          const tabEntries = entriesByTab[tabKey as GameTab] ?? [];
          const tabMaxEarnings = tabEntries.length ? Math.max(...tabEntries.map(p => p.earnings)) : 1;

          return (
          <TabsContent key={tabKey} value={tabKey} className="mt-3">
            <Card className="overflow-hidden border-arena-cyan/18 shadow-[0_0_44px_-16px_hsl(var(--arena-cyan)/0.14)]">
              {/* Table header */}
              <div className="grid grid-cols-[3rem_1fr_4.5rem_4.5rem_6rem_6rem_3rem] gap-2 px-4 py-2 text-[10px] text-muted-foreground/60 uppercase tracking-widest font-display border-b border-border/50">
                <span>#</span>
                <span>Player</span>
                <span className="text-right">W</span>
                <span className="text-right">L</span>
                <span className="text-right">WR%</span>
                <span className="text-right">Earned</span>
                <span className="text-center">Δ</span>
              </div>

              <div className="divide-y divide-border/30">
                {tabEntries
                  .map((player) => {
                    const isExpanded = expandedRowPlayer === player.username;
                    const col = gameColor[player.game] ?? "#888";
                    const tier = getRankTier(player.rank);
                    return (
                      <div key={player.id}>
                        {/* ── Row ── */}
                        <div
                          data-testid={`table-row-${player.username}`}
                          className={`relative grid grid-cols-[3rem_1fr_4.5rem_4.5rem_6rem_6rem_3rem] gap-2 px-4 py-2.5 items-center cursor-pointer transition-all duration-150 ${rankBorder(player.rank)} ${
                            isExpanded ? "bg-primary/8" : "hover:bg-secondary/20"
                          }`}
                          onClick={() => setExpandedRowPlayer(isExpanded ? null : player.username)}
                        >
                          {/* WR heatmap fill */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: `linear-gradient(90deg, ${
                                player.rank === 1 ? "rgba(234,179,8,0.06)" :
                                player.rank === 2 ? "rgba(148,163,184,0.04)" :
                                player.rank === 3 ? "rgba(249,115,22,0.05)" :
                                "hsl(var(--primary) / 0.03)"
                              } ${player.winRate}%, transparent ${player.winRate}%)`,
                            }}
                          />

                          {/* Rank */}
                          <div className="relative flex flex-col items-center justify-center gap-0.5">
                            {(() => {
                              if (!tier) return (
                                <span className="font-mono text-xs text-muted-foreground/30">
                                  {String(player.rank).padStart(2, "0")}
                                </span>
                              );
                              const { Icon, color, iconSize } = tier;
                              return (
                                <>
                                  <Icon className={`${iconSize} ${color} shrink-0`} />
                                  {player.rank > 1 && (
                                    <span className={`font-mono text-[9px] leading-none ${color} opacity-50`}>
                                      {String(player.rank).padStart(2, "0")}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>

                          {/* Player — username is clickable for popover; rest of row toggles expand */}
                          <div className="relative flex items-center gap-2.5 min-w-0">
                            <PlayerActionPopover player={player}>
                              <div
                                className="relative w-7 h-7 shrink-0 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all rounded-full"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div
                                  className={`w-full h-full rounded-full flex items-center justify-center text-[11px] font-display font-bold overflow-hidden ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}
                                >
                                  {player.avatar && player.avatar !== "initials"
                                    ? player.avatar.startsWith("upload:")
                                      ? <img src={player.avatar.slice(7)} className={cn("h-full w-full", identityPortraitCropClassName)} alt={player.username} decoding="async" />
                                      : (() => {
                                        const u = getAvatarImageUrlFromStorage(player.avatar);
                                        return u ? <img src={u} className={cn("h-full w-full", identityPortraitCropClassName)} alt="" decoding="async" /> : <span className="text-sm">{player.avatar}</span>;
                                      })()
                                    : player.username.slice(0, 2)
                                  }
                                </div>
                                {player.equippedBadgeIcon?.startsWith("badge:") && (
                                  <div className="absolute bottom-0 right-0 z-[1] h-[11px] w-[11px] overflow-hidden rounded-full ring-2 ring-background shadow-sm pointer-events-none">
                                    {renderForgeShopIcon(player.equippedBadgeIcon, "sm", "pin")}
                                  </div>
                                )}
                              </div>
                            </PlayerActionPopover>
                            <div className="min-w-0">
                              <PlayerActionPopover player={player}>
                                <button
                                  className="font-display text-sm font-semibold truncate leading-tight hover:text-primary transition-colors block text-left w-full"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {player.username}
                                </button>
                              </PlayerActionPopover>
                              <span className="text-[10px] font-mono" style={{ color: col }}>
                                {player.game}
                              </span>
                            </div>
                          </div>

                          {/* W */}
                          <span className="relative text-right text-sm text-primary font-mono font-bold">{player.wins}</span>
                          {/* L */}
                          <span className="relative text-right text-sm text-destructive font-mono">{player.losses}</span>

                          {/* WR% with mini bar */}
                          <div className="relative flex flex-col items-end gap-0.5">
                            <span className="text-sm font-mono font-bold">{player.winRate}%</span>
                            <div className="w-12 h-0.5 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-primary/60 rounded-full" style={{ width: `${player.winRate}%` }} />
                            </div>
                          </div>

                          {/* Earned with relative bar */}
                          <div className="relative flex flex-col items-end gap-0.5">
                            <span className="text-sm font-display font-bold text-arena-gold">${player.earnings.toLocaleString()}</span>
                            <div className="w-12 h-0.5 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-arena-gold/50 rounded-full" style={{ width: `${(player.earnings / tabMaxEarnings) * 100}%` }} />
                            </div>
                          </div>

                          {/* Change */}
                          <div className="relative flex justify-center">
                            {player.change === "up"   && <ChevronUp   className="h-4 w-4 text-primary" />}
                            {player.change === "down" && <ChevronDown className="h-4 w-4 text-destructive" />}
                            {player.change === "same" && <Minus        className="h-4 w-4 text-muted-foreground/40" />}
                          </div>
                        </div>

                        {/* ── Expanded row ── */}
                        {isExpanded && (
                          <div className="px-4 py-3 bg-secondary/10 border-l-[3px] border-l-primary/40">
                            {/* Tier header */}
                            {tier && (
                              <div className={`flex items-center gap-1.5 mb-2.5 ${tier.color}`}>
                                <tier.Icon className="h-3.5 w-3.5" />
                                <span className="font-display text-[10px] font-bold uppercase tracking-widest">{tier.label}</span>
                                <span className="text-muted-foreground/40 text-[10px] font-mono">· Rank #{player.rank}</span>
                              </div>
                            )}
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                              {[
                                { label: "Matches", value: player.wins + player.losses, color: "" },
                                { label: "Wins",    value: player.wins,   color: "text-primary" },
                                { label: "Losses",  value: player.losses, color: "text-destructive" },
                                { label: "Win Rate",value: `${player.winRate}%`, color: "" },
                                { label: "Streak",  value: null, color: "text-arena-orange", streak: player.streak },
                                { label: "Avg $ / Match", value: `$${(player.earnings / Math.max(player.wins + player.losses, 1)).toFixed(2)}`, color: "text-arena-gold" },
                              ].map(({ label, value, color, streak }) => (
                                <div key={label} className="rounded-md border border-border/40 bg-background/40 p-2">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-display">{label}</p>
                                  {streak !== undefined ? (
                                    <div className="mt-0.5"><StreakDots streak={streak} /></div>
                                  ) : (
                                    <p className={`font-display text-sm font-bold mt-0.5 ${color}`}>{value}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </Card>
          </TabsContent>
          );
        })}
      </Tabs>
            </>
          )}
          {section === "tiers" && <TierMatrixPanel />}
          {section === "intel" && (
            <IntelFeedPanel timeRange={timeRange} entryCount={entries.length} activeGameTab={tab} />
          )}
        </div>
      </div>
    </ArenaPageShell>
  );
};

export default Leaderboard;
