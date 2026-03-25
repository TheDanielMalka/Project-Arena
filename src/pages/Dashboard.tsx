import { useNavigate } from "react-router-dom";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { WinLossChart } from "@/components/dashboard/WinLossChart";
import { EarningsChart } from "@/components/dashboard/EarningsChart";
import { RecentMatches } from "@/components/dashboard/RecentMatches";
import { DailyChallenges } from "@/components/dashboard/DailyChallenges";
import LiveMatchTracker from "@/components/match/LiveMatchTracker";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { Swords, Wallet, History, TrendingUp, Radio, Gift } from "lucide-react";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useUserStore();
  const { matches } = useMatchStore();

  const liveCount = matches.filter(m => m.status === "in_progress").length;
  const initials = (user?.username ?? "??").slice(0, 2).toUpperCase();

  // Rank color
  const rankColors: Record<string, string> = {
    Bronze: "#CD7F32", Silver: "#9CA3AF", Gold: "#EAB308",
    Platinum: "#22D3EE", Diamond: "#818CF8", Master: "#F43F5E",
  };
  const rank = user?.stats?.winRate
    ? user.stats.winRate >= 70 ? "Master"
    : user.stats.winRate >= 62 ? "Diamond"
    : user.stats.winRate >= 54 ? "Platinum"
    : user.stats.winRate >= 46 ? "Gold"
    : user.stats.winRate >= 38 ? "Silver"
    : "Bronze"
    : "Bronze";
  const rankColor = rankColors[rank] ?? "#EAB308";

  return (
    <div className="space-y-6">

      {/* ── Hero Command Center ── */}
      <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
        {/* Ambient top gradient */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-24 bg-primary/5 blur-3xl pointer-events-none" />

        <div className="relative p-5 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Avatar + identity */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-display text-xl font-bold text-white"
                style={{ background: `linear-gradient(135deg, ${rankColor}40, ${rankColor}20)`, border: `1.5px solid ${rankColor}50` }}>
                {initials}
              </div>
              {liveCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-arena-cyan border-2 border-card animate-pulse" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mb-0.5">Command Center</p>
              <h1 className="font-display text-2xl font-bold tracking-wide truncate">
                {user?.username ?? "Player"}
              </h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: `${rankColor}18`, color: rankColor, border: `1px solid ${rankColor}30` }}>
                  {rank}
                </span>
                <span className="text-xs text-muted-foreground">
                  {user?.stats.winRate ?? 0}% WR
                </span>
                {(user?.stats.wins ?? 0) > 0 && (
                  <span className="text-xs text-arena-orange">
                    {Math.min(user!.stats.wins, 7)}🔥
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Balance + quick stats */}
          <div className="hidden md:flex items-center gap-6 text-center shrink-0">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Available</p>
              <p className="font-display text-lg font-bold text-primary">${user?.balance.available.toLocaleString() ?? "0"}</p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">In Escrow</p>
              <p className="font-display text-lg font-bold text-arena-gold">${user?.balance.inEscrow.toLocaleString() ?? "0"}</p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Earnings</p>
              <p className="font-display text-lg font-bold text-arena-cyan">${user?.stats.totalEarnings.toLocaleString() ?? "0"}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 shrink-0 flex-wrap">
            <button onClick={() => navigate("/lobby")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/15 border border-primary/40 text-primary font-display text-sm font-semibold hover:bg-primary/25 transition-all"
              style={{ boxShadow: "0 0 18px rgba(var(--primary-rgb),0.25)" }}>
              <Swords className="h-3.5 w-3.5" /> Find Match
            </button>
            <button onClick={() => navigate("/wallet")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-secondary/40 text-muted-foreground font-display text-sm hover:border-primary/30 hover:text-foreground transition-all">
              <Wallet className="h-3.5 w-3.5" /> Deposit
            </button>
            <button onClick={() => navigate("/history")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-secondary/40 text-muted-foreground font-display text-sm hover:border-primary/30 hover:text-foreground transition-all">
              <History className="h-3.5 w-3.5" /> History
            </button>
          </div>
        </div>

        {/* Mobile balance strip */}
        <div className="md:hidden flex border-t border-border divide-x divide-border">
          {[
            { label: "Available", value: `$${user?.balance.available.toLocaleString() ?? "0"}`, color: "text-primary" },
            { label: "In Escrow", value: `$${user?.balance.inEscrow.toLocaleString() ?? "0"}`, color: "text-arena-gold" },
            { label: "Earnings",  value: `$${user?.stats.totalEarnings.toLocaleString() ?? "0"}`, color: "text-arena-cyan" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex-1 py-2.5 px-3 text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-widest">{label}</p>
              <p className={`font-display text-sm font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stats strip ── */}
      <StatsCards />

      {/* ── Live section header ── */}
      {liveCount > 0 && (
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-arena-cyan animate-pulse" />
          <span className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-arena-cyan">
            Live Now — {liveCount} match{liveCount > 1 ? "es" : ""}
          </span>
          <div className="flex-1 h-px bg-arena-cyan/10" />
        </div>
      )}

      <LiveMatchTracker />

      {/* ── Daily Challenges ── */}
      <div className="flex items-center gap-2">
        <Gift className="h-3.5 w-3.5 text-arena-gold" />
        <span className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Daily Challenges</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <DailyChallenges />

      {/* ── Charts ── */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Performance</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <WinLossChart />
        <EarningsChart />
      </div>

      {/* ── Recent matches ── */}
      <RecentMatches showViewAll limit={5} />
    </div>
  );
};

export default Dashboard;
