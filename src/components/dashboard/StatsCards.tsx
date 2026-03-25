import { Trophy, Target, TrendingUp, Zap } from "lucide-react";
import { useUserStore } from "@/stores/userStore";

export function StatsCards() {
  const { user } = useUserStore();

  const winRate = user?.stats.winRate ?? 0;
  const matches = user?.stats.matches ?? 0;
  const wins    = user?.stats.wins ?? 0;
  const streak  = Math.min(wins, 7);

  const stats = [
    {
      label: "Total Matches",
      value: matches.toString(),
      icon: Target,
      color: "#38BDF8",
      sub: `${wins}W · ${user?.stats.losses ?? 0}L`,
      bar: matches > 0 ? (wins / matches) : 0,
    },
    {
      label: "Win Rate",
      value: `${winRate}%`,
      icon: Trophy,
      color: winRate >= 60 ? "#22C55E" : winRate >= 50 ? "#EAB308" : winRate >= 40 ? "#F97316" : "#EF4444",
      sub: winRate >= 60 ? "Excellent" : winRate >= 50 ? "Good" : winRate >= 40 ? "Average" : "Improving",
      bar: winRate / 100,
    },
    {
      label: "Total Earnings",
      value: `$${user?.stats.totalEarnings?.toLocaleString() ?? "0"}`,
      icon: TrendingUp,
      color: "#EAB308",
      sub: `$${user?.balance.inEscrow ?? 0} in escrow`,
      bar: Math.min((user?.stats.totalEarnings ?? 0) / 5000, 1),
    },
    {
      label: "Win Streak",
      value: streak > 0 ? `${streak}🔥` : "—",
      icon: Zap,
      color: "#F97316",
      sub: streak >= 5 ? "On fire!" : streak >= 3 ? "Hot streak" : streak > 0 ? "Keep going" : "Start one!",
      bar: streak / 7,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label}
            className="rounded-2xl border border-border bg-card p-4 relative overflow-hidden group hover:border-opacity-60 transition-all"
            style={{ borderColor: `${stat.color}20` }}>
            {/* Ambient glow */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ background: `radial-gradient(ellipse at top left, ${stat.color}08, transparent 70%)` }} />

            <div className="flex items-center justify-between mb-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: `${stat.color}15` }}>
                <Icon className="h-4 w-4" style={{ color: stat.color }} />
              </div>
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-display">{stat.label}</span>
            </div>

            <p className="font-display text-2xl font-bold leading-none mb-1">{stat.value}</p>
            <p className="text-xs text-muted-foreground mb-3">{stat.sub}</p>

            {/* Mini progress bar */}
            <div className="h-0.5 w-full rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${Math.round(stat.bar * 100)}%`, background: stat.color, opacity: 0.7 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
