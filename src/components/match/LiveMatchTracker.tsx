import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, Clock, Gamepad2, Users, Zap } from "lucide-react";
import { useMatchStore } from "@/stores/matchStore";
import type { Match } from "@/types";

const LiveMatchTracker = () => {
  const { matches } = useMatchStore();
  const liveMatches = matches.filter((m) => m.status === "in_progress");
  const [now, setNow] = useState(Date.now());

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
        <Card key={match.id} className="bg-card border-arena-cyan/20 hover:border-arena-cyan/40 transition-colors">
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default LiveMatchTracker;
