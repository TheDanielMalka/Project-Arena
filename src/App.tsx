import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationToastListener } from "@/components/notifications/NotificationToast";
import { useUserStore } from "@/stores/userStore";
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
  <div className="min-h-screen bg-background text-foreground">
    <div className="max-w-4xl mx-auto px-6 py-10">{children}</div>
  </div>
);

const AdminRoute = () => {
  const user = useUserStore((s) => s.user);
  return user?.role === "admin" ? <AppLayout><Admin /></AppLayout> : <Navigate to="/dashboard" replace />;
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <NotificationToastListener />
        <BrowserRouter>
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
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
