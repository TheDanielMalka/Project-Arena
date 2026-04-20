import { useCallback, useEffect, useState } from "react";
import {
  Tv2, Youtube, Twitter, ExternalLink, Star, Radio, Crosshair,
  ChevronRight, Send, X, CheckCircle2, Loader2, Crown, Flame,
  Trophy, Users, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUserStore }   from "@/stores/userStore";
import { ArenaPageShell } from "@/components/visual";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { renderForgeShopIcon } from "@/lib/forgeItemIcon";
import { cn } from "@/lib/utils";
import {
  apiGetCreators, apiGetCreator, apiApplyCreator,
} from "@/lib/engine-api";
import type { CreatorProfile } from "@/types";

// ─── Constants ───────────────────────────────────────────────

const CREATOR_NAV = [
  { id: "all"      as const, icon: Users,    label: "All Creators",  short: "ALL",  desc: "Full roster · featured first" },
  { id: "by_game"  as const, icon: Crosshair, label: "By Game",      short: "GAME", desc: "Filter by title" },
  { id: "by_tier"  as const, icon: Crown,    label: "By Tier",       short: "TIER", desc: "Rank classification" },
  { id: "featured" as const, icon: Star,     label: "Featured",      short: "FEAT", desc: "Hand-picked by Arena" },
  { id: "apply"    as const, icon: Radio,    label: "Apply",         short: "APLX", desc: "Join the creator roster" },
] as const;
type CreatorSection = (typeof CREATOR_NAV)[number]["id"];

const GAME_FILTERS = ["All Games", "CS2", "Valorant", "MLBB", "Wild Rift", "Honor of Kings", "Fortnite", "Apex Legends"];
const TIER_FILTERS = ["All Tiers", "Champion", "Legend", "Elite", "Diamond", "Platinum", "Gold"];

const gameColor: Record<string, string> = {
  CS2: "#F97316", Valorant: "#EF4444", MLBB: "#FFD700",
  "Wild Rift": "#38BDF8", "Honor of Kings": "#A855F7",
  Fortnite: "#38BDF8", "Apex Legends": "#6366F1",
};

const tierColor: Record<string, string> = {
  Champion: "#FFD700", Legend: "#C0C0C0", Elite: "#CD7F32",
  Diamond: "#A855F7", Platinum: "#00C9C9", Gold: "#F59E0B",
};

// ─── Helpers ─────────────────────────────────────────────────

function PlatformLinks({ c }: { c: CreatorProfile }) {
  const links = [
    { url: c.twitch_url,  icon: Tv2,      label: "Twitch",  color: "text-purple-400" },
    { url: c.youtube_url, icon: Youtube,  label: "YouTube", color: "text-red-400"    },
    { url: c.tiktok_url,  icon: Zap,      label: "TikTok",  color: "text-pink-400"   },
    { url: c.twitter_url, icon: Twitter,  label: "Twitter", color: "text-sky-400"    },
  ].filter((l) => l.url);
  if (!links.length) return <span className="text-muted-foreground/40 text-[10px] font-mono">NO LINKS</span>;
  return (
    <div className="flex items-center gap-2">
      {links.map(({ url, icon: Icon, label, color }) => (
        <a key={label} href={url!} target="_blank" rel="noreferrer"
          className={cn("transition-opacity hover:opacity-100 opacity-70", color)}
          title={label}>
          <Icon className="h-3.5 w-3.5" />
        </a>
      ))}
    </div>
  );
}

// ─── Creator Card ────────────────────────────────────────────

interface CreatorCardProps {
  creator: CreatorProfile;
  onClick: (c: CreatorProfile) => void;
}

function CreatorCard({ creator: c, onClick }: CreatorCardProps) {
  const avatarUrl = getAvatarImageUrlFromStorage(c.avatar);
  const gameCol = gameColor[c.primary_game] ?? "#00C9C9";
  const tierCol = c.rank_tier ? (tierColor[c.rank_tier] ?? "#A0A0A0") : "#A0A0A0";

  return (
    <div
      onClick={() => onClick(c)}
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-gray-950/80 transition-all duration-200",
        "hover:border-arena-cyan/40 hover:shadow-[0_0_18px_hsl(var(--arena-cyan)/0.12)]",
        c.featured
          ? "border-arena-gold/40 shadow-[0_0_12px_hsl(43_96%_56%/0.1)]"
          : "border-border/40",
      )}>
      {/* featured ribbon */}
      {c.featured && (
        <div className="absolute top-0 right-0 px-2 py-0.5 bg-arena-gold/10 border-b border-l border-arena-gold/30 rounded-tr-lg rounded-bl-lg">
          <span className="text-[9px] font-mono text-arena-gold tracking-widest uppercase">FEATURED</span>
        </div>
      )}

      {/* game accent bar */}
      <div className="h-[2px] rounded-t-lg w-full" style={{ background: gameCol }} />

      <div className="p-4 space-y-3">
        {/* avatar + info */}
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <div className={cn(
              "h-12 w-12 rounded-full overflow-hidden border-2 flex items-center justify-center text-sm font-bold",
              c.featured ? "border-arena-gold/60" : "border-border/50",
            )} style={{ background: c.avatar_bg ? `var(--${c.avatar_bg}, #1a1a2e)` : "#1a1a2e" }}>
              {avatarUrl
                ? <img src={avatarUrl} alt={c.display_name} className={cn("h-full w-full object-cover", identityPortraitCropClassName(c.avatar))} />
                : <span className="text-foreground/80">{c.display_name.slice(0, 2).toUpperCase()}</span>
              }
            </div>
            {c.equipped_badge_icon && (
              <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-background border border-border/60 flex items-center justify-center text-[9px]">
                {renderForgeShopIcon(c.equipped_badge_icon, "h-3 w-3")}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-foreground text-sm leading-tight truncate">{c.display_name}</p>
            <p className="text-muted-foreground/60 text-[11px] font-mono truncate">@{c.username}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
                style={{ color: gameCol, borderColor: `${gameCol}40`, background: `${gameCol}10` }}>
                {c.primary_game}
              </span>
              {c.rank_tier && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
                  style={{ color: tierCol, borderColor: `${tierCol}40`, background: `${tierCol}10` }}>
                  {c.rank_tier}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* bio */}
        {c.bio && (
          <p className="text-muted-foreground/70 text-[11px] leading-relaxed line-clamp-2">{c.bio}</p>
        )}

        {/* stats row */}
        {(c.total_matches !== undefined || c.wins !== undefined) && (
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground/60">
            {c.total_matches !== undefined && <span>{c.total_matches} <span className="text-muted-foreground/40">MATCHES</span></span>}
            {c.wins !== undefined && <span className="text-arena-cyan/70">{c.wins} <span className="text-muted-foreground/40">WINS</span></span>}
          </div>
        )}

        {/* platform links + watch CTA */}
        <div className="flex items-center justify-between pt-1 border-t border-border/20">
          <PlatformLinks c={c} />
          <button className="text-[9px] font-mono text-arena-cyan/60 hover:text-arena-cyan flex items-center gap-1 transition-colors">
            VIEW <ChevronRight className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Creator Detail Modal ────────────────────────────────────

function CreatorModal({ creator: c, onClose }: { creator: CreatorProfile; onClose: () => void }) {
  const avatarUrl = getAvatarImageUrlFromStorage(c.avatar);
  const gameCol   = gameColor[c.primary_game] ?? "#00C9C9";

  const platformLinks = [
    { url: c.twitch_url,  icon: Tv2,     label: "Twitch",  color: "bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20" },
    { url: c.youtube_url, icon: Youtube, label: "YouTube", color: "bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20" },
    { url: c.tiktok_url,  icon: Zap,     label: "TikTok",  color: "bg-pink-500/10 border-pink-500/30 text-pink-300 hover:bg-pink-500/20" },
    { url: c.twitter_url, icon: Twitter, label: "Twitter", color: "bg-sky-500/10 border-sky-500/30 text-sky-300 hover:bg-sky-500/20" },
  ].filter((l) => l.url);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-gray-950 border-border/50 p-0 overflow-hidden">
        <div className="h-[3px] w-full" style={{ background: gameCol }} />

        <div className="p-6 space-y-5">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <div className="h-16 w-16 rounded-full overflow-hidden border-2 border-arena-cyan/30 flex items-center justify-center text-lg font-bold bg-secondary/40">
                  {avatarUrl
                    ? <img src={avatarUrl} alt={c.display_name} className={cn("h-full w-full object-cover", identityPortraitCropClassName(c.avatar))} />
                    : c.display_name.slice(0, 2).toUpperCase()
                  }
                </div>
                {c.featured && (
                  <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-arena-gold/20 border border-arena-gold/50 flex items-center justify-center">
                    <Star className="h-2.5 w-2.5 text-arena-gold" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold text-foreground">{c.display_name}</DialogTitle>
                <DialogDescription className="text-muted-foreground/60 font-mono text-xs">@{c.username}</DialogDescription>
                {c.arena_id && <p className="text-[10px] font-mono text-muted-foreground/40 mt-0.5">{c.arena_id}</p>}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded border"
                    style={{ color: gameCol, borderColor: `${gameCol}40`, background: `${gameCol}10` }}>
                    {c.primary_game}
                  </span>
                  {c.rank_tier && (
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded border"
                      style={{ color: tierColor[c.rank_tier] ?? "#A0A0A0", borderColor: `${tierColor[c.rank_tier] ?? "#A0A0A0"}40` }}>
                      {c.rank_tier}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </DialogHeader>

          {c.bio && (
            <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-arena-cyan/30 pl-3">{c.bio}</p>
          )}

          {/* stats */}
          {(c.total_matches !== undefined || c.wins !== undefined) && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "MATCHES", value: c.total_matches ?? 0, color: "text-foreground" },
                { label: "WINS",    value: c.wins ?? 0,          color: "text-arena-cyan" },
                { label: "WIN RATE", value: c.total_matches ? `${Math.round((c.wins ?? 0) / c.total_matches * 100)}%` : "—", color: "text-arena-gold" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-secondary/30 rounded-lg p-3 text-center border border-border/30">
                  <p className={cn("text-lg font-bold font-mono", color)}>{value}</p>
                  <p className="text-[9px] font-mono text-muted-foreground/50 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* platform links */}
          {platformLinks.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest">PLATFORMS</p>
              <div className="grid grid-cols-2 gap-2">
                {platformLinks.map(({ url, icon: Icon, label, color }) => (
                  <a key={label} href={url!} target="_blank" rel="noreferrer"
                    className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors", color)}>
                    <Icon className="h-4 w-4" />
                    {label}
                    <ExternalLink className="h-3 w-3 ml-auto opacity-60" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* clips */}
          {c.clip_urls.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest">CLIPS</p>
              <div className="space-y-1">
                {c.clip_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-xs text-arena-cyan/70 hover:text-arena-cyan transition-colors font-mono">
                    <Zap className="h-3 w-3" />
                    Clip {i + 1}
                    <ExternalLink className="h-2.5 w-2.5 ml-auto" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Apply Modal ─────────────────────────────────────────────

function ApplyModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const token   = useUserStore((s) => s.token);
  const [form, setForm] = useState({
    primary_game: "", bio: "", motivation: "",
    twitch_url: "", youtube_url: "", tiktok_url: "", twitter_url: "",
  });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  const submit = async () => {
    if (!form.primary_game) { setError("Select a primary game"); return; }
    if (!token) { setError("You must be logged in"); return; }
    setLoading(true); setError(null);
    try {
      await apiApplyCreator(token, form);
      setSuccess(true);
      setTimeout(onSuccess, 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-gray-950 border-border/50 p-0 overflow-hidden">
        <div className="h-[2px] w-full bg-gradient-to-r from-arena-cyan via-primary to-arena-purple" />
        <div className="p-6 space-y-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Radio className="h-4 w-4 text-arena-cyan" />
              Creator Application
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/60 text-xs font-mono">
              APPLY · ARENA CREATOR NETWORK · REVIEWED BY STAFF
            </DialogDescription>
          </DialogHeader>

          {success ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm text-foreground font-medium">Application Submitted</p>
              <p className="text-xs text-muted-foreground/60 text-center">Our team will review it within 48h. You'll receive a notification.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">Primary Game *</label>
                <Select value={form.primary_game} onValueChange={(v) => setForm((f) => ({ ...f, primary_game: v }))}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 text-sm">
                    <SelectValue placeholder="Select game..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-border/50">
                    {["CS2", "Valorant", "MLBB", "Wild Rift", "Honor of Kings", "Fortnite", "Apex Legends"].map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {[
                { key: "twitch_url",  label: "Twitch URL",  placeholder: "https://twitch.tv/..." },
                { key: "youtube_url", label: "YouTube URL", placeholder: "https://youtube.com/..." },
                { key: "tiktok_url",  label: "TikTok URL",  placeholder: "https://tiktok.com/..." },
                { key: "twitter_url", label: "Twitter/X URL", placeholder: "https://x.com/..." },
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">{label}</label>
                  <Input
                    className="bg-secondary/40 border-border/50 text-sm h-8"
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">Bio</label>
                <Textarea
                  className="bg-secondary/40 border-border/50 text-sm min-h-[72px] resize-none"
                  placeholder="Tell the Arena community about yourself..."
                  value={form.bio}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                  maxLength={300}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">Why do you want to join?</label>
                <Textarea
                  className="bg-secondary/40 border-border/50 text-sm min-h-[60px] resize-none"
                  placeholder="Your motivation..."
                  value={form.motivation}
                  onChange={(e) => setForm((f) => ({ ...f, motivation: e.target.value }))}
                  maxLength={500}
                />
              </div>

              {error && (
                <p className="text-xs text-destructive font-mono bg-destructive/10 border border-destructive/30 rounded px-3 py-2">{error}</p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" onClick={submit} disabled={loading} className="flex-1 bg-arena-cyan/10 border border-arena-cyan/40 text-arena-cyan hover:bg-arena-cyan/20">
                  {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                  Submit
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function Creators() {
  const user  = useUserStore((s) => s.user);
  const [section, setSection]         = useState<CreatorSection>("all");
  const [creators, setCreators]       = useState<CreatorProfile[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<CreatorProfile | null>(null);
  const [showApply, setShowApply]     = useState(false);
  const [gameFilter, setGameFilter]   = useState("All Games");
  const [tierFilter, setTierFilter]   = useState("All Tiers");

  const fetchCreators = useCallback(async (overrides?: { game?: string; tier?: string; featured?: boolean }) => {
    setLoading(true);
    try {
      const params: Record<string, string | boolean> = {};
      const g = overrides?.game ?? (gameFilter !== "All Games" ? gameFilter : undefined);
      const t = overrides?.tier ?? (tierFilter !== "All Tiers" ? tierFilter : undefined);
      if (g) params.game = g;
      if (t) params.tier = t;
      if (overrides?.featured) params.featured = true;
      const data = await apiGetCreators(params);
      setCreators(data.creators);
    } catch {
      setCreators([]);
    } finally {
      setLoading(false);
    }
  }, [gameFilter, tierFilter]);

  useEffect(() => {
    if (section === "featured") {
      fetchCreators({ featured: true });
    } else if (section === "apply") {
      setLoading(false);
    } else {
      fetchCreators();
    }
  }, [section, fetchCreators]);

  const handleCardClick = useCallback(async (c: CreatorProfile) => {
    try {
      const full = await apiGetCreator(c.id);
      setSelected(full);
    } catch {
      setSelected(c);
    }
  }, []);

  const filteredCreators = creators.filter((c) => {
    if (section === "by_game" && gameFilter !== "All Games" && c.primary_game !== gameFilter) return false;
    if (section === "by_tier" && tierFilter !== "All Tiers" && c.rank_tier !== tierFilter) return false;
    return true;
  });

  return (
    <ArenaPageShell>
      <div className="flex flex-col gap-0 min-h-screen text-foreground">

        {/* ── Page header ── */}
        <div className="relative border-b border-border/30 bg-gray-950/60 px-6 py-5">
          <div className="absolute top-3 left-4 text-[9px] font-mono text-muted-foreground/30 tracking-widest">SYS_REF_CRTX</div>
          <div className="absolute top-3 right-4 text-[9px] font-mono text-muted-foreground/30 tracking-widest">ARENA_CREATORS · SYNC OK</div>
          <p className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest mb-1">CREATOR NETWORK</p>
          <div className="flex items-end gap-4">
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground uppercase font-mono flex items-center gap-3">
              <Trophy className="h-8 w-8 text-arena-gold" />
              CREATORS
            </h1>
          </div>
          <p className="text-muted-foreground/50 text-xs font-mono mt-1 uppercase tracking-wider">
            FEATURED ROSTER · VERIFIED ARENA PLAYERS · CONTENT NETWORK
          </p>
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-arena-cyan/20 to-transparent" />
        </div>

        {/* ── Body: sidebar + content ── */}
        <div className="flex flex-1">

          {/* Left nav */}
          <div className="w-48 shrink-0 border-r border-border/30 bg-gray-950/40 py-4 flex flex-col gap-1 px-2">
            {CREATOR_NAV.map(({ id, icon: Icon, label, short, desc }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-md transition-all duration-150 group",
                  section === id
                    ? "bg-arena-cyan/8 border border-arena-cyan/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60 border border-transparent",
                )}>
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", section === id ? "text-arena-cyan" : "text-muted-foreground/60 group-hover:text-muted-foreground")} />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
                  {section === id && <ChevronRight className="hidden md:block h-3 w-3 ml-auto opacity-40" />}
                </div>
                <p className="text-[9px] font-mono text-muted-foreground/40 mt-0.5 pl-5">{desc}</p>
              </button>
            ))}

            {/* apply CTA */}
            {user && section !== "apply" && (
              <button
                onClick={() => setShowApply(true)}
                className="mt-auto mx-1 px-3 py-2 rounded-md border border-arena-cyan/25 bg-arena-cyan/5 text-arena-cyan/80 hover:bg-arena-cyan/10 hover:text-arena-cyan transition-colors text-[10px] font-mono uppercase tracking-widest flex items-center gap-1.5">
                <Radio className="h-3 w-3" />
                APPLY NOW
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 p-6">

            {/* filter bar */}
            {(section === "by_game" || section === "by_tier" || section === "all") && (
              <div className="flex items-center gap-3 mb-5 flex-wrap">
                {(section === "by_game" || section === "all") && (
                  <Select value={gameFilter} onValueChange={(v) => setGameFilter(v)}>
                    <SelectTrigger className="w-40 h-7 text-xs bg-secondary/40 border-border/40 font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-border/50">
                      {GAME_FILTERS.map((g) => <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {(section === "by_tier" || section === "all") && (
                  <Select value={tierFilter} onValueChange={(v) => setTierFilter(v)}>
                    <SelectTrigger className="w-36 h-7 text-xs bg-secondary/40 border-border/40 font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-border/50">
                      {TIER_FILTERS.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <span className="text-[10px] font-mono text-muted-foreground/40 ml-auto">
                  {loading ? "LOADING..." : `${filteredCreators.length} CREATORS`}
                </span>
              </div>
            )}

            {/* apply section */}
            {section === "apply" && (
              <div className="max-w-lg mx-auto text-center space-y-6 py-10">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-arena-cyan/10 border border-arena-cyan/30">
                  <Radio className="h-8 w-8 text-arena-cyan" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">Join the Creator Network</h2>
                  <p className="text-muted-foreground/70 text-sm leading-relaxed">
                    Are you a streamer or content creator who plays on Arena? Apply to be featured on the Creators page and grow your audience.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 text-left">
                  {[
                    { icon: Star,    title: "Get Featured",     desc: "Appear on the Arena Creators page visible to all players" },
                    { icon: Flame,   title: "Grow Your Audience", desc: "Arena directs players to your streams and content" },
                    { icon: Trophy,  title: "Creator Badge",    desc: "Exclusive badge on your Arena profile" },
                  ].map(({ icon: Icon, title, desc }) => (
                    <div key={title} className="flex items-start gap-3 p-3 rounded-lg border border-border/30 bg-secondary/20">
                      <Icon className="h-4 w-4 text-arena-cyan mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{title}</p>
                        <p className="text-xs text-muted-foreground/60">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {user ? (
                  <Button onClick={() => setShowApply(true)}
                    className="w-full bg-arena-cyan/10 border border-arena-cyan/40 text-arena-cyan hover:bg-arena-cyan/20">
                    <Send className="h-4 w-4 mr-2" />
                    Submit Application
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground/60">You must be logged in to apply.</p>
                )}
              </div>
            )}

            {/* grid */}
            {section !== "apply" && (
              <>
                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-arena-cyan/50" />
                  </div>
                ) : filteredCreators.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-20 text-center">
                    <Users className="h-10 w-10 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground/40 font-mono">NO CREATORS FOUND</p>
                    <p className="text-xs text-muted-foreground/30">Be the first — apply to join the network.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredCreators.map((c) => (
                      <CreatorCard key={c.id} creator={c} onClick={handleCardClick} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {selected  && <CreatorModal creator={selected} onClose={() => setSelected(null)} />}
      {showApply && (
        <ApplyModal
          onClose={() => setShowApply(false)}
          onSuccess={() => { setShowApply(false); setSection("all"); fetchCreators(); }}
        />
      )}
    </ArenaPageShell>
  );
}
