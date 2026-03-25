import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMatchStore } from "@/stores/matchStore";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Swords, Inbox, Gamepad2, Users, Trophy,
  ChevronDown, ChevronUp, TrendingUp, DollarSign, Shield,
} from "lucide-react";
import type { Game, MatchStatus } from "@/types";

const ITEMS_PER_PAGE = 8;

// ── Game logo config (mirrors Profile.tsx) ────────────────────────────────
const gameConfig: Record<string, { logo: string; color: string }> = {
  CS2: {
    logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg",
    color: "#f0a500",
  },
  Valorant: {
    logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg",
    color: "#ff4655",
  },
  Fortnite: {
    logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1665460/capsule_sm_120.jpg",
    color: "#00d4ff",
  },
  "Apex Legends": {
    logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg",
    color: "#fc4b00",
  },
};

// ── Helper components ─────────────────────────────────────────────────────
const GameLogo = ({ game, size = 32 }: { game: string; size?: number }) => {
  const cfg = gameConfig[game];
  if (!cfg) return <Gamepad2 className="h-6 w-6 text-muted-foreground" />;
  return (
    <img
      src={cfg.logo}
      alt={game}
      width={size}
      height={size}
      className="rounded object-cover"
      style={{ width: size, height: size }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
};

const PlayerInitial = ({ name, isYou = false }: { name: string; isYou?: boolean }) => (
  <div
    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${
      isYou
        ? "border-primary/60 bg-primary/20 text-primary"
        : "border-border bg-secondary/40 text-muted-foreground"
    }`}
  >
    {name.slice(0, 2).toUpperCase()}
  </div>
);

// ── Status config ─────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<MatchStatus, { label: string; pillClass: string; borderClass: string }> = {
  waiting:     { label: "Waiting",     pillClass: "bg-arena-gold/20 text-arena-gold border-arena-gold/40",       borderClass: "border-l-arena-gold" },
  in_progress: { label: "Live",        pillClass: "bg-arena-cyan/20 text-arena-cyan border-arena-cyan/40",       borderClass: "border-l-arena-cyan" },
  completed:   { label: "Completed",   pillClass: "bg-muted text-muted-foreground border-border",                borderClass: "border-l-border" },
  cancelled:   { label: "Cancelled",   pillClass: "bg-destructive/20 text-destructive border-destructive/40",   borderClass: "border-l-destructive" },
  disputed:    { label: "Disputed",    pillClass: "bg-arena-orange/20 text-arena-orange border-arena-orange/40", borderClass: "border-l-arena-orange" },
};

// ─────────────────────────────────────────────────────────────────────────
const History = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { matches } = useMatchStore();
  const [search, setSearch] = useState("");
  const [gameFilter, setGameFilter] = useState<Game | "all">((searchParams.get("game") as Game) ?? "all");
  const [statusFilter, setStatusFilter] = useState<MatchStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  // ── Only matches the current user participated in, excluding lobbies ──
  const MY_ID = "user-001";
  const userMatches = matches.filter((m) => {
    if (m.status === "waiting") return false; // waiting = lobby, not history
    return (
      m.players.includes(MY_ID) ||
      m.hostId === MY_ID ||
      (m.teamA ?? []).includes(MY_ID) ||
      (m.teamB ?? []).includes(MY_ID)
    );
  });

  // ── Quick stats from user's matches ────────────────────────────────────
  const completedMatches = userMatches.filter((m) => m.status === "completed");
  const wins = completedMatches.filter((m) => m.winnerId === MY_ID).length;
  const losses = completedMatches.filter((m) => m.winnerId && m.winnerId !== MY_ID).length;
  const totalEarned = completedMatches
    .filter((m) => m.winnerId === MY_ID)
    .reduce((sum, m) => sum + m.betAmount, 0);
  const winRate = completedMatches.length > 0 ? Math.round((wins / completedMatches.length) * 100) : 0;
  const last10 = completedMatches.slice(-10).map((m) => m.winnerId === MY_ID);

  // ── Filter ─────────────────────────────────────────────────────────────
  const filtered = userMatches.filter((m) => {
    const matchSearch =
      m.host.toLowerCase().includes(search.toLowerCase()) ||
      m.game.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase());
    const matchGame = gameFilter === "all" || m.game === gameFilter;
    const matchStatus = statusFilter === "all" || m.status === statusFilter;
    return matchSearch && matchGame && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Count per status for pill badges (from user's matches only)
  const countForStatus = (s: MatchStatus | "all") =>
    s === "all" ? userMatches.length : userMatches.filter((m) => m.status === s).length;

  const GAMES: (Game | "all")[] = ["all", "CS2", "Valorant", "Fortnite", "Apex Legends"];
  // "waiting" is excluded — history only shows matches that have progressed past lobby
  const STATUSES: (MatchStatus | "all")[] = ["all", "in_progress", "completed", "cancelled", "disputed"];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">Match History</h1>
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
                  win ? "bg-primary/30 text-primary border border-primary/40" : "bg-destructive/30 text-destructive border border-destructive/40"
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
        <div className="flex gap-1.5 flex-wrap">
          {GAMES.map((g) => (
            <button
              key={g}
              onClick={() => { setGameFilter(g); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                gameFilter === g
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {g !== "all" && <GameLogo game={g} size={14} />}
              {g === "all" ? "All Games" : g}
            </button>
          ))}
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
            const isWin = m.status === "completed" && m.winnerId === MY_ID;
            const isLoss = m.status === "completed" && !!m.winnerId && m.winnerId !== MY_ID;
            const isLive = m.status === "in_progress";
            const isExpanded = expandedMatchId === m.id;
            const maxPerTeam = m.maxPerTeam ?? Math.max(1, Math.ceil(m.maxPlayers / 2));
            const teamA = m.teamA ?? m.players.slice(0, maxPerTeam);
            const teamB = m.teamB ?? m.players.slice(maxPerTeam, maxPerTeam * 2);
            const statusCfg = STATUS_CONFIG[m.status];
            const gameCfg = gameConfig[m.game];

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
                {/* Live pulse bar */}
                {isLive && (
                  <div className="h-0.5 w-full bg-gradient-to-r from-arena-cyan/0 via-arena-cyan to-arena-cyan/0 animate-pulse" />
                )}

                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    {/* Left: game logo + info */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">
                        <GameLogo game={m.game} size={36} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* W / L / LIVE badge */}
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
                          <span
                            className="font-medium"
                            style={{ color: gameCfg?.color ?? "inherit" }}
                          >
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
                        </p>
                      </div>
                    </div>

                    {/* Right: amount + chevron */}
                    <div className="text-right flex items-center gap-2 shrink-0">
                      <div>
                        <p
                          className={`font-display text-lg font-bold ${
                            isWin ? "text-primary" : isLoss ? "text-destructive" : "text-arena-gold"
                          }`}
                        >
                          ${m.betAmount}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">{m.id.slice(0, 8)}</p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* ── Battle Report (expanded) ── */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-4">
                      {/* Result banner */}
                      <div
                        className={`rounded-lg p-3 flex items-center justify-between ${
                          isWin
                            ? "bg-primary/10 border border-primary/20"
                            : isLoss
                            ? "bg-destructive/10 border border-destructive/20"
                            : "bg-secondary/30 border border-border"
                        }`}
                      >
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

                      {/* VS graphic + teams */}
                      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
                        {/* Team A */}
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <p className="text-[10px] text-primary uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Users className="h-3 w-3" /> Team A ({teamA.length}/{maxPerTeam})
                          </p>
                          <div className="space-y-1.5">
                            {teamA.map((player, i) => (
                              <div key={`${m.id}-a-${player}-${i}`} className="flex items-center gap-2">
                                <PlayerInitial name={player} isYou={player === "You" || player === "user-001"} />
                                <span className="text-xs truncate">{player}</span>
                              </div>
                            ))}
                            {Array.from({ length: maxPerTeam - teamA.length }).map((_, i) => (
                              <p key={`${m.id}-a-empty-${i}`} className="text-xs text-muted-foreground/40 italic pl-1">
                                Empty slot
                              </p>
                            ))}
                          </div>
                        </div>

                        {/* VS */}
                        <div className="flex flex-col items-center justify-center gap-1 pt-4">
                          <Swords className="h-5 w-5 text-muted-foreground/50" />
                          <span className="font-display text-[10px] text-muted-foreground/50 uppercase tracking-widest">vs</span>
                        </div>

                        {/* Team B */}
                        <div className="rounded-lg border border-arena-orange/20 bg-arena-orange/5 p-3">
                          <p className="text-[10px] text-arena-orange uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Users className="h-3 w-3" /> Team B ({teamB.length}/{maxPerTeam})
                          </p>
                          <div className="space-y-1.5">
                            {teamB.map((player, i) => (
                              <div key={`${m.id}-b-${player}-${i}`} className="flex items-center gap-2">
                                <PlayerInitial name={player} />
                                <span className="text-xs truncate">{player}</span>
                              </div>
                            ))}
                            {Array.from({ length: maxPerTeam - teamB.length }).map((_, i) => (
                              <p key={`${m.id}-b-empty-${i}`} className="text-xs text-muted-foreground/40 italic pl-1">
                                Empty slot
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Winner row */}
                      {m.status === "completed" && m.winnerId && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Trophy className="h-3 w-3 text-arena-gold" />
                          <span>Winner:</span>
                          <span className="text-foreground font-medium">{m.winnerId}</span>
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
