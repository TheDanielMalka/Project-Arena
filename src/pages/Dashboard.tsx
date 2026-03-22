import { useNavigate } from "react-router-dom";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { WinLossChart } from "@/components/dashboard/WinLossChart";
import { EarningsChart } from "@/components/dashboard/EarningsChart";
import { RecentMatches } from "@/components/dashboard/RecentMatches";
import LiveMatchTracker from "@/components/match/LiveMatchTracker";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/stores/userStore";
import { Swords, Wallet, History, Gamepad2 } from "lucide-react";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useUserStore();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide">
            Welcome back, {user?.username ?? "Player"}
          </h1>
          <p className="text-muted-foreground mt-1">Your performance overview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate("/lobby")} className="glow-green font-display animate-glow-breath">
            <Swords className="mr-2 h-4 w-4" /> Find Match
          </Button>
          <Button variant="outline" onClick={() => navigate("/wallet")} className="border-primary/30 text-primary hover:bg-primary/10 font-display">
            <Wallet className="mr-2 h-4 w-4" /> Deposit
          </Button>
          <Button variant="outline" onClick={() => navigate("/history")} className="border-border font-display">
            <History className="mr-2 h-4 w-4" /> History
          </Button>
        </div>
      </div>

      <StatsCards />

      <LiveMatchTracker />

      <div className="grid md:grid-cols-2 gap-6">
        <WinLossChart />
        <EarningsChart />
      </div>

      <RecentMatches showViewAll limit={5} />
    </div>
  );
};

export default Dashboard;
