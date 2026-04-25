import { useEffect, type ReactNode } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationToastListener } from "@/components/notifications/NotificationToast";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { registerAuth401Handler, clearAuth401Handler } from "@/lib/authSession";
import { wsClient, useWsEvent } from "@/lib/ws-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount } from "wagmi";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ArenaGlobalStarfield } from "@/components/visual/ArenaGlobalStarfield";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import MatchLobby from "./pages/MatchLobby";
import ArenaClientPage from "./pages/ArenaClient";
import History from "./pages/History";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import WalletPage from "./pages/Wallet";
import Leaderboard from "./pages/Leaderboard";
import Creators from "./pages/Creators";
import SettingsPage from "./pages/Settings";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import ResponsibleGaming from "./pages/ResponsibleGaming";
import NotFound from "./pages/NotFound";
import Players from "./pages/Players";
import PlayerProfile from "./pages/PlayerProfile";
import Hub from "./pages/Hub";
import Forge from "./pages/Forge";
import WhyArena from "./pages/WhyArena";
import HowToPlay from "./pages/HowToPlay";
import ForumHome from "./pages/forum/ForumHome";
import CategoryPage from "./pages/forum/CategoryPage";
import ThreadPage from "./pages/forum/ThreadPage";
import NewThreadPage from "./pages/forum/NewThreadPage";
import SearchPage from "./pages/forum/SearchPage";
import { ForumLayout } from "./components/forum/ForumLayout";
import { TournamentSectionLayout } from "./components/tournament/TournamentSectionLayout";
import TournamentsHub from "./pages/TournamentsHub";
import TournamentSeasonPage from "./pages/TournamentSeasonPage";

const queryClient = new QueryClient();

function WagmiAutoSync() {
  const { address } = useAccount();
  const user = useUserStore((s) => s.user);
  const token = useUserStore((s) => s.token);
  const setConnected = useWalletStore((s) => s.setConnectedAddress);
  const refreshProfile = useUserStore((s) => s.refreshProfileFromServer);

  // 1. Only promote the wagmi address into walletStore when it matches the DB.
  useEffect(() => {
    if (!address) { setConnected(null); return; }
    if (user?.walletAddress?.toLowerCase() === address.toLowerCase()) {
      setConnected(address);
    } else {
      setConnected(null);
    }
  }, [address, user?.walletAddress, setConnected]);

  // 2. Pull fresh profile on every wagmi account event (connect/disconnect/switch).
  //    refreshProfile is stable; intentionally omitted to prevent double-fire.
  useEffect(() => {
    if (!token) return;
    void refreshProfile();
  }, [address, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. Global 30 s poll — propagates cross-device changes (phone connects
  //    while desktop tab is open) without a WebSocket infrastructure.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => void refreshProfile(), 30_000);
    return () => clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function WsLifecycle() {
  const token = useUserStore((s) => s.token);
  const refreshProfileFromServer = useUserStore((s) => s.refreshProfileFromServer);

  useEffect(() => {
    if (token) {
      wsClient.connect(token);
    } else {
      wsClient.disconnect();
    }
    return () => {
      if (!token) wsClient.disconnect();
    };
  }, [token]);

  // Instant profile refresh when engine pushes AT/wallet balance changes.
  // The page-level polls (15s/30s) stay active as fallback.
  useWsEvent("user:profile_updated", () => {
    if (token) void refreshProfileFromServer();
  });

  return null;
}

const PublicLegal = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-background text-foreground relative">
    <ArenaGlobalStarfield className="fixed inset-0 z-0" />
    <div className="pointer-events-none absolute inset-0 z-[1] opacity-[0.06] motion-reduce:opacity-[0.02] [background:repeating-linear-gradient(0deg,transparent,transparent_2px,hsl(0_0%_0%/0.4)_2px,hsl(0_0%_0%/0.4)_3px)] mix-blend-multiply" aria-hidden />
    <div className="max-w-4xl mx-auto px-6 py-10 relative z-[2]">
      <div className="arena-hud-legal-frame">{children}</div>
    </div>
  </div>
);

const AdminRoute = () => {
  const user = useUserStore((s) => s.user);
  return user?.role === "admin" ? <AppLayout><Admin /></AppLayout> : <Navigate to="/" replace />;
};

function SessionGate({ children }: { children: ReactNode }) {
  const authHydrated = useUserStore((s) => s.authHydrated);
  const restoreSession = useUserStore((s) => s.restoreSession);

  useEffect(() => {
    registerAuth401Handler(() => {
      useUserStore.getState().logout();
    });
    void restoreSession();
    return () => clearAuth401Handler();
  }, [restoreSession]);

  if (!authHydrated) {
    return (
      <div className="arena-hud-loading-screen min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground relative z-0">
        <ArenaGlobalStarfield className="fixed inset-0 z-0" />
        <div className="relative z-[1] flex flex-col items-center gap-2">
          <div className="h-1.5 w-1.5 tactical-hud-slot-cut bg-arena-cyan motion-safe:animate-pulse shadow-[0_0_12px_hsl(var(--arena-cyan)/0.5)]" aria-hidden />
          <span className="font-hud text-[10px] uppercase tracking-[0.4em] text-arena-cyan/70">Initializing</span>
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();

const AppShell = () => (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <WagmiAutoSync />
      <WsLifecycle />
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <NotificationToastListener />
        <BrowserRouter>
          <SessionGate>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/why-arena" element={<WhyArena />} />
            <Route path="/how-to-play" element={<HowToPlay />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<AppLayout><Dashboard /></AppLayout>} />
            <Route path="/lobby" element={<AppLayout><MatchLobby /></AppLayout>} />
            <Route path="/client" element={<AppLayout><ArenaClientPage /></AppLayout>} />
            <Route path="/history" element={<AppLayout><History /></AppLayout>} />
            <Route path="/profile" element={<AppLayout><Profile /></AppLayout>} />
            <Route path="/wallet" element={<AppLayout><WalletPage /></AppLayout>} />
            <Route path="/leaderboard" element={<AppLayout><Leaderboard /></AppLayout>} />
            <Route path="/creators" element={<AppLayout><Creators /></AppLayout>} />
            <Route path="/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
            <Route path="/terms-of-service" element={<AppLayout><TermsOfService /></AppLayout>} />
            <Route path="/privacy-policy" element={<AppLayout><PrivacyPolicy /></AppLayout>} />
            <Route path="/responsible-gaming" element={<AppLayout><ResponsibleGaming /></AppLayout>} />
            {/* Public legal pages — accessible without authentication */}
            <Route path="/legal/terms" element={<PublicLegal><TermsOfService /></PublicLegal>} />
            <Route path="/legal/privacy" element={<PublicLegal><PrivacyPolicy /></PublicLegal>} />
            <Route path="/legal/responsible-gaming" element={<PublicLegal><ResponsibleGaming /></PublicLegal>} />
            {/* Tournaments — standalone section (dedicated layout, not AppLayout sidebar) */}
            <Route
              path="/tournaments"
              element={
                <TournamentSectionLayout backTo="/" backLabel="Home">
                  <TournamentsHub />
                </TournamentSectionLayout>
              }
            />
            <Route
              path="/tournaments/:slug"
              element={
                <TournamentSectionLayout backTo="/tournaments" backLabel="Tournaments">
                  <TournamentSeasonPage />
                </TournamentSectionLayout>
              }
            />
            <Route path="/hub" element={<AppLayout><Hub /></AppLayout>} />
            <Route path="/forge" element={<AppLayout><Forge /></AppLayout>} />
            <Route path="/players" element={<AppLayout><Players /></AppLayout>} />
            <Route path="/players/:username" element={<AppLayout><PlayerProfile /></AppLayout>} />
            <Route path="/forum" element={<ForumLayout><ForumHome /></ForumLayout>} />
            <Route path="/forum/new" element={<ForumLayout><NewThreadPage /></ForumLayout>} />
            <Route path="/forum/search" element={<ForumLayout><SearchPage /></ForumLayout>} />
            <Route path="/forum/t/:threadSlug" element={<ForumLayout><ThreadPage /></ForumLayout>} />
            <Route path="/forum/:categorySlug" element={<ForumLayout><CategoryPage /></ForumLayout>} />
            <Route path="/admin" element={<AdminRoute />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </SessionGate>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </WagmiProvider>
);

const App = () => {
  useEffect(() => {
    document.documentElement.classList.add("arena-tactical-hud");
    return () => document.documentElement.classList.remove("arena-tactical-hud");
  }, []);

  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <AppShell />
      </GoogleOAuthProvider>
    );
  }
  return <AppShell />;
};

export default App;
