import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShieldAlert, Gavel, Users, Ban, CheckCircle2, XCircle, AlertTriangle,
  Activity, DollarSign, Eye, Clock, Search, ArrowUpDown, ArrowUp, ArrowDown,
  Download, Power, Settings, Radio, ChevronRight, Zap, Flag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNotificationStore } from "@/stores/notificationStore";
import { PLATFORM_BETTING_MAX } from "@/stores/walletStore";
import type {
  Dispute, DisputeStatus, DisputeResolution,
  FlaggedUser, AuditLog, AdminActivityEvent, PlatformSettings,
} from "@/types";
import { cn } from "@/lib/utils";
import { useReportStore } from "@/stores/reportStore";
import type { SupportTicket, TicketStatus } from "@/types";

// ─── Seed Data ────────────────────────────────────────────────
// When DB is connected: replace with API calls to /admin/disputes, /admin/users/flagged, /admin/audit-logs

const SEED_DISPUTES: Dispute[] = [
  { id: "D-1051", matchId: "M-2048", playerA: "DUNELZ",  playerB: "ShadowKing", game: "CS2",     stake: 120, reason: "Player B claims disconnect wasn't counted", status: "open",      resolution: "pending",       createdAt: "2026-03-08 14:22", evidence: "Screenshot of disconnect error" },
  { id: "D-1050", matchId: "M-2045", playerA: "DUNELZ",  playerB: "CyberWolf",  game: "Valorant", stake: 75,  reason: "Suspected aim-bot usage by Player A",       status: "reviewing",  resolution: "pending",       createdAt: "2026-03-08 11:05" },
  { id: "D-1048", matchId: "M-2039", playerA: "DUNELZ",  playerB: "IronClad",   game: "CS2",      stake: 200, reason: "Vision engine failed to capture final round", status: "escalated", resolution: "pending",       createdAt: "2026-03-07 22:30", evidence: "Game API logs attached" },
  { id: "D-1045", matchId: "M-2031", playerA: "DUNELZ",  playerB: "DarkViper",  game: "Valorant", stake: 50,  reason: "Player A rage-quit mid-match",              status: "resolved",  resolution: "player_b_wins", createdAt: "2026-03-07 09:15" },
  { id: "D-1042", matchId: "M-2025", playerA: "DUNELZ",  playerB: "NightHawk",  game: "CS2",      stake: 90,  reason: "Both players claim victory",                status: "resolved",  resolution: "refund",        createdAt: "2026-03-06 17:40" },
];

const SEED_FLAGGED: FlaggedUser[] = [
  { id: "U-301", username: "xDragon99",  walletAddress: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A", reason: "92% win rate over 50 matches",             winRate: 92, matchesPlayed: 54,  flaggedAt: "2026-03-08", status: "flagged" },
  { id: "U-288", username: "BlazeFury",  walletAddress: "0x1b8E44a1C9d2F3e4A5b6C7d8E9f0A1B2C3D4E5F6", reason: "Multiple accounts detected (smurf)",        winRate: 78, matchesPlayed: 31,  flaggedAt: "2026-03-07", status: "banned"  },
  { id: "U-275", username: "StormRider", walletAddress: "0x9e2D3f4A5b6C7d8E9f0A1B2C3D4E5F6A7b8C9d0E", reason: "Suspicious betting pattern",                winRate: 65, matchesPlayed: 120, flaggedAt: "2026-03-06", status: "cleared" },
  { id: "U-260", username: "PhantomAce", walletAddress: "0x3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B1c2D", reason: "Hardware fingerprint mismatch",              winRate: 71, matchesPlayed: 43,  flaggedAt: "2026-03-05", status: "flagged" },
];

const SEED_AUDIT: AuditLog[] = [
  { id: "A-1", adminId: "admin-001", adminName: "admin_root", action: "RESOLVE_DISPUTE", target: "D-1045", detail: "Awarded win to Player B (rage-quit confirmed)",     createdAt: "2026-03-07 09:20" },
  { id: "A-2", adminId: "admin-001", adminName: "admin_root", action: "BAN_USER",         target: "U-288",  detail: "Permanent ban — multiple smurf accounts",           createdAt: "2026-03-07 08:00" },
  { id: "A-3", adminId: "admin-001", adminName: "admin_root", action: "REFUND_MATCH",     target: "D-1042", detail: "Full refund issued — inconclusive evidence",         createdAt: "2026-03-06 18:00" },
  { id: "A-4", adminId: "admin-001", adminName: "admin_root", action: "CLEAR_FLAG",       target: "U-275",  detail: "Betting pattern reviewed — within normal range",     createdAt: "2026-03-06 14:30" },
  { id: "A-5", adminId: "admin-001", adminName: "admin_root", action: "FREEZE_PAYOUT",    target: "M-2048", detail: "Payout frozen pending dispute D-1051",               createdAt: "2026-03-08 14:25" },
];

const ACTIVITY_TEMPLATES: Omit<AdminActivityEvent, "id" | "timestamp">[] = [
  { type: "match_start", message: "🎮 M-2055 started: xDragon99 vs CyberWolf (CS2 · $80)" },
  { type: "payout",      message: "💰 Payout $45 → NovaBlade (0x1b8...44a1)" },
  { type: "login",       message: "🔑 StormRider connected wallet 0x9e2...bb07" },
  { type: "match_end",   message: "🏁 M-2054 ended: PhantomAce won vs IronClad (Valorant)" },
  { type: "deposit",     message: "📥 Deposit $200 from DarkViper" },
  { type: "dispute",     message: "🚩 Dispute D-1052 opened for M-2053", highlight: true },
  { type: "match_start", message: "🎮 M-2056 started: BlazeFury vs NightHawk (CS2 · $150)" },
  { type: "payout",      message: "💰 Payout $120 → ShadowKing (0x3c4...d5e8)" },
  { type: "ban",         message: "🛑 Auto-flag: QuickScope (win streak anomaly)", highlight: true },
  { type: "login",       message: "🔑 GhostSniper login attempt — BANNED", highlight: true },
];

// ─── Style helpers ────────────────────────────────────────────

const disputeStatusBadge: Record<DisputeStatus, string> = {
  open:      "bg-arena-orange/15 text-arena-orange border-arena-orange/30",
  reviewing: "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30",
  escalated: "bg-destructive/15 text-destructive border-destructive/30",
  resolved:  "bg-primary/15 text-primary border-primary/30",
};

const userStatusBadge: Record<string, string> = {
  flagged: "bg-arena-orange/15 text-arena-orange border-arena-orange/30",
  banned:  "bg-destructive/15 text-destructive border-destructive/30",
  cleared: "bg-primary/15 text-primary border-primary/30",
};

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: filename,
  });
  a.click();
}

const ROWS_PER_PAGE = 8;

// ─── Nav sections ──────────────────────────────────────────────
const NAV = [
  { id: "disputes", icon: Gavel,       label: "Disputes"   },
  { id: "users",    icon: Users,        label: "Users"      },
  { id: "reports",  icon: Flag,         label: "Reports"    },
  { id: "audit",    icon: Eye,          label: "Audit Log"  },
  { id: "live",     icon: Radio,        label: "Live Feed"  },
  { id: "platform", icon: Settings,     label: "Platform"   },
] as const;
type NavId = typeof NAV[number]["id"];

// ─── Component ────────────────────────────────────────────────

const Admin = () => {
  const { toast } = useToast();
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [section, setSection] = useState<NavId>("disputes");

  // Data
  const [disputes,     setDisputes]     = useState<Dispute[]>(SEED_DISPUTES);
  const [flaggedUsers, setFlaggedUsers] = useState<FlaggedUser[]>(SEED_FLAGGED);
  const [auditLog,     setAuditLog]     = useState<AuditLog[]>(SEED_AUDIT);
  const [activity,     setActivity]     = useState<AdminActivityEvent[]>([]);
  const activityCounter = useRef(0);
  const feedRef         = useRef<HTMLDivElement>(null);

  // Platform settings — DB: platform_settings (single row)
  const [platform, setPlatform] = useState<PlatformSettings>({
    feePercent: 5,
    platformBettingMax: PLATFORM_BETTING_MAX,
    maintenanceMode: false,
    registrationOpen: true,
    autoDisputeEscalation: true,
    killSwitchActive: false,
  });

  // Dispute state
  const [selectedDispute,  setSelectedDispute]  = useState<Dispute | null>(null);
  const [resolutionNote,   setResolutionNote]   = useState("");
  const [resolutionChoice, setResolutionChoice] = useState<DisputeResolution>("pending");
  const [disputeSearch,    setDisputeSearch]    = useState("");
  const [disputeStatus,    setDisputeStatus]    = useState<DisputeStatus | "all">("all");
  const [sortKey,          setSortKey]          = useState<keyof Dispute | null>(null);
  const [sortDir,          setSortDir]          = useState<"asc" | "desc">("asc");
  const [disputePage,      setDisputePage]      = useState(1);

  // User state
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | FlaggedUser["status"]>("all");
  const [banTarget,        setBanTarget]        = useState<FlaggedUser | null>(null);

  // Audit state
  const [auditPage, setAuditPage] = useState(1);

  // Reports
  const tickets             = useReportStore((s) => s.tickets);
  const updateTicketStatus  = useReportStore((s) => s.updateTicketStatus);
  const [reportStatusFilter, setReportStatusFilter] = useState<TicketStatus | "all">("all");

  // Kill switch
  const [killConfirm, setKillConfirm] = useState(false);

  // ── Activity feed ──
  useEffect(() => {
    const seed = ACTIVITY_TEMPLATES.slice(0, 5).map((t, i) => ({
      ...t, id: `evt-${i}`, timestamp: new Date(Date.now() - (5 - i) * 8000).toLocaleTimeString(),
    }));
    setActivity(seed);
    activityCounter.current = 5;

    const iv = setInterval(() => {
      const tpl = ACTIVITY_TEMPLATES[activityCounter.current % ACTIVITY_TEMPLATES.length];
      setActivity((p) => [...p.slice(-50), { ...tpl, id: `evt-${activityCounter.current}`, timestamp: new Date().toLocaleTimeString() }]);
      activityCounter.current++;
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [activity]);

  // ── Audit helper ──
  const pushAudit = (action: string, target: string, detail: string) =>
    setAuditLog((p) => [{
      id: `A-${p.length + 1}`, adminId: "admin-001", adminName: "admin_root",
      action, target, detail, createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    }, ...p]);

  // ── Dispute actions ──
  const handleResolve = () => {
    if (!selectedDispute || resolutionChoice === "pending") return;
    setDisputes((p) => p.map((d) => d.id === selectedDispute.id
      ? { ...d, status: "resolved" as DisputeStatus, resolution: resolutionChoice, resolvedBy: "admin_root", resolvedAt: new Date().toISOString().slice(0, 16).replace("T", " ") }
      : d
    ));
    const act = resolutionChoice === "refund" ? "REFUND_MATCH" : resolutionChoice === "void" ? "VOID_MATCH" : "RESOLVE_DISPUTE";
    pushAudit(act, selectedDispute.id, resolutionNote || `Resolved as ${resolutionChoice.replace("_", " ")}`);
    toast({ title: "Dispute Resolved", description: `${selectedDispute.id} — ${resolutionChoice.replace("_", " ")}` });
    addNotification({ type: "dispute", title: "⚖️ Dispute Resolved", message: `${selectedDispute.id}: ${selectedDispute.playerA} vs ${selectedDispute.playerB} — ${resolutionChoice.replace("_", " ")}` });
    setSelectedDispute(null); setResolutionNote(""); setResolutionChoice("pending");
  };

  // ── User actions ──
  const handleBan = (u: FlaggedUser) => {
    setFlaggedUsers((p) => p.map((x) => x.id === u.id ? { ...x, status: "banned" as const } : x));
    pushAudit("BAN_USER", u.id, `Banned user ${u.username}`);
    toast({ title: "User Banned", description: `${u.username} permanently banned.`, variant: "destructive" });
    addNotification({ type: "system", title: "🛑 User Banned", message: `${u.username} (${u.walletAddress.slice(0, 8)}...) permanently banned.` });
    setBanTarget(null);
  };

  const handleClear = (u: FlaggedUser) => {
    setFlaggedUsers((p) => p.map((x) => x.id === u.id ? { ...x, status: "cleared" as const } : x));
    pushAudit("CLEAR_FLAG", u.id, `Flag cleared for ${u.username} after admin review`);
    toast({ title: "Flag Cleared", description: `${u.username} is no longer flagged.` });
    addNotification({ type: "system", title: "✅ Flag Cleared", message: `${u.username} cleared after admin review.` });
  };

  // ── Kill switch ──
  const handleKillSwitch = () => {
    const next = !platform.killSwitchActive;
    setPlatform((p) => ({ ...p, killSwitchActive: next }));
    setKillConfirm(false);
    pushAudit(next ? "KILL_SWITCH_ON" : "KILL_SWITCH_OFF", "PLATFORM", next ? "Emergency payout freeze activated" : "Payout freeze lifted");
    toast({ title: next ? "🚨 Payouts Frozen" : "✅ Payouts Resumed", description: next ? "Kill switch active." : "Kill switch deactivated.", variant: next ? "destructive" : "default" });
    addNotification({ type: "system", title: next ? "🚨 KILL SWITCH" : "✅ Payouts Resumed", message: next ? "All payouts frozen by admin." : "Kill switch deactivated. Payouts processing." });
  };

  // ── Derived data ──
  const openDisputes  = disputes.filter((d) => d.status !== "resolved").length;
  const bannedCount   = flaggedUsers.filter((u) => u.status === "banned").length;
  const flaggedCount  = flaggedUsers.filter((u) => u.status === "flagged").length;
  const totalStake    = disputes.reduce((s, d) => s + d.stake, 0);

  const toggleSort = (k: keyof Dispute) => {
    setSortKey(k); setSortDir((p) => sortKey === k && p === "asc" ? "desc" : "asc");
  };

  const filteredDisputes = disputes
    .filter((d) => {
      const q = disputeSearch.toLowerCase();
      return (disputeStatus === "all" || d.status === disputeStatus) &&
        (!q || d.id.toLowerCase().includes(q) || d.playerA.toLowerCase().includes(q) || d.playerB.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (!sortKey) return 0;
      return sortDir === "asc"
        ? String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""))
        : String(b[sortKey] ?? "").localeCompare(String(a[sortKey] ?? ""));
    });

  const dpPages   = Math.max(1, Math.ceil(filteredDisputes.length / ROWS_PER_PAGE));
  const pagedDisp = filteredDisputes.slice((disputePage - 1) * ROWS_PER_PAGE, disputePage * ROWS_PER_PAGE);

  const filteredUsers = flaggedUsers.filter((u) => userStatusFilter === "all" || u.status === userStatusFilter);

  const auditPages  = Math.max(1, Math.ceil(auditLog.length / ROWS_PER_PAGE));
  const pagedAudit  = auditLog.slice((auditPage - 1) * ROWS_PER_PAGE, auditPage * ROWS_PER_PAGE);

  // ── Sort icon ──
  const SortIcon = ({ col }: { col: keyof Dispute }) =>
    sortKey !== col ? <ArrowUpDown className="h-3 w-3 ml-1 opacity-30 inline" /> :
    sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1 text-primary inline" /> :
    <ArrowDown className="h-3 w-3 ml-1 text-primary inline" />;

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide leading-tight">Admin Panel</h1>
            <p className="text-[11px] text-muted-foreground">Dispute resolution · User moderation · Platform control</p>
          </div>
          <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px] uppercase tracking-widest ml-1">
            Restricted
          </Badge>
        </div>

        {/* Kill switch */}
        {platform.killSwitchActive ? (
          <Button size="sm" variant="outline" onClick={() => setKillConfirm(true)}
            className="border-primary/40 text-primary animate-pulse text-xs font-display">
            <Power className="mr-1.5 h-3.5 w-3.5" /> Deactivate Freeze
          </Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={() => setKillConfirm(true)}
            className="text-xs font-display">
            <Zap className="mr-1.5 h-3.5 w-3.5" /> Kill Switch
          </Button>
        )}
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Open Disputes",  value: openDisputes,           color: "text-arena-orange", icon: Gavel       },
          { label: "Flagged Users",  value: flaggedCount,           color: "text-arena-gold",   icon: AlertTriangle },
          { label: "Banned",         value: bannedCount,            color: "text-destructive",  icon: Ban         },
          { label: "Total at Stake", value: `$${totalStake.toLocaleString()}`, color: "text-primary", icon: DollarSign },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border/60 bg-secondary/30 px-3 py-2 flex items-center gap-2.5">
            <Icon className={cn("h-4 w-4 shrink-0", color)} />
            <div>
              <p className={cn("font-display text-sm font-bold tabular-nums", color)}>{value}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Body: nav + panel ── */}
      <div className="flex gap-0 min-h-[520px]">

        {/* Left nav */}
        <nav className="w-[52px] md:w-[160px] shrink-0 border-r border-border/60 flex flex-col gap-0.5 pt-1 pr-0">
          {NAV.map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all w-full",
                section === id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}>
              <Icon className={cn("h-4 w-4 shrink-0", section === id && "text-primary")} />
              <span className="hidden md:block font-display text-xs font-medium">{label}</span>
              {section === id && <ChevronRight className="hidden md:block h-3 w-3 ml-auto opacity-40" />}
            </button>
          ))}
        </nav>

        {/* Panel */}
        <div className="flex-1 pl-5 min-w-0">

          {/* ══ DISPUTES ══ */}
          {section === "disputes" && (
            <div className="space-y-3">
              {/* toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[140px] max-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input value={disputeSearch} onChange={(e) => { setDisputeSearch(e.target.value); setDisputePage(1); }}
                    placeholder="Search…" className="pl-8 h-8 bg-secondary/60 border-border text-xs" />
                </div>
                <Select value={disputeStatus} onValueChange={(v) => { setDisputeStatus(v as DisputeStatus | "all"); setDisputePage(1); }}>
                  <SelectTrigger className="h-8 w-28 bg-secondary/60 border-border text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="reviewing">Reviewing</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8 text-xs border-border ml-auto"
                  onClick={() => exportCSV("disputes.csv", ["ID","Match","Player A","Player B","Game","Stake","Status","Resolution","Created"],
                    disputes.map((d) => [d.id, d.matchId, d.playerA, d.playerB, d.game, `$${d.stake}`, d.status, d.resolution, d.createdAt]))}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Export
                </Button>
              </div>

              {/* dispute cards */}
              <div className="space-y-2">
                {pagedDisp.map((d) => {
                  const borderColor = {
                    open: "border-l-arena-orange",
                    reviewing: "border-l-arena-cyan",
                    escalated: "border-l-destructive",
                    resolved: "border-l-primary",
                  }[d.status];
                  return (
                    <div key={d.id} className={cn(
                      "rounded-lg border border-border/60 bg-secondary/20 border-l-2 px-4 py-3 hover:bg-secondary/40 transition-colors",
                      borderColor
                    )}>
                      {/* top row */}
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">{d.id}</span>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{d.matchId}</span>
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-border/50 text-muted-foreground">{d.game}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-arena-gold">${d.stake}</span>
                          <Badge className={cn("text-[10px] border px-1.5 py-0", disputeStatusBadge[d.status])}>{d.status}</Badge>
                          {d.status !== "resolved" && (
                            <Button size="sm" variant="outline" className="h-6 px-2.5 text-[10px] font-display border-primary/40 text-primary hover:bg-primary/10"
                              onClick={() => { setSelectedDispute(d); setResolutionChoice("pending"); setResolutionNote(""); }}>
                              <Gavel className="mr-1 h-3 w-3" /> Resolve
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* players row */}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="font-display text-sm font-bold">{d.playerA}</span>
                        <span className="text-[10px] text-muted-foreground font-display uppercase tracking-widest">vs</span>
                        <span className="font-display text-sm font-bold">{d.playerB}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{d.createdAt}</span>
                      </div>

                      {/* reason */}
                      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{d.reason}</p>

                      {/* evidence */}
                      {d.evidence && (
                        <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-arena-cyan bg-arena-cyan/5 border border-arena-cyan/20 rounded px-2 py-0.5">
                          📎 {d.evidence}
                        </div>
                      )}

                      {/* resolution badge */}
                      {d.status === "resolved" && d.resolution !== "pending" && (
                        <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-primary bg-primary/5 border border-primary/20 rounded px-2 py-0.5">
                          <CheckCircle2 className="h-3 w-3" /> {d.resolution.replace(/_/g, " ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {dpPages > 1 && (
                <div className="flex justify-end gap-1">
                  {Array.from({ length: dpPages }, (_, i) => (
                    <button key={i} onClick={() => setDisputePage(i + 1)}
                      className={cn("w-6 h-6 rounded text-[10px] font-mono transition-colors", disputePage === i + 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ USERS ══ */}
          {section === "users" && (
            <div className="space-y-3">
              {/* filter pills */}
              <div className="flex gap-1.5">
                {(["all","flagged","banned","cleared"] as const).map((s) => (
                  <button key={s} onClick={() => setUserStatusFilter(s)}
                    className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-display uppercase tracking-wider border transition-colors",
                      userStatusFilter === s
                        ? s === "banned"  ? "bg-destructive/20 border-destructive/40 text-destructive"
                        : s === "flagged" ? "bg-arena-orange/20 border-arena-orange/40 text-arena-orange"
                        : s === "cleared" ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-secondary border-border text-foreground"
                        : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
                    )}>
                    {s}
                  </button>
                ))}
              </div>

              {/* user cards */}
              <div className="space-y-2">
                {filteredUsers.map((u) => {
                  const risk = u.winRate >= 85 ? { label: "CRITICAL", color: "text-destructive bg-destructive/10 border-destructive/30" }
                    : u.winRate >= 75 ? { label: "HIGH",     color: "text-arena-orange bg-arena-orange/10 border-arena-orange/30" }
                    : u.winRate >= 60 ? { label: "MEDIUM",   color: "text-arena-gold bg-arena-gold/10 border-arena-gold/30" }
                    :                  { label: "LOW",       color: "text-primary bg-primary/10 border-primary/30" };

                  const avatarBg = u.status === "banned" ? "bg-destructive/20 text-destructive"
                    : u.status === "flagged" ? "bg-arena-orange/20 text-arena-orange"
                    : "bg-primary/20 text-primary";

                  return (
                    <div key={u.id} className={cn(
                      "rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 flex items-center gap-4 hover:bg-secondary/40 transition-colors",
                      u.status === "banned" && "border-destructive/20 bg-destructive/5"
                    )}>
                      {/* avatar */}
                      <div className={cn("w-9 h-9 rounded-full flex items-center justify-center font-display text-sm font-bold shrink-0", avatarBg)}>
                        {u.username.slice(0, 2).toUpperCase()}
                      </div>

                      {/* info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-sm font-bold">{u.username}</span>
                          <Badge className={cn("text-[9px] border px-1.5 py-0", userStatusBadge[u.status])}>{u.status}</Badge>
                          <Badge variant="outline" className={cn("text-[9px] border px-1.5 py-0 ml-auto", risk.color)}>{risk.label}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate" title={u.reason}>{u.reason}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          {/* win rate bar */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground">Win rate</span>
                            <div className="w-20 h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div className={cn("h-full rounded-full transition-all",
                                u.winRate >= 80 ? "bg-destructive" : u.winRate >= 65 ? "bg-arena-orange" : "bg-primary"
                              )} style={{ width: `${u.winRate}%` }} />
                            </div>
                            <span className={cn("text-[10px] font-mono font-bold",
                              u.winRate >= 80 ? "text-destructive" : u.winRate >= 65 ? "text-arena-orange" : "text-primary"
                            )}>{u.winRate}%</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{u.matchesPlayed} matches</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{u.walletAddress.slice(0, 6)}…{u.walletAddress.slice(-4)}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{u.flaggedAt}</span>
                        </div>
                      </div>

                      {/* actions */}
                      <div className="flex gap-1 shrink-0">
                        {u.status !== "banned" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[10px] text-destructive hover:bg-destructive/10 font-display border border-destructive/20"
                            onClick={() => setBanTarget(u)}>
                            <Ban className="mr-1 h-3 w-3" /> Ban
                          </Button>
                        )}
                        {u.status === "flagged" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[10px] text-primary hover:bg-primary/10 font-display border border-primary/20"
                            onClick={() => handleClear(u)}>
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══ REPORTS ══ */}
          {section === "reports" && (
            <div className="space-y-3">
              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground flex-1">
                  Player reports submitted by users — review and take action
                </p>
                <select
                  value={reportStatusFilter}
                  onChange={(e) => setReportStatusFilter(e.target.value as TicketStatus | "all")}
                  className="h-8 px-2 text-xs bg-secondary/60 border border-border rounded-md text-foreground"
                >
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="investigating">Investigating</option>
                  <option value="dismissed">Dismissed</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>

              {/* Ticket list */}
              {(() => {
                const filtered = tickets.filter(
                  (t) => reportStatusFilter === "all" || t.status === reportStatusFilter
                );
                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 text-muted-foreground">
                      <Flag className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No reports found</p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {filtered.map((t: SupportTicket) => {
                      const statusStyle: Record<TicketStatus, string> = {
                        open:          "border-l-arena-orange",
                        investigating: "border-l-arena-cyan",
                        dismissed:     "border-l-muted-foreground",
                        resolved:      "border-l-primary",
                      };
                      const statusBadge: Record<TicketStatus, string> = {
                        open:          "bg-arena-orange/15 text-arena-orange border-arena-orange/30",
                        investigating: "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30",
                        dismissed:     "bg-muted/30 text-muted-foreground border-border/50",
                        resolved:      "bg-primary/15 text-primary border-primary/30",
                      };
                      const reasonLabel: Record<string, string> = {
                        cheating:         "Cheating",
                        harassment:       "Harassment",
                        fake_screenshot:  "Fake Screenshot",
                        disconnect_abuse: "Disconnect Abuse",
                        other:            "Other",
                      };
                      return (
                        <div
                          key={t.id}
                          className={cn(
                            "rounded-lg border border-border/60 bg-secondary/20 border-l-2 px-4 py-3",
                            statusStyle[t.status]
                          )}
                        >
                          {/* Top row */}
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-muted-foreground">{t.id}</span>
                              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 border", statusBadge[t.status])}>
                                {t.status}
                              </Badge>
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border/40 text-muted-foreground">
                                {reasonLabel[t.reason] ?? t.reason}
                              </Badge>
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {new Date(t.createdAt).toLocaleDateString()}
                            </span>
                          </div>

                          {/* Players */}
                          <div className="flex items-center gap-1.5 text-xs mb-2">
                            <span className="text-muted-foreground">by</span>
                            <span className="font-medium">{t.reporterName}</span>
                            <span className="text-muted-foreground">→ reported</span>
                            <span className="font-display font-semibold text-destructive">{t.reportedUsername}</span>
                          </div>

                          {/* Description */}
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{t.description}</p>

                          {/* Admin note */}
                          {t.adminNote && (
                            <p className="text-[10px] text-arena-cyan bg-arena-cyan/10 border border-arena-cyan/20 rounded-md px-2 py-1 mb-3">
                              Admin: {t.adminNote}
                            </p>
                          )}

                          {/* Actions */}
                          {t.status !== "dismissed" && t.status !== "resolved" && (
                            <div className="flex gap-2 flex-wrap">
                              {t.status === "open" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs border-arena-cyan/40 text-arena-cyan hover:bg-arena-cyan/10"
                                  onClick={() => {
                                    updateTicketStatus(t.id, "investigating");
                                    pushAudit("INVESTIGATE_REPORT", t.id, `Started investigation on ${t.reportedUsername}`);
                                    toast({ title: "Under Investigation", description: `Report ${t.id} is now being reviewed.` });
                                  }}
                                >
                                  Investigate
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
                                onClick={() => {
                                  updateTicketStatus(t.id, "resolved", "Reviewed and resolved by admin");
                                  pushAudit("RESOLVE_REPORT", t.id, `Report on ${t.reportedUsername} resolved`);
                                  toast({ title: "Report Resolved", description: `${t.id} marked as resolved.` });
                                }}
                              >
                                Resolve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-border/50 text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  updateTicketStatus(t.id, "dismissed", "No violation found");
                                  pushAudit("DISMISS_REPORT", t.id, `Report on ${t.reportedUsername} dismissed`);
                                  toast({ title: "Report Dismissed", description: `${t.id} dismissed.` });
                                }}
                              >
                                Dismiss
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ══ AUDIT ══ */}
          {section === "audit" && (() => {
            const auditActionStyle: Record<string, string> = {
              BAN_USER:               "bg-destructive/15 text-destructive border-destructive/30",
              RESOLVE_DISPUTE:        "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30",
              REFUND_MATCH:           "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30",
              VOID_MATCH:             "bg-muted/40 text-muted-foreground border-border",
              CLEAR_FLAG:             "bg-primary/15 text-primary border-primary/30",
              FREEZE_PAYOUT:          "bg-arena-orange/15 text-arena-orange border-arena-orange/30",
              UPDATE_PLATFORM_SETTINGS: "bg-arena-purple/15 text-arena-purple border-arena-purple/30",
              KILL_SWITCH_ON:         "bg-destructive/20 text-destructive border-destructive/40",
              KILL_SWITCH_OFF:        "bg-primary/15 text-primary border-primary/30",
            };
            return (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                    onClick={() => exportCSV("audit_log.csv", ["Timestamp","Action","Target","Detail","Admin"],
                      auditLog.map((l) => [l.createdAt, l.action, l.target, l.detail, l.adminName]))}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export
                  </Button>
                </div>

                {/* timeline */}
                <ScrollArea className="h-[400px] pr-2">
                  <div className="relative pl-5">
                    {/* vertical line */}
                    <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border/60" />

                    <div className="space-y-3">
                      {pagedAudit.map((l) => {
                        const style = auditActionStyle[l.action] ?? "bg-secondary text-muted-foreground border-border";
                        return (
                          <div key={l.id} className="relative flex gap-3 group">
                            {/* dot */}
                            <div className={cn("absolute -left-[13px] top-2 w-2 h-2 rounded-full border-2 border-background shrink-0",
                              l.action.includes("BAN") || l.action.includes("KILL_SWITCH_ON") ? "bg-destructive"
                              : l.action.includes("CLEAR") || l.action.includes("RESOLVE") || l.action.includes("KILL_SWITCH_OFF") ? "bg-primary"
                              : l.action.includes("FREEZE") ? "bg-arena-orange"
                              : "bg-muted-foreground"
                            )} />

                            <div className="flex-1 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2.5 hover:bg-secondary/40 transition-colors group-hover:border-border/60">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className={cn("text-[9px] border px-1.5 py-0 font-mono", style)}>
                                  {l.action.replace(/_/g, " ")}
                                </Badge>
                                <span className="font-mono text-[10px] text-muted-foreground">{l.target}</span>
                                <span className="text-[10px] text-muted-foreground ml-auto">{l.createdAt}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{l.detail}</p>
                              <p className="text-[10px] text-arena-cyan font-mono mt-1">{l.adminName}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </ScrollArea>

                {auditPages > 1 && (
                  <div className="flex justify-end gap-1">
                    {Array.from({ length: auditPages }, (_, i) => (
                      <button key={i} onClick={() => setAuditPage(i + 1)}
                        className={cn("w-6 h-6 rounded text-[10px] font-mono transition-colors", auditPage === i + 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ══ LIVE FEED ══ */}
          {section === "live" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span className="text-xs text-muted-foreground font-display uppercase tracking-wider">Live — updates every 4s</span>
              </div>
              <ScrollArea className="h-[440px] rounded-lg border border-border/60 bg-secondary/10">
                <div ref={feedRef} className="p-3 space-y-1.5">
                  {activity.map((e) => (
                    <div key={e.id} className={cn(
                      "flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-all",
                      e.highlight ? "bg-destructive/10 border border-destructive/20" : "hover:bg-secondary/40"
                    )}>
                      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap pt-0.5">{e.timestamp}</span>
                      <span className={e.highlight ? "text-destructive" : "text-foreground"}>{e.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* ══ PLATFORM SETTINGS ══ */}
          {section === "platform" && (
            <div className="space-y-1 max-w-xl">
              {[
                {
                  label: "Platform Fee",
                  desc: `ArenaEscrow FEE_PERCENT — currently ${platform.feePercent}%`,
                  control: (
                    <div className="flex items-center gap-3 w-48">
                      <Slider min={1} max={25} step={0.5} value={[platform.feePercent]}
                        onValueChange={([v]) => setPlatform((p) => ({ ...p, feePercent: v }))} className="flex-1" />
                      <span className="text-xs font-mono text-primary w-10 text-right">{platform.feePercent}%</span>
                    </div>
                  ),
                },
                {
                  label: "Daily Betting Max",
                  desc: `Platform-wide hard cap — currently $${platform.platformBettingMax}`,
                  control: (
                    <div className="flex items-center gap-3 w-48">
                      <Slider min={50} max={2000} step={50} value={[platform.platformBettingMax]}
                        onValueChange={([v]) => setPlatform((p) => ({ ...p, platformBettingMax: v }))} className="flex-1" />
                      <span className="text-xs font-mono text-arena-gold w-14 text-right">${platform.platformBettingMax}</span>
                    </div>
                  ),
                },
                {
                  label: "Maintenance Mode",
                  desc: "Blocks all new matches and deposits",
                  control: <Switch checked={platform.maintenanceMode} onCheckedChange={(v) => setPlatform((p) => ({ ...p, maintenanceMode: v }))} />,
                },
                {
                  label: "New Registrations",
                  desc: "Allow new users to sign up",
                  control: <Switch checked={platform.registrationOpen} onCheckedChange={(v) => setPlatform((p) => ({ ...p, registrationOpen: v }))} />,
                },
                {
                  label: "Auto-Escalate Disputes",
                  desc: "Escalate unresolved disputes after 24h",
                  control: <Switch checked={platform.autoDisputeEscalation} onCheckedChange={(v) => setPlatform((p) => ({ ...p, autoDisputeEscalation: v }))} />,
                },
              ].map(({ label, desc, control }, i, arr) => (
                <div key={label} className={cn("flex items-center justify-between py-3 gap-4", i < arr.length - 1 && "border-b border-border/50")}>
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  <div className="shrink-0">{control}</div>
                </div>
              ))}

              <div className="flex justify-end pt-3">
                <Button size="sm" className="font-display text-xs glow-green"
                  onClick={() => { pushAudit("UPDATE_PLATFORM_SETTINGS", "PLATFORM", `Fee=${platform.feePercent}% | BettingMax=$${platform.platformBettingMax} | Maintenance=${platform.maintenanceMode}`); toast({ title: "Settings Saved", description: "Platform configuration updated." }); }}>
                  Save Platform Settings
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Resolve Dispute Dialog ── */}
      <Dialog open={!!selectedDispute} onOpenChange={(o) => !o && setSelectedDispute(null)}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-sm">Resolve {selectedDispute?.id}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {selectedDispute?.playerA} vs {selectedDispute?.playerB} · ${selectedDispute?.stake} · {selectedDispute?.game}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground italic">"{selectedDispute?.reason}"</p>
            {selectedDispute?.evidence && (
              <div className="text-xs bg-secondary/50 rounded px-2.5 py-1.5 text-muted-foreground">
                📎 Evidence: {selectedDispute.evidence}
              </div>
            )}
            <Select value={resolutionChoice} onValueChange={(v) => setResolutionChoice(v as DisputeResolution)}>
              <SelectTrigger className="h-8 bg-secondary/60 border-border text-xs"><SelectValue placeholder="Select resolution…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="player_a_wins">Player A Wins ({selectedDispute?.playerA})</SelectItem>
                <SelectItem value="player_b_wins">Player B Wins ({selectedDispute?.playerB})</SelectItem>
                <SelectItem value="refund">Full Refund (Both Players)</SelectItem>
                <SelectItem value="void">Void Match (No Payout)</SelectItem>
              </SelectContent>
            </Select>
            <Textarea value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Admin notes (optional)…" className="bg-secondary/60 border-border text-xs min-h-[60px] resize-none" />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedDispute(null)}>Cancel</Button>
            <Button size="sm" className="font-display text-xs" disabled={resolutionChoice === "pending"} onClick={handleResolve}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Confirm Resolution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Ban Confirm Dialog ── */}
      <AlertDialog open={!!banTarget} onOpenChange={(o) => !o && setBanTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-sm">Ban {banTarget?.username}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This will permanently ban <span className="font-mono font-bold">{banTarget?.walletAddress.slice(0, 12)}...</span>
              {" "}from the platform. Action is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction className="text-xs h-8 bg-destructive hover:bg-destructive/90 font-display"
              onClick={() => banTarget && handleBan(banTarget)}>
              <Ban className="mr-1.5 h-3.5 w-3.5" /> Confirm Ban
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Kill Switch Confirm ── */}
      <AlertDialog open={killConfirm} onOpenChange={setKillConfirm}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-sm text-destructive flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {platform.killSwitchActive ? "Deactivate Kill Switch?" : "Activate Kill Switch?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {platform.killSwitchActive
                ? "This will resume all payouts. Funds will begin processing from the smart contract immediately."
                : "This will freeze ALL payouts across the platform. No funds will be released from escrow until deactivated."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn("text-xs h-8 font-display", platform.killSwitchActive ? "bg-primary hover:bg-primary/90" : "bg-destructive hover:bg-destructive/90")}
              onClick={handleKillSwitch}>
              {platform.killSwitchActive ? "Deactivate" : "Activate Kill Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default Admin;
