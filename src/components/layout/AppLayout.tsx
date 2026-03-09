import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/stores/userStore";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ArenaSidebar } from "./ArenaSidebar";
import { ArenaHeader } from "./ArenaHeader";
import { Footer } from "@/components/shared/Footer";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const isAuthenticated = useUserStore((s) => s.isAuthenticated);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/auth", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <ArenaSidebar />
        <div className="flex-1 flex flex-col">
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
