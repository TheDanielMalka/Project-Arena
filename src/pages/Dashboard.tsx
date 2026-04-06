import { useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { WinLossChart } from "@/components/dashboard/WinLossChart";
import { EarningsChart } from "@/components/dashboard/EarningsChart";
import { RecentMatches } from "@/components/dashboard/RecentMatches";
import { DailyChallenges } from "@/components/dashboard/DailyChallenges";
import LiveMatchTracker from "@/components/match/LiveMatchTracker";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { useMatchListLivePoll } from "@/hooks/useMatchListLivePoll";
import { Swords, Wallet, History, TrendingUp, Radio, Gift, Medal, Shield, Trophy, Gem, Sparkles, Crown, X, Download, type LucideIcon } from "lucide-react";
import { getXpInfo } from "@/lib/xp";
import { getAvatarSidebarStyle } from "@/lib/avatarBgs";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { cn } from "@/lib/utils";
import { hasPendingClientSetup, clearPendingClientSetup } from "@/lib/localArenaPrefs";

const XP_ICON_MAP: Record<string, LucideIcon> = {
  Medal, Shield, Trophy, Gem, Sparkles, Crown,
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, token, showLoginGreeting, greetingType, clearLoginGreeting } = useUserStore();
  const { matches } = useMatchStore();
  useMatchListLivePoll(user && token ? token : null);

  // ── Login greeting banner ─────────────────────────────────────────────────
  const [bannerVisible, setBannerVisible] = useState(false);
  const [bannerOut, setBannerOut] = useState(false);
  const [showClientSetupBanner, setShowClientSetupBanner] = useState(false);

  useEffect(() => {
    setShowClientSetupBanner(hasPendingClientSetup());
  }, []);

  useEffect(() => {
    if (!showLoginGreeting) return;
    setBannerVisible(true);
    setBannerOut(false);
    const out = setTimeout(() => setBannerOut(true), 3800);
    const clear = setTimeout(() => { setBannerVisible(false); clearLoginGreeting(); }, 4400);
    return () => { clearTimeout(out); clearTimeout(clear); };
  }, [showLoginGreeting]);

  const dismissBanner = () => { setBannerOut(true); setTimeout(() => { setBannerVisible(false); clearLoginGreeting(); }, 500); };

  const liveCount = matches.filter(m => m.status === "in_progress").length;
  const initials = (user?.username ?? "??").slice(0, 2).toUpperCase();
  const xpInfo = getXpInfo(user?.stats.xp ?? 0);
  const XpIcon = XP_ICON_MAP[xpInfo.iconName] ?? Medal;

  // Rank color (win-rate based)
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

  // Avatar content renderer
  const renderAvatar = (size: number) => {
    const av = user?.avatar ?? "initials";
    if (av === "initials") return <span className="font-display font-bold text-white" style={{ fontSize: size * 0.4 }}>{initials}</span>;
    if (av.startsWith("upload:"))
      return <img src={av.slice(7)} className={cn("h-full w-full rounded-2xl", identityPortraitCropClassName)} alt="avatar" />;
    const presetUrl = getAvatarImageUrlFromStorage(av);
    if (presetUrl)
      return <img src={presetUrl} className={cn("h-full w-full rounded-2xl", identityPortraitCropClassName)} alt="" decoding="async" />;
    return <span style={{ fontSize: size * 0.45 }}>{av}</span>;
  };

  return (
    <div className="space-y-6">

      {/* ── Login Greeting Banner ── */}
      {bannerVisible && (
        <div
          className={`fixed top-4 left-1/2 z-50 transition-all duration-500 ease-out
            ${bannerOut ? "-translate-y-16 opacity-0" : "-translate-x-1/2 translate-y-0 opacity-100"}`}
          style={bannerOut ? {} : { transform: "translateX(-50%) translateY(0)" }}
        >
          <div className="relative flex items-center gap-3 px-5 py-3 rounded-2xl border border-primary/40 bg-background/95 backdrop-blur-md shadow-[0_0_30px_rgba(34,197,94,0.15)] min-w-[280px] max-w-sm">
            {/* left glow line */}
            <div className="absolute left-0 inset-y-3 w-0.5 rounded-full bg-gradient-to-b from-primary/0 via-primary to-primary/0" />
            {/* icon */}
            <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <XpIcon className="w-4 h-4 text-primary" />
            </div>
            {/* text */}
            <div className="flex-1 min-w-0">
              <p className="font-display text-xs font-bold tracking-widest text-primary uppercase">
                {greetingType === "signup" ? "Welcome to Arena" : "Welcome back"}
              </p>
              <p className="text-sm font-semibold text-foreground truncate">{user?.username}</p>
              <p className="text-[10px] text-muted-foreground">{xpInfo.label} · {user?.stats.xp ?? 0} XP</p>
            </div>
            {/* dismiss */}
            <button onClick={dismissBanner} className="flex-shrink-0 p-1 rounded-lg hover:bg-muted/50 transition-colors">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* ── Post-signup: install desktop client (local flag until DB onboarding exists) ── */}
      {showClientSetupBanner && (
        <div className="rounded-2xl border border-arena-cyan/35 bg-arena-cyan/5 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-display text-sm font-bold text-arena-cyan tracking-wide">Next: Arena Client</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Install the desktop app to join staked matches. It verifies capture on your PC and talks to the engine—your
              browser alone isn&apos;t enough for ranked play.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <a
              href="https://arena-client-dist.s3.us-east-1.amazonaws.com/ArenaClient.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/15 border border-primary/40 text-primary font-display text-xs font-semibold hover:bg-primary/25 transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <Link
              to="/client"
              className="inline-flex items-center px-3 py-2 rounded-xl border border-border bg-secondary/50 text-foreground font-display text-xs font-semibold hover:border-primary/30 transition-colors"
            >
              Why &amp; how
            </Link>
            <button
              type="button"
              onClick={() => {
                clearPendingClientSetup();
                setShowClientSetupBanner(false);
              }}
              className="px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Hero Command Center ── */}
      <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
        {/* Ambient top gradient */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-24 bg-primary/5 blur-3xl pointer-events-none" />

        <div className="relative p-5 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Avatar + identity */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="relative shrink-0">
              <div
                className="relative w-14 h-14 flex items-center justify-center overflow-hidden ring-1 ring-white/10"
                style={{ ...getAvatarSidebarStyle(user?.avatarBg), borderRadius: 16, width: 56, height: 56 }}
              >
                <span className="pointer-events-none absolute inset-0 opacity-[0.12] bg-gradient-to-br from-white/40 to-transparent" />
                <span className="relative z-[1] flex h-full w-full items-center justify-center">{renderAvatar(56)}</span>
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
                {/* XP level badge */}
                <span className="inline-flex items-center gap-1 text-[10px] font-display font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: `${xpInfo.color}15`, color: xpInfo.color, border: `1px solid ${xpInfo.color}30` }}>
                  <XpIcon className="h-2.5 w-2.5" />
                  {xpInfo.label}
                </span>
              </div>
              {/* XP mini progress bar */}
              <div className="mt-1 flex items-center gap-1.5 max-w-[180px]">
                <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.round(xpInfo.progress * 100)}%`, background: xpInfo.color, boxShadow: `0 0 4px ${xpInfo.color}60` }} />
                </div>
                <span className="text-[9px] font-mono text-muted-foreground/60 tabular-nums shrink-0">{xpInfo.xp} XP</span>
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
              <Wallet className="h-3.5 w-3.5" /> Wallet
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
      <div className="grid md:grid-cols-2 gap-3 md:gap-4">
        <WinLossChart />
        <EarningsChart />
      </div>

      {/* ── Recent matches ── */}
      <RecentMatches showViewAll limit={5} />
    </div>
  );
};

export default Dashboard;
