import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Send } from "lucide-react";
import { useForumStore } from "@/stores/forumStore";
import { useUserStore } from "@/stores/userStore";
import { apiCreateForumThread } from "@/lib/engine-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function NewThreadPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user);
  const { categories, loadCategories } = useForumStore();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-select category from query param
  useEffect(() => {
    const slug = searchParams.get("category");
    if (slug) {
      void loadCategories().then(() => {
        const all = [...categories, ...categories.flatMap((c) => c.children)];
        const found = all.find((c) => c.slug === slug);
        if (found) setCategoryId(found.id);
      });
    } else {
      void loadCategories();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Also set category when categories load
  useEffect(() => {
    const slug = searchParams.get("category");
    if (slug && !categoryId) {
      const all = [...categories, ...categories.flatMap((c) => c.children)];
      const found = all.find((c) => c.slug === slug);
      if (found) setCategoryId(found.id);
    }
  }, [categories, searchParams, categoryId]);

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center text-muted-foreground text-sm">
        <Link to="/auth" className="text-arena-cyan hover:underline">Sign in</Link> to create a thread.
      </div>
    );
  }

  const allLeafCategories = [
    ...categories,
    ...categories.flatMap((c) => c.children),
  ];

  const handleSubmit = async () => {
    if (!token || !title.trim() || !body.trim() || !categoryId) return;
    setSubmitting(true);
    const result = await apiCreateForumThread(token, {
      title: title.trim(),
      category_id: categoryId,
      body: body.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      const detail = (result as { ok: false; detail: string }).detail;
      toast({ title: "Failed to create thread", description: detail, variant: "destructive" });
      return;
    }
    navigate(`/forum/t/${result.slug}`);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Link to="/forum" className="hover:text-arena-cyan transition-colors">Forum</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground/60">New Thread</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 bg-arena-cyan shadow-[0_0_8px_hsl(var(--arena-cyan)/0.6)]" />
        <h1 className="font-hud text-lg uppercase tracking-widest text-arena-cyan">New Thread</h1>
      </div>

      <div className="arena-hud-panel p-5 space-y-4">
        {/* Category */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-hud uppercase tracking-widest text-arena-cyan/70">
            Category
          </label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="bg-white/5 border-border/40">
              <SelectValue placeholder="Select a category…" />
            </SelectTrigger>
            <SelectContent>
              {allLeafCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.icon && <span className="mr-1.5">{cat.icon}</span>}
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-hud uppercase tracking-widest text-arena-cyan/70">
            Title
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Thread title…"
            maxLength={200}
            className="bg-white/5 border-border/40"
          />
          <p className="text-[10px] text-muted-foreground/50 text-right">{title.length}/200</p>
        </div>

        {/* Body */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-hud uppercase tracking-widest text-arena-cyan/70">
            Content
          </label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your post… Markdown supported."
            className="min-h-[200px] bg-white/5 border-border/40 resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) void handleSubmit();
            }}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground/50">Ctrl+Enter to submit</span>
          <Button
            className="arena-hud-btn gap-1.5"
            disabled={!title.trim() || !body.trim() || !categoryId || submitting}
            onClick={() => void handleSubmit()}
          >
            <Send className="h-3.5 w-3.5" />
            {submitting ? "Creating…" : "Create Thread"}
          </Button>
        </div>
      </div>
    </div>
  );
}
