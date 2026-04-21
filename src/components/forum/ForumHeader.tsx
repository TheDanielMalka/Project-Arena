import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, X } from "lucide-react";
import { useUserStore } from "@/stores/userStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ForumHeader() {
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/forum/search?q=${encodeURIComponent(q)}`);
    setQuery("");
    inputRef.current?.blur();
  };

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <header className="h-12 border-b border-border/30 flex items-center gap-3 px-4 bg-background/80 backdrop-blur-sm shrink-0">
      {/* Title */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-4 w-0.5 bg-arena-cyan shadow-[0_0_6px_hsl(var(--arena-cyan)/0.5)]" />
        <span className="font-hud text-[11px] uppercase tracking-widest text-arena-cyan hidden sm:block">
          Arena Forum
        </span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex-1 max-w-sm">
        <div
          className={cn(
            "flex items-center gap-2 px-3 h-7 rounded-sm border transition-colors bg-white/[0.03]",
            focused
              ? "border-arena-cyan/40 bg-white/[0.05]"
              : "border-border/30 hover:border-border/50",
          )}
        >
          <Search className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder='Search forum… (press /)'
            className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none min-w-0"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </form>

      <div className="flex-1" />

      {/* New Thread CTA */}
      {user && (
        <Button
          size="sm"
          className="arena-hud-btn gap-1.5 h-7 text-[11px]"
          onClick={() => navigate("/forum/new")}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Thread</span>
        </Button>
      )}
    </header>
  );
}
