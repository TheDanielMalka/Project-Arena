import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/stores/userStore";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ArenaSidebar } from "./ArenaSidebar";
import { ArenaHeader } from "./ArenaHeader";
import { ArenaAmbientBackground } from "./ArenaAmbientBackground";
import { Footer } from "@/components/shared/Footer";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const authHydrated = useUserStore((s) => s.authHydrated);
  const isAuthenticated = useUserStore((s) => s.isAuthenticated);
  const pruneExpiredShopEntitlements = useUserStore((s) => s.pruneExpiredShopEntitlements);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authHydrated) return;
    if (!isAuthenticated) {
      navigate("/auth", { replace: true });
    }
  }, [authHydrated, isAuthenticated, navigate]);

  useEffect(() => {
    if (!authHydrated || !isAuthenticated) return;
    pruneExpiredShopEntitlements();
    const id = window.setInterval(pruneExpiredShopEntitlements, 60_000);
    return () => window.clearInterval(id);
  }, [authHydrated, isAuthenticated, pruneExpiredShopEntitlements]);

  if (!authHydrated) return null;
  if (!isAuthenticated) return null;

  return (
    <SidebarProvider>
      <div className="relative min-h-screen flex w-full">
        <ArenaAmbientBackground />
        <ArenaSidebar />
        <div className="relative z-10 flex-1 flex flex-col min-w-0">
          <ArenaHeader />
          <main className="flex-1 p-6 overflow-auto">
            <Breadcrumbs />
            {children}
          </main>
          <Footer />
        </div>
      </div>
    </SidebarProvider>
  );
}
