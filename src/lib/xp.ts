// ── XP / Level system — DB-ready ─────────────────────────────────────────────
// Progress thresholds match rank colors used throughout the app.

// iconName maps to a Lucide icon — imported per-component to keep xp.ts framework-free
export const XP_LEVELS = [
  { label: "Bronze",   color: "#CD7F32", minXp: 0,    maxXp: 499,      iconName: "Medal"     },
  { label: "Silver",   color: "#9CA3AF", minXp: 500,  maxXp: 999,      iconName: "Shield"    },
  { label: "Gold",     color: "#EAB308", minXp: 1000, maxXp: 1999,     iconName: "Trophy"    },
  { label: "Platinum", color: "#22D3EE", minXp: 2000, maxXp: 3499,     iconName: "Gem"       },
  { label: "Diamond",  color: "#818CF8", minXp: 3500, maxXp: 4999,     iconName: "Sparkles"  },
  { label: "Master",   color: "#F43F5E", minXp: 5000, maxXp: Infinity, iconName: "Crown"     },
] as const;

export interface XpInfo {
  label: string;
  color: string;
  iconName: string;
  xp: number;
  progress: number;   // 0–1 within current level
  nextXp: number | null; // null at Master
  remaining: number;
}

export function getXpInfo(xp: number): XpInfo {
  let levelDef = XP_LEVELS[0] as (typeof XP_LEVELS)[number];
  for (const l of XP_LEVELS) {
    if (xp >= l.minXp) levelDef = l;
  }
  const isMax = levelDef.maxXp === Infinity;
  const range = isMax ? 1 : (levelDef.maxXp as number) - levelDef.minXp + 1;
  const progress = isMax ? 1 : Math.min((xp - levelDef.minXp) / range, 1);
  return {
    label: levelDef.label,
    color: levelDef.color,
    iconName: levelDef.iconName,
    xp,
    progress,
    nextXp: isMax ? null : (levelDef.maxXp as number) + 1,
    remaining: isMax ? 0 : (levelDef.maxXp as number) + 1 - xp,
  };
}
