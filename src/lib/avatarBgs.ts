// ── Avatar frame presets — shared Profile, Sidebar, Dashboard, API contract ───
// DB: users.avatar_bg stores `id` from AvatarBackgroundDef.id

import type { CSSProperties } from "react";

export type AvatarBgTier = "free" | "event" | "premium";

export interface AvatarBackgroundDef {
  id: string;
  label: string;
  tier: AvatarBgTier;
  /** Solid accent for fallbacks / matching text */
  accent: string;
  /** Full frame fill */
  background: string;
  borderCss: string;
  shadowCss: string;
  pulse?: boolean;
  locked?: boolean;
  eventName?: string;
  price?: string;
}

export const AVATAR_BACKGROUNDS: AvatarBackgroundDef[] = [
  {
    id: "default", label: "Crimson Core", tier: "free", accent: "#EF4444",
    background: "linear-gradient(145deg, rgba(239,68,68,0.65) 0%, rgba(10,4,6,0.97) 38%, rgba(127,29,29,0.5) 100%)",
    borderCss: "2px solid rgba(252,165,165,0.55)",
    shadowCss: "0 0 32px rgba(239,68,68,0.55), 0 0 64px rgba(239,68,68,0.15), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -12px 32px rgba(0,0,0,0.45)",
  },
  {
    id: "blue", label: "Ion Blue", tier: "free", accent: "#3B82F6",
    background: "linear-gradient(155deg, rgba(59,130,246,0.7) 0%, rgba(8,15,35,0.96) 42%, rgba(30,64,175,0.55) 100%)",
    borderCss: "2px solid rgba(147,197,253,0.55)",
    shadowCss: "0 0 32px rgba(59,130,246,0.55), 0 0 60px rgba(37,99,235,0.18), inset 0 1px 0 rgba(255,255,255,0.18)",
  },
  {
    id: "purple", label: "Void Violet", tier: "free", accent: "#A855F7",
    background: "linear-gradient(160deg, rgba(168,85,247,0.65) 0%, rgba(15,8,28,0.96) 45%, rgba(88,28,135,0.5) 100%)",
    borderCss: "2px solid rgba(216,180,254,0.5)",
    shadowCss: "0 0 34px rgba(168,85,247,0.55), 0 0 70px rgba(126,34,206,0.12), inset 0 1px 0 rgba(255,255,255,0.15)",
  },
  {
    id: "cyan", label: "Neon Azure", tier: "free", accent: "#22D3EE",
    background: "linear-gradient(165deg, rgba(34,211,238,0.72) 0%, rgba(6,20,35,0.96) 40%, rgba(8,145,178,0.45) 100%)",
    borderCss: "2px solid rgba(103,232,249,0.6)",
    shadowCss: "0 0 36px rgba(34,211,238,0.6), 0 0 72px rgba(6,182,212,0.2), inset 0 1px 0 rgba(255,255,255,0.25)",
  },
  {
    id: "green", label: "Toxic Matrix", tier: "free", accent: "#22C55E",
    background: "linear-gradient(150deg, rgba(34,197,94,0.6) 0%, rgba(5,24,12,0.96) 45%, rgba(20,83,45,0.5) 100%)",
    borderCss: "2px solid rgba(134,239,172,0.55)",
    shadowCss: "0 0 30px rgba(34,197,94,0.5), 0 0 56px rgba(22,163,74,0.14), inset 0 1px 0 rgba(255,255,255,0.14)",
  },
  {
    id: "orange", label: "Solar Flare", tier: "free", accent: "#F97316",
    background: "linear-gradient(145deg, rgba(249,115,22,0.68) 0%, rgba(28,12,4,0.96) 42%, rgba(154,52,18,0.48) 100%)",
    borderCss: "2px solid rgba(253,186,116,0.55)",
    shadowCss: "0 0 32px rgba(249,115,22,0.52), inset 0 1px 0 rgba(255,255,255,0.16)",
  },
  {
    id: "fire", label: "Inferno Season", tier: "event", accent: "#F97316",
    background: "linear-gradient(135deg, rgba(251,146,60,0.85) 0%, rgba(69,10,2,0.95) 35%, rgba(220,38,38,0.55) 100%)",
    borderCss: "2px solid rgba(253,186,116,0.75)",
    shadowCss: "0 0 40px rgba(251,113,133,0.55), 0 0 80px rgba(234,88,12,0.25), inset 0 0 28px rgba(251,191,36,0.15)",
    pulse: true, locked: true, eventName: "Summer Blaze 2025",
  },
  {
    id: "ice", label: "Sub-Zero Crown", tier: "event", accent: "#7DD3FC",
    background: "linear-gradient(160deg, rgba(186,230,253,0.75) 0%, rgba(8,25,45,0.94) 48%, rgba(14,116,144,0.5) 100%)",
    borderCss: "2px solid rgba(165,243,252,0.65)",
    shadowCss: "0 0 36px rgba(125,211,252,0.55), 0 0 72px rgba(14,165,233,0.2), inset 0 1px 0 rgba(255,255,255,0.35)",
    pulse: true, locked: false, eventName: "Winter Cup 2025",
  },
  {
    id: "electric", label: "Storm Surge", tier: "event", accent: "#FACC15",
    background: "linear-gradient(140deg, rgba(250,204,21,0.85) 0%, rgba(22,18,4,0.96) 40%, rgba(202,138,4,0.45) 100%)",
    borderCss: "2px solid rgba(253,224,71,0.7)",
    shadowCss: "0 0 42px rgba(250,204,21,0.6), 0 0 88px rgba(234,179,8,0.2), inset 0 0 20px rgba(254,240,138,0.12)",
    pulse: true, locked: true, eventName: "Arena Open S2",
  },
  {
    id: "void", label: "Abyss Prime", tier: "event", accent: "#7C3AED",
    background: "radial-gradient(ellipse 120% 80% at 30% 20%, rgba(139,92,246,0.75) 0%, rgba(15,8,35,0.98) 50%, rgba(76,29,149,0.6) 100%)",
    borderCss: "2px solid rgba(196,181,253,0.55)",
    shadowCss: "0 0 44px rgba(124,58,237,0.55), 0 0 90px rgba(91,33,182,0.18), inset 0 0 40px rgba(15,5,35,0.6)",
    pulse: true, locked: true, eventName: "Dark Tournament",
  },
  {
    id: "gold", label: "Sovereign Gold", tier: "premium", accent: "#EAB308",
    background: "linear-gradient(135deg, rgba(253,224,71,0.85) 0%, rgba(55,40,4,0.95) 38%, rgba(202,138,4,0.65) 100%)",
    borderCss: "2px solid rgba(253,224,71,0.75)",
    shadowCss: "0 0 40px rgba(234,179,8,0.65), 0 0 90px rgba(250,204,21,0.22), inset 0 2px 0 rgba(255,255,255,0.35)",
    pulse: true, price: "$1.99",
  },
  {
    id: "rainbow", label: "Chroma Luxe", tier: "premium", accent: "#EC4899",
    background: "linear-gradient(120deg, rgba(236,72,153,0.55) 0%, rgba(99,102,241,0.45) 33%, rgba(34,211,238,0.45) 66%, rgba(52,211,153,0.45) 100%)",
    borderCss: "2px solid rgba(244,114,182,0.6)",
    shadowCss: "0 0 38px rgba(236,72,153,0.45), 0 0 80px rgba(99,102,241,0.2), inset 0 1px 0 rgba(255,255,255,0.25)",
    pulse: true, price: "$2.99",
  },
  {
    id: "aurora", label: "Northern Pulse", tier: "premium", accent: "#34D399",
    background: "linear-gradient(200deg, rgba(52,211,153,0.55) 0%, rgba(15,35,40,0.95) 45%, rgba(16,185,129,0.45) 100%)",
    borderCss: "2px solid rgba(110,231,183,0.55)",
    shadowCss: "0 0 36px rgba(52,211,153,0.5), 0 0 72px rgba(16,185,129,0.18), inset 0 0 28px rgba(167,243,208,0.08)",
    pulse: true, price: "$2.99",
  },
  {
    id: "lava", label: "Magma Elite", tier: "premium", accent: "#DC2626",
    background: "linear-gradient(180deg, rgba(251,113,133,0.65) 0%, rgba(40,8,6,0.97) 35%, rgba(220,38,38,0.65) 100%)",
    borderCss: "2px solid rgba(248,113,113,0.65)",
    shadowCss: "0 0 42px rgba(220,38,38,0.58), 0 0 84px rgba(251,146,60,0.22), inset 0 -8px 28px rgba(0,0,0,0.5)",
    pulse: true, price: "$1.99",
  },
];

export function getAvatarBackground(id: string | undefined): AvatarBackgroundDef {
  return AVATAR_BACKGROUNDS.find((b) => b.id === id) ?? AVATAR_BACKGROUNDS[0];
}

export function getBgColor(bgId: string | undefined): string {
  return getAvatarBackground(bgId).accent;
}

/** Square-ish frame — sidebar, compact slots */
export function getAvatarSidebarStyle(bgId: string | undefined): CSSProperties {
  const b = getAvatarBackground(bgId);
  return {
    background: b.background,
    border: b.borderCss,
    boxShadow: b.shadowCss,
    borderRadius: 11,
  };
}

/** Circular — profile hero, popovers */
export function getAvatarCircleStyle(bgId: string | undefined): CSSProperties {
  const b = getAvatarBackground(bgId);
  return {
    background: b.background,
    border: b.borderCss,
    boxShadow: b.shadowCss,
    borderRadius: 9999,
  };
}

/** Checkout / Forge preview — same fill as live ring, softer outer glow so the portrait stays visually dominant */
export function getForgePreviewCircleStyle(bgId: string | undefined): CSSProperties {
  const b = getAvatarBackground(bgId);
  const soft = `0 0 10px ${b.accent}24, 0 1px 0 rgba(255,255,255,0.12) inset`;
  return {
    background: b.background,
    border: b.borderCss,
    boxShadow: `${soft}, inset 0 -8px 20px rgba(0,0,0,0.35)`,
    borderRadius: 9999,
  };
}

export function avatarBackgroundsByTier(tier: AvatarBgTier): AvatarBackgroundDef[] {
  return AVATAR_BACKGROUNDS.filter((b) => b.tier === tier);
}
