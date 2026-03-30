import type { PublicPlayerProfile } from "@/types";

/**
 * Match roster slots may store user id (e.g. user-001) or username — resolve for UI routes & popover.
 * DB-ready: roster will always include display_username from API
 */
export function slotToProfileUsername(
  slot: string,
  currentUserId: string | undefined,
  currentUsername: string | undefined
): string {
  if (currentUserId && slot === currentUserId && currentUsername) return currentUsername;
  return slot;
}

export function isCurrentUserSlot(
  slot: string,
  currentUserId: string | undefined,
  currentUsername: string | undefined
): boolean {
  if (currentUserId && slot === currentUserId) return true;
  if (currentUsername && slot === currentUsername) return true;
  return false;
}

/** Stable synthetic id when a roster slot has no row in the local catalog (DB-ready: never used once API fills roster). */
export function syntheticUserIdFromDisplayKey(displayKey: string): string {
  return `u-${displayKey.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/**
 * Resolve catalog profile from a roster slot (id or username), same rules as MatchRosterAvatar.
 */
export function resolveRosterProfile(
  slotValue: string,
  currentUserId: string | undefined,
  currentUsername: string | undefined,
  catalog: PublicPlayerProfile[]
): PublicPlayerProfile | undefined {
  const displayKey = slotToProfileUsername(slotValue, currentUserId, currentUsername);
  const byExactId = catalog.find((p) => p.id === slotValue);
  if (byExactId) return byExactId;
  const slotLower = slotValue.toLowerCase();
  const byIdCi = catalog.find((p) => p.id.toLowerCase() === slotLower);
  if (byIdCi) return byIdCi;
  return catalog.find((p) => p.username.toLowerCase() === displayKey.toLowerCase());
}

export function rosterDisplayUsername(
  slotValue: string,
  currentUserId: string | undefined,
  currentUsername: string | undefined,
  catalog: PublicPlayerProfile[]
): string {
  const profile = resolveRosterProfile(slotValue, currentUserId, currentUsername, catalog);
  const displayKey = slotToProfileUsername(slotValue, currentUserId, currentUsername);
  return profile?.username ?? displayKey;
}
