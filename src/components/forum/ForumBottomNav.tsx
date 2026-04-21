import { NavLink, useNavigate } from "react-router-dom";
import { Home, Search, Plus, List } from "lucide-react";
import { useUserStore } from "@/stores/userStore";
import { cn } from "@/lib/utils";

export function ForumBottomNav() {
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/40 bg-background/95 backdrop-blur-sm flex items-center h-14">
      <NavLink
        to="/forum"
        end
        className={({ isActive }) =>
          cn(
            "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors",
            isActive ? "text-arena-cyan" : "text-muted-foreground hover:text-foreground",
          )
        }
      >
        <Home className="h-4 w-4" />
        Home
      </NavLink>

      <button
        onClick={() => navigate("/forum/search")}
        className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Search className="h-4 w-4" />
        Search
      </button>

      {user && (
        <button
          onClick={() => navigate("/forum/new")}
          className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      )}

      <NavLink
        to="/forum"
        className={({ isActive }) =>
          cn(
            "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors",
            isActive ? "text-arena-cyan" : "text-muted-foreground hover:text-foreground",
          )
        }
      >
        <List className="h-4 w-4" />
        Categories
      </NavLink>
    </nav>
  );
}
