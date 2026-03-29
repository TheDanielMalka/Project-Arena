import { useState, useRef } from "react";
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
  Trophy, Flame, Crown, ChevronUp, ChevronDown, Minus, Zap, TrendingUp,
  Star, Gem, Shield, UserPlus, UserCheck, Clock, MessageSquare, Flag,
  ExternalLink, Send, CheckCircle2, Ban,
} from "lucide-react";
import { useUserStore }         from "@/stores/userStore";
import { useFriendStore }       from "@/stores/friendStore";
import { useMessageStore }      from "@/stores/messageStore";
import { useReportStore }       from "@/stores/reportStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { getRankTier, RANK_TIERS } from "@/lib/rankTiers";
import type { TicketReason }    from "@/types";

// ─── Types ────────────────────────────────────────────────────

interface LeaderboardEntry {
  id:       string;   // DB: users.id
  arenaId:  string;   // DB: users.arena_id
  rank:     number;
  username: string;
  wins:     number;
  losses:   number;
  winRate:  number;
  earnings: number;
  streak:   number;
  change:   "up" | "down" | "same";
  game:     string;
  avatar?:  string;
}

// ─── Mock Data ────────────────────────────────────────────────
// DB-ready: GET /api/leaderboard?range={timeRange}&game={game}
// timeRange param is passed through to the server which filters by date window.
// game param filters server-side by game; "all" returns cross-game global ranking.
// Each game leaderboard has independent ranks starting at 1.

const mockLeaderboard: LeaderboardEntry[] = [
  { id: "lb-001", arenaId: "ARENA-SK0001", rank: 1,  username: "ShadowKing",  wins: 142, losses: 28, winRate: 83.5, earnings: 4250, streak: 12, change: "same", game: "CS2"          },
  { id: "lb-002", arenaId: "ARENA-NV0002", rank: 2,  username: "NeonViper",   wins: 128, losses: 35, winRate: 78.5, earnings: 3800, streak: 7,  change: "up",   game: "CS2"          },
  { id: "lb-003", arenaId: "ARENA-PS0003", rank: 3,  username: "PixelStorm",  wins: 115, losses: 40, winRate: 74.2, earnings: 3200, streak: 4,  change: "up",   game: "Valorant"     },
  { id: "U-288",  arenaId: "ARENA-BF0005", rank: 4,  username: "BlazeFury",   wins: 110, losses: 42, winRate: 72.4, earnings: 2900, streak: 2,  change: "down", game: "CS2"          },
  { id: "lb-005", arenaId: "ARENA-AH0005", rank: 5,  username: "AceHunter",   wins: 105, losses: 45, winRate: 70.0, earnings: 2750, streak: 5,  change: "up",   game: "Valorant"     },
  { id: "lb-006", arenaId: "ARENA-GR0006", rank: 6,  username: "GhostRider",  wins: 98,  losses: 50, winRate: 66.2, earnings: 2400, streak: 1,  change: "down", game: "CS2"          },
  { id: "lb-007", arenaId: "ARENA-IW0007", rank: 7,  username: "IronWolf",    wins: 95,  losses: 48, winRate: 66.4, earnings: 2200, streak: 3,  change: "same", game: "Fortnite"     },
  { id: "lb-008", arenaId: "ARENA-CN0008", rank: 8,  username: "CyberNinja",  wins: 90,  losses: 55, winRate: 62.1, earnings: 1900, streak: 0,  change: "down", game: "Apex Legends" },
  { id: "lb-009", arenaId: "ARENA-VE0009", rank: 9,  username: "VoltEdge",    wins: 88,  losses: 52, winRate: 62.9, earnings: 1800, streak: 2,  change: "up",   game: "CS2"          },
  { id: "lb-010", arenaId: "ARENA-TB0010", rank: 10, username: "ThunderBolt", wins: 85,  losses: 58, winRate: 59.4, earnings: 1650, streak: 1,  change: "same", game: "Valorant"     },
];

// Per-game leaderboards — independent rankings per game (rank #1 = best in that game)
// DB-ready: GET /api/leaderboard?game=CS2&range={timeRange}
const GAME_LEADERBOARDS: Record<string, LeaderboardEntry[]> = {
  CS2: [
    { id: "lb-001", arenaId: "ARENA-SK0001", rank: 1, username: "ShadowKing",  wins: 142, losses: 28, winRate: 83.5, earnings: 4250, streak: 12, change: "same", game: "CS2" },
    { id: "lb-002", arenaId: "ARENA-NV0002", rank: 2, username: "NeonViper",   wins: 128, losses: 35, winRate: 78.5, earnings: 3800, streak: 7,  change: "up",   game: "CS2" },
    { id: "U-288",  arenaId: "ARENA-BF0005", rank: 3, username: "BlazeFury",   wins: 110, losses: 42, winRate: 72.4, earnings: 2900, streak: 2,  change: "down", game: "CS2" },
    { id: "lb-006", arenaId: "ARENA-GR0006", rank: 4, username: "GhostRider",  wins: 98,  losses: 50, winRate: 66.2, earnings: 2400, streak: 1,  change: "down", game: "CS2" },
    { id: "lb-009", arenaId: "ARENA-VE0009", rank: 5, username: "VoltEdge",    wins: 88,  losses: 52, winRate: 62.9, earnings: 1800, streak: 2,  change: "up",   game: "CS2" },
    { id: "cs2-006", arenaId: "ARENA-HK0011", rank: 6, username: "HeadClick",  wins: 80,  losses: 55, winRate: 59.3, earnings: 1520, streak: 0,  change: "same", game: "CS2" },
    { id: "cs2-007", arenaId: "ARENA-RM0012", rank: 7, username: "RushMaster", wins: 74,  losses: 58, winRate: 56.1, earnings: 1280, streak: 1,  change: "up",   game: "CS2" },
  ],
  Valorant: [
    { id: "lb-003", arenaId: "ARENA-PS0003", rank: 1, username: "PixelStorm",  wins: 115, losses: 40, winRate: 74.2, earnings: 3200, streak: 4, change: "up",   game: "Valorant" },
    { id: "lb-005", arenaId: "ARENA-AH0005", rank: 2, username: "AceHunter",   wins: 105, losses: 45, winRate: 70.0, earnings: 2750, streak: 5, change: "up",   game: "Valorant" },
    { id: "lb-010", arenaId: "ARENA-TB0010", rank: 3, username: "ThunderBolt", wins: 85,  losses: 58, winRate: 59.4, earnings: 1650, streak: 1, change: "same", game: "Valorant" },
    { id: "val-004", arenaId: "ARENA-JM0013", rank: 4, username: "JettMain",   wins: 78,  losses: 60, winRate: 56.5, earnings: 1380, streak: 0, change: "down", game: "Valorant" },
    { id: "val-005", arenaId: "ARENA-RP0014", rank: 5, username: "ReynaPeak",  wins: 71,  losses: 62, winRate: 53.4, earnings: 1140, streak: 2, change: "up",   game: "Valorant" },
    { id: "val-006", arenaId: "ARENA-SB0015", rank: 6, username: "SageBlock",  wins: 66,  losses: 65, winRate: 50.4, earnings: 980,  streak: 0, change: "same", game: "Valorant" },
  ],
  Fortnite: [
    { id: "lb-007",  arenaId: "ARENA-IW0007", rank: 1, username: "IronWolf",    wins: 95,  losses: 48, winRate: 66.4, earnings: 2200, streak: 3, change: "same", game: "Fortnite" },
    { id: "fn-002",  arenaId: "ARENA-SB0016", rank: 2, username: "StormBreak",  wins: 82,  losses: 54, winRate: 60.3, earnings: 1760, streak: 1, change: "up",   game: "Fortnite" },
    { id: "fn-003",  arenaId: "ARENA-ZZ0017", rank: 3, username: "ZeroZone",    wins: 70,  losses: 58, winRate: 54.7, earnings: 1340, streak: 0, change: "down", game: "Fortnite" },
    { id: "fn-004",  arenaId: "ARENA-GK0018", rank: 4, username: "GlideKing",   wins: 62,  losses: 60, winRate: 50.8, earnings: 1080, streak: 2, change: "up",   game: "Fortnite" },
    { id: "fn-005",  arenaId: "ARENA-LV0019", rank: 5, username: "LootVault",   wins: 55,  losses: 63, winRate: 46.6, earnings: 870,  streak: 0, change: "same", game: "Fortnite" },
  ],
  "Apex Legends": [
    { id: "lb-008",  arenaId: "ARENA-CN0008", rank: 1, username: "CyberNinja",  wins: 90,  losses: 55, winRate: 62.1, earnings: 1900, streak: 0, change: "down", game: "Apex Legends" },
    { id: "apex-002",arenaId: "ARENA-WR0020", rank: 2, username: "WraithX",     wins: 76,  losses: 58, winRate: 56.7, earnings: 1520, streak: 3, change: "up",   game: "Apex Legends" },
    { id: "apex-003",arenaId: "ARENA-BP0021", rank: 3, username: "BangBang",    wins: 68,  losses: 62, winRate: 52.3, earnings: 1240, streak: 1, change: "same", game: "Apex Legends" },
    { id: "apex-004",arenaId: "ARENA-PK0022", rank: 4, username: "PathFinder",  wins: 60,  losses: 65, winRate: 48.0, earnings: 980,  streak: 0, change: "down", game: "Apex Legends" },
    { id: "apex-005",arenaId: "ARENA-CL0023", rank: 5, username: "CausticLab",  wins: 52,  losses: 68, winRate: 43.3, earnings: 740,  streak: 0, change: "same", game: "Apex Legends" },
  ],
};

// All defined game tabs (order matters for display)
const GAME_TABS = ["all", "CS2", "Valorant", "Fortnite", "Apex Legends"] as const;
type GameTab = typeof GAME_TABS[number];

const maxEarnings = Math.max(...mockLeaderboard.map(p => p.earnings));

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
  const blockPlayer    = useFriendStore((s) => s.blockPlayer);
  const isIgnored      = useFriendStore((s) => s.isIgnored);
  const unignoreUser   = useFriendStore((s) => s.unignoreUser);
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
  const handleAddFriend = () => {
    if (!currentUser) return;
    const created = sendFriendRequest({
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
    if (f) declineRequest(f.id);
  };

  // ── Message ─────────────────────────────────────────────────
  const handleSendMessage = () => {
    if (!currentUser || !msgText.trim()) return;
    const sent = sendMessage({ myId: currentUser.id, myUsername: currentUser.username, friendId: player.id, content: msgText.trim() });
    if (!sent) return;
    setMsgSent(true);
    addNotif({ type: "system", title: "Message Sent", message: `Your message was delivered to ${player.username}` });
  };

  const handleBlockFromPopover = () => {
    if (!currentUser) return;
    blockPlayer({ myId: currentUser.id, targetUserId: player.id, targetUsername: player.username });
    setOpen(false);
  };

  const handleUnignoreFromPopover = () => {
    unignoreUser(player.id);
    addNotif({ type: "system", title: "Unignored", message: `You can interact with ${player.username} again.` });
    setOpen(false);
  };

  // ── Report ──────────────────────────────────────────────────
  const handleReport = () => {
    if (!currentUser || !reason || reportDesc.trim().length < 10) return;
    setReportSubmitting(true);
    setTimeout(() => {
      submitReport({
        reporterId: currentUser.id, reporterName: currentUser.username,
        reportedId: player.id, reportedUsername: player.username,
        reason: reason as TicketReason, description: reportDesc.trim(),
      });
      addNotif({ type: "system", title: "🚩 Report Submitted", message: `Report against ${player.username} sent to moderation.` });
      setReportSubmitting(false);
      setReportDone(true);
    }, 700);
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
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-display text-sm font-bold ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}>
                {player.avatar && player.avatar !== "initials"
                  ? <span className="text-lg">{player.avatar}</span>
                  : player.username.slice(0, 2)}
              </div>
              {!isSelf && currentUser && (
                isIgnored(player.id) ? (
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
                      onClick={() => { handleAddFriend(); setOpen(false); }}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add Friend
                    </button>
                  )}

                  {isIgnored(player.id) ? (
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
                        handleSendMessage();
                      }
                    }}
                  />
                  <p className="text-[9px] text-muted-foreground text-right">{msgText.length}/500 · Ctrl+Enter to send</p>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 px-1"
                      onClick={() => setTab("actions")}
                    >← Back</button>
                    {rel !== "accepted" && rel !== "pending" && !isIgnored(player.id) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0 border-primary/30 text-primary gap-1"
                        onClick={() => { handleAddFriend(); setOpen(false); }}
                      >
                        <UserPlus className="h-3 w-3" /> Add Friend
                      </Button>
                    )}
                    {isIgnored(player.id) ? (
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
                      onClick={handleSendMessage}
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
                      onClick={handleReport}
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

// ─── Main Component ───────────────────────────────────────────

const Leaderboard = () => {
  // DB-ready: changing timeRange triggers GET /api/leaderboard?range={timeRange}&game={activeTab}
  const [timeRange, setTimeRange] = useState<"weekly" | "monthly" | "alltime">("weekly");
  const [selectedTopPlayer, setSelectedTopPlayer] = useState<LeaderboardEntry>(mockLeaderboard[0]);
  const [expandedRowPlayer, setExpandedRowPlayer] = useState<string | null>(null);

  const matchesPlayed      = selectedTopPlayer.wins + selectedTopPlayer.losses;
  const avgEarningsPerMatch = matchesPlayed > 0 ? selectedTopPlayer.earnings / matchesPlayed : 0;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
            <Trophy className="h-7 w-7 text-arena-gold" /> Leaderboard
          </h1>
        </div>
        <div className="flex gap-1.5">
          {(["weekly", "monthly", "alltime"] as const).map((range) => (
            <Button key={range} size="sm" variant={timeRange === range ? "default" : "outline"}
              onClick={() => setTimeRange(range)} className="font-display capitalize text-xs h-7 px-3">
              {range === "alltime" ? "All Time" : range.charAt(0).toUpperCase() + range.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* ── COMPACT PODIUM ── */}
      <div className="grid grid-cols-3 gap-2">
        {([mockLeaderboard[1], mockLeaderboard[0], mockLeaderboard[2]] as LeaderboardEntry[]).map((player, idx) => {
          const podiumRank = [2, 1, 3][idx] as 1 | 2 | 3;
          const cfg = podiumConfig[podiumRank];
          const isSelected = selectedTopPlayer.username === player.username;
          const tier = getRankTier(podiumRank);
          return (
            <div
              key={player.username}
              data-testid={`podium-card-${player.username}`}
              onClick={() => setSelectedTopPlayer(player)}
              className={`relative cursor-pointer rounded-xl border ${cfg.border} ${cfg.bg} ${cfg.glow} ${cfg.mt} transition-all duration-200 ${
                isSelected ? "ring-1 ring-primary/40 scale-[1.01]" : "hover:scale-[1.005]"
              } overflow-hidden`}
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
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-display text-sm font-bold overflow-hidden cursor-pointer hover:scale-110 transition-transform ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {player.avatar && player.avatar !== "initials"
                      ? player.avatar.startsWith("upload:")
                        ? <img src={player.avatar.slice(7)} className="w-full h-full object-cover" alt={player.username} />
                        : <span className="text-lg">{player.avatar}</span>
                      : player.username.slice(0, 2)
                    }
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

      {/* ── COMPACT QUICK STATS ── */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <span className="sr-only">{selectedTopPlayer.username} - Quick Stats (Top 3)</span>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
      <Tabs defaultValue="all" className="w-full">
        {/* DB-ready: tabs driven by games.enabled — Coming Soon games non-selectable until Client supports them */}
        <TabsList className="bg-secondary border border-border h-8 flex-wrap gap-0">
          {(GAME_TABS as readonly string[]).map((tab) => {
            const isLive = tab === "all" || tab === "CS2" || tab === "Valorant";
            return isLive ? (
              <TabsTrigger key={tab} value={tab}
                className="font-display text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary h-6 px-3">
                {tab === "all" ? "All Games" : tab}
              </TabsTrigger>
            ) : (
              <div key={tab}
                className="inline-flex items-center gap-1 h-6 px-3 font-display text-xs text-muted-foreground/40 cursor-not-allowed select-none">
                {tab}
                <span className="text-[8px] font-bold tracking-wide text-muted-foreground/30">SOON</span>
              </div>
            );
          })}
        </TabsList>

        {(GAME_TABS as readonly string[]).map((tab) => {
          // All Games uses the global cross-game ranking; per-game tabs use their own independent ranking
          const entries = tab === "all"
            ? mockLeaderboard
            : (GAME_LEADERBOARDS[tab] ?? []);
          const tabMaxEarnings = entries.length ? Math.max(...entries.map(p => p.earnings)) : 1;

          return (
          <TabsContent key={tab} value={tab} className="mt-3">
            <Card className="bg-card border-border overflow-hidden">
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
                {entries
                  .map((player) => {
                    const isExpanded = expandedRowPlayer === player.username;
                    const col = gameColor[player.game] ?? "#888";
                    const tier = getRankTier(player.rank);
                    return (
                      <div key={player.rank}>
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
                                "rgba(var(--primary), 0.03)"
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
                                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-display font-bold shrink-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {player.avatar && player.avatar !== "initials"
                                  ? player.avatar.startsWith("upload:")
                                    ? <img src={player.avatar.slice(7)} className="w-full h-full object-cover" alt={player.username} />
                                    : <span className="text-sm">{player.avatar}</span>
                                  : player.username.slice(0, 2)
                                }
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
    </div>
  );
};

export default Leaderboard;
