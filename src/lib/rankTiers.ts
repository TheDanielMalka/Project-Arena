import type { LucideIcon } from "lucide-react";
import { Crown, Star, Trophy, Gem, Zap, Shield } from "lucide-react";

// DB-ready: tier is computed from rank returned by GET /api/leaderboard
// When a player's rank changes (e.g. drops from top 50 → 51), their icon disappears dynamically.

export interface RankTier {
  min:      number;
  max:      number;
  Icon:     LucideIcon;
  label:    string;
  color:    string;   // Tailwind class
  iconSize: string;   // Tailwind class
}

export const RANK_TIERS: RankTier[] = [
  { min: 1,  max: 1,  Icon: Crown,  label: "Champion", color: "text-arena-gold",    iconSize: "h-4 w-4"     },
  { min: 2,  max: 2,  Icon: Star,   label: "Legend",   color: "text-slate-300",     iconSize: "h-3.5 w-3.5" },
  { min: 3,  max: 3,  Icon: Trophy, label: "Elite",    color: "text-arena-orange",  iconSize: "h-3.5 w-3.5" },
  { min: 4,  max: 10, Icon: Gem,    label: "Diamond",  color: "text-arena-cyan",    iconSize: "h-3 w-3"     },
  { min: 11, max: 24, Icon: Zap,    label: "Platinum", color: "text-arena-purple",  iconSize: "h-3 w-3"     },
  { min: 25, max: 50, Icon: Shield, label: "Gold",     color: "text-arena-gold/60", iconSize: "h-3 w-3"     },
];

export const getRankTier = (rank: number): RankTier | null =>
  RANK_TIERS.find((t) => rank >= t.min && rank <= t.max) ?? null;
