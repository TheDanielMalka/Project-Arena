import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Pin, Lock, Plus, ChevronLeft, ChevronRight,
  MessageSquare, Clock,
} from "lucide-react";
import { useForumStore } from "@/stores/forumStore";
import { useUserStore } from "@/stores/userStore";
import { Button } from "@/components/ui/button";
import type { ForumThread } from "@/lib/engine-api";
import { formatDistanceToNow } from "date-fns";

function ThreadRow({ thread }: { thread: ForumThread }) {
  const ago = thread.last_post_at
    ? formatDistanceToNow(new Date(thread.last_post_at), { addSuffix: true })
    : formatDistanceToNow(new Date(thread.created_at), { addSuffix: true });

  return (
    <Link
      to={`/forum/t/${thread.slug}`}
      className="group flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors border-b border-border/20 last:border-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        {thread.is_pinned && (
          <Pin className="h-3 w-3 text-arena-cyan shrink-0" />
        )}
        {thread.is_locked && (
          <Lock className="h-3 w-3 text-yellow-500/70 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-display text-sm text-foreground group-hover:text-arena-cyan transition-colors truncate">
            {thread.title}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            by{" "}
            <span className="text-foreground/70">{thread.author.username}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0 ml-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {thread.reply_count}
        </span>
        <span className="flex items-center gap-1 hidden sm:flex">
          <Clock className="h-3 w-3" />
          {ago}
        </span>
      </div>
    </Link>
  );
}

export default function CategoryPage() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);
  const { threads, threadsLoading, threadsPage, threadsPages, loadThreads, categories } =
    useForumStore();

  const [currentPage, setCurrentPage] = useState(1);

  const category = categories.find((c) => c.slug === categorySlug) ??
    categories.flatMap((c) => c.children).find((c) => c.slug === categorySlug);

  useEffect(() => {
    if (categorySlug) void loadThreads(categorySlug, currentPage);
  }, [categorySlug, currentPage, loadThreads]);

  const pinned = threads.filter((t) => t.is_pinned);
  const regular = threads.filter((t) => !t.is_pinned);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Link to="/forum" className="hover:text-arena-cyan transition-colors">Forum</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground/70">{category?.name ?? categorySlug}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 bg-arena-cyan shadow-[0_0_8px_hsl(var(--arena-cyan)/0.6)]" />
          <div>
            <h1 className="font-hud text-lg uppercase tracking-widest text-arena-cyan">
              {category?.name ?? categorySlug}
            </h1>
            {category?.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{category.description}</p>
            )}
          </div>
        </div>
        {user && (
          <Button
            size="sm"
            className="arena-hud-btn gap-1.5"
            onClick={() => navigate(`/forum/new?category=${categorySlug}`)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Thread
          </Button>
        )}
      </div>

      {/* Thread list */}
      <div className="arena-hud-panel overflow-hidden">
        {threadsLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading threads…</div>
        ) : threads.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No threads yet. Be the first to post!
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div>
                <div className="px-4 py-1.5 bg-arena-cyan/5 border-b border-border/20">
                  <span className="text-[10px] font-hud uppercase tracking-widest text-arena-cyan/60">
                    Pinned
                  </span>
                </div>
                {pinned.map((t) => <ThreadRow key={t.id} thread={t} />)}
              </div>
            )}
            {regular.map((t) => <ThreadRow key={t.id} thread={t} />)}
          </>
        )}
      </div>

      {/* Pagination */}
      {threadsPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground font-mono">
            {threadsPage} / {threadsPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentPage >= threadsPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
