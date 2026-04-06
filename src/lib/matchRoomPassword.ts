/**
 * Room password (custom matches) — client contract with engine.
 * All user-facing strings here are English.
 */

/** POST /matches/{match_id}/join JSON field; must match engine Pydantic model + DB naming. */
export const MATCH_JOIN_PASSWORD_FIELD = "password" as const;

/**
 * User-visible message after join fails with 403 (wrong/missing room password).
 * Prefer a short server `detail` when it looks safe; otherwise a fixed English line.
 */
export function joinPasswordFailureMessage(serverDetail: string | null | undefined): string {
  const raw = (serverDetail ?? "").trim();
  if (!raw) {
    return "Incorrect room password. Ask the host for the current password.";
  }
  if (raw.length > 200) {
    return "Incorrect room password. Ask the host for the current password.";
  }
  const low = raw.toLowerCase();
  if (
    low.includes("password") ||
    low.includes("incorrect") ||
    low.includes("wrong") ||
    low.includes("forbidden") ||
    low.includes("denied")
  ) {
    return raw;
  }
  return "Incorrect room password. Ask the host for the current password.";
}
