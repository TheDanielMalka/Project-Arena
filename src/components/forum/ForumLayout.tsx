import type { ReactNode } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ForumHeader } from "@/components/forum/ForumHeader";
import { ForumSidebar } from "@/components/forum/ForumSidebar";
import { ForumBottomNav } from "@/components/forum/ForumBottomNav";

interface Props {
  children: ReactNode;
}

export function ForumLayout({ children }: Props) {
  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <ForumHeader />
        <div className="flex flex-1 overflow-hidden">
          <ForumSidebar />
          <main className="flex-1 overflow-y-auto min-w-0 pb-16 lg:pb-0">
            {children}
          </main>
        </div>
        {/* Mobile bottom nav — visible only on small screens */}
        <ForumBottomNav />
      </div>
    </AppLayout>
  );
}
