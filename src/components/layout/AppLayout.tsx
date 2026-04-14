import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/stores/userStore";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ArenaSidebar } from "./ArenaSidebar";
import { ArenaHeader } from "./ArenaHeader";
import { ArenaAmbientBackground } from "./ArenaAmbientBackground";
import { ArenaGlobalStarfield } from "@/components/visual/ArenaGlobalStarfield";
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
        {/* Stars must live INSIDE each z-10 column — a sibling at z-[1] sits under the whole column and is invisible */}
        <div className="relative z-10 flex shrink-0 self-stretch">
          <ArenaGlobalStarfield className="absolute inset-0 z-0" />
          <div className="relative z-[1] min-h-screen">
            <ArenaSidebar />
          </div>
        </div>
        <div className="relative z-10 flex min-w-0 min-h-0 flex-1 flex-col">
          <ArenaGlobalStarfield className="absolute inset-0 z-0" />
          <div className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col">
            <ArenaHeader />
            <main className="arena-main-scroll relative flex-1 overflow-auto border-t border-arena-cyan/[0.07] p-6 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.03)]">
              <Breadcrumbs />
              {children}
            </main>
            <Footer />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
