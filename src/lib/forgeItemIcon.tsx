/* eslint-disable react-refresh/only-export-components -- intentional: exports ForgeLookPreview + renderForgeShopIcon for Shop/confirm */
// ── Forge shop icon rendering + “try on” preview helpers ──────────────────────
// DB-ready: icon strings sync with GET /api/forge/items[].icon

import type { ReactNode } from "react";
import type { ForgeCategory } from "@/types";
import { getAvatarBackground, getAvatarCircleStyle } from "@/lib/avatarBgs";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { cn } from "@/lib/utils";
import {
  Crown, Gem, Package, Shield, ShieldCheck, Sparkles, Trophy, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type BadgeKey = "founders" | "champions" | "veterans";

/** Hex medallion — same “jewelry” language as Identity Studio portraits (rim light + depth) */
const BADGE_HEX =
  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)" as const;

const BADGE_ART: Record<
  BadgeKey,
  {
    Icon: LucideIcon;
    shellBg: string;
    shellShadow: string;
    faceBg: string;
    iconClass: string;
  }
> = {
  founders: {
    Icon: Sparkles,
    shellBg: "linear-gradient(165deg, #fcd34d 0%, #d97706 28%, #451a03 72%, #0c0a09 100%)",
    shellShadow:
      "0 0 26px rgba(251,191,36,0.55), 0 0 52px rgba(234,179,8,0.18), inset 0 1px 0 rgba(255,255,255,0.35)",
    faceBg:
      "linear-gradient(155deg, rgba(255,251,235,0.98) 0%, rgba(245,158,11,0.85) 18%, rgba(146,64,14,0.92) 52%, rgba(12,10,9,1) 100%)",
    iconClass:
      "text-amber-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] drop-shadow-[0_0_10px_rgba(251,191,36,0.85)]",
  },
  champions: {
    Icon: Trophy,
    shellBg: "linear-gradient(165deg, #e9d5ff 0%, #9333ea 35%, #4c1d95 78%, #0f172a 100%)",
    shellShadow:
      "0 0 26px rgba(168,85,247,0.55), 0 0 48px rgba(139,92,246,0.2), inset 0 1px 0 rgba(255,255,255,0.28)",
    faceBg:
      "linear-gradient(158deg, rgba(243,232,255,0.95) 0%, rgba(147,51,234,0.9) 28%, rgba(88,28,135,0.95) 58%, rgba(15,23,42,1) 100%)",
    iconClass:
      "text-violet-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.92)] drop-shadow-[0_0_12px_rgba(196,181,253,0.75)]",
  },
  veterans: {
    Icon: Shield,
    shellBg: "linear-gradient(165deg, #94a3b8 0%, #334155 38%, #0f172a 82%, #020617 100%)",
    shellShadow:
      "0 0 22px rgba(34,211,238,0.35), 0 0 40px rgba(56,189,248,0.12), inset 0 1px 0 rgba(255,255,255,0.22)",
    faceBg:
      "linear-gradient(155deg, rgba(226,232,240,0.92) 0%, rgba(71,85,105,0.88) 32%, rgba(30,41,59,0.95) 62%, rgba(2,6,23,1) 100%)",
    iconClass:
      "text-cyan-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.92)] drop-shadow-[0_0_8px_rgba(34,211,238,0.55)]",
  },
};

function ForgeBadgeMedallion({ badgeKey, iconSm }: { badgeKey: BadgeKey; iconSm: string }) {
  const art = BADGE_ART[badgeKey];
  const I = art.Icon;
  return (
    <div className="relative h-full w-full">
      <div
        className="absolute inset-0"
        style={{
          clipPath: BADGE_HEX,
          background: art.shellBg,
          boxShadow: art.shellShadow,
        }}
        aria-hidden
      />
      <div
        className="absolute inset-[2px] flex items-center justify-center"
        style={{
          clipPath: BADGE_HEX,
          background: art.faceBg,
          boxShadow:
            "inset 0 2px 14px rgba(0,0,0,0.55), inset 0 -2px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.52]"
          style={{
            background:
              "linear-gradient(128deg, rgba(255,255,255,0.5) 0%, transparent 40%, transparent 62%, rgba(255,255,255,0.06) 100%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-18deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)",
          }}
          aria-hidden
        />
        <I className={cn(iconSm, "relative z-[2]", art.iconClass)} strokeWidth={2.35} />
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
export function renderForgeShopIcon(icon: string | undefined, sizeHint: "sm" | "md" = "md"): ReactNode {
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
    const key = icon.slice(6) as BadgeKey;
    if (!BADGE_ART[key]) return <span aria-hidden>{icon}</span>;
    return (
      <div className="h-full w-full rounded-sm overflow-hidden">
        <ForgeBadgeMedallion badgeKey={key} iconSm={iconSm} />
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

  const circleStyle = getAvatarCircleStyle(bgId);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full ring-2 ring-white/15",
          dim,
        )}
        style={circleStyle}
      >
        <span className="pointer-events-none absolute inset-0 opacity-[0.14] bg-gradient-to-br from-white/45 to-transparent rounded-full" />
        <span className="relative z-[1] flex h-[78%] w-[78%] items-center justify-center overflow-hidden rounded-full bg-black/25">
          <AvatarFace avatar={faceAvatar} username={username} />
        </span>
        {badgeOverlay && tryOnIcon && (
          <span className="absolute bottom-0 right-0 z-[3] h-8 w-8 overflow-visible drop-shadow-[0_4px_14px_rgba(0,0,0,0.75)] ring-2 ring-black/70 rounded-sm">
            {renderForgeShopIcon(tryOnIcon, "sm")}
          </span>
        )}
      </div>
      <span className="text-[9px] font-mono text-muted-foreground text-center max-w-[11rem] leading-tight">
        Profile preview{(tryOnIcon ? " · item applied" : "")}
      </span>
    </div>
  );
}
