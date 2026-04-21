import { useEffect } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, ChevronRight } from "lucide-react";
import { useForumStore } from "@/stores/forumStore";
import type { ForumCategory } from "@/lib/engine-api";

function CategoryRow({ cat, depth = 0 }: { cat: ForumCategory; depth?: number }) {
  return (
    <div className={depth > 0 ? "ml-4 border-l border-border/40 pl-4" : ""}>
      <Link
        to={`/forum/${cat.slug}`}
        className="group flex items-center justify-between py-3 px-4 hover:bg-white/[0.03] transition-colors border-b border-border/20 last:border-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          {cat.icon && (
            <span className="text-lg shrink-0">{cat.icon}</span>
          )}
          <div className="min-w-0">
            <p className="font-display text-sm text-foreground group-hover:text-arena-cyan transition-colors truncate">
              {cat.name}
            </p>
            {cat.description && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{cat.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <span className="text-[11px] text-muted-foreground font-mono">
            {cat.thread_count} threads
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-arena-cyan transition-colors" />
        </div>
      </Link>
      {cat.children.map((child) => (
        <CategoryRow key={child.id} cat={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function ForumHome() {
  const { categories, categoriesLoading, loadCategories } = useForumStore();

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 bg-arena-cyan shadow-[0_0_8px_hsl(var(--arena-cyan)/0.6)]" />
        <div>
          <h1 className="font-hud text-lg uppercase tracking-widest text-arena-cyan">
            Arena Forum
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Discuss strategy, report issues, connect with the community
          </p>
        </div>
      </div>

      {/* Categories */}
      {categoriesLoading ? (
        <div className="arena-hud-panel p-8 text-center text-muted-foreground text-sm">
          Loading categories…
        </div>
      ) : categories.length === 0 ? (
        <div className="arena-hud-panel p-8 text-center text-muted-foreground text-sm">
          No categories yet.
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat.id} className="arena-hud-panel overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.02] border-b border-border/30">
                <MessageSquare className="h-3.5 w-3.5 text-arena-cyan/70" />
                <span className="font-hud text-[11px] uppercase tracking-widest text-arena-cyan/70">
                  {cat.name}
                </span>
              </div>
              <CategoryRow cat={cat} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
