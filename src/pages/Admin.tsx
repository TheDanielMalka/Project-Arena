import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  Download, Power, Settings, Radio, ChevronRight, Zap, Flag, RefreshCw,
  TrendingUp, Shield,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNotificationStore } from "@/stores/notificationStore";
import { PLATFORM_BETTING_MAX } from "@/stores/walletStore";
import { useUserStore } from "@/stores/userStore";
import type {
  Dispute, DisputeStatus, DisputeResolution,
  FlaggedUser, AuditLog, AdminActivityEvent, PlatformSettings,
  SupportTicket,
  SupportTicketCategory,
  SupportTopic,
  TicketStatus,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  apiAdminFreezeStatus,
  apiAdminFreeze,
  apiAdminGetUsers,
  apiAdminGetDisputes,
  apiAdminIssuePenalty,
  apiGetPlatformConfig,
  apiUpdatePlatformConfig,
  apiAdminGetAuditLog,
  apiAdminGetFraudReport,
  apiAdminGetFraudSummary,
  apiAdminPostFraudExportReport,
  apiAdminFraudExport,
  apiAdminOracleStatus,
  apiAdminOracleSync,
  apiAdminTestSlack,
  apiAdminDeclareWinner,
  apiAdminListSupportTicketAttachments,
  apiGetAttachmentBlob,
  apiDeleteAttachment,
  apiPostSupportTicketAttachment,
  apiAdminListSupportTickets,
  apiAdminPatchSupportTicket,
  type AdminTicketAttachmentMeta,
  type ApiAdminSupportTicketRow,
} from "@/lib/engine-api";
import type { FraudReport, FraudSummary, OracleStatus, PlatformConfig } from "@/lib/engine-api";

function mapAdminSupportRowToUiTicket(r: ApiAdminSupportTicketRow): SupportTicket {
  const cat = (r.category || "player_report") as SupportTicketCategory;
  const reason = (r.reason || "other") as SupportTicket["reason"];
  const status = (r.status || "open") as TicketStatus;
  const topic = r.topic && r.topic.length > 0 ? (r.topic as SupportTopic) : undefined;
  return {
    id: r.id,
    reporterId: r.reporter_id,
    reporterName: r.reporter_username?.trim() || "—",
    reportedId: r.reported_id ?? "platform",
    reportedUsername: r.reported_username?.trim() || "—",
    reason,
    description: r.description || "",
    status,
    adminNote: r.admin_note ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
    updatedAt: r.updated_at ?? undefined,
    ticketCategory: cat,
    matchId: r.match_id ?? undefined,
    supportTopic: topic,
  };
}

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

/** Flatten POST /admin/fraud/report/export JSON into a single CSV (uses exportCSV). */
function exportFraudReportToCsv(report: FraudReport) {
  const rows: string[][] = [];
  for (const p of report.flagged_players) {
    rows.push(["high_winrate", p.user_id, p.username, String(p.win_rate), String(p.wins), String(p.matches), p.reason, ""]);
  }
  for (const sp of report.suspicious_pairs) {
    rows.push(["pair_farming", sp.player_a, sp.username_a, sp.player_b, sp.username_b, String(sp.match_count), sp.reason, ""]);
  }
  for (const u of report.repeat_offenders) {
    rows.push(["repeat_offender", u.user_id, u.username, String(u.penalty_count), u.last_offense, String(u.is_banned), u.reason, ""]);
  }
  for (const b of report.recently_banned) {
    rows.push(["recently_banned", b.user_id, b.username, b.banned_at, b.offense_type, b.notes ?? "", b.reason, ""]);
  }
  for (const il of report.intentional_losing) {
    rows.push([
      "intentional_losing",
      il.loser_username,
      il.winner_username,
      String(il.loss_count),
      il.first_match,
      il.last_match,
      il.reason ?? "Intentional Losing",
      "",
    ]);
  }
  exportCSV(`fraud_report_${new Date().toISOString().slice(0, 10)}.csv`, [
    "section",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
  ], rows);
}

const ROWS_PER_PAGE = 8;

function AdminReportAttachmentThumb({
  attachmentId,
  token,
  contentType,
  onDelete,
}: {
  attachmentId: string;
  token: string;
  contentType: string;
  onDelete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let created: string | null = null;
    void apiGetAttachmentBlob(token, attachmentId).then((blob) => {
      if (!blob || !blob.size) return;
      created = URL.createObjectURL(blob);
      setSrc(created);
    });
    return () => {
      if (created) URL.revokeObjectURL(created);
    };
  }, [attachmentId, token]);
  return (
    <div className="relative inline-block group/thumb">
      {src && contentType.startsWith("image/") ? (
        <img src={src} alt="" className="h-16 w-16 rounded border border-border object-cover" />
      ) : (
        <div className="h-16 w-16 rounded border border-border bg-secondary/40 text-[8px] flex items-center justify-center p-1 text-center">
          file
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="absolute -top-1 -right-1 h-5 w-5 p-0 text-[10px] opacity-0 group-hover/thumb:opacity-100 transition-opacity"
        onClick={async () => {
          const ok = await apiDeleteAttachment(token, attachmentId);
          if (ok) onDelete();
        }}
      >
        ×
      </Button>
    </div>
  );
}

function AdminTicketAttachmentsBlock({ ticketId, token }: { ticketId: string; token: string | null }) {
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<AdminTicketAttachmentMeta[]>([]);
  const load = useCallback(async () => {
    if (!token) return;
    const list = await apiAdminListSupportTicketAttachments(token, ticketId);
    setAttachments(list ?? []);
  }, [token, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;
    const r = await apiPostSupportTicketAttachment(token, ticketId, file);
    if (r.ok === false) {
      toast({
        title: "Upload failed",
        description: r.detail ?? "Only the ticket reporter can upload from the client; admins manage files here.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Attachment added", description: r.filename });
    void load();
  };

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[10px] text-muted-foreground font-display uppercase tracking-wider">Ticket attachments</p>
      <label className="inline-flex items-center gap-2 cursor-pointer text-[10px] text-primary hover:underline">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(ev) => void onUpload(ev)}
        />
        + Upload image (reporter-only on live tickets)
      </label>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <AdminReportAttachmentThumb
            key={a.id}
            attachmentId={a.id}
            token={token!}
            contentType={a.content_type}
            onDelete={() => void load()}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Live feed: derived from same GET /admin/audit-log as Audit tab (no mock templates) ───
function auditRowsToActivity(entries: AuditLog[]): AdminActivityEvent[] {
  const rows = entries.map((l) => {
    const action = l.action;
    const actionUp = action.toUpperCase();
    let type: AdminActivityEvent["type"] = "login";
    if (/BAN_|SUSPEND_/i.test(action)) type = "ban";
    else if (/DECLARE_WINNER|RESOLVE/i.test(action)) type = "match_end";
    else if (/FREEZE_PAYOUT|DISPUTE/i.test(action)) type = "dispute";
    const highlight = /BAN_|SUSPEND_|FREEZE_PAYOUT/i.test(action);
    let orangeBadge: string | undefined;
    let message: string;
    if (actionUp === "AUTO_FLAG") {
      orangeBadge = "Auto-flagged";
      const who = (l.detail ?? "").trim() || (l.target && l.target !== "—" ? l.target : "");
      message = who
        ? `Auto-flagged by vision consensus: ${who}`
        : "Auto-flagged by vision consensus";
    } else {
      message = [
        action.replace(/_/g, " "),
        l.detail ? `— ${l.detail}` : "",
        l.target && l.target !== "—" ? `· ${l.target}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    return {
      id: `live-${l.id}`,
      type,
      message,
      timestamp: l.createdAt,
      highlight,
      orangeBadge,
    };
  });
  return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ─── Nav sections ──────────────────────────────────────────────
const NAV = [
  { id: "disputes", icon: Gavel,         label: "Disputes"   },
  { id: "users",    icon: Users,          label: "Users"      },
  { id: "reports",  icon: Flag,           label: "Reports"    },
  { id: "audit",    icon: Eye,            label: "Audit Log"  },
  { id: "live",     icon: Radio,          label: "Live Feed"  },
  { id: "platform", icon: Settings,       label: "Platform"   },
  { id: "fraud",    icon: AlertTriangle,  label: "Fraud"      },
  { id: "oracle",   icon: Activity,       label: "Oracle"     },
] as const;
type NavId = typeof NAV[number]["id"];

// ─── Component ────────────────────────────────────────────────

const Admin = () => {
  const { toast } = useToast();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const token = useUserStore((s) => s.token);
  const navigate = useNavigate();

  const [section, setSection] = useState<NavId>("disputes");

  // ── Live data ──
  const [disputes,     setDisputes]     = useState<Dispute[]>([]);
  const [flaggedUsers, setFlaggedUsers] = useState<FlaggedUser[]>([]);
  const [auditLog,     setAuditLog]     = useState<AuditLog[]>([]);
  const [activity,     setActivity]     = useState<AdminActivityEvent[]>([]);
  const feedRef         = useRef<HTMLDivElement>(null);

  // ── Fraud report ──
  const [fraudSummary,  setFraudSummary]  = useState<FraudSummary | null>(null);
  const [fraudReport,   setFraudReport]  = useState<FraudReport | null>(null);
  const [fraudLoading,  setFraudLoading] = useState(false);
  const [fraudExporting, setFraudExporting] = useState(false);
  const [fraudSubTab, setFraudSubTab] = useState<"win" | "pair" | "intentional" | "repeat" | "banned">("win");

  // ── Oracle ──
  const [oracleStatus,  setOracleStatus]  = useState<OracleStatus | null>(null);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [syncFromBlock, setSyncFromBlock] = useState("");
  const [syncLoading,   setSyncLoading]   = useState(false);
  const [slackTestLoading, setSlackTestLoading] = useState(false);

  // ── Platform settings ──
  const [platform, setPlatform] = useState<PlatformSettings>({
    feePercent:            5,
    platformBettingMax:    PLATFORM_BETTING_MAX,
    maintenanceMode:       false,
    registrationOpen:      true,
    autoDisputeEscalation: true,
    killSwitchActive:      false,
  });
  const [platformSaving, setPlatformSaving] = useState(false);

  // ── Dispute state ──
  const [selectedDispute,  setSelectedDispute]  = useState<Dispute | null>(null);
  const [resolutionNote,   setResolutionNote]   = useState("");
  const [resolutionChoice, setResolutionChoice] = useState<DisputeResolution>("pending");
  const [disputeSearch,    setDisputeSearch]    = useState("");
  const [disputeStatus,    setDisputeStatus]    = useState<DisputeStatus | "all">("all");
  const [sortKey,          setSortKey]          = useState<keyof Dispute | null>(null);
  const [sortDir,          setSortDir]          = useState<"asc" | "desc">("asc");
  const [disputePage,      setDisputePage]      = useState(1);

  // ── User state ──
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | FlaggedUser["status"]>("all");
  const [banTarget,        setBanTarget]        = useState<FlaggedUser | null>(null);

  // ── Audit state ──
  const [auditPage, setAuditPage] = useState(1);

  // ── Reports (GET /admin/support/tickets) ──
  const [reportTickets, setReportTickets] = useState<SupportTicket[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportStatusFilter, setReportStatusFilter] = useState<TicketStatus | "all">("all");

  // ── Kill switch ──
  const [killConfirm, setKillConfirm] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // Data loaders
  // ─────────────────────────────────────────────────────────────

  const loadAuditLog = useCallback(async () => {
    if (!token) return;
    const r = await apiAdminGetAuditLog(token, { limit: 50 });
    if (r.ok) {
      const mapped = r.entries.map((e) => ({
        id:        e.id,
        adminId:   e.admin_id,
        adminName: e.admin_username || "admin",
        action:    e.action,
        target:    e.target_id  || "—",
        detail:    e.notes      || "",
        createdAt: e.created_at?.slice(0, 16).replace("T", " ") || "",
      }));
      setAuditLog(mapped);
      setActivity(auditRowsToActivity(mapped));
    }
  }, [token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    const r = await apiAdminGetUsers(token, { limit: 200 });
    if (r.ok) {
      setFlaggedUsers(r.users.map((u) => ({
        id:            u.user_id,
        username:      u.username,
        walletAddress: u.wallet_address || "",
        reason: u.penalty_count > 0
          ? `${u.penalty_count} offense${u.penalty_count !== 1 ? "s" : ""} recorded`
          : "Risk monitoring",
        winRate:       Math.round(u.win_rate),
        matchesPlayed: u.matches,
        flaggedAt:     (u.banned_at || u.suspended_until || "")?.slice(0, 10),
        status:        u.is_banned ? "banned" : u.is_suspended ? "flagged" : "cleared",
      })));
    }
  }, [token]);

  const loadDisputes = useCallback(async () => {
    if (!token) return;
    const r = await apiAdminGetDisputes(token, { limit: 100 });
    if (r.ok) {
      setDisputes(r.disputes.map((d) => ({
        id:         d.id,
        matchId:    d.match_id,
        playerA:    d.raised_by_username || d.raised_by || "—",
        playerB:    "—",
        game:       (d.game as Dispute["game"]) || "CS2",
        stake:      d.bet_amount,
        reason:     d.reason,
        status:     (d.status     as DisputeStatus)    || "open",
        resolution: (d.resolution as DisputeResolution) || "pending",
        createdAt:  d.created_at?.slice(0, 16).replace("T", " ") || "",
      })));
    }
  }, [token]);

  const loadReportTickets = useCallback(async () => {
    if (!token) return;
    setReportsLoading(true);
    const r = await apiAdminListSupportTickets(token, { limit: 200 });
    setReportsLoading(false);
    if (r.ok === false) {
      toast({
        title: "Could not load reports",
        description: r.detail ?? "Check admin session.",
        variant: "destructive",
      });
      setReportTickets([]);
      return;
    }
    setReportTickets(r.tickets.map(mapAdminSupportRowToUiTicket));
  }, [token, toast]);

  useEffect(() => {
    if (!token || section !== "reports") return;
    void loadReportTickets();
  }, [token, section, loadReportTickets]);

  // ── Initial load + audit polling ──
  useEffect(() => {
    if (!token) return;

    // Platform: freeze status + config
    void apiAdminFreezeStatus(token).then((r) => {
      if (r.ok) setPlatform((p) => ({ ...p, killSwitchActive: r.frozen }));
    });
    void apiGetPlatformConfig(token).then((r) => {
      if (r.ok) {
        setPlatform((p) => ({
          ...p,
          feePercent:            parseFloat(r.fee_pct)   || 5,
          platformBettingMax:    parseInt(r.daily_bet_max_at) || 500,
          maintenanceMode:       r.maintenance_mode       === "true",
          registrationOpen:      r.new_registrations      === "true",
          autoDisputeEscalation: r.auto_escalate_disputes === "true",
        }));
      }
    });

    void loadUsers();
    void loadDisputes();
    void loadAuditLog();
    void (async () => {
      const fr = await apiAdminGetFraudSummary(token);
      if (fr.ok) setFraudSummary(fr);
    })();

    // Poll audit log every 30s
    const iv = setInterval(() => void loadAuditLog(), 30_000);
    return () => clearInterval(iv);
  }, [token, loadUsers, loadDisputes, loadAuditLog]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [activity]);

  // ─────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────

  // ── Dispute actions ──
  const handleResolve = async () => {
    if (!selectedDispute || resolutionChoice === "pending" || !token) return;

    // For "confirm raiser wins" — call declare-winner on the match with the raiser as winner
    if (resolutionChoice === "player_a_wins") {
      // selectedDispute.playerA = raised_by_username; we need raised_by UUID (stored in playerB field unused)
      // Use the match to declare winner — raiser is stored in the dispute from raised_by
      const dispute = disputes.find((d) => d.id === selectedDispute.id);
      if (dispute) {
        const r = await apiAdminDeclareWinner(
          token,
          selectedDispute.matchId,
          // raised_by UUID is not in local Dispute type — we use playerA as identifier note
          selectedDispute.playerA, // username used as note fallback
          resolutionNote || `Admin resolved dispute ${selectedDispute.id}`,
        );
        if (!r.ok) {
          toast({ title: "Error", description: ('detail' in r ? r.detail : null) || "Failed to declare winner", variant: "destructive" });
          return;
        }
      }
    }

    // Optimistic local update
    setDisputes((p) => p.map((d) => d.id === selectedDispute.id
      ? { ...d, status: "resolved" as DisputeStatus, resolution: resolutionChoice,
          resolvedBy: "admin", resolvedAt: new Date().toISOString().slice(0, 16).replace("T", " ") }
      : d,
    ));
    toast({ title: "Dispute Resolved", description: `${selectedDispute.id} — ${resolutionChoice.replace(/_/g, " ")}` });
    addNotification({ type: "dispute", title: "⚖️ Dispute Resolved",
      message: `${selectedDispute.id}: ${selectedDispute.playerA} — ${resolutionChoice.replace(/_/g, " ")}` });
    setSelectedDispute(null); setResolutionNote(""); setResolutionChoice("pending");
    void loadAuditLog();
  };

  // ── Ban / Penalty ──
  const handleBan = async (u: FlaggedUser) => {
    if (!token) return;
    const r = await apiAdminIssuePenalty(token, u.id, "manual_ban", `Admin escalation for ${u.username}`);
    if (!r.ok) {
      toast({ title: "Error", description: ('detail' in r ? r.detail : null) || "Failed to apply penalty", variant: "destructive" });
      setBanTarget(null);
      return;
    }
    const isBanned = r.action === "banned_permanent";
    toast({
      title: isBanned ? "User Banned" : "User Suspended",
      description: `${u.username} ${isBanned ? "permanently banned" : "suspended"} (offense #${r.offense_count}).`,
      variant: "destructive",
    });
    addNotification({ type: "system",
      title: isBanned ? "🛑 User Banned" : "⚠️ User Suspended",
      message: `${u.username} ${isBanned ? "banned" : "suspended"} (offense #${r.offense_count}).` });
    setBanTarget(null);
    void loadUsers();
    void loadAuditLog();
  };

  const handleClear = (u: FlaggedUser) => {
    // Local-only (no clear endpoint); update optimistically
    setFlaggedUsers((p) => p.map((x) => x.id === u.id ? { ...x, status: "cleared" as const } : x));
    toast({ title: "Flag Cleared", description: `${u.username} is no longer flagged.` });
    addNotification({ type: "system", title: "✅ Flag Cleared", message: `${u.username} cleared after admin review.` });
  };

  // ── Kill switch ──
  const handleKillSwitch = async () => {
    if (!token) return;
    const next = !platform.killSwitchActive;
    const r = await apiAdminFreeze(token, next);
    if (!r.ok) {
      toast({ title: "Error", description: ('detail' in r ? r.detail : null) || "Failed to toggle freeze", variant: "destructive" });
      setKillConfirm(false);
      return;
    }
    setPlatform((p) => ({ ...p, killSwitchActive: r.frozen }));
    setKillConfirm(false);
    void loadAuditLog();
    toast({
      title: r.frozen ? "🚨 Payouts Frozen" : "✅ Payouts Resumed",
      description: r.message,
      variant: r.frozen ? "destructive" : "default",
    });
    addNotification({ type: "system",
      title: r.frozen ? "🚨 KILL SWITCH" : "✅ Payouts Resumed",
      message: r.frozen ? "All payouts frozen by admin." : "Kill switch deactivated. Payouts processing." });
  };

  // ── Platform settings save ──
  const handleSavePlatform = async () => {
    if (!token) return;
    setPlatformSaving(true);
    const r = await apiUpdatePlatformConfig(token, {
      fee_pct:                String(platform.feePercent),
      daily_bet_max_at:       String(platform.platformBettingMax),
      maintenance_mode:       String(platform.maintenanceMode),
      new_registrations:      String(platform.registrationOpen),
      auto_escalate_disputes: String(platform.autoDisputeEscalation),
    });
    setPlatformSaving(false);
    if (!r.ok) {
      toast({ title: "Error", description: ('detail' in r ? r.detail : null) || "Failed to save settings", variant: "destructive" });
      return;
    }
    void loadAuditLog();
    toast({ title: "Settings Saved", description: `Updated: ${r.fields.join(", ")}` });
  };

  // ── Fraud report ──
  const refreshFraudSummary = useCallback(async () => {
    if (!token) return;
    const fr = await apiAdminGetFraudSummary(token);
    if (fr.ok) setFraudSummary(fr);
  }, [token]);

  const handleViewFullFraudReport = async () => {
    if (!token) return;
    setFraudLoading(true);
    const r = await apiAdminGetFraudReport(token);
    setFraudLoading(false);
    if (!r.ok) {
      toast({ title: "Error", description: ('detail' in r ? r.detail : null) || "Failed to load fraud report", variant: "destructive" });
      return;
    }
    setFraudReport(r);
    void refreshFraudSummary();
  };

  const handleExportFraudJson = async () => {
    if (!token) return;
    setFraudExporting(true);
    const r = await apiAdminFraudExport(token);
    setFraudExporting(false);
    if (r.ok === false) {
      toast({ title: "Export failed", description: r.detail ?? "Could not download report", variant: "destructive" });
      return;
    }
    toast({ title: "Download started", description: "Fraud report JSON export." });
  };

  const handleExportFraudCsv = async () => {
    if (!token) return;
    setFraudExporting(true);
    const r = await apiAdminPostFraudExportReport(token);
    setFraudExporting(false);
    if (!r.ok) {
      toast({ title: "Export failed", description: ('detail' in r ? r.detail : null) ?? "Could not load export payload", variant: "destructive" });
      return;
    }
    exportFraudReportToCsv(r);
    toast({ title: "CSV exported", description: "Fraud report saved as CSV." });
  };

  // ── Oracle ──
  const handleCheckOracleStatus = async () => {
    if (!token) return;
    setOracleLoading(true);
    const r = await apiAdminOracleStatus(token);
    setOracleLoading(false);
    if (r.ok) setOracleStatus(r);
    else toast({ title: "Error", description: ('detail' in r ? r.detail : null) || "Failed to fetch oracle status", variant: "destructive" });
  };

  const handleOracleSync = async () => {
    if (!token) return;
    setSyncLoading(true);
    const from = syncFromBlock ? parseInt(syncFromBlock) : undefined;
    const r = await apiAdminOracleSync(token, from);
    setSyncLoading(false);
    if (!r.ok) {
      toast({ title: "Sync Failed", description: ('detail' in r ? r.detail : null) || "Oracle sync error", variant: "destructive" });
      return;
    }
    toast({ title: "Oracle Synced", description: `${r.events_processed} events from block ${r.from_block} → ${r.to_block}` });
    void handleCheckOracleStatus(); // refresh status
  };

  const handleSlackTest = async () => {
    if (!token) return;
    setSlackTestLoading(true);
    const r = await apiAdminTestSlack(token);
    setSlackTestLoading(false);
    if (!r.ok) {
      toast({
        title: "Slack test failed",
        description: ('detail' in r ? r.detail : null) || "Could not send test message",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Slack test sent", description: "Check your Slack channel for the message." });
  };

  // ─────────────────────────────────────────────────────────────
  // Derived data
  // ─────────────────────────────────────────────────────────────

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
                <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                  onClick={() => void loadDisputes()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs border-border ml-auto"
                  onClick={() => exportCSV("disputes.csv", ["ID","Match","Raised By","Game","Stake","Status","Resolution","Created"],
                    disputes.map((d) => [d.id, d.matchId, d.playerA, d.game, `$${d.stake}`, d.status, d.resolution, d.createdAt]))}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Export
                </Button>
              </div>

              {pagedDisp.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Gavel className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No disputes found</p>
                </div>
              )}

              {/* dispute cards */}
              <div className="space-y-2">
                {pagedDisp.map((d) => {
                  const borderColor = {
                    open:      "border-l-arena-orange",
                    reviewing: "border-l-arena-cyan",
                    escalated: "border-l-destructive",
                    resolved:  "border-l-primary",
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
                        <span className="text-[10px] text-muted-foreground">Raised by:</span>
                        <span className="font-display text-sm font-bold">{d.playerA}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{d.createdAt}</span>
                      </div>

                      {/* reason */}
                      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{d.reason}</p>

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
              <div className="flex gap-1.5 flex-wrap items-center">
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
                <Button size="sm" variant="ghost" className="h-7 ml-auto text-xs text-muted-foreground"
                  onClick={() => void loadUsers()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>

              {filteredUsers.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No users found</p>
                </div>
              )}

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
                        <div className="flex items-center gap-2 flex-wrap">
                          <button className="font-display text-sm font-bold hover:text-primary transition-colors"
                            onClick={() => void navigate(`/players/${u.username}`)}>
                            {u.username}
                          </button>
                          {u.status === "banned" && (
                            <Badge className="text-[9px] border px-1.5 py-0 bg-destructive/15 text-destructive border-destructive/40 font-display uppercase tracking-wide">
                              BANNED
                            </Badge>
                          )}
                          {u.status === "flagged" && (
                            <Badge className="text-[9px] border px-1.5 py-0 bg-arena-orange/15 text-arena-orange border-arena-orange/40 font-display uppercase tracking-wide">
                              SUSPENDED
                            </Badge>
                          )}
                          {u.status === "cleared" && (
                            <Badge className={cn("text-[9px] border px-1.5 py-0", userStatusBadge.cleared)}>cleared</Badge>
                          )}
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
                          {u.walletAddress && (
                            <span className="font-mono text-[10px] text-muted-foreground">{u.walletAddress.slice(0, 6)}…{u.walletAddress.slice(-4)}</span>
                          )}
                          {u.flaggedAt && (
                            <span className="text-[10px] text-muted-foreground ml-auto">{u.flaggedAt}</span>
                          )}
                        </div>
                      </div>

                      {/* actions */}
                      <div className="flex gap-1 shrink-0">
                        {u.status !== "banned" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[10px] text-destructive hover:bg-destructive/10 font-display border border-destructive/20"
                            onClick={() => setBanTarget(u)}>
                            <Ban className="mr-1 h-3 w-3" /> Penalty
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
                  Support tickets from the database — same queue as POST /support/tickets
                </p>
                <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                  onClick={() => void loadReportTickets()} disabled={reportsLoading}>
                  <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", reportsLoading && "animate-spin")} /> Refresh
                </Button>
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
                if (reportsLoading && reportTickets.length === 0) {
                  return (
                    <div className="text-center py-12 text-muted-foreground">
                      <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-30 animate-spin" />
                      <p className="text-sm">Loading reports…</p>
                    </div>
                  );
                }
                const filtered = reportTickets.filter(
                  (t) => reportStatusFilter === "all" || t.status === reportStatusFilter
                );
                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 text-muted-foreground">
                      <Flag className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No reports in the database yet</p>
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
                      const categoryLabel: Record<SupportTicketCategory, string> = {
                        player_report:   "Player report",
                        match_dispute:   "Match appeal",
                        general_support: "Support ticket",
                      };
                      const topicLabel: Record<SupportTopic, string> = {
                        account_access:  "Account & login",
                        payments_escrow: "Payments & escrow",
                        bug_technical:   "Bug / technical",
                        match_outcome:   "Match outcome",
                        feedback:        "Feedback",
                        other:           "Other",
                      };
                      const cat = t.ticketCategory ?? "player_report";
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
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/30 text-primary/90">
                                {categoryLabel[cat]}
                              </Badge>
                              {t.supportTopic && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-arena-cyan/30 text-arena-cyan">
                                  {topicLabel[t.supportTopic]}
                                </Badge>
                              )}
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {new Date(t.createdAt).toLocaleDateString()}
                            </span>
                          </div>

                          {/* Players */}
                          <div className="flex items-center gap-1.5 text-xs mb-2 flex-wrap">
                            <span className="text-muted-foreground">by</span>
                            <span className="font-medium">{t.reporterName}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-display font-semibold text-destructive">{t.reportedUsername}</span>
                          </div>

                          {t.matchId && (
                            <p className="text-[10px] font-mono text-arena-orange mb-2">
                              Match: {t.matchId}
                            </p>
                          )}

                          {/* Description */}
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4 mb-3">{t.description}</p>

                          {t.attachmentDataUrl && (
                            <div className="mb-3">
                              <p className="text-[10px] text-muted-foreground mb-1">Attachment (legacy preview)</p>
                              <a href={t.attachmentDataUrl} target="_blank" rel="noreferrer" className="inline-block">
                                <img src={t.attachmentDataUrl} alt="Ticket attachment"
                                  className="max-h-32 rounded border border-border object-contain" />
                              </a>
                            </div>
                          )}

                          {token && <AdminTicketAttachmentsBlock ticketId={t.id} token={token} />}

                          {t.adminNote && (
                            <p className="text-[10px] text-arena-cyan bg-arena-cyan/10 border border-arena-cyan/20 rounded-md px-2 py-1 mb-3">
                              Admin: {t.adminNote}
                            </p>
                          )}

                          {/* Actions */}
                          {t.status !== "dismissed" && t.status !== "resolved" && (
                            <div className="flex gap-2 flex-wrap">
                              {t.status === "open" && (
                                <Button size="sm" variant="outline"
                                  className="h-7 text-xs border-arena-cyan/40 text-arena-cyan hover:bg-arena-cyan/10"
                                  onClick={() => void (async () => {
                                    if (!token) return;
                                    const r = await apiAdminPatchSupportTicket(token, t.id, { status: "investigating" });
                                    if (r.ok === false) {
                                      toast({ title: "Update failed", description: r.detail ?? "", variant: "destructive" });
                                      return;
                                    }
                                    toast({ title: "Under Investigation", description: `Report ${t.id} is now being reviewed.` });
                                    void loadReportTickets();
                                  })()}>
                                  Investigate
                                </Button>
                              )}
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
                                onClick={() => void (async () => {
                                  if (!token) return;
                                  const r = await apiAdminPatchSupportTicket(token, t.id, {
                                    status: "resolved",
                                    admin_note: "Reviewed and resolved by admin",
                                  });
                                  if (r.ok === false) {
                                    toast({ title: "Update failed", description: r.detail ?? "", variant: "destructive" });
                                    return;
                                  }
                                  toast({ title: "Report Resolved", description: `${t.id} marked as resolved.` });
                                  void loadReportTickets();
                                })()}>
                                Resolve
                              </Button>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs border-border/50 text-muted-foreground hover:text-foreground"
                                onClick={() => void (async () => {
                                  if (!token) return;
                                  const r = await apiAdminPatchSupportTicket(token, t.id, {
                                    status: "dismissed",
                                    admin_note: "No violation found",
                                  });
                                  if (r.ok === false) {
                                    toast({ title: "Update failed", description: r.detail ?? "", variant: "destructive" });
                                    return;
                                  }
                                  toast({ title: "Report Dismissed", description: `${t.id} dismissed.` });
                                  void loadReportTickets();
                                })()}>
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
              BAN_USER:          "bg-destructive/15 text-destructive border-destructive/30",
              SUSPEND_USER:      "bg-arena-orange/15 text-arena-orange border-arena-orange/30",
              DECLARE_WINNER:    "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30",
              FREEZE_PAYOUT:     "bg-arena-orange/15 text-arena-orange border-arena-orange/30",
              UNFREEZE_PAYOUT:   "bg-primary/15 text-primary border-primary/30",
              CONFIG_UPDATE:     "bg-arena-purple/15 text-arena-purple border-arena-purple/30",
            };
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                    onClick={() => void loadAuditLog()}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                    onClick={() => exportCSV("audit_log.csv", ["Timestamp","Action","Target","Notes","Admin"],
                      auditLog.map((l) => [l.createdAt, l.action, l.target, l.detail, l.adminName]))}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export
                  </Button>
                </div>

                {auditLog.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Eye className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No audit entries yet</p>
                  </div>
                )}

                {/* timeline */}
                <ScrollArea className="h-[400px] pr-2">
                  <div className="relative pl-5">
                    <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border/60" />
                    <div className="space-y-3">
                      {pagedAudit.map((l) => {
                        const style = auditActionStyle[l.action] ?? "bg-secondary text-muted-foreground border-border";
                        return (
                          <div key={l.id} className="relative flex gap-3 group">
                            <div className={cn("absolute -left-[13px] top-2 w-2 h-2 rounded-full border-2 border-background shrink-0",
                              l.action.includes("BAN") ? "bg-destructive"
                              : l.action.includes("UNFREEZE") || l.action.includes("DECLARE") ? "bg-primary"
                              : l.action.includes("FREEZE") || l.action.includes("SUSPEND") ? "bg-arena-orange"
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
                <span className="text-xs text-muted-foreground font-display uppercase tracking-wider">Live — same data as Audit log (refreshes every 30s)</span>
              </div>
              <ScrollArea className="h-[440px] rounded-lg border border-border/60 bg-secondary/10">
                <div ref={feedRef} className="p-3 space-y-1.5">
                  {activity.map((e) => (
                    <div key={e.id} className={cn(
                      "flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-all",
                      e.highlight ? "bg-destructive/10 border border-destructive/20"
                        : e.orangeBadge ? "bg-arena-orange/10 border border-arena-orange/25"
                        : "hover:bg-secondary/40",
                    )}>
                      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap pt-0.5">{e.timestamp}</span>
                      <div className="flex-1 min-w-0 flex items-start gap-2 flex-wrap">
                        {e.orangeBadge && (
                          <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-arena-orange/40 text-arena-orange shrink-0">
                            {e.orangeBadge}
                          </Badge>
                        )}
                        <span className={cn(
                          e.highlight ? "text-destructive" : e.orangeBadge ? "text-arena-orange" : "text-foreground",
                        )}>{e.message}</span>
                      </div>
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
                  label: "Daily Betting Max (AT)",
                  desc: `Platform-wide hard cap — currently ${platform.platformBettingMax} AT/day`,
                  control: (
                    <div className="flex items-center gap-3 w-48">
                      <Slider min={50} max={2000} step={50} value={[platform.platformBettingMax]}
                        onValueChange={([v]) => setPlatform((p) => ({ ...p, platformBettingMax: v }))} className="flex-1" />
                      <span className="text-xs font-mono text-arena-gold w-14 text-right">{platform.platformBettingMax} AT</span>
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
                <Button size="sm" className="font-display text-xs glow-green" disabled={platformSaving}
                  onClick={handleSavePlatform}>
                  {platformSaving ? "Saving…" : "Save Platform Settings"}
                </Button>
              </div>
            </div>
          )}

          {/* ══ FRAUD REPORT ══ */}
          {section === "fraud" && (() => {
            const summaryBadges = fraudSummary ?? fraudReport?.summary ?? null;
            const badgeVal = (n: number | undefined) =>
              summaryBadges !== null ? (n ?? 0) : "—";
            return (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <p className="text-xs text-muted-foreground flex-1">
                  Automated anomaly detection — counts refresh from GET /admin/fraud/summary; full rows from GET /admin/fraud/report.
                </p>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                    onClick={() => void refreshFraudSummary()} disabled={fraudExporting}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh counts
                  </Button>
                  <Button size="sm" variant="default" className="h-8 text-xs"
                    onClick={handleViewFullFraudReport} disabled={fraudLoading}>
                    {fraudLoading
                      ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…</>
                      : <><TrendingUp className="mr-1.5 h-3.5 w-3.5" /> View Full Report</>}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                    onClick={() => void handleExportFraudJson()} disabled={fraudExporting || !token}>
                    {fraudExporting ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Export JSON
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                    onClick={() => void handleExportFraudCsv()} disabled={fraudExporting || !token}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>
              </div>

              {/* Summary badges (mount + summary endpoint) */}
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { label: "High Win-Rate",    val: badgeVal(summaryBadges?.high_winrate),       color: "text-arena-orange" },
                  { label: "Pair Farming",     val: badgeVal(summaryBadges?.pair_farming),       color: "text-destructive"  },
                  { label: "Repeat",           val: badgeVal(summaryBadges?.repeat_offenders),   color: "text-arena-gold"   },
                  { label: "Intentional Lose", val: badgeVal(summaryBadges?.intentional_losing), color: "text-arena-purple" },
                  { label: "Recently Banned",  val: badgeVal(summaryBadges?.recently_banned),    color: "text-muted-foreground" },
                ].map(({ label, val, color }) => (
                  <div key={label} className="rounded-lg border border-border/40 bg-secondary/20 px-3 py-1.5 text-center min-w-[5.5rem]">
                    <p className={cn("font-display text-sm font-bold tabular-nums", color)}>{val}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider leading-tight">{label}</p>
                  </div>
                ))}
                {fraudReport?.generated_at && (
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                    Report {new Date(fraudReport.generated_at).toLocaleString()}
                  </span>
                )}
              </div>

              {!fraudReport && !fraudLoading && (
                <div className="text-center py-10 text-muted-foreground border border-dashed border-border/60 rounded-xl">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm font-display">Click &quot;View Full Report&quot; to load detailed fraud rows</p>
                </div>
              )}

              {fraudReport && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5 border-b border-border/50 pb-2">
                    {([
                      ["win",       "Win anomalies"],
                      ["pair",      "Pair farming"],
                      ["intentional", "Intentional losing"],
                      ["repeat",    "Repeat offenders"],
                      ["banned",    "Recently banned"],
                    ] as const).map(([id, lab]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setFraudSubTab(id)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[10px] font-display uppercase tracking-wide border transition-colors",
                          fraudSubTab === id
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "border-transparent text-muted-foreground hover:bg-secondary/60",
                        )}
                      >
                        {lab}
                      </button>
                    ))}
                  </div>

                  {fraudSubTab === "win" && (
                    fraudReport.flagged_players.length > 0 ? (
                      <div className="space-y-1.5">
                        {fraudReport.flagged_players.map((p) => (
                          <div key={p.user_id} className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-arena-orange/20 text-arena-orange flex items-center justify-center text-xs font-bold shrink-0">
                              {(p.username ?? "?").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <button className="font-display text-xs font-bold hover:text-primary transition-colors"
                                onClick={() => void navigate(`/players/${p.username}`)}>
                                @{p.username}
                              </button>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-destructive font-mono font-bold">{p.win_rate.toFixed(1)}% WR</span>
                                <span className="text-[10px] text-muted-foreground">{p.matches} matches</span>
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10 border border-destructive/20"
                              onClick={() => void (token && apiAdminIssuePenalty(token, p.user_id, "fraud", "High win-rate anomaly").then((r) => {
                                if (r.ok) {
                                  toast({ title: "Penalty Applied", description: `${p.username} penalized.`, variant: "destructive" });
                                  void loadAuditLog();
                                  void refreshFraudSummary();
                                }
                              }))}>
                              <Ban className="h-2.5 w-2.5 mr-1" /> Penalize
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-6 text-center">No high win-rate anomalies in this report.</p>
                    )
                  )}

                  {fraudSubTab === "pair" && (
                    fraudReport.suspicious_pairs.length > 0 ? (
                      <div className="space-y-1.5">
                        {fraudReport.suspicious_pairs.map((pair, i) => (
                          <div key={i} className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 flex items-center gap-3">
                            <div className="flex-1 flex items-center gap-2">
                              <span className="font-display text-xs font-bold">@{pair.username_a}</span>
                              <span className="text-[10px] text-muted-foreground">vs</span>
                              <span className="font-display text-xs font-bold">@{pair.username_b}</span>
                            </div>
                            <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive shrink-0">
                              {pair.match_count}× in 24h
                            </Badge>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10 border border-destructive/20 shrink-0"
                              onClick={() => void (token && Promise.all([
                                apiAdminIssuePenalty(token, pair.player_a, "fraud", "Pair farming"),
                                apiAdminIssuePenalty(token, pair.player_b, "fraud", "Pair farming"),
                              ]).then(() => {
                                toast({ title: "Both Penalized", description: `${pair.username_a} & ${pair.username_b}`, variant: "destructive" });
                                void loadAuditLog();
                                void refreshFraudSummary();
                              }))}>
                              Penalize Both
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-6 text-center">No suspicious pairs in this report.</p>
                    )
                  )}

                  {fraudSubTab === "intentional" && (
                    fraudReport.intentional_losing.length > 0 ? (
                      <div className="space-y-1.5">
                        {fraudReport.intentional_losing.map((row, i) => (
                          <div key={`${row.loser_username}-${row.winner_username}-${i}`} className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="flex-1 flex items-center gap-2 flex-wrap">
                              <span className="font-display text-xs font-bold">@{row.loser_username}</span>
                              <span className="text-[10px] text-muted-foreground">→ loses to →</span>
                              <span className="font-display text-xs font-bold">@{row.winner_username}</span>
                              <Badge variant="outline" className="text-[9px] border-arena-purple/40 text-arena-purple">
                                {row.reason?.trim() || "Intentional Losing"}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                              <span className="font-mono text-foreground">
                                lost {row.loss_count} time{row.loss_count === 1 ? "" : "s"} (7d window)
                              </span>
                              <span>{new Date(row.first_match).toLocaleDateString()} → {new Date(row.last_match).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-6 text-center">No intentional losing patterns in this report.</p>
                    )
                  )}

                  {fraudSubTab === "repeat" && (
                    fraudReport.repeat_offenders.length > 0 ? (
                      <div className="space-y-1.5">
                        {fraudReport.repeat_offenders.map((u) => (
                          <div key={u.user_id} className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 flex items-center gap-3">
                            <span className="font-display text-xs font-bold flex-1">@{u.username}</span>
                            <Badge variant="outline" className="text-[9px] border-arena-gold/30 text-arena-gold">
                              {u.penalty_count} offenses
                            </Badge>
                            {u.is_banned && (
                              <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive">BANNED</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-6 text-center">No repeat offenders in this report.</p>
                    )
                  )}

                  {fraudSubTab === "banned" && (
                    fraudReport.recently_banned.length > 0 ? (
                      <div className="space-y-1.5">
                        {fraudReport.recently_banned.map((u) => (
                          <div key={u.user_id} className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 flex items-center gap-3">
                            <span className="font-display text-xs font-bold flex-1">@{u.username}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{u.offense_type}</span>
                            <span className="text-[10px] text-muted-foreground">{u.banned_at?.slice(0, 10)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-6 text-center">No recently banned users in this report.</p>
                    )
                  )}

                  {fraudReport.summary.total_flagged === 0 && (
                    <div className="text-center py-6 text-muted-foreground border-t border-border/40">
                      <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No anomalies in this report — platform looks healthy</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })()}

          {/* ══ ORACLE ══ */}
          {section === "oracle" && (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-display font-bold">Escrow Oracle Status</p>
                  <p className="text-[11px] text-muted-foreground">On-chain event listener · block sync · EscrowClient</p>
                </div>
                <Button size="sm" variant="outline" className="h-8 text-xs border-border ml-auto"
                  onClick={handleCheckOracleStatus} disabled={oracleLoading}>
                  {oracleLoading
                    ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Checking…</>
                    : <><Activity className="mr-1.5 h-3.5 w-3.5" /> Check Status</>}
                </Button>
              </div>

              <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-4 space-y-3">
                <p className="text-xs font-display font-semibold">Slack alerts</p>
                <p className="text-[11px] text-muted-foreground">
                  Sends a one-off test message if <span className="font-mono">SLACK_ALERTS_WEBHOOK_URL</span> is set on the engine.
                </p>
                <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                  onClick={handleSlackTest} disabled={slackTestLoading}>
                  {slackTestLoading
                    ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…</>
                    : "Send Slack test"}
                </Button>
              </div>

              {!oracleStatus && !oracleLoading && (
                <div className="text-center py-16 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-display">Click "Check Status" to query the oracle</p>
                </div>
              )}

              {oracleStatus && (
                <div className="space-y-4">
                  {/* Status grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        label: "Engine",
                        ok: oracleStatus.escrow_enabled,
                        yes: "✅ Connected",
                        no:  "❌ Disconnected",
                        desc: "EscrowClient initialised",
                      },
                      {
                        label: "Listener",
                        ok: oracleStatus.listener_active,
                        yes: "✅ Active",
                        no:  "⚠️ Inactive",
                        desc: "Background event loop",
                      },
                    ].map(({ label, ok, yes, no, desc }) => (
                      <div key={label} className={cn(
                        "rounded-xl border px-4 py-3",
                        ok ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"
                      )}>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono mb-1">{label}</p>
                        <p className={cn("font-display text-sm font-bold", ok ? "text-primary" : "text-destructive")}>
                          {ok ? yes : no}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
                      </div>
                    ))}

                    <div className="rounded-xl border border-border/40 bg-secondary/20 px-4 py-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono mb-1">Last Block</p>
                      <p className="font-display text-sm font-bold font-mono tabular-nums">
                        {oracleStatus.last_block.toLocaleString()}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border/40 bg-secondary/20 px-4 py-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono mb-1">Last Sync</p>
                      <p className="font-display text-sm font-bold">
                        {oracleStatus.last_sync_at
                          ? new Date(oracleStatus.last_sync_at).toLocaleString()
                          : "Never"}
                      </p>
                    </div>
                  </div>

                  {/* Manual Sync */}
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-4 space-y-3">
                    <p className="text-xs font-display font-semibold">Manual Sync</p>
                    <p className="text-[11px] text-muted-foreground">
                      Force a one-off event scan. Useful if the engine was down and events were missed.
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder="From block (optional)"
                        value={syncFromBlock}
                        onChange={(e) => setSyncFromBlock(e.target.value)}
                        className="h-8 bg-secondary/60 border-border text-xs max-w-[180px]"
                      />
                      <Button size="sm" variant="outline" className="h-8 text-xs border-border"
                        onClick={handleOracleSync} disabled={syncLoading}>
                        {syncLoading
                          ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Syncing…</>
                          : "Sync Now"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
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
              Raised by {selectedDispute?.playerA} · Match {selectedDispute?.matchId} · ${selectedDispute?.stake}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground italic">"{selectedDispute?.reason}"</p>
            <Select value={resolutionChoice} onValueChange={(v) => setResolutionChoice(v as DisputeResolution)}>
              <SelectTrigger className="h-8 bg-secondary/60 border-border text-xs"><SelectValue placeholder="Select resolution…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="player_a_wins">Confirm Raiser Wins</SelectItem>
                <SelectItem value="player_b_wins">Deny — Opponent Wins</SelectItem>
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

      {/* ── Penalty Confirm Dialog ── */}
      <AlertDialog open={!!banTarget} onOpenChange={(o) => !o && setBanTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-sm">Apply Penalty to {banTarget?.username}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This will escalate the penalty for <span className="font-mono font-bold">{banTarget?.username}</span>:
              first offense → 24h suspension, second → 7-day suspension, third+ → permanent ban.
              Action is logged to the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction className="text-xs h-8 bg-destructive hover:bg-destructive/90 font-display"
              onClick={() => banTarget && void handleBan(banTarget)}>
              <Ban className="mr-1.5 h-3.5 w-3.5" /> Apply Penalty
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
              onClick={() => void handleKillSwitch()}>
              {platform.killSwitchActive ? "Deactivate" : "Activate Kill Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default Admin;
