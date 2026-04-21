import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MessageSquare, ChevronRight, ChevronDown } from "lucide-react";
import { useForumStore } from "@/stores/forumStore";
import { cn } from "@/lib/utils";
import type { ForumCategory } from "@/lib/engine-api";

const GAME_COLORS: Record<string, string> = {
  cs2:          "#4FC3F7",
  valorant:     "#FF4655",
  mlbb:         "#F59E0B",
  wildrift:     "#06B6D4",
  honorofkings: "#8B5CF6",
  general:      "#6366f1",
  feedback:     "#F59E0B",
};

function CategoryItem({ cat, depth = 0 }: { cat: ForumCategory; depth?: number }) {
  const location = useLocation();
  const color = GAME_COLORS[cat.slug] ?? GAME_COLORS[cat.parent_id ? "general" : "general"];
  const isActive = location.pathname === `/forum/${cat.slug}` ||
    location.pathname.startsWith(`/forum/${cat.slug}/`);
  const hasChildren = cat.children.length > 0;

  return (
    <div>
      <NavLink
        to={`/forum/${cat.slug}`}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors rounded-sm",
          depth === 0
            ? "font-display text-foreground/80 hover:text-foreground"
            : "font-normal text-muted-foreground hover:text-foreground/80 ml-3 border-l border-border/30 pl-3 rounded-none",
          isActive && "text-foreground bg-white/5",
        )}
        style={isActive ? { borderLeftColor: color, borderLeftWidth: depth === 0 ? 2 : 2 } : {}}
      >
        {depth === 0 && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: color }}
          />
        )}
        <span className="truncate flex-1">{cat.name}</span>
        {depth === 0 && hasChildren && (
          isActive
            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        )}
      </NavLink>
      {/* Sub-categories always visible */}
      {cat.children.length > 0 && (
        <div className="ml-2">
          {cat.children.map((child) => (
            <CategoryItem key={child.id} cat={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ForumSidebar() {
  const { categories, categoriesLoading, loadCategories } = useForumStore();

  useEffect(() => {
    if (categories.length === 0) void loadCategories();
  }, [categories.length, loadCategories]);

  return (
    <aside className="w-52 shrink-0 hidden lg:flex flex-col border-r border-border/30 bg-background/60 overflow-y-auto">
      <div className="px-3 py-3 border-b border-border/20 flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-arena-cyan" />
        <span className="font-hud text-[11px] uppercase tracking-widest text-arena-cyan">
          Categories
        </span>
      </div>
      <nav className="py-2 space-y-0.5 px-1">
        <NavLink
          to="/forum"
          end
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 px-3 py-1.5 text-[12px] font-display transition-colors rounded-sm",
              isActive
                ? "text-arena-cyan bg-arena-cyan/5"
                : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          <span className="w-2 h-2 rounded-full bg-arena-cyan/60 shrink-0" />
          All Categories
        </NavLink>
        {categoriesLoading ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>
        ) : (
          categories.map((cat) => (
            <CategoryItem key={cat.id} cat={cat} />
          ))
        )}
      </nav>
    </aside>
  );
}
