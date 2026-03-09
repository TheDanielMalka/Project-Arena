import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useMatchStore } from "@/stores/matchStore";
import { Swords, Inbox } from "lucide-react";

interface RecentMatchesProps {
  showViewAll?: boolean;
  limit?: number;
}

export function RecentMatches({ showViewAll = true, limit = 5 }: RecentMatchesProps) {
  const navigate = useNavigate();
  const { matches } = useMatchStore();

  // Show completed and in-progress matches as "recent"
  const recentMatches = matches
    .filter((m) => m.status === "completed" || m.status === "in_progress")
    .slice(0, limit);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-display text-lg">Recent Matches</CardTitle>
        {showViewAll && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-primary hover:text-primary/80"
            onClick={() => navigate("/history")}
          >
            View All →
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {recentMatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Inbox className="h-10 w-10 mb-3 opacity-30" />
            <p className="font-display text-sm">No matches yet</p>
            <p className="text-xs opacity-60 mb-3">Jump into your first match!</p>
            <Button size="sm" onClick={() => navigate("/lobby")} className="glow-green font-display">
              <Swords className="mr-2 h-4 w-4" /> Find Match
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {recentMatches.map((m) => {
              const isWin = m.status === "completed" && m.winnerId === "user-001";
              const isLoss = m.status === "completed" && m.winnerId && m.winnerId !== "user-001";
              const resultLabel = m.status === "in_progress" ? "Live" : isWin ? "Win" : isLoss ? "Loss" : "Draw";
              const resultVariant = resultLabel === "Win" ? "default" : resultLabel === "Loss" ? "destructive" : "secondary";

              return (
                <div key={m.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <Badge variant={resultVariant} className="text-xs w-12 justify-center">
                      {resultLabel}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm">vs {m.host}</p>
                      <p className="text-xs text-muted-foreground">{m.game}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${resultLabel === "Win" ? "text-primary" : resultLabel === "Loss" ? "text-destructive" : "text-arena-cyan"}`}>
                      {resultLabel === "Win" ? `+$${m.betAmount}` : resultLabel === "Loss" ? `-$${m.betAmount}` : `$${m.betAmount}`}
                    </p>
                    {m.timeLeft && <p className="text-xs text-arena-cyan animate-pulse-glow">{m.timeLeft}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
