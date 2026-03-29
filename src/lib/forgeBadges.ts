// ── Forge badge ids — DB-ready: forge_items.icon & users.equipped_badge_icon ───
// Art files: /public/badges/{id}.svg — see badgeAssets.FORGE_BADGE_ART_IDS

import { isForgeBadgeArtId, type ForgeBadgeArtId } from "@/lib/badgeAssets";

export const FORGE_BADGE_ICON_PREFIX = "badge:" as const;

export type { ForgeBadgeArtId };

/** Returns the art id after `badge:` if known; else null. */
export function parseForgeBadgeId(icon: string): ForgeBadgeArtId | null {
  if (!icon.startsWith(FORGE_BADGE_ICON_PREFIX)) return null;
  const id = icon.slice(FORGE_BADGE_ICON_PREFIX.length);
  return isForgeBadgeArtId(id) ? id : null;
}
