import { Card, CardContent } from "@/components/ui/card";
import { Trophy, TrendingUp, Target, Zap } from "lucide-react";
import { useUserStore } from "@/stores/userStore";

export function StatsCards() {
  const { user } = useUserStore();

  const stats = [
    { label: "Total Matches", value: user?.stats.matches?.toString() ?? "0", icon: Target, color: "text-arena-cyan" },
    { label: "Win Rate", value: `${user?.stats.winRate ?? 0}%`, icon: Trophy, color: "text-primary" },
    { label: "Total Earnings", value: `$${user?.stats.totalEarnings?.toLocaleString() ?? "0"}`, icon: TrendingUp, color: "text-arena-gold" },
    { label: "Win Streak", value: user?.stats.wins ? Math.min(user.stats.wins, 7).toString() : "0", icon: Zap, color: "text-arena-orange" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </div>
            <p className="font-display text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-muted-foreground">{stat.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
