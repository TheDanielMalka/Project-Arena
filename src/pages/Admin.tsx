import { Fragment, useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShieldAlert,
  Gavel,
  Users,
  Ban,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  DollarSign,
  Eye,
  Clock,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Power,
  Settings,
  Radio,
  ChevronDown,
  ChevronRight,
  Zap,
  UserCheck,
  Swords,
  CreditCard,
  Shield,
  Wrench,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useNotificationStore } from "@/stores/notificationStore";

// ─── Types ───────────────────────────────────────────────────

type DisputeStatus = "open" | "reviewing" | "resolved" | "escalated";
type DisputeResolution = "pending" | "player_a_wins" | "player_b_wins" | "refund" | "void";

interface Dispute {
  id: string;
  matchId: string;
  playerA: string;
  playerB: string;
  game: string;
  stake: string;
  reason: string;
  status: DisputeStatus;
  resolution: DisputeResolution;
  createdAt: string;
  evidence?: string;
}

interface FlaggedUser {
  id: string;
  username: string;
  walletShort: string;
  reason: string;
  winRate: number;
  matchesPlayed: number;
  flaggedAt: string;
  status: "flagged" | "banned" | "cleared";
}

interface AuditLog {
  id: string;
  admin: string;
  action: string;
  target: string;
  detail: string;
  timestamp: string;
}

interface ActivityEvent {
  id: string;
  type: "match_start" | "match_end" | "payout" | "deposit" | "login" | "dispute" | "ban";
  message: string;
  timestamp: string;
  highlight?: boolean;
}

// ─── Mock Data ───────────────────────────────────────────────

const MOCK_DISPUTES: Dispute[] = [
  { id: "D-1051", matchId: "M-2048", playerA: "xDragon99", playerB: "ShadowKing", game: "CS2", stake: "$120", reason: "Player B claims disconnect wasn't counted", status: "open", resolution: "pending", createdAt: "2026-03-08 14:22", evidence: "Screenshot of disconnect error" },
  { id: "D-1050", matchId: "M-2045", playerA: "NovaBlade", playerB: "CyberWolf", game: "Valorant", stake: "$75", reason: "Suspected aim-bot usage by Player A", status: "reviewing", resolution: "pending", createdAt: "2026-03-08 11:05" },
  { id: "D-1048", matchId: "M-2039", playerA: "PhantomAce", playerB: "IronClad", game: "CS2", stake: "$200", reason: "Vision engine failed to capture final round", status: "escalated", resolution: "pending", createdAt: "2026-03-07 22:30", evidence: "Game API logs attached" },
  { id: "D-1045", matchId: "M-2031", playerA: "StormRider", playerB: "DarkViper", game: "Valorant", stake: "$50", reason: "Player A rage-quit mid-match", status: "resolved", resolution: "player_b_wins", createdAt: "2026-03-07 09:15" },
  { id: "D-1042", matchId: "M-2025", playerA: "BlazeFury", playerB: "NightHawk", game: "CS2", stake: "$90", reason: "Both players claim victory", status: "resolved", resolution: "refund", createdAt: "2026-03-06 17:40" },
];

const MOCK_FLAGGED_USERS: FlaggedUser[] = [
  { id: "U-301", username: "xDragon99", walletShort: "0x7a3...f9c2", reason: "92% win rate over 50 matches", winRate: 92, matchesPlayed: 54, flaggedAt: "2026-03-08", status: "flagged" },
  { id: "U-288", username: "GhostSniper", walletShort: "0x1b8...44a1", reason: "Multiple accounts detected (smurf)", winRate: 78, matchesPlayed: 31, flaggedAt: "2026-03-07", status: "banned" },
  { id: "U-275", username: "QuickScope", walletShort: "0x9e2...bb07", reason: "Suspicious betting pattern", winRate: 65, matchesPlayed: 120, flaggedAt: "2026-03-06", status: "cleared" },
  { id: "U-260", username: "SilentKill", walletShort: "0x3c4...d5e8", reason: "Hardware fingerprint mismatch", winRate: 71, matchesPlayed: 43, flaggedAt: "2026-03-05", status: "flagged" },
];

const MOCK_AUDIT_LOG: AuditLog[] = [
  { id: "A-1", admin: "admin_root", action: "RESOLVE_DISPUTE", target: "D-1045", detail: "Awarded win to Player B (rage-quit confirmed)", timestamp: "2026-03-07 09:20" },
  { id: "A-2", admin: "admin_root", action: "BAN_USER", target: "U-288", detail: "Permanent ban — multiple smurf accounts", timestamp: "2026-03-07 08:00" },
  { id: "A-3", admin: "admin_root", action: "REFUND_MATCH", target: "D-1042", detail: "Full refund issued — inconclusive evidence", timestamp: "2026-03-06 18:00" },
  { id: "A-4", admin: "admin_root", action: "CLEAR_FLAG", target: "U-275", detail: "Betting pattern reviewed — within normal range", timestamp: "2026-03-06 14:30" },
  { id: "A-5", admin: "admin_root", action: "FREEZE_PAYOUT", target: "M-2048", detail: "Payout frozen pending dispute D-1051", timestamp: "2026-03-08 14:25" },
];

const ACTIVITY_TEMPLATES: Omit<ActivityEvent, "id" | "timestamp">[] = [
  { type: "match_start", message: "🎮 Match M-2055 started: xDragon99 vs CyberWolf (CS2, $80)" },
  { type: "payout", message: "💰 Payout of $45 sent to NovaBlade (0x1b8...44a1)" },
  { type: "login", message: "🔑 User StormRider connected wallet 0x9e2...bb07" },
  { type: "match_end", message: "🏁 Match M-2054 ended: PhantomAce won vs IronClad (Valorant)" },
  { type: "deposit", message: "📥 Deposit of $200 received from DarkViper" },
  { type: "dispute", message: "🚩 Dispute D-1052 opened for Match M-2053", highlight: true },
  { type: "match_start", message: "🎮 Match M-2056 started: BlazeFury vs NightHawk (CS2, $150)" },
  { type: "payout", message: "💰 Payout of $120 sent to ShadowKing (0x3c4...d5e8)" },
  { type: "ban", message: "🛑 Auto-flag triggered for user QuickScope (win streak anomaly)", highlight: true },
  { type: "login", message: "🔑 User GhostSniper attempted login (BANNED — access denied)", highlight: true },
  { type: "match_end", message: "🏁 Match M-2055 ended: xDragon99 won vs CyberWolf (CS2)" },
  { type: "deposit", message: "📥 Deposit of $50 received from NovaBlade" },
];

// ─── Helpers ─────────────────────────────────────────────────

const statusColor: Record<DisputeStatus, string> = {
  open: "bg-arena-orange/20 text-arena-orange border-arena-orange/30",
  reviewing: "bg-arena-cyan/20 text-arena-cyan border-arena-cyan/30",
  escalated: "bg-destructive/20 text-destructive border-destructive/30",
  resolved: "bg-primary/20 text-primary border-primary/30",
};

const userStatusColor: Record<string, string> = {
  flagged: "bg-arena-orange/20 text-arena-orange border-arena-orange/30",
  banned: "bg-destructive/20 text-destructive border-destructive/30",
  cleared: "bg-primary/20 text-primary border-primary/30",
};

function exportToCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ITEMS_PER_PAGE = 10;

// ─── Component ───────────────────────────────────────────────

const Admin = () => {
  const { toast } = useToast();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [disputes, setDisputes] = useState(MOCK_DISPUTES);
  const [flaggedUsers, setFlaggedUsers] = useState(MOCK_FLAGGED_USERS);
  const [auditLog, setAuditLog] = useState(MOCK_AUDIT_LOG);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionChoice, setResolutionChoice] = useState<DisputeResolution>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof Dispute | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Filters
  const [statusFilter, setStatusFilter] = useState<DisputeStatus | "all">("all");
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | "flagged" | "banned" | "cleared">("all");

  // Kill-Switch
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);

  // Ban confirmation
  const [banTarget, setBanTarget] = useState<FlaggedUser | null>(null);
  const [clearTarget, setClearTarget] = useState<FlaggedUser | null>(null);

  // Expanded rows
  const [expandedDisputeIds, setExpandedDisputeIds] = useState<Set<string>>(new Set());

  // Pagination
  const [disputePage, setDisputePage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);

  // Platform Settings
  const [platformFee, setPlatformFee] = useState(10);
  const [dailyBetLimit, setDailyBetLimit] = useState(50);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [newUserRegistration, setNewUserRegistration] = useState(true);
  const [autoDisputeEscalation, setAutoDisputeEscalation] = useState(true);

  // Activity Feed
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const activityCounter = useRef(0);

  useEffect(() => {
    // Seed initial events
    const initial: ActivityEvent[] = ACTIVITY_TEMPLATES.slice(0, 5).map((t, i) => ({
      ...t,
      id: `evt-${i}`,
      timestamp: new Date(Date.now() - (5 - i) * 8000).toLocaleTimeString(),
    }));
    setActivityFeed(initial);
    activityCounter.current = 5;

    const interval = setInterval(() => {
      const template = ACTIVITY_TEMPLATES[activityCounter.current % ACTIVITY_TEMPLATES.length];
      const evt: ActivityEvent = {
        ...template,
        id: `evt-${activityCounter.current}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      activityCounter.current++;
      setActivityFeed((prev) => [...prev.slice(-50), evt]);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activityFeed]);

  const openDisputes = disputes.filter((d) => d.status !== "resolved").length;
  const bannedUsers = flaggedUsers.filter((u) => u.status === "banned").length;

  const toggleSort = (key: keyof Dispute) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: keyof Dispute }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1 text-primary" /> : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
  };

  const toggleExpandDispute = (id: string) => {
    setExpandedDisputeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addAuditEntry = (action: string, target: string, detail: string) => {
    setAuditLog((prev) => [
      {
        id: `A-${prev.length + 1}`,
        admin: "admin_root",
        action,
        target,
        detail,
        timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
      },
      ...prev,
    ]);
  };

  const handleResolve = () => {
    if (!selectedDispute || resolutionChoice === "pending") return;
    setDisputes((prev) =>
      prev.map((d) =>
        d.id === selectedDispute.id ? { ...d, status: "resolved" as DisputeStatus, resolution: resolutionChoice } : d
      )
    );
    const actionLabel = resolutionChoice === "refund" ? "REFUND_MATCH" : resolutionChoice === "void" ? "VOID_MATCH" : "RESOLVE_DISPUTE";
    addAuditEntry(actionLabel, selectedDispute.id, resolutionNote || `Resolved as ${resolutionChoice.replace("_", " ")}`);
    toast({ title: "Dispute Resolved", description: `${selectedDispute.id} — ${resolutionChoice.replace("_", " ")}` });
    addNotification({ type: "dispute", title: "⚖️ Dispute Resolved", message: `${selectedDispute.id}: ${selectedDispute.playerA} vs ${selectedDispute.playerB} — ${resolutionChoice.replace("_", " ")}` });
    setSelectedDispute(null);
    setResolutionNote("");
    setResolutionChoice("pending");
  };

  const handleBanUser = (user: FlaggedUser) => {
    setFlaggedUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: "banned" as const } : u)));
    addAuditEntry("BAN_USER", user.id, `Banned user ${user.username}`);
    toast({ title: "User Banned", description: `${user.username} has been permanently banned.`, variant: "destructive" });
    addNotification({ type: "system", title: "🛑 User Banned", message: `${user.username} (${user.walletShort}) permanently banned from the platform.` });
    setBanTarget(null);
  };

  const handleClearUser = (userId: string) => {
    setFlaggedUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, status: "cleared" as const } : u)));
    addAuditEntry("CLEAR_FLAG", userId, "Cleared after admin review");
    toast({ title: "User Cleared", description: "Flag removed after review." });
    addNotification({ type: "system", title: "✅ User Cleared", message: `Flag removed from user ${userId} after admin review.` });
  };

  const handleKillSwitch = () => {
    setKillSwitchActive(true);
    setKillSwitchConfirm(false);
    addAuditEntry("KILL_SWITCH_ACTIVATED", "PLATFORM", "Emergency payout freeze activated by admin");
    toast({ title: "🚨 KILL SWITCH ACTIVATED", description: "All payouts are now frozen.", variant: "destructive" });
    addNotification({ type: "system", title: "🚨 EMERGENCY: Kill Switch", message: "All platform payouts have been frozen by admin. No funds will be released until deactivated." });
  };

  const handleDeactivateKillSwitch = () => {
    setKillSwitchActive(false);
    addAuditEntry("KILL_SWITCH_DEACTIVATED", "PLATFORM", "Payout freeze lifted by admin");
    toast({ title: "Kill Switch Deactivated", description: "Payouts are now live again." });
    addNotification({ type: "payout", title: "✅ Payouts Resumed", message: "Kill switch deactivated. All payouts are now processing normally." });
  };

  const handleExportDisputes = () => {
    exportToCSV("disputes.csv", ["ID", "Match", "Player A", "Player B", "Game", "Stake", "Status", "Resolution", "Created"],
      disputes.map((d) => [d.id, d.matchId, d.playerA, d.playerB, d.game, d.stake, d.status, d.resolution, d.createdAt])
    );
    toast({ title: "Exported", description: "Disputes CSV downloaded." });
  };

  const handleExportAudit = () => {
    exportToCSV("audit_log.csv", ["Timestamp", "Action", "Target", "Detail", "Admin"],
      auditLog.map((l) => [l.timestamp, l.action, l.target, l.detail, l.admin])
    );
    toast({ title: "Exported", description: "Audit log CSV downloaded." });
  };

  // Filtered + sorted disputes
  const filteredDisputes = disputes
    .filter((d) => {
      const matchesSearch =
        d.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.playerA.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.playerB.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || d.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (!sortKey) return 0;
      const aVal = a[sortKey] ?? "";
      const bVal = b[sortKey] ?? "";
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });

  const filteredUsers = flaggedUsers.filter((u) => userStatusFilter === "all" || u.status === userStatusFilter);

  // Pagination
  const disputePages = Math.max(1, Math.ceil(filteredDisputes.length / ITEMS_PER_PAGE));
  const pagedDisputes = filteredDisputes.slice((disputePage - 1) * ITEMS_PER_PAGE, disputePage * ITEMS_PER_PAGE);
  const auditPages = Math.max(1, Math.ceil(auditLog.length / ITEMS_PER_PAGE));
  const pagedAudit = auditLog.slice((auditPage - 1) * ITEMS_PER_PAGE, auditPage * ITEMS_PER_PAGE);

  return (
    <div className="space-y-6">
      {/* Header + Kill Switch */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
            <ShieldAlert className="h-8 w-8 text-destructive" />
            Admin Panel
          </h1>
          <p className="text-muted-foreground mt-1">Dispute resolution, user moderation & audit logs</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="border-destructive/40 text-destructive text-xs uppercase tracking-widest px-3 py-1">
            Restricted Access
          </Badge>
          {killSwitchActive ? (
            <Button
              size="sm"
              variant="outline"
              className="border-primary/40 text-primary hover:bg-primary/10 animate-pulse"
              onClick={handleDeactivateKillSwitch}
            >
              <Power className="mr-2 h-4 w-4" /> Deactivate Kill Switch
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setKillSwitchConfirm(true)}
            >
              <Power className="mr-2 h-4 w-4" /> Kill Switch
            </Button>
          )}
        </div>
      </div>

      {/* Kill Switch Banner */}
      {killSwitchActive && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-center gap-3 animate-pulse">
          <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
          <div>
            <p className="font-display font-bold text-destructive">⚠️ EMERGENCY MODE — ALL PAYOUTS FROZEN</p>
            <p className="text-sm text-destructive/80">No payouts will be processed until the kill switch is deactivated.</p>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-arena-orange/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-arena-orange/10"><AlertTriangle className="h-5 w-5 text-arena-orange" /></div>
            <div>
              <p className="text-2xl font-bold font-display">{openDisputes}</p>
              <p className="text-xs text-muted-foreground">Open Disputes</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10"><Ban className="h-5 w-5 text-destructive" /></div>
            <div>
              <p className="text-2xl font-bold font-display">{bannedUsers}</p>
              <p className="text-xs text-muted-foreground">Banned Users</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Activity className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-2xl font-bold font-display">247</p>
              <p className="text-xs text-muted-foreground">Matches Today</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-arena-gold/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-arena-gold/10"><DollarSign className="h-5 w-5 text-arena-gold" /></div>
            <div>
              <p className="text-2xl font-bold font-display">$12,450</p>
              <p className="text-xs text-muted-foreground">Volume Today</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="disputes" className="space-y-4">
        <TabsList className="bg-secondary flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="disputes" className="data-[state=active]:bg-background">
            <Gavel className="mr-2 h-4 w-4" /> Disputes
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-background">
            <Users className="mr-2 h-4 w-4" /> Flagged Users
          </TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-background">
            <Eye className="mr-2 h-4 w-4" /> Audit Log
          </TabsTrigger>
          <TabsTrigger value="feed" className="data-[state=active]:bg-background">
            <Radio className="mr-2 h-4 w-4" /> Live Feed
          </TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:bg-background">
            <Settings className="mr-2 h-4 w-4" /> Settings
          </TabsTrigger>
        </TabsList>

        {/* ── Disputes Tab ── */}
        <TabsContent value="disputes">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Match Disputes</CardTitle>
                  <CardDescription>Review and resolve player-reported issues</CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as DisputeStatus | "all"); setDisputePage(1); }}>
                    <SelectTrigger className="w-full sm:w-36 bg-secondary border-border">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="reviewing">Reviewing</SelectItem>
                      <SelectItem value="escalated">Escalated</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="relative w-full sm:w-56">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." className="pl-9 bg-secondary border-border" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" className="border-border" onClick={handleExportDisputes}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead className="hidden md:table-cell">Players</TableHead>
                    <TableHead className="hidden lg:table-cell cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("game")}>
                      <span className="inline-flex items-center">Game <SortIcon col="game" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("stake")}>
                      <span className="inline-flex items-center">Stake <SortIcon col="stake" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("status")}>
                      <span className="inline-flex items-center">Status <SortIcon col="status" /></span>
                    </TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedDisputes.map((d) => (
                    <Fragment key={d.id}>
                      <TableRow key={d.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => toggleExpandDispute(d.id)}>
                        <TableCell className="w-8 px-2">
                          {expandedDisputeIds.has(d.id) ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{d.id}</TableCell>
                        <TableCell className="font-mono text-xs">{d.matchId}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {d.playerA} <span className="text-muted-foreground mx-1">vs</span> {d.playerB}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">{d.game}</TableCell>
                        <TableCell className="font-semibold text-primary">{d.stake}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColor[d.status]}>{d.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {d.status !== "resolved" ? (
                            <Button size="sm" variant="outline" className="border-primary/30 text-primary hover:bg-primary/10" onClick={() => setSelectedDispute(d)}>
                              Resolve
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">{d.resolution.replace("_", " ")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expandedDisputeIds.has(d.id) && (
                        <TableRow key={`${d.id}-detail`} className="bg-secondary/30 hover:bg-secondary/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid sm:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Reason</p>
                                <p className="text-foreground">{d.reason}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Evidence</p>
                                <p className="text-foreground">{d.evidence || "No evidence submitted"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Created</p>
                                <p className="font-mono text-xs">{d.createdAt}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Resolution</p>
                                <p className={d.resolution === "pending" ? "text-arena-orange" : "text-primary"}>{d.resolution.replace("_", " ")}</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
              {disputePages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">Page {disputePage} of {disputePages} ({filteredDisputes.length} results)</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={disputePage <= 1} onClick={() => setDisputePage((p) => p - 1)}>Prev</Button>
                    <Button size="sm" variant="outline" disabled={disputePage >= disputePages} onClick={() => setDisputePage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Flagged Users Tab ── */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Flagged Users</CardTitle>
                  <CardDescription>Players flagged by anti-cheat or anomaly detection</CardDescription>
                </div>
                <Select value={userStatusFilter} onValueChange={(v) => setUserStatusFilter(v as typeof userStatusFilter)}>
                  <SelectTrigger className="w-full sm:w-36 bg-secondary border-border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="flagged">Flagged</SelectItem>
                    <SelectItem value="banned">Banned</SelectItem>
                    <SelectItem value="cleared">Cleared</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="hidden md:table-cell">Wallet</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="hidden lg:table-cell">Win Rate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.id} className="hover:bg-secondary/50">
                      <TableCell className="font-semibold">{u.username}</TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">{u.walletShort}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{u.reason}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className={u.winRate > 80 ? "text-destructive font-bold" : ""}>{u.winRate}%</span>
                        <span className="text-muted-foreground text-xs ml-1">({u.matchesPlayed})</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={userStatusColor[u.status]}>{u.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {u.status === "flagged" && (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => setBanTarget(u)}>
                              <Ban className="h-3 w-3 mr-1" /> Ban
                            </Button>
                            <Button size="sm" variant="outline" className="border-primary/30 text-primary hover:bg-primary/10" onClick={() => setClearTarget(u)}>
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Clear
                            </Button>
                          </div>
                        )}
                        {u.status !== "flagged" && (
                          <span className="text-xs text-muted-foreground capitalize">{u.status}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit Log Tab ── */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Audit Log</CardTitle>
                  <CardDescription>Tamper-proof record of all admin actions</CardDescription>
                </div>
                <Button size="sm" variant="outline" className="border-border" onClick={handleExportAudit}>
                  <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden sm:table-cell"><Clock className="h-4 w-4" /></TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="hidden md:table-cell">Detail</TableHead>
                    <TableHead className="hidden sm:table-cell">Admin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedAudit.map((log) => (
                    <TableRow key={log.id} className="hover:bg-secondary/50">
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground font-mono whitespace-nowrap">{log.timestamp}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{log.action}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{log.target}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[300px] truncate">{log.detail}</TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{log.admin}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {auditPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">Page {auditPage} of {auditPages}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={auditPage <= 1} onClick={() => setAuditPage((p) => p - 1)}>Prev</Button>
                    <Button size="sm" variant="outline" disabled={auditPage >= auditPages} onClick={() => setAuditPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Live Activity Feed Tab ── */}
        <TabsContent value="feed">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                    </span>
                    Live Activity Feed
                  </CardTitle>
                  <CardDescription>Real-time platform events (auto-updating)</CardDescription>
                </div>
                <Badge variant="outline" className="border-primary/30 text-primary font-mono text-xs">
                  {activityFeed.length} events
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] rounded-lg border border-border bg-secondary/30 p-1" ref={feedRef}>
                <div className="space-y-1 p-3">
                  {activityFeed.map((evt) => (
                    <div
                      key={evt.id}
                      className={`flex items-start gap-3 py-2 px-3 rounded-md text-sm transition-colors ${
                        evt.highlight ? "bg-destructive/10 border border-destructive/20" : "hover:bg-secondary/50"
                      }`}
                    >
                      <span className="text-xs text-muted-foreground font-mono shrink-0 mt-0.5">{evt.timestamp}</span>
                      <span className="text-foreground">{evt.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Platform Settings Tab ── */}
        <TabsContent value="settings">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Fees & Limits */}
            <Card>
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2"><DollarSign className="h-5 w-5 text-arena-gold" /> Fees & Limits</CardTitle>
                <CardDescription>Configure platform commission and betting caps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Platform Fee</label>
                    <span className="font-display text-xl font-bold text-primary">{platformFee}%</span>
                  </div>
                  <Slider
                    value={[platformFee]}
                    onValueChange={([v]) => setPlatformFee(v)}
                    min={1}
                    max={25}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Deducted from each match pot before payout</p>
                </div>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Daily Bet Limit</label>
                    <span className="font-display text-xl font-bold text-arena-gold">${dailyBetLimit}</span>
                  </div>
                  <Select value={String(dailyBetLimit)} onValueChange={(v) => setDailyBetLimit(Number(v))}>
                    <SelectTrigger className="bg-secondary border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">$10</SelectItem>
                      <SelectItem value="25">$25</SelectItem>
                      <SelectItem value="50">$50</SelectItem>
                      <SelectItem value="100">$100</SelectItem>
                      <SelectItem value="250">$250</SelectItem>
                      <SelectItem value="500">$500</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Max total bet per user per 24h period</p>
                </div>
              </CardContent>
            </Card>

            {/* System Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2"><Wrench className="h-5 w-5 text-arena-cyan" /> System Controls</CardTitle>
                <CardDescription>Platform-wide toggles and operational settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="font-medium text-sm">Maintenance Mode</p>
                    <p className="text-xs text-muted-foreground">Pauses matchmaking and displays a banner</p>
                  </div>
                  <Switch checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="font-medium text-sm">New User Registration</p>
                    <p className="text-xs text-muted-foreground">Allow new wallets to create accounts</p>
                  </div>
                  <Switch checked={newUserRegistration} onCheckedChange={setNewUserRegistration} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="font-medium text-sm">Auto Dispute Escalation</p>
                    <p className="text-xs text-muted-foreground">Auto-escalate disputes after 24h with no action</p>
                  </div>
                  <Switch checked={autoDisputeEscalation} onCheckedChange={setAutoDisputeEscalation} />
                </div>
                <Separator />
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => {
                  addAuditEntry("SETTINGS_UPDATED", "PLATFORM", `Fee: ${platformFee}%, Limit: $${dailyBetLimit}, Maintenance: ${maintenanceMode}`);
                  toast({ title: "Settings Saved", description: "Platform configuration updated." });
                  addNotification({ type: "system", title: "⚙️ Settings Updated", message: `Platform fee: ${platformFee}%, Daily limit: $${dailyBetLimit}, Maintenance: ${maintenanceMode ? "ON" : "OFF"}` });
                }}>
                  Save Settings
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Resolve Dialog ── */}
      <Dialog open={!!selectedDispute} onOpenChange={() => setSelectedDispute(null)}>
        <DialogContent className="bg-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Gavel className="h-5 w-5 text-primary" /> Resolve {selectedDispute?.id}
            </DialogTitle>
            <DialogDescription>
              {selectedDispute?.playerA} vs {selectedDispute?.playerB} — {selectedDispute?.game} ({selectedDispute?.stake})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-secondary text-sm">
              <p className="font-semibold text-foreground mb-1">Reason:</p>
              <p className="text-muted-foreground">{selectedDispute?.reason}</p>
              {selectedDispute?.evidence && <p className="text-xs text-arena-cyan mt-2">📎 {selectedDispute.evidence}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Resolution</label>
              <Select value={resolutionChoice} onValueChange={(v) => setResolutionChoice(v as DisputeResolution)}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Choose resolution..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="player_a_wins"><span className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-primary" /> {selectedDispute?.playerA} Wins</span></SelectItem>
                  <SelectItem value="player_b_wins"><span className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-primary" /> {selectedDispute?.playerB} Wins</span></SelectItem>
                  <SelectItem value="refund"><span className="flex items-center gap-2"><DollarSign className="h-3 w-3 text-arena-gold" /> Full Refund</span></SelectItem>
                  <SelectItem value="void"><span className="flex items-center gap-2"><XCircle className="h-3 w-3 text-destructive" /> Void Match</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Admin Note</label>
              <Textarea placeholder="Describe the reasoning behind this decision..." className="bg-secondary border-border resize-none" rows={3} value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelectedDispute(null)}>Cancel</Button>
            <Button onClick={handleResolve} disabled={resolutionChoice === "pending"} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Gavel className="mr-2 h-4 w-4" /> Confirm Resolution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Ban Confirmation ── */}
      <AlertDialog open={!!banTarget} onOpenChange={() => setBanTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" /> Ban {banTarget?.username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently ban <strong>{banTarget?.username}</strong> ({banTarget?.walletShort}) from the platform.
              Reason: {banTarget?.reason}. This action is logged and cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => banTarget && handleBanUser(banTarget)}>
              Confirm Ban
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Clear Confirmation ── */}
      <AlertDialog open={!!clearTarget} onOpenChange={() => setClearTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="h-5 w-5" /> Clear {clearTarget?.username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the flag from <strong>{clearTarget?.username}</strong> ({clearTarget?.walletShort}) and mark them as cleared.
              Reason for flag: {clearTarget?.reason}. This action is logged in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => { if (clearTarget) { handleClearUser(clearTarget.id); setClearTarget(null); } }}>
              Confirm Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Kill Switch Confirmation ── */}
      <AlertDialog open={killSwitchConfirm} onOpenChange={setKillSwitchConfirm}>
        <AlertDialogContent className="bg-card border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Power className="h-5 w-5" /> Activate Emergency Kill Switch?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>immediately freeze ALL payouts</strong> across the entire platform. Active matches will continue but no funds will be released. Use only in case of a confirmed security breach or hack.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleKillSwitch}>
              🚨 ACTIVATE KILL SWITCH
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Admin;
