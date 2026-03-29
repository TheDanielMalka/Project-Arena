/* eslint-disable react-refresh/only-export-components -- intentional: exports ForgeLookPreview + renderForgeShopIcon for Shop/confirm */
// ── Forge shop icon rendering + “try on” preview helpers ──────────────────────
// DB-ready: icon strings sync with GET /api/forge/items[].icon

import type { ReactNode } from "react";
import type { ForgeCategory } from "@/types";
import { getAvatarBackground, getForgePreviewCircleStyle } from "@/lib/avatarBgs";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import type { ForgeBadgeId } from "@/lib/forgeBadges";
import { parseForgeBadgeId } from "@/lib/forgeBadges";
import { cn } from "@/lib/utils";
import {
  Crown, Gem, Package, Shield, ShieldCheck, Sparkles, Trophy, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Identity Studio line — compact enamel “sigil” (not hex medallion); pairs with portrait art direction */
const BADGE_SIGIL: Record<
  ForgeBadgeId,
  { Icon: LucideIcon; bezel: string; face: string; iconClass: string }
> = {
  founders: {
    Icon: Sparkles,
    bezel: "bg-gradient-to-br from-amber-200/55 via-amber-600/35 to-zinc-900",
    face: "bg-gradient-to-b from-zinc-800/90 via-zinc-950 to-black",
    iconClass: "text-amber-100/95",
  },
  champions: {
    Icon: Trophy,
    bezel: "bg-gradient-to-br from-violet-300/45 via-fuchsia-700/35 to-zinc-900",
    face: "bg-gradient-to-b from-violet-950/90 via-zinc-950 to-black",
    iconClass: "text-violet-100/95",
  },
  veterans: {
    Icon: Shield,
    bezel: "bg-gradient-to-br from-slate-300/40 via-slate-600/35 to-zinc-900",
    face: "bg-gradient-to-b from-slate-900/90 via-zinc-950 to-black",
    iconClass: "text-cyan-100/90",
  },
};

/** Shop / card tile — tight, minimal outer glow */
function ForgeBadgeSigilTile({ badgeKey, iconClass }: { badgeKey: ForgeBadgeId; iconClass: string }) {
  const s = BADGE_SIGIL[badgeKey];
  const I = s.Icon;
  return (
    <div className="relative h-full w-full rounded-[7px] p-px shadow-[0_0_10px_rgba(0,0,0,0.45)]">
      <div className={cn("absolute inset-0 rounded-[inherit]", s.bezel)} aria-hidden />
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center rounded-[6px] shadow-[inset_0_1px_6px_rgba(0,0,0,0.65)]",
          s.face,
        )}
      >
        <span
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-[0.35]"
          style={{
            background: "linear-gradient(145deg, rgba(255,255,255,0.2) 0%, transparent 42%, transparent 58%, rgba(0,0,0,0.25) 100%)",
          }}
          aria-hidden
        />
        <I className={cn(iconClass, s.iconClass, "relative z-[1]")} strokeWidth={2.05} />
      </div>
    </div>
  );
}

function BoostVIPTile({
  children,
  className,
  glow,
}: {
  children: ReactNode;
  className: string;
  glow: string;
}) {
  return (
    <div
      className={cn(
        "h-full w-full rounded-md flex items-center justify-center border border-white/10",
        className,
        glow,
      )}
    >
      {children}
    </div>
  );
}

/** Renders catalog icon: preset:*, bg:*, badge:*, boost:*, vip:*, bundle:*, emoji fallback */
export function renderForgeShopIcon(
  icon: string | undefined,
  sizeHint: "sm" | "md" = "md",
  layout: "tile" | "pin" = "tile",
): ReactNode {
  if (!icon) return "🛒";
  const iconSm = sizeHint === "sm" ? "h-4 w-4" : "h-5 w-5";
  /** Badges use slightly smaller glyphs so the sigil stays legible without dominating the card */
  const badgeTileIcon = sizeHint === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const pinIcon = sizeHint === "sm" ? "h-[9px] w-[9px]" : "h-2.5 w-2.5";

  const presetUrl = getAvatarImageUrlFromStorage(icon);
  if (presetUrl) {
    return (
      <img
        src={presetUrl}
        alt=""
        className={cn("h-full w-full", identityPortraitCropClassName)}
        decoding="async"
      />
    );
  }
  if (icon.startsWith("bg:")) {
    const bgId = icon.slice(3);
    const bg = getAvatarBackground(bgId);
    return (
      <div
        className="h-full w-full rounded-md"
        style={{ background: bg.background, boxShadow: bg.shadowCss, border: bg.borderCss }}
        aria-hidden
      />
    );
  }
  if (icon.startsWith("badge:")) {
    const key = parseForgeBadgeId(icon);
    if (!key) return <span aria-hidden>{icon}</span>;
    const s = BADGE_SIGIL[key];
    const I = s.Icon;
    if (layout === "pin") {
      return (
        <div className="h-full w-full rounded-full p-px bg-gradient-to-br from-white/30 to-zinc-800 shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
          <div
            className={cn(
              "flex h-full w-full items-center justify-center rounded-full",
              s.face,
              "ring-1 ring-black/40",
            )}
          >
            <I className={cn(pinIcon, s.iconClass)} strokeWidth={2.15} />
          </div>
        </div>
      );
    }
    return (
      <div className="h-full w-full overflow-hidden rounded-[7px]">
        <ForgeBadgeSigilTile badgeKey={key} iconClass={badgeTileIcon} />
      </div>
    );
  }
  if (icon.startsWith("boost:")) {
    const k = icon.slice(6);
    if (k === "xp") {
      return (
        <BoostVIPTile
          className="bg-gradient-to-br from-primary/50 via-emerald-950/80 to-black text-primary-foreground"
          glow="shadow-[0_0_16px_hsl(var(--primary)/0.35)]"
        >
          <Zap className={cn(iconSm)} strokeWidth={2.4} />
        </BoostVIPTile>
      );
    }
    if (k === "shield") {
      return (
        <BoostVIPTile
          className="bg-gradient-to-br from-slate-400/40 via-slate-950 to-black text-white"
          glow="shadow-[0_0_14px_rgba(148,163,184,0.35)]"
        >
          <ShieldCheck className={cn(iconSm)} strokeWidth={2.2} />
        </BoostVIPTile>
      );
    }
  }
  if (icon.startsWith("vip:")) {
    const k = icon.slice(4);
    if (k === "month" || k === "week") {
      return (
        <BoostVIPTile
          className="bg-gradient-to-br from-arena-gold/45 via-amber-950/90 to-black text-arena-gold"
          glow="shadow-[0_0_18px_rgba(234,179,8,0.35)]"
        >
          {k === "month" ? (
            <Crown className={cn(iconSm)} strokeWidth={2.2} />
          ) : (
            <Gem className={cn(iconSm)} strokeWidth={2.2} />
          )}
        </BoostVIPTile>
      );
    }
  }
  if (icon.startsWith("bundle:")) {
    return (
      <BoostVIPTile
        className="bg-gradient-to-br from-arena-purple/45 via-violet-950 to-black text-white"
        glow="shadow-[0_0_16px_rgba(139,92,246,0.4)]"
      >
        <Package className={cn(iconSm)} strokeWidth={2.2} />
      </BoostVIPTile>
    );
  }
  return <span className="text-lg leading-none" aria-hidden>{icon}</span>;
}

function AvatarFace({
  avatar,
  username,
  className,
}: {
  avatar: string | undefined;
  username: string;
  className?: string;
}) {
  const initials = username.slice(0, 2).toUpperCase();
  const av = avatar ?? "initials";
  if (av === "initials") {
    return (
      <span className={cn("font-display font-bold text-white text-[11px] sm:text-sm", className)}>
        {initials}
      </span>
    );
  }
  if (av.startsWith("upload:")) {
    return <img src={av.slice(7)} alt="" className="h-full w-full object-cover" />;
  }
  const url = getAvatarImageUrlFromStorage(av);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn("h-full w-full", identityPortraitCropClassName)}
        decoding="async"
      />
    );
  }
  return <span className="text-base">{av}</span>;
}

/** Mini profile ring — shows how a frame + avatar look together */
export function ForgeLookPreview({
  username,
  baseAvatar,
  baseBgId,
  tryOnIcon,
  tryCategory,
  size = "md",
}: {
  username: string;
  baseAvatar: string | undefined;
  baseBgId: string | undefined;
  /** ForgeItem.icon */
  tryOnIcon?: string;
  tryCategory?: ForgeCategory;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-14 w-14" : "h-[4.25rem] w-[4.25rem]";
  let bgId = baseBgId ?? "default";
  let faceAvatar: string | undefined = baseAvatar;
  const badgeOverlay = tryOnIcon?.startsWith("badge:") && tryCategory === "badge";

  if (tryOnIcon?.startsWith("bg:")) {
    bgId = tryOnIcon.slice(3);
  } else if (tryOnIcon?.startsWith("preset:")) {
    faceAvatar = tryOnIcon;
  }

  const circleStyle = getForgePreviewCircleStyle(bgId);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full ring-1 ring-white/12",
          dim,
        )}
        style={circleStyle}
      >
        <span className="pointer-events-none absolute inset-0 opacity-[0.14] bg-gradient-to-br from-white/45 to-transparent rounded-full" />
        <span className="relative z-[1] flex h-[78%] w-[78%] items-center justify-center overflow-hidden rounded-full bg-black/25">
          <AvatarFace avatar={faceAvatar} username={username} />
        </span>
        {badgeOverlay && tryOnIcon && (
          <span className="absolute bottom-0 right-0 z-[3] h-[15px] w-[15px] overflow-hidden translate-x-px translate-y-px">
            {renderForgeShopIcon(tryOnIcon, "sm", "pin")}
          </span>
        )}
      </div>
      <span className="text-[9px] font-mono text-muted-foreground text-center max-w-[11rem] leading-tight">
        Profile preview{(tryOnIcon ? " · item applied" : "")}
      </span>
    </div>
  );
}
