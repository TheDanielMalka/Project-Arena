/* eslint-disable react-refresh/only-export-components -- intentional: exports ForgeLookPreview + renderForgeShopIcon for Shop/confirm */
// ── Forge shop icon rendering + “try on” preview helpers ──────────────────────
// DB-ready: icon strings sync with GET /api/forge/items[].icon

import type { ReactNode } from "react";
import type { ForgeCategory } from "@/types";
import { getAvatarBackground, getForgePreviewCircleStyle } from "@/lib/avatarBgs";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { parseForgeBadgeId } from "@/lib/forgeBadges";
import { forgeBadgeArtUrl } from "@/lib/badgeAssets";
import { cn } from "@/lib/utils";
import {
  Crown, Gem, Package, ShieldCheck, Zap,
} from "lucide-react";
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
    const artId = parseForgeBadgeId(icon);
    const src = artId ? forgeBadgeArtUrl(artId) : null;
    if (!src) return <span aria-hidden className="text-[10px] opacity-60">{icon}</span>;
    if (layout === "pin") {
      return (
        <img
          src={src}
          alt=""
          className="h-full w-full rounded-full object-cover shadow-[0_1px_4px_rgba(0,0,0,0.65)]"
          decoding="async"
        />
      );
    }
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full object-contain p-0.5 drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]"
        decoding="async"
      />
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
          <span className="absolute bottom-0.5 right-0.5 z-[3] h-[18px] w-[18px] overflow-hidden rounded-full ring-2 ring-background shadow-sm">
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
