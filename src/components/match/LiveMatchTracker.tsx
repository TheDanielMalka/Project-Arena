import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, Clock, Gamepad2, Users, Zap, ChevronDown, ChevronUp, Hash, Shield } from "lucide-react";
import { useMatchStore } from "@/stores/matchStore";
import type { Match } from "@/types";

const LiveMatchTracker = () => {
  const { matches } = useMatchStore();
  const liveMatches = matches.filter((m) => m.status === "in_progress");
  const [now, setNow] = useState(Date.now());
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getElapsed = (match: Match) => {
    if (!match.startedAt) return "00:00";
    const diff = Math.floor((now - new Date(match.startedAt).getTime()) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, "0");
    const secs = (diff % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const getMapForMatch = (match: Match) => {
    const mapPools: Record<string, string[]> = {
      CS2: ["Mirage", "Inferno", "Nuke", "Ancient", "Anubis"],
      Valorant: ["Ascent", "Haven", "Bind", "Split", "Lotus"],
      Fortnite: ["Olympus", "Classy Courts", "Pleasant Piazza"],
      "Apex Legends": ["World's Edge", "Storm Point", "Olympus"],
    };
    const pool = mapPools[match.game] ?? ["Arena Core"];
    const seed = match.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return pool[seed % pool.length];
  };

  const getEstimatedPrize = (match: Match) => {
    return match.betAmount * Math.max(match.maxPlayers, 2);
  };

  if (liveMatches.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8 text-center">
          <Radio className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-pulse" />
          <p className="text-muted-foreground font-display">No live matches right now</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Active matches will appear here in real-time</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-destructive animate-pulse" />
        <span className="font-display text-sm font-semibold uppercase tracking-wider text-destructive">
          Live — {liveMatches.length} match{liveMatches.length > 1 ? "es" : ""}
        </span>
      </div>

      {liveMatches.map((match) => (
        <Card
          key={match.id}
          className={`bg-card border-arena-cyan/20 transition-colors cursor-pointer ${
            expandedMatchId === match.id ? "border-arena-cyan/50" : "hover:border-arena-cyan/40"
          }`}
          onClick={() => setExpandedMatchId((prev) => (prev === match.id ? null : match.id))}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                <div>
                  <p className="font-display font-semibold">{match.host}'s Match</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Gamepad2 className="h-3 w-3" /> {match.game}
                    <span>•</span>
                    <Users className="h-3 w-3" /> {match.players.length}/{match.maxPlayers}
                    <span>•</span>
                    {match.mode}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 text-arena-cyan font-mono text-lg">
                  <Clock className="h-4 w-4" />
                  {getElapsed(match)}
                </div>
                <Badge variant="outline" className="text-xs border-arena-gold/30 text-arena-gold mt-1">
                  <Zap className="h-3 w-3 mr-1" /> ${match.betAmount}
                </Badge>
                <div className="flex justify-end mt-2 text-muted-foreground">
                  {expandedMatchId === match.id ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </div>
              </div>
            </div>

            {/* Player bars */}
            {match.mode === "1v1" && match.players.length === 2 && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs font-display font-medium text-primary">{match.players[0]}</span>
                <div className="flex-1 h-1 rounded bg-secondary overflow-hidden">
                  <div className="h-full w-1/2 bg-gradient-to-r from-primary to-arena-cyan animate-pulse-glow" />
                </div>
                <span className="text-xs font-display font-medium text-arena-orange">{match.players[1]}</span>
              </div>
            )}

            {expandedMatchId === match.id && (
              <div className="mt-4 rounded-lg border border-border bg-secondary/20 p-3 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-md bg-background/60 p-2">
                    <p className="text-muted-foreground">Map</p>
                    <p className="font-medium">{getMapForMatch(match)}</p>
                  </div>
                  <div className="rounded-md bg-background/60 p-2">
                    <p className="text-muted-foreground">Match ID</p>
                    <p className="font-mono flex items-center gap-1">
                      <Hash className="h-3 w-3" />
                      {match.id}
                    </p>
                  </div>
                  <div className="rounded-md bg-background/60 p-2">
                    <p className="text-muted-foreground">Type</p>
                    <p className="font-medium capitalize">{match.type} • {match.mode}</p>
                  </div>
                  <div className="rounded-md bg-background/60 p-2">
                    <p className="text-muted-foreground">Estimated Pot</p>
                    <p className="font-medium text-arena-gold">${getEstimatedPrize(match)}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-2">Players in lobby</p>
                  <div className="flex flex-wrap gap-2">
                    {match.players.length > 0 ? (
                      match.players.map((player) => (
                        <Badge key={`${match.id}-${player}`} variant="outline" className="gap-1">
                          <Shield className="h-3 w-3" />
                          {player}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No players listed yet</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default LiveMatchTracker;
