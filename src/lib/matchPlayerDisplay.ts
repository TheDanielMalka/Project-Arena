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
