import { useEffect, type ReactNode } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationToastListener } from "@/components/notifications/NotificationToast";
import { useUserStore } from "@/stores/userStore";
import { registerAuth401Handler, clearAuth401Handler } from "@/lib/authSession";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
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
import SettingsPage from "./pages/Settings";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import ResponsibleGaming from "./pages/ResponsibleGaming";
import NotFound from "./pages/NotFound";
import Players from "./pages/Players";
import PlayerProfile from "./pages/PlayerProfile";
import Hub from "./pages/Hub";
import Forge from "./pages/Forge";

const queryClient = new QueryClient();

const PublicLegal = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-background text-foreground relative">
    <div className="pointer-events-none absolute inset-0 opacity-[0.06] motion-reduce:opacity-[0.02] [background:repeating-linear-gradient(0deg,transparent,transparent_2px,hsl(0_0%_0%/0.4)_2px,hsl(0_0%_0%/0.4)_3px)] mix-blend-multiply" aria-hidden />
    <div className="max-w-4xl mx-auto px-6 py-10 relative z-[1]">
      <div className="arena-hud-legal-frame">{children}</div>
    </div>
  </div>
);

const AdminRoute = () => {
  const user = useUserStore((s) => s.user);
  return user?.role === "admin" ? <AppLayout><Admin /></AppLayout> : <Navigate to="/dashboard" replace />;
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
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <NotificationToastListener />
      <BrowserRouter>
        <SessionGate>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<AppLayout><Dashboard /></AppLayout>} />
            <Route path="/lobby" element={<AppLayout><MatchLobby /></AppLayout>} />
            <Route path="/client" element={<AppLayout><ArenaClientPage /></AppLayout>} />
            <Route path="/history" element={<AppLayout><History /></AppLayout>} />
            <Route path="/profile" element={<AppLayout><Profile /></AppLayout>} />
            <Route path="/wallet" element={<AppLayout><WalletPage /></AppLayout>} />
            <Route path="/leaderboard" element={<AppLayout><Leaderboard /></AppLayout>} />
            <Route path="/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
            <Route path="/terms-of-service" element={<AppLayout><TermsOfService /></AppLayout>} />
            <Route path="/privacy-policy" element={<AppLayout><PrivacyPolicy /></AppLayout>} />
            <Route path="/responsible-gaming" element={<AppLayout><ResponsibleGaming /></AppLayout>} />
            {/* Public legal pages — accessible without authentication */}
            <Route path="/legal/terms" element={<PublicLegal><TermsOfService /></PublicLegal>} />
            <Route path="/legal/privacy" element={<PublicLegal><PrivacyPolicy /></PublicLegal>} />
            <Route path="/legal/responsible-gaming" element={<PublicLegal><ResponsibleGaming /></PublicLegal>} />
            <Route path="/hub" element={<AppLayout><Hub /></AppLayout>} />
            <Route path="/forge" element={<AppLayout><Forge /></AppLayout>} />
            <Route path="/players" element={<AppLayout><Players /></AppLayout>} />
            <Route path="/players/:username" element={<AppLayout><PlayerProfile /></AppLayout>} />
            <Route path="/admin" element={<AdminRoute />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </SessionGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
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
