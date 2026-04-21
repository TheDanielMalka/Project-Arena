import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ChevronRight, Lock, Pin, ChevronLeft, ChevronRight as ChRight,
  Trash2, Send, Eye, MessageSquare, Flag, Pencil, Check, X,
  PinOff, Unlock,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { formatDistanceToNow, format, differenceInMinutes } from "date-fns";
import { useForumStore } from "@/stores/forumStore";
import { useUserStore } from "@/stores/userStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ForumUserCardPanel } from "@/components/forum/ForumUserCardPanel";
import {
  apiPinForumThread, apiLockForumThread, apiDeleteForumThread,
  apiDeleteForumPost, apiReactForumPost,
} from "@/lib/engine-api";
import type { ForumPost } from "@/lib/engine-api";

const REACTIONS = ["👍", "❤️", "🔥", "😂", "😮", "👀"];
const POLL_INTERVAL = 15_000;

// ── Post editing ──────────────────────────────────────────────────────────────
function EditableBody({
  post,
  onSave,
  onCancel,
}: {
  post: ForumPost;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(post.body);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2">
      <Textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="min-h-[100px] bg-white/5 border-border/40 text-sm resize-y"
        autoFocus
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
        <Button
          size="sm"
          className="arena-hud-btn gap-1"
          disabled={!val.trim() || saving}
          onClick={async () => {
            setSaving(true);
            await onSave(val.trim());
            setSaving(false);
          }}
        >
          <Check className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Report modal ──────────────────────────────────────────────────────────────
function ReportModal({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const token = useUserStore((s) => s.token);
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!token || !reason.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/forum/posts/${encodeURIComponent(postId)}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res.ok) {
        toast({ title: "Report submitted", description: "A moderator will review this post." });
        onClose();
      } else {
        const data = (await res.json()) as { detail?: string };
        toast({ title: "Failed to report", description: data.detail ?? "Try again.", variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="arena-hud-panel w-full max-w-sm mx-4 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-hud text-[11px] uppercase tracking-widest text-arena-cyan/70">
            Report Post
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for reporting…"
          className="bg-white/5 border-border/40 text-sm min-h-[80px]"
          maxLength={200}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="arena-hud-btn gap-1"
            disabled={!reason.trim() || submitting}
            onClick={() => void handleSubmit()}
          >
            <Flag className="h-3.5 w-3.5" />
            {submitting ? "Submitting…" : "Report"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── PostCard ──────────────────────────────────────────────────────────────────
function PostCard({
  post,
  isMod,
  onEdit,
  onDeleted,
}: {
  post: ForumPost;
  isMod: boolean;
  onEdit: (postId: string, body: string) => Promise<void>;
  onDeleted: (postId: string) => void;
}) {
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user);
  const { reactPost } = useForumStore();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [reportingPostId, setReportingPostId] = useState<string | null>(null);

  const canEdit =
    user &&
    (user.id === post.author.id &&
      differenceInMinutes(new Date(), new Date(post.created_at)) < 15 ||
      isMod);
  const canDelete = user && (user.id === post.author.id || isMod);

  const handleDelete = async () => {
    if (!token) return;
    const ok = await apiDeleteForumPost(token, post.id);
    if (ok) {
      onDeleted(post.id);
    } else {
      toast({ title: "Failed to delete post", variant: "destructive" });
    }
  };

  return (
    <>
      {reportingPostId && (
        <ReportModal postId={reportingPostId} onClose={() => setReportingPostId(null)} />
      )}
      <div
        id={`post-${post.post_number}`}
        className="arena-hud-panel overflow-hidden"
      >
        <div className="flex gap-0 sm:gap-4">
          {/* User card — sidebar */}
          <div className="hidden sm:block w-40 shrink-0 border-r border-border/30 bg-white/[0.01] p-3">
            <ForumUserCardPanel card={post.author} />
          </div>

          {/* Post body */}
          <div className="flex-1 min-w-0 p-4">
            {/* Mobile author */}
            <div className="sm:hidden flex items-center gap-2 mb-3 text-[11px] text-muted-foreground">
              <span className="text-foreground/80 font-display">{post.author.username}</span>
              <span>·</span>
              <span>{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
            </div>

            {/* Post meta */}
            <div className="hidden sm:flex items-center justify-between mb-3 text-[10px] text-muted-foreground border-b border-border/20 pb-2">
              <span className="font-mono">#{post.post_number}</span>
              <div className="flex items-center gap-2">
                {post.edit_count > 0 && (
                  <span className="italic opacity-60">edited</span>
                )}
                <span title={format(new Date(post.created_at), "PPpp")}>
                  {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>

            {post.is_deleted ? (
              <p className="text-muted-foreground/50 italic text-sm">[This post has been deleted]</p>
            ) : editing ? (
              <EditableBody
                post={post}
                onSave={async (body) => {
                  await onEdit(post.id, body);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="prose prose-sm prose-invert max-w-none text-foreground/90 leading-relaxed
                prose-headings:font-hud prose-headings:text-arena-cyan
                prose-a:text-arena-cyan prose-a:no-underline hover:prose-a:underline
                prose-code:bg-white/5 prose-code:px-1 prose-code:rounded prose-code:text-[0.8em]
                prose-pre:!bg-transparent prose-pre:!p-0
                prose-blockquote:border-l-arena-cyan prose-blockquote:text-muted-foreground
                prose-strong:text-foreground prose-hr:border-border/30">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {post.body}
                </ReactMarkdown>
              </div>
            )}

            {/* Signature */}
            {!post.is_deleted && !editing && post.author.forum_signature && (
              <div className="mt-4 pt-3 border-t border-border/20 text-[11px] text-muted-foreground/60 italic">
                {post.author.forum_signature}
              </div>
            )}

            {/* Reactions + actions row */}
            {!post.is_deleted && !editing && (
              <div className="mt-3 flex items-center flex-wrap gap-1.5">
                {REACTIONS.map((emoji) => {
                  const count = post.reactions[emoji] ?? 0;
                  return (
                    <button
                      key={emoji}
                      onClick={() => token && void reactPost(token, post.id, emoji)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-sm transition-colors
                        ${count > 0
                          ? "bg-arena-cyan/10 border border-arena-cyan/30 text-foreground"
                          : "bg-white/5 border border-border/30 text-muted-foreground hover:border-arena-cyan/30"
                        }`}
                      title={token ? `React with ${emoji}` : "Sign in to react"}
                    >
                      <span>{emoji}</span>
                      {count > 0 && (
                        <span className="text-[10px] font-mono">{count}</span>
                      )}
                    </button>
                  );
                })}

                <div className="ml-auto flex items-center gap-1">
                  {canEdit && (
                    <button
                      onClick={() => setEditing(true)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]
                        text-muted-foreground/50 hover:text-foreground border border-transparent
                        hover:border-border/40 transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  )}
                  {user && !canDelete && (
                    <button
                      onClick={() => setReportingPostId(post.id)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]
                        text-muted-foreground/50 hover:text-yellow-500/80 border border-transparent
                        hover:border-yellow-500/30 transition-colors"
                    >
                      <Flag className="h-3 w-3" />
                      Report
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => void handleDelete()}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]
                        text-muted-foreground/50 hover:text-destructive border border-transparent
                        hover:border-destructive/30 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── ThreadPage ────────────────────────────────────────────────────────────────
export default function ThreadPage() {
  const { threadSlug } = useParams<{ threadSlug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user);

  const {
    thread, threadLoading, loadThread,
    posts, postsLoading, postsPage, postsPages, loadPosts,
    submitPost, pollThread,
  } = useForumStore();

  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [localPosts, setLocalPosts] = useState<ForumPost[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (threadSlug) void loadThread(threadSlug);
  }, [threadSlug, loadThread]);

  useEffect(() => {
    if (thread) void loadPosts(thread.id, currentPage);
  }, [thread?.id, currentPage, loadPosts]);

  useEffect(() => {
    setLocalPosts(posts);
  }, [posts]);

  // Live polling on last page
  useEffect(() => {
    if (!thread || postsPage < postsPages) return;
    pollRef.current = setInterval(() => {
      void pollThread(thread.id);
    }, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [thread?.id, postsPage, postsPages, pollThread]);

  const isMod = user?.role === "admin" || user?.role === "moderator";

  const handleReply = useCallback(async () => {
    if (!token || !thread || !replyBody.trim()) return;
    setReplying(true);
    const post = await submitPost(token, thread.id, replyBody.trim());
    if (post) {
      setReplyBody("");
    } else {
      toast({ title: "Failed to post reply", variant: "destructive" });
    }
    setReplying(false);
  }, [token, thread, replyBody, submitPost, toast]);

  const handleEditPost = useCallback(async (postId: string, body: string) => {
    if (!token) return;
    const res = await fetch(`/api/forum/posts/${encodeURIComponent(postId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      setLocalPosts((prev) => prev.map((p) => p.id === postId ? { ...p, body, edit_count: p.edit_count + 1 } : p));
    } else {
      toast({ title: "Failed to edit post", variant: "destructive" });
    }
  }, [token, toast]);

  const handlePostDeleted = useCallback((postId: string) => {
    setLocalPosts((prev) =>
      prev.map((p) => p.id === postId ? { ...p, is_deleted: true, body: "[deleted]" } : p)
    );
  }, []);

  const handlePinThread = async () => {
    if (!token || !thread) return;
    const ok = await apiPinForumThread(token, thread.id, !thread.is_pinned);
    if (ok) void loadThread(threadSlug!);
  };

  const handleLockThread = async () => {
    if (!token || !thread) return;
    const ok = await apiLockForumThread(token, thread.id, thread.status !== "locked");
    if (ok) void loadThread(threadSlug!);
  };

  const handleDeleteThread = async () => {
    if (!token || !thread) return;
    const ok = await apiDeleteForumThread(token, thread.id);
    if (ok) navigate(`/forum/${thread.category_slug}`);
    else toast({ title: "Failed to delete thread", variant: "destructive" });
  };

  if (threadLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center text-muted-foreground text-sm">
        Loading thread…
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center text-muted-foreground text-sm">
        Thread not found.{" "}
        <Link to="/forum" className="text-arena-cyan hover:underline">Back to forum</Link>
      </div>
    );
  }

  const canReply = user && thread.status !== "locked";

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
        <Link to="/forum" className="hover:text-arena-cyan transition-colors">Forum</Link>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <Link
          to={`/forum/${thread.category_slug}`}
          className="hover:text-arena-cyan transition-colors"
        >
          {thread.category_name}
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="text-foreground/60 truncate max-w-[200px]">{thread.title}</span>
      </div>

      {/* Thread header */}
      <div className="arena-hud-panel px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {thread.is_pinned && <Pin className="h-3.5 w-3.5 text-arena-cyan shrink-0" />}
              {thread.status === "locked" && <Lock className="h-3.5 w-3.5 text-yellow-500/70 shrink-0" />}
              <h1 className="font-hud text-base uppercase tracking-wide text-arena-cyan break-words">
                {thread.title}
              </h1>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {thread.reply_count} replies
              </span>
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {thread.view_count} views
              </span>
            </div>
          </div>

          {/* Mod toolbar */}
          {isMod && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => void handlePinThread()}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground
                  hover:text-arena-cyan border border-transparent hover:border-arena-cyan/30 transition-colors"
                title={thread.is_pinned ? "Unpin thread" : "Pin thread"}
              >
                {thread.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{thread.is_pinned ? "Unpin" : "Pin"}</span>
              </button>
              <button
                onClick={() => void handleLockThread()}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground
                  hover:text-yellow-400 border border-transparent hover:border-yellow-400/30 transition-colors"
                title={thread.status === "locked" ? "Unlock thread" : "Lock thread"}
              >
                {thread.status === "locked" ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{thread.status === "locked" ? "Unlock" : "Lock"}</span>
              </button>
              <button
                onClick={() => void handleDeleteThread()}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground
                  hover:text-destructive border border-transparent hover:border-destructive/30 transition-colors"
                title="Delete thread"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Posts */}
      <div className="space-y-3">
        {postsLoading && localPosts.length === 0 ? (
          <div className="arena-hud-panel p-8 text-center text-muted-foreground text-sm">
            Loading posts…
          </div>
        ) : (
          localPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              isMod={isMod}
              onEdit={handleEditPost}
              onDeleted={handlePostDeleted}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {postsPages > 1 && (
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
            {postsPage} / {postsPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentPage >= postsPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <ChRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Reply box */}
      {canReply ? (
        <div className="arena-hud-panel p-4 space-y-3">
          <p className="text-[11px] font-hud uppercase tracking-widest text-arena-cyan/70">
            Post a Reply
          </p>
          <Textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write your reply… Markdown supported."
            className="min-h-[100px] bg-white/5 border-border/40 text-sm resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) void handleReply();
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/50">Ctrl+Enter to submit</span>
            <Button
              size="sm"
              className="arena-hud-btn gap-1.5"
              disabled={!replyBody.trim() || replying}
              onClick={() => void handleReply()}
            >
              <Send className="h-3.5 w-3.5" />
              {replying ? "Posting…" : "Post Reply"}
            </Button>
          </div>
        </div>
      ) : thread.status === "locked" ? (
        <div className="arena-hud-panel p-4 text-center text-[12px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 inline mr-1.5 text-yellow-500/60" />
          This thread is locked.
        </div>
      ) : (
        <div className="arena-hud-panel p-4 text-center text-[12px] text-muted-foreground">
          <Link to="/auth" className="text-arena-cyan hover:underline">Sign in</Link> to reply.
        </div>
      )}
    </div>
  );
}
