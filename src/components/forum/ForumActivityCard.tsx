import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENGINE_BASE } from "@/lib/engine-api";
import type { ForumThread } from "@/lib/engine-api";
import { formatDistanceToNow } from "date-fns";

interface Props {
  userId: string | undefined;
}

interface ForumActivity {
  threads: ForumThread[];
  post_count: number;
  thread_count: number;
}

export function ForumActivityCard({ userId }: Props) {
  const [activity, setActivity] = useState<ForumActivity | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetch(`${ENGINE_BASE}/forum/users/${encodeURIComponent(userId)}/activity`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ForumActivity | null) => {
        setActivity(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  if (!userId) return null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="font-display text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Forum Activity
          </CardTitle>
          <Link
            to="/forum"
            className="text-[10px] font-display text-muted-foreground hover:text-primary transition-colors tracking-wider uppercase"
          >
            Visit Forum →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {loading ? (
          <div className="text-xs text-muted-foreground/50 py-2">Loading…</div>
        ) : !activity || (activity.thread_count === 0 && activity.post_count === 0) ? (
          <div className="text-xs text-muted-foreground/50 py-2">
            No forum activity yet.{" "}
            <Link to="/forum" className="text-arena-cyan hover:underline">
              Join the conversation
            </Link>
          </div>
        ) : (
          <>
            {/* Counters */}
            <div className="flex gap-4">
              <div className="text-center">
                <p className="font-display text-lg font-bold leading-none text-arena-cyan">
                  {activity.thread_count}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Threads</p>
              </div>
              <div className="text-center">
                <p className="font-display text-lg font-bold leading-none text-foreground">
                  {activity.post_count}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Replies</p>
              </div>
            </div>

            {/* Recent threads */}
            {activity.threads.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-hud uppercase tracking-widest text-muted-foreground/60">
                  Recent Threads
                </p>
                {activity.threads.slice(0, 3).map((t) => (
                  <Link
                    key={t.id}
                    to={`/forum/t/${t.slug}`}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/[0.03] transition-colors group"
                  >
                    <span className="text-xs text-foreground/80 group-hover:text-arena-cyan transition-colors truncate flex-1">
                      {t.title}
                    </span>
                    <div className="flex items-center gap-2 shrink-0 ml-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="h-2.5 w-2.5" />
                        {t.reply_count}
                      </span>
                      <ChevronRight className="h-3 w-3 opacity-40 group-hover:opacity-80 transition-opacity" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
