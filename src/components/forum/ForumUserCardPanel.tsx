import { Link } from "react-router-dom";
import { Shield, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ForumUserCard } from "@/lib/engine-api";

const ROLE_COLORS: Record<string, string> = {
  admin:     "text-red-400",
  moderator: "text-yellow-400",
  user:      "text-muted-foreground",
};

const ROLE_LABELS: Record<string, string> = {
  admin:     "Admin",
  moderator: "Moderator",
  user:      "Member",
};

interface Props {
  card: ForumUserCard;
  compact?: boolean;
}

export function ForumUserCardPanel({ card, compact = false }: Props) {
  const initial = card.username.slice(0, 2).toUpperCase();
  const roleColor = ROLE_COLORS[card.role] ?? ROLE_COLORS.user;
  const roleLabel = ROLE_LABELS[card.role] ?? "Member";

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {/* Avatar */}
      <Link to={`/players/${card.username}`} className="shrink-0">
        <div
          className={cn(
            "rounded-sm flex items-center justify-center font-bold text-background select-none",
            "ring-1 ring-border/40 hover:ring-arena-cyan/50 transition-all",
            compact ? "w-8 h-8 text-xs" : "w-12 h-12 text-sm",
          )}
          style={{ background: card.avatar_bg ?? "hsl(var(--arena-cyan))" }}
        >
          {initial}
        </div>
      </Link>

      {/* Username */}
      <Link
        to={`/players/${card.username}`}
        className="font-display text-xs text-foreground/90 hover:text-arena-cyan transition-colors leading-tight break-words max-w-full"
      >
        {card.username}
      </Link>

      {/* Role badge */}
      <div className={cn("flex items-center gap-1 text-[10px] font-hud", roleColor)}>
        {card.role === "admin" ? (
          <Shield className="h-2.5 w-2.5" />
        ) : card.role === "moderator" ? (
          <Star className="h-2.5 w-2.5" />
        ) : null}
        {roleLabel}
      </div>

      {!compact && (
        <>
          {/* Rank */}
          <div className="text-[10px] text-arena-cyan/70 font-mono">
            {card.rank}
          </div>

          {/* Forum post count */}
          <div className="text-[10px] text-muted-foreground">
            {card.forum_post_count} posts
          </div>

          {/* Member since */}
          <div className="text-[10px] text-muted-foreground/60">
            Since{" "}
            {new Date(card.member_since).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </div>

          {/* Custom badge */}
          {card.forum_badge && (
            <div className="px-1.5 py-0.5 rounded border border-arena-cyan/30 text-[9px] text-arena-cyan/80 bg-arena-cyan/5 font-hud max-w-full truncate">
              {card.forum_badge}
            </div>
          )}
        </>
      )}
    </div>
  );
}
