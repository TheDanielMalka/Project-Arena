import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, MessageSquare, ChevronRight } from "lucide-react";
import { apiSearchForum } from "@/lib/engine-api";
import type { ForumThread } from "@/lib/engine-api";
import { formatDistanceToNow } from "date-fns";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const [results, setResults] = useState<ForumThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(false);
    apiSearchForum(q.trim()).then((data) => {
      setResults(data?.threads ?? []);
      setLoading(false);
      setSearched(true);
    });
  }, [q]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 bg-arena-cyan shadow-[0_0_8px_hsl(var(--arena-cyan)/0.6)]" />
        <div>
          <h1 className="font-hud text-lg uppercase tracking-widest text-arena-cyan">
            Search Results
          </h1>
          {q && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Results for <span className="text-foreground/70">"{q}"</span>
            </p>
          )}
        </div>
      </div>

      {!q ? (
        <div className="arena-hud-panel p-8 text-center text-muted-foreground text-sm">
          <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
          Use the search bar above to find threads.
        </div>
      ) : loading ? (
        <div className="arena-hud-panel p-8 text-center text-muted-foreground text-sm">
          Searching…
        </div>
      ) : searched && results.length === 0 ? (
        <div className="arena-hud-panel p-8 text-center text-muted-foreground text-sm">
          No results found for "{q}".
        </div>
      ) : (
        <div className="arena-hud-panel overflow-hidden">
          {results.map((thread) => (
            <Link
              key={thread.id}
              to={`/forum/t/${thread.slug}`}
              className="group flex items-start justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors border-b border-border/20 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground/50">
                    {thread.category_name}
                  </span>
                  <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/30" />
                </div>
                <p className="font-display text-sm text-foreground group-hover:text-arena-cyan transition-colors truncate">
                  {thread.title}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  by {thread.author.username} ·{" "}
                  {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-4 text-[11px] text-muted-foreground">
                <MessageSquare className="h-3 w-3" />
                {thread.reply_count}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
