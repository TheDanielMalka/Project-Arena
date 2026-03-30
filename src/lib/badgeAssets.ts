// ── Forge ring badges — art in /public/badges/{id}.svg (Identity Studio style)
// DB-ready: CDN base URL for badge assets when moving off static hosting

export const FORGE_BADGE_ART_IDS = [
  "founders",
  "champions",
  "veterans",
  "arena_ring",
  "sun_god",
  "neon_hunter",
  "shadow_ronin",
  "black_mage",
  "desert_prince",
  "storm_swordsman",
  "crimson_core",
  "void_warden",
  "iron_command",
] as const;

export type ForgeBadgeArtId = (typeof FORGE_BADGE_ART_IDS)[number];

export function isForgeBadgeArtId(id: string): id is ForgeBadgeArtId {
  return (FORGE_BADGE_ART_IDS as readonly string[]).includes(id);
}

/** Public URL for circular badge art (Vite serves /public at root). */
export function forgeBadgeArtUrl(id: string): string | null {
  return isForgeBadgeArtId(id) ? `/badges/${id}.svg` : null;
}
