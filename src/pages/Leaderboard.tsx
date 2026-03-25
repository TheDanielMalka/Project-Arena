import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Flame, Crown, ChevronUp, ChevronDown, Minus, Zap, TrendingUp } from "lucide-react";

interface LeaderboardEntry {
  rank: number;
  username: string;
  wins: number;
  losses: number;
  winRate: number;
  earnings: number;
  streak: number;
  change: "up" | "down" | "same";
  game: string;
  avatar?: string; // "initials" | emoji | "upload:{dataURL}" | CDN URL
}

const mockLeaderboard: LeaderboardEntry[] = [
  { rank: 1, username: "ShadowKing",  wins: 142, losses: 28, winRate: 83.5, earnings: 4250, streak: 12, change: "same", game: "CS2" },
  { rank: 2, username: "NeonViper",   wins: 128, losses: 35, winRate: 78.5, earnings: 3800, streak: 7,  change: "up",   game: "CS2" },
  { rank: 3, username: "PixelStorm",  wins: 115, losses: 40, winRate: 74.2, earnings: 3200, streak: 4,  change: "up",   game: "Valorant" },
  { rank: 4, username: "BlazeFury",   wins: 110, losses: 42, winRate: 72.4, earnings: 2900, streak: 2,  change: "down", game: "CS2" },
  { rank: 5, username: "AceHunter",   wins: 105, losses: 45, winRate: 70.0, earnings: 2750, streak: 5,  change: "up",   game: "Valorant" },
  { rank: 6, username: "GhostRider",  wins: 98,  losses: 50, winRate: 66.2, earnings: 2400, streak: 1,  change: "down", game: "CS2" },
  { rank: 7, username: "IronWolf",    wins: 95,  losses: 48, winRate: 66.4, earnings: 2200, streak: 3,  change: "same", game: "Fortnite" },
  { rank: 8, username: "CyberNinja",  wins: 90,  losses: 55, winRate: 62.1, earnings: 1900, streak: 0,  change: "down", game: "Apex Legends" },
  { rank: 9, username: "VoltEdge",    wins: 88,  losses: 52, winRate: 62.9, earnings: 1800, streak: 2,  change: "up",   game: "CS2" },
  { rank: 10, username: "ThunderBolt",wins: 85,  losses: 58, winRate: 59.4, earnings: 1650, streak: 1,  change: "same", game: "Valorant" },
];

const maxEarnings = Math.max(...mockLeaderboard.map(p => p.earnings));

const podiumConfig = {
  1: { glow: "shadow-[0_0_28px_hsl(43_96%_56%/0.35)]", border: "border-arena-gold/60",        bg: "bg-arena-gold/5",    label: "text-arena-gold",        mt: "mt-0" },
  2: { glow: "shadow-[0_0_16px_hsl(220_9%_70%/0.2)]",  border: "border-muted-foreground/40",  bg: "bg-secondary/40",    label: "text-muted-foreground",  mt: "mt-5" },
  3: { glow: "shadow-[0_0_16px_hsl(25_95%_53%/0.2)]",  border: "border-arena-orange/40",      bg: "bg-arena-orange/5",  label: "text-arena-orange",      mt: "mt-9" },
} as const;

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

const gameColor: Record<string, string> = {
  "CS2": "#F97316", "Valorant": "#EF4444", "Fortnite": "#38BDF8",
  "Apex Legends": "#6366F1", "PUBG": "#F59E0B",
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

const Leaderboard = () => {
  const [timeRange, setTimeRange] = useState<"weekly" | "monthly" | "alltime">("weekly");
  const [selectedTopPlayer, setSelectedTopPlayer] = useState<LeaderboardEntry>(mockLeaderboard[0]);
  const [expandedRowPlayer, setExpandedRowPlayer] = useState<string | null>(null);

  const matchesPlayed = selectedTopPlayer.wins + selectedTopPlayer.losses;
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
          return (
            <div
              key={player.username}
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
                {/* Crown above avatar for #1 */}
                {podiumRank === 1 && <Crown className="h-4 w-4 text-arena-gold" />}

                {/* Avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-display text-sm font-bold overflow-hidden ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}>
                  {player.avatar && player.avatar !== "initials"
                    ? player.avatar.startsWith("upload:")
                      ? <img src={player.avatar.slice(7)} className="w-full h-full object-cover" alt={player.username} />
                      : <span className="text-lg">{player.avatar}</span>
                    : player.username.slice(0, 2)
                  }
                </div>

                <p className="font-display font-bold text-sm leading-tight">{player.username}</p>
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
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="bg-secondary border border-border h-8">
          {["all", "CS2", "Valorant"].map((tab) => (
            <TabsTrigger key={tab} value={tab}
              className="font-display text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary h-6 px-3">
              {tab === "all" ? "All Games" : tab}
            </TabsTrigger>
          ))}
        </TabsList>

        {["all", "CS2", "Valorant"].map((tab) => (
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
                {mockLeaderboard
                  .filter((p) => tab === "all" || p.game === tab)
                  .map((player) => {
                    const isExpanded = expandedRowPlayer === player.username;
                    const col = gameColor[player.game] ?? "#888";
                    return (
                      <div key={player.rank}>
                        {/* ── Row ── */}
                        <div
                          className={`relative grid grid-cols-[3rem_1fr_4.5rem_4.5rem_6rem_6rem_3rem] gap-2 px-4 py-2.5 items-center cursor-pointer transition-all duration-150 ${rankBorder(player.rank)} ${
                            isExpanded ? "bg-primary/8" : "hover:bg-secondary/20"
                          }`}
                          onClick={() => setExpandedRowPlayer(isExpanded ? null : player.username)}
                        >
                          {/* WR heatmap fill behind the row */}
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
                          <div className="relative flex items-center">
                            {player.rank === 1 ? <Crown className="h-4 w-4 text-arena-gold" /> :
                             player.rank === 2 ? <span className="font-mono text-xs font-bold text-muted-foreground/70">02</span> :
                             player.rank === 3 ? <span className="font-mono text-xs font-bold text-arena-orange/70">03</span> :
                             <span className="font-mono text-xs text-muted-foreground/50">{String(player.rank).padStart(2,"0")}</span>}
                          </div>

                          {/* Player */}
                          <div className="relative flex items-center gap-2.5 min-w-0">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-display font-bold shrink-0 overflow-hidden ${avatarBg(player.username)} ${avatarRing(player.winRate)}`}>
                              {player.avatar && player.avatar !== "initials"
                                ? player.avatar.startsWith("upload:")
                                  ? <img src={player.avatar.slice(7)} className="w-full h-full object-cover" alt={player.username} />
                                  : <span className="text-sm">{player.avatar}</span>
                                : player.username.slice(0, 2)
                              }
                            </div>
                            <div className="min-w-0">
                              <p className="font-display text-sm font-semibold truncate leading-tight">{player.username}</p>
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
                              <div className="h-full bg-arena-gold/50 rounded-full" style={{ width: `${(player.earnings / maxEarnings) * 100}%` }} />
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
        ))}
      </Tabs>
    </div>
  );
};

export default Leaderboard;
