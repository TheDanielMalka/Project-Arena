import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Medal, TrendingUp, Flame, Crown, Star, ChevronUp, ChevronDown, Minus } from "lucide-react";

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
}

const mockLeaderboard: LeaderboardEntry[] = [
  { rank: 1, username: "ShadowKing", wins: 142, losses: 28, winRate: 83.5, earnings: 4250, streak: 12, change: "same", game: "CS2" },
  { rank: 2, username: "NeonViper", wins: 128, losses: 35, winRate: 78.5, earnings: 3800, streak: 7, change: "up", game: "CS2" },
  { rank: 3, username: "PixelStorm", wins: 115, losses: 40, winRate: 74.2, earnings: 3200, streak: 4, change: "up", game: "Valorant" },
  { rank: 4, username: "BlazeFury", wins: 110, losses: 42, winRate: 72.4, earnings: 2900, streak: 2, change: "down", game: "CS2" },
  { rank: 5, username: "AceHunter", wins: 105, losses: 45, winRate: 70.0, earnings: 2750, streak: 5, change: "up", game: "Valorant" },
  { rank: 6, username: "GhostRider", wins: 98, losses: 50, winRate: 66.2, earnings: 2400, streak: 1, change: "down", game: "CS2" },
  { rank: 7, username: "IronWolf", wins: 95, losses: 48, winRate: 66.4, earnings: 2200, streak: 3, change: "same", game: "Fortnite" },
  { rank: 8, username: "CyberNinja", wins: 90, losses: 55, winRate: 62.1, earnings: 1900, streak: 0, change: "down", game: "Apex Legends" },
  { rank: 9, username: "VoltEdge", wins: 88, losses: 52, winRate: 62.9, earnings: 1800, streak: 2, change: "up", game: "CS2" },
  { rank: 10, username: "ThunderBolt", wins: 85, losses: 58, winRate: 59.4, earnings: 1650, streak: 1, change: "same", game: "Valorant" },
];

const getRankIcon = (rank: number) => {
  if (rank === 1) return <Crown className="h-5 w-5 text-arena-gold" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-muted-foreground" />;
  if (rank === 3) return <Medal className="h-5 w-5 text-arena-orange" />;
  return <span className="text-sm font-mono text-muted-foreground w-5 text-center">{rank}</span>;
};

const getChangeIcon = (change: "up" | "down" | "same") => {
  if (change === "up") return <ChevronUp className="h-4 w-4 text-primary" />;
  if (change === "down") return <ChevronDown className="h-4 w-4 text-destructive" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
};

const Leaderboard = () => {
  const [timeRange, setTimeRange] = useState<"weekly" | "monthly" | "alltime">("weekly");
  const [selectedTopPlayer, setSelectedTopPlayer] = useState<LeaderboardEntry>(mockLeaderboard[0]);
  const [expandedRowPlayer, setExpandedRowPlayer] = useState<string | null>(null);

  const matchesPlayed = selectedTopPlayer.wins + selectedTopPlayer.losses;
  const avgEarningsPerMatch = matchesPlayed > 0 ? selectedTopPlayer.earnings / matchesPlayed : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
            <Trophy className="h-8 w-8 text-arena-gold" /> Leaderboard
          </h1>
          <p className="text-muted-foreground mt-1">Top players ranked by performance</p>
        </div>
        <div className="flex gap-2">
          {(["weekly", "monthly", "alltime"] as const).map((range) => (
            <Button
              key={range}
              size="sm"
              variant={timeRange === range ? "default" : "outline"}
              onClick={() => setTimeRange(range)}
              className="font-display capitalize"
            >
              {range === "alltime" ? "All Time" : range}
            </Button>
          ))}
        </div>
      </div>

      {/* Top 3 Podium */}
      <div className="grid grid-cols-3 gap-4">
        {[mockLeaderboard[1], mockLeaderboard[0], mockLeaderboard[2]].map((player, idx) => {
          const podiumOrder = [2, 1, 3];
          const heights = ["h-28", "h-36", "h-24"];
          const glows = ["", "glow-green", ""];
          const borders = ["border-muted-foreground/30", "border-arena-gold/50", "border-arena-orange/30"];
          return (
            <Card
              key={player.username}
              className={`bg-card ${borders[idx]} ${glows[idx]} text-center cursor-pointer transition-all hover:-translate-y-0.5 ${
                selectedTopPlayer.username === player.username ? "ring-1 ring-primary/40" : ""
              }`}
              onClick={() => setSelectedTopPlayer(player)}
            >
              <CardContent className="pt-6 pb-4 flex flex-col items-center">
                <div className={`${heights[idx]} flex items-end justify-center mb-3`}>
                  <div className="text-center">
                    {podiumOrder[idx] === 1 && <Crown className="h-8 w-8 text-arena-gold mx-auto mb-2" />}
                    <div className="w-14 h-14 rounded-full bg-secondary border-2 border-border flex items-center justify-center font-display text-xl font-bold">
                      {player.username.slice(0, 2)}
                    </div>
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{player.username}</p>
                <p className="text-arena-gold font-display text-xl font-bold">${player.earnings}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                    {player.winRate}% WR
                  </Badge>
                  {player.streak > 0 && (
                    <Badge variant="outline" className="text-xs border-arena-orange/30 text-arena-orange gap-1">
                      <Flame className="h-3 w-3" /> {player.streak}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Selected Player Quick View */}
      <Card className="bg-card border-primary/25">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Star className="h-5 w-5 text-arena-gold" />
            {selectedTopPlayer.username} - Quick Stats (Top 3)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Matches</p>
              <p className="font-display text-xl font-bold">{matchesPlayed}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Wins</p>
              <p className="font-display text-xl font-bold text-primary">{selectedTopPlayer.wins}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Losses</p>
              <p className="font-display text-xl font-bold text-destructive">{selectedTopPlayer.losses}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Win Rate</p>
              <p className="font-display text-xl font-bold">{selectedTopPlayer.winRate}%</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg $ / Match</p>
              <p className="font-display text-xl font-bold text-arena-gold">
                ${avgEarningsPerMatch.toFixed(2)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span>
              Current streak: <span className="text-foreground font-medium">{selectedTopPlayer.streak}</span> • Game:{" "}
              <span className="text-foreground font-medium">{selectedTopPlayer.game}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Full Leaderboard Table */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="all" className="font-display data-[state=active]:bg-primary/20 data-[state=active]:text-primary">All Games</TabsTrigger>
          <TabsTrigger value="CS2" className="font-display data-[state=active]:bg-primary/20 data-[state=active]:text-primary">CS2</TabsTrigger>
          <TabsTrigger value="Valorant" className="font-display data-[state=active]:bg-primary/20 data-[state=active]:text-primary">Valorant</TabsTrigger>
        </TabsList>

        {["all", "CS2", "Valorant"].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <Card className="bg-card border-border">
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {/* Header */}
                  <div className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem_4rem] gap-2 px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-display">
                    <span>#</span><span>Player</span><span className="text-right">W</span><span className="text-right">L</span><span className="text-right">WR%</span><span className="text-right">Earned</span><span className="text-center">Δ</span>
                  </div>
                  {mockLeaderboard
                    .filter((p) => tab === "all" || p.game === tab)
                    .map((player) => (
                      <div key={player.rank}>
                        <div
                          className={`grid grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem_4rem] gap-2 px-4 py-3 items-center transition-colors cursor-pointer ${
                            expandedRowPlayer === player.username
                              ? "bg-primary/10 border-l-2 border-primary"
                              : "hover:bg-secondary/30"
                          }`}
                          onClick={() =>
                            setExpandedRowPlayer((prev) => (prev === player.username ? null : player.username))
                          }
                        >
                          <div className="flex items-center">{getRankIcon(player.rank)}</div>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-xs font-display font-bold">
                              {player.username.slice(0, 2)}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{player.username}</p>
                              <p className="text-xs text-muted-foreground">{player.game}</p>
                            </div>
                          </div>
                          <span className="text-right text-sm text-primary font-mono">{player.wins}</span>
                          <span className="text-right text-sm text-destructive font-mono">{player.losses}</span>
                          <span className="text-right text-sm font-mono">{player.winRate}%</span>
                          <span className="text-right text-sm font-display font-bold text-arena-gold">${player.earnings}</span>
                          <div className="flex justify-center">{getChangeIcon(player.change)}</div>
                        </div>

                        {expandedRowPlayer === player.username && (
                          <div className="px-4 py-3 bg-secondary/20 border-l-2 border-primary">
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                              <div className="rounded-md border border-border bg-background/50 p-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Matches</p>
                                <p className="font-display text-sm font-bold">{player.wins + player.losses}</p>
                              </div>
                              <div className="rounded-md border border-border bg-background/50 p-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Wins</p>
                                <p className="font-display text-sm font-bold text-primary">{player.wins}</p>
                              </div>
                              <div className="rounded-md border border-border bg-background/50 p-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Losses</p>
                                <p className="font-display text-sm font-bold text-destructive">{player.losses}</p>
                              </div>
                              <div className="rounded-md border border-border bg-background/50 p-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
                                <p className="font-display text-sm font-bold">{player.winRate}%</p>
                              </div>
                              <div className="rounded-md border border-border bg-background/50 p-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Streak</p>
                                <p className="font-display text-sm font-bold">{player.streak}</p>
                              </div>
                              <div className="rounded-md border border-border bg-background/50 p-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg $ / Match</p>
                                <p className="font-display text-sm font-bold text-arena-gold">
                                  ${(player.earnings / Math.max(player.wins + player.losses, 1)).toFixed(2)}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default Leaderboard;
