// ── Forge badge ids — DB-ready: forge_items.icon & users.equipped_badge_icon ───
// Visual rendering lives in forgeItemIcon.tsx (ForgeBadgeSigil). Do not rename ids without API migration.

export const FORGE_BADGE_ICON_PREFIX = "badge:" as const;

export type ForgeBadgeId = "founders" | "champions" | "veterans";

export const FORGE_BADGE_IDS: readonly ForgeBadgeId[] = ["founders", "champions", "veterans"];

export function parseForgeBadgeId(icon: string): ForgeBadgeId | null {
  if (!icon.startsWith(FORGE_BADGE_ICON_PREFIX)) return null;
  const id = icon.slice(FORGE_BADGE_ICON_PREFIX.length) as ForgeBadgeId;
  return FORGE_BADGE_IDS.includes(id) ? id : null;
}
