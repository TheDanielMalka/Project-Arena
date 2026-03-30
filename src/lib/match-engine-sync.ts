/**
 * Maps engine/API match outcome to the current user.
 *
 * DB-ready: `winner_id` from GET /match/:id/status will be users.id (UUID).
 * Until then the engine may echo username — we accept both.
 *
 * CONTRACT-ready: when this returns `null`, callers must not invoke mock or real
 * `releaseEscrow` / declareWinner — no winner is known yet.
 */
export function resolveUserWonFromEngineWinner(
  winnerId: string | undefined,
  user: { id: string; username: string } | null,
): boolean | null {
  if (!user) return null;
  const w = winnerId?.trim();
  if (!w) return null;
  return w === user.id || w === user.username;
}
