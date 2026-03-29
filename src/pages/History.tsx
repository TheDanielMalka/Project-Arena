import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMatchStore } from "@/stores/matchStore";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Swords, Inbox, Gamepad2, Users, Trophy,
  ChevronDown, ChevronUp, TrendingUp, DollarSign, Shield,
  Monitor, Smartphone,
} from "lucide-react";
import type { Game, MatchStatus } from "@/types";

const ITEMS_PER_PAGE = 8;

type TimeRange = "weekly" | "monthly" | "alltime";

// DB-ready: maps to ?range= query param on GET /api/matches/history
// Server filters by: weekly = last 7 days, monthly = last 30 days, alltime = no date filter
const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "weekly",  label: "Weekly"   },
  { value: "monthly", label: "Monthly"  },
  { value: "alltime", label: "All Time" },
];

const filterByTimeRange = (isoDate: string, range: TimeRange): boolean => {
  if (range === "alltime") return true;
  const date = new Date(isoDate).getTime();
  const now  = Date.now();
  const days = range === "weekly" ? 7 : 30;
  return now - date <= days * 24 * 60 * 60 * 1000;
};

// ── Timestamp formatter — DB-ready: accepts ISO 8601 string (endedAt / createdAt) ──
// Returns: "Today · 09:45" | "Yesterday · 18:40" | "Mar 24 · 14:30"
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`;
};

// ── Game configs — identical URLs to Profile.tsx ─────────────────────────
// comingSoon: true → game shown in dropdown but non-selectable (DB-ready: games.enabled)
const PC_GAME_CONFIG: Record<string, { logo: string; color: string; comingSoon?: boolean }> = {
  CS2: {
    logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg",
    color: "#F97316",
  },
  Valorant: {
    logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg",
    color: "#FF4655",
  },
  Fortnite: {
    logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120",
    color: "#38BDF8",
    comingSoon: true,
  },
  "Apex Legends": {
    logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg",
    color: "#FC4B08",
    comingSoon: true,
  },
};

const MOBILE_GAME_CONFIG: Record<string, { logo: string; color: string }> = {
  MLBB: {
    logo: "https://play-lh.googleusercontent.com/Op7v9XdsyxjrKImMD5RLyiLRCAHs3DMQFANwfsuMTw1hq0lH4j8tOqD3Fd7zyr4ixmC0xoqqRkQDBjAd46NsFQ=s120",
    color: "#EF4444",
  },
  "Wild Rift": {
    logo: "https://play-lh.googleusercontent.com/7-kbcpgrCOE1mleJ9g0d61sJeoqKcQRIj4iFvJ8DjPlRIfocOWfOQsXzKWw2I5oHySVdbjR2fvzfCCz1FYQ-RQ=s120",
    color: "#6366F1",
  },
  "COD Mobile": {
    logo: "https://play-lh.googleusercontent.com/cfGSXkDwxa1jW3TlhhkDJBN16-1_KEtEDhnILPcs9rXcC25g14XY6MRGCtlXHFHs0g=s120",
    color: "#84CC16",
  },
  "PUBG Mobile": {
    logo: "https://play-lh.googleusercontent.com/zCSGnBtZk0Lmp1BAbyaZfLktDzHmC6oke67qzz3G1lBegAF2asyt5KzXOJ2PVdHDYkU=s120",
    color: "#F59E0B",
  },
  "Fortnite Mobile": {
    logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120",
    color: "#38BDF8",
  },
};

// Combined for match-card logo lookup
const ALL_GAME_CONFIG: Record<string, { logo: string; color: string }> = {
  ...PC_GAME_CONFIG,
  ...MOBILE_GAME_CONFIG,
};

// ── Helper components ─────────────────────────────────────────────────────
const GameLogo = ({ game, size = 32 }: { game: string; size?: number }) => {
  const cfg = ALL_GAME_CONFIG[game];
  if (!cfg) return <Gamepad2 style={{ width: size, height: size }} className="text-muted-foreground" />;
  return (
    <img
      src={cfg.logo}
      alt={game}
      className="rounded object-cover"
      style={{ width: size, height: size }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
};

const PlayerInitial = ({ name, isYou = false }: { name: string; isYou?: boolean }) => (
  <div
    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border shrink-0 ${
      isYou
        ? "border-primary/60 bg-primary/20 text-primary"
        : "border-border bg-secondary/40 text-muted-foreground"
    }`}
  >
    {name.slice(0, 2).toUpperCase()}
  </div>
);

// ── Status config ─────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<MatchStatus, { label: string; pillClass: string }> = {
  waiting:     { label: "Waiting",   pillClass: "bg-arena-gold/20 text-arena-gold border-arena-gold/40" },
  in_progress: { label: "Live",      pillClass: "bg-arena-cyan/20 text-arena-cyan border-arena-cyan/40" },
  completed:   { label: "Completed", pillClass: "bg-muted text-muted-foreground border-border" },
  cancelled:   { label: "Cancelled", pillClass: "bg-destructive/20 text-destructive border-destructive/40" },
  disputed:    { label: "Disputed",  pillClass: "bg-arena-orange/20 text-arena-orange border-arena-orange/40" },
};

// ── Dropdown component ────────────────────────────────────────────────────
interface GameDropdownProps {
  label: string;
  icon: React.ReactNode;
  games: Record<string, { logo: string; color: string; comingSoon?: boolean }>;
  activeGame: Game | "all";
  onSelect: (game: Game | "all") => void;
  comingSoon?: boolean;
}

const GameDropdown = ({ label, icon, games, activeGame, onSelect, comingSoon }: GameDropdownProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasActive = !comingSoon && Object.keys(games).some((g) => g === activeGame && !games[g].comingSoon);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
          hasActive
            ? "bg-primary/20 border-primary/50 text-primary"
            : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
        }`}
      >
        {icon}
        {label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 z-50 min-w-[180px] rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          {comingSoon ? (
            <div className="px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Coming Soon</p>
              {Object.entries(games).map(([name, cfg]) => (
                <div key={name} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg opacity-40 cursor-not-allowed">
                  <img
                    src={cfg.logo}
                    alt={name}
                    className="rounded object-cover"
                    style={{ width: 20, height: 20 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="text-xs">{name}</span>
                  <span className="ml-auto text-[9px] bg-secondary px-1.5 py-0.5 rounded-full text-muted-foreground">Soon</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1">
              {Object.entries(games).map(([name, cfg]) => {
                const isActive = activeGame === name;
                // Per-game Coming Soon — DB-ready: flip cfg.comingSoon when games.enabled=true
                if (cfg.comingSoon) return (
                  <div key={name} className="flex items-center gap-2.5 px-3 py-2 text-xs opacity-40 cursor-not-allowed">
                    <img src={cfg.logo} alt={name} className="rounded object-cover grayscale"
                      style={{ width: 20, height: 20 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="font-medium text-muted-foreground">{name}</span>
                    <span className="ml-auto text-[8px] bg-secondary px-1 py-0.5 rounded text-muted-foreground font-bold">SOON</span>
                  </div>
                );
                return (
                  <button
                    key={name}
                    onClick={() => { onSelect(name as Game); setOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-all ${
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                  >
                    <img
                      src={cfg.logo}
                      alt={name}
                      className="rounded object-cover"
                      style={{ width: 20, height: 20 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <span className="font-medium">{name}</span>
                    {isActive && <span className="ml-auto text-[9px] bg-primary/20 px-1.5 py-0.5 rounded-full">Active</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
const History = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { matches } = useMatchStore();
  const [timeRange,    setTimeRange]    = useState<TimeRange>("alltime");
  const [search,       setSearch]       = useState("");
  const [gameFilter,   setGameFilter]   = useState<Game | "all">((searchParams.get("game") as Game) ?? "all");
  const [statusFilter, setStatusFilter] = useState<MatchStatus | "all">("all");
  const [page,         setPage]         = useState(1);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const MY_ID = "user-001";

  // ── Only user's matches, no waiting ───────────────────────────────────
  const userMatches = matches.filter((m) => {
    if (m.status === "waiting") return false;
    return (
      m.players.includes(MY_ID) ||
      m.hostId === MY_ID ||
      (m.teamA ?? []).includes(MY_ID) ||
      (m.teamB ?? []).includes(MY_ID)
    );
  });

  // ── Time-range scoped matches (used for stats + further filtering) ─────
  // DB-ready: when connected, the server filters by date range server-side
  // and returns only the relevant matches via GET /api/matches/history?range={timeRange}
  const rangedMatches = userMatches.filter((m) =>
    filterByTimeRange(m.endedAt ?? m.createdAt, timeRange)
  );

  // ── Quick stats (scoped to selected time range) ────────────────────────
  const completedMatches = rangedMatches.filter((m) => m.status === "completed");
  const wins = completedMatches.filter((m) => m.winnerId === MY_ID).length;
  const losses = completedMatches.filter((m) => m.winnerId && m.winnerId !== MY_ID).length;
  const totalEarned = completedMatches
    .filter((m) => m.winnerId === MY_ID)
    .reduce((sum, m) => sum + m.betAmount, 0);
  const winRate = completedMatches.length > 0 ? Math.round((wins / completedMatches.length) * 100) : 0;
  const last10 = completedMatches.slice(-10).map((m) => m.winnerId === MY_ID);

  // ── Search / game / status filters applied on top of time range ────────
  const filtered = rangedMatches.filter((m) => {
    const matchSearch =
      m.host.toLowerCase().includes(search.toLowerCase()) ||
      m.game.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase());
    const matchGame   = gameFilter   === "all" || m.game   === gameFilter;
    const matchStatus = statusFilter === "all" || m.status === statusFilter;
    return matchSearch && matchGame && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const countForStatus = (s: MatchStatus | "all") =>
    s === "all" ? rangedMatches.length : rangedMatches.filter((m) => m.status === s).length;

  // No "waiting" in history status filters
  const STATUSES: (MatchStatus | "all")[] = ["all", "in_progress", "completed", "cancelled", "disputed"];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold tracking-wide">Match History</h1>
        {/* Time range — DB-ready: triggers GET /api/matches/history?range={timeRange} */}
        <div className="flex gap-1.5">
          {TIME_RANGES.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant={timeRange === value ? "default" : "outline"}
              onClick={() => { setTimeRange(value); setPage(1); }}
              className="font-display text-xs h-7 px-3"
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Quick Stats Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
            <Trophy className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Wins</p>
            <p className="font-display text-xl font-bold text-primary">{wins}</p>
          </div>
        </div>
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-destructive/20 flex items-center justify-center">
            <Shield className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Losses</p>
            <p className="font-display text-xl font-bold text-destructive">{losses}</p>
          </div>
        </div>
        <div className="rounded-xl border border-arena-gold/20 bg-arena-gold/5 p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-arena-gold/20 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-arena-gold" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
            <p className="font-display text-xl font-bold text-arena-gold">{winRate}%</p>
          </div>
        </div>
        <div className="rounded-xl border border-arena-cyan/20 bg-arena-cyan/5 p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-arena-cyan/20 flex items-center justify-center">
            <DollarSign className="h-4 w-4 text-arena-cyan" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Earned</p>
            <p className="font-display text-xl font-bold text-arena-cyan">${totalEarned}</p>
          </div>
        </div>
      </div>

      {/* ── Last 10 results ── */}
      {last10.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">Last {last10.length}</span>
          <div className="flex gap-1">
            {last10.map((win, i) => (
              <div
                key={i}
                title={win ? "Win" : "Loss"}
                className={`h-5 w-4 rounded-sm font-display text-[9px] flex items-center justify-center font-bold ${
                  win
                    ? "bg-primary/30 text-primary border border-primary/40"
                    : "bg-destructive/30 text-destructive border border-destructive/40"
                }`}
              >
                {win ? "W" : "L"}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Search + Game Filter ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by opponent, game, or match ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 bg-secondary border-border"
          />
        </div>

        {/* Game filter: All Games + PC dropdown + Mobile dropdown */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* All Games */}
          <button
            onClick={() => { setGameFilter("all"); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              gameFilter === "all"
                ? "bg-primary/20 border-primary/50 text-primary"
                : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Gamepad2 className="h-3.5 w-3.5" />
            All Games
          </button>

          {/* PC Games dropdown */}
          <GameDropdown
            label="PC"
            icon={<Monitor className="h-3.5 w-3.5" />}
            games={PC_GAME_CONFIG}
            activeGame={gameFilter}
            onSelect={(g) => { setGameFilter(g); setPage(1); }}
          />

          {/* Mobile Games dropdown */}
          <GameDropdown
            label="Mobile"
            icon={<Smartphone className="h-3.5 w-3.5" />}
            games={MOBILE_GAME_CONFIG}
            activeGame={gameFilter}
            onSelect={(g) => { setGameFilter(g); setPage(1); }}
            comingSoon
          />
        </div>
      </div>

      {/* ── Status Pill Filters ── */}
      <div className="flex gap-1.5 flex-wrap">
        {STATUSES.map((s) => {
          const count = countForStatus(s);
          const active = statusFilter === s;
          const cfg = s !== "all" ? STATUS_CONFIG[s] : null;
          return (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                active
                  ? cfg
                    ? cfg.pillClass
                    : "bg-primary/20 border-primary/50 text-primary"
                  : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : cfg?.label}
              <span className={`text-[10px] px-1 rounded-full ${active ? "bg-white/10" : "bg-secondary"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Results ── */}
      {paged.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-display text-lg">No matches found</p>
            <p className="text-sm opacity-60 mb-4">
              {search || gameFilter !== "all" || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "You haven't played any matches yet"}
            </p>
            <Button onClick={() => navigate("/lobby")} className="glow-green font-display">
              <Swords className="mr-2 h-4 w-4" /> Find a Match
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {paged.map((m) => {
            const isWin  = m.status === "completed" && m.winnerId === MY_ID;
            const isLoss = m.status === "completed" && !!m.winnerId && m.winnerId !== MY_ID;
            const isLive = m.status === "in_progress";
            const isExpanded = expandedMatchId === m.id;
            const maxPerTeam = m.maxPerTeam ?? Math.max(1, Math.ceil(m.maxPlayers / 2));
            const teamA = m.teamA ?? m.players.slice(0, maxPerTeam);
            const teamB = m.teamB ?? m.players.slice(maxPerTeam, maxPerTeam * 2);
            const statusCfg = STATUS_CONFIG[m.status];
            const gameCfg = ALL_GAME_CONFIG[m.game];

            const borderColor = isWin
              ? "border-l-primary"
              : isLoss
              ? "border-l-destructive"
              : isLive
              ? "border-l-arena-cyan"
              : "border-l-border";

            return (
              <Card
                key={m.id}
                className={`bg-card border-border border-l-4 ${borderColor} cursor-pointer arena-hover overflow-hidden`}
                onClick={() => setExpandedMatchId((prev) => (prev === m.id ? null : m.id))}
              >
                {isLive && (
                  <div className="h-0.5 w-full bg-gradient-to-r from-arena-cyan/0 via-arena-cyan to-arena-cyan/0 animate-pulse" />
                )}

                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">
                        <GameLogo game={m.game} size={36} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isWin && (
                            <span className="text-[10px] font-display font-bold px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                              WIN
                            </span>
                          )}
                          {isLoss && (
                            <span className="text-[10px] font-display font-bold px-1.5 py-0.5 rounded bg-destructive/20 text-destructive border border-destructive/30">
                              LOSS
                            </span>
                          )}
                          {isLive && (
                            <span className="text-[10px] font-display font-bold px-1.5 py-0.5 rounded bg-arena-cyan/20 text-arena-cyan border border-arena-cyan/30 animate-pulse">
                              LIVE
                            </span>
                          )}
                          {!isWin && !isLoss && !isLive && (
                            <Badge variant="outline" className={`text-[10px] ${statusCfg.pillClass}`}>
                              {statusCfg.label}
                            </Badge>
                          )}
                          <p className="font-medium text-sm truncate">
                            {m.type === "custom" ? `${m.host}'s Custom` : `YOU vs ${m.host}`}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="font-medium" style={{ color: gameCfg?.color ?? "inherit" }}>
                            {m.game}
                          </span>
                          <span className="text-border">•</span>
                          {m.mode}
                          {m.code && (
                            <>
                              <span className="text-border">•</span>
                              <span className="font-mono text-arena-cyan">{m.code}</span>
                            </>
                          )}
                          {(m.endedAt ?? m.createdAt) && (
                            <>
                              <span className="text-border">•</span>
                              <span className="font-mono text-[10px] text-muted-foreground/70">
                                {fmtDate(m.endedAt ?? m.createdAt)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="text-right flex items-center gap-2 shrink-0">
                      <div>
                        <p className={`font-display text-lg font-bold ${isWin ? "text-primary" : isLoss ? "text-destructive" : "text-arena-gold"}`}>
                          ${m.betAmount}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">{m.id.slice(0, 8)}</p>
                      </div>
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      }
                    </div>
                  </div>

                  {/* ── Battle Report ── */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-4">
                      <div className={`rounded-lg p-3 flex items-center justify-between ${
                        isWin  ? "bg-primary/10 border border-primary/20"
                        : isLoss ? "bg-destructive/10 border border-destructive/20"
                        : "bg-secondary/30 border border-border"
                      }`}>
                        <div className="flex items-center gap-2">
                          <Trophy className={`h-4 w-4 ${isWin ? "text-primary" : isLoss ? "text-destructive" : "text-arena-gold"}`} />
                          <span className="text-sm font-display font-bold">
                            {isWin ? "Victory" : isLoss ? "Defeat" : m.status === "in_progress" ? "In Progress" : m.status.replace("_", " ")}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.players.length}/{m.maxPlayers} players · {m.mode}
                        </div>
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <p className="text-[10px] text-primary uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Users className="h-3 w-3" /> Team A ({teamA.length}/{maxPerTeam})
                          </p>
                          <div className="space-y-1.5">
                            {teamA.map((player, i) => (
                              <div key={`${m.id}-a-${player}-${i}`} className="flex items-center gap-2">
                                <PlayerInitial name={player} isYou={player === MY_ID} />
                                <span className="text-xs truncate">{player === MY_ID ? "You" : player}</span>
                              </div>
                            ))}
                            {Array.from({ length: maxPerTeam - teamA.length }).map((_, i) => (
                              <p key={`${m.id}-a-empty-${i}`} className="text-xs text-muted-foreground/40 italic pl-1">Empty slot</p>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-center gap-1 pt-4">
                          <Swords className="h-5 w-5 text-muted-foreground/50" />
                          <span className="font-display text-[10px] text-muted-foreground/50 uppercase tracking-widest">vs</span>
                        </div>

                        <div className="rounded-lg border border-arena-orange/20 bg-arena-orange/5 p-3">
                          <p className="text-[10px] text-arena-orange uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Users className="h-3 w-3" /> Team B ({teamB.length}/{maxPerTeam})
                          </p>
                          <div className="space-y-1.5">
                            {teamB.map((player, i) => (
                              <div key={`${m.id}-b-${player}-${i}`} className="flex items-center gap-2">
                                <PlayerInitial name={player} isYou={player === MY_ID} />
                                <span className="text-xs truncate">{player === MY_ID ? "You" : player}</span>
                              </div>
                            ))}
                            {Array.from({ length: maxPerTeam - teamB.length }).map((_, i) => (
                              <p key={`${m.id}-b-empty-${i}`} className="text-xs text-muted-foreground/40 italic pl-1">Empty slot</p>
                            ))}
                          </div>
                        </div>
                      </div>

                      {m.status === "completed" && m.winnerId && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Trophy className="h-3 w-3 text-arena-gold" />
                          <span>Winner:</span>
                          <span className="text-foreground font-medium">{m.winnerId === MY_ID ? "You" : m.winnerId}</span>
                          <span>·</span>
                          <span className="text-arena-gold font-medium">+${m.betAmount}</span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Numbered Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-xs font-display font-bold transition-all ${
                page === p
                  ? "bg-primary/20 border border-primary/50 text-primary"
                  : "bg-secondary/50 border border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default History;
