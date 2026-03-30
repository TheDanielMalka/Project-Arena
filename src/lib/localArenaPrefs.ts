/**
 * Browser-only preferences for Arena UI onboarding and local-only flags.
 * DB-ready: replace with server-backed user_preferences when API exists.
 */

export const ARENA_LS_PENDING_CLIENT_SETUP = "arena_pending_client_setup_v1";

const ALL_ARENA_LOCAL_KEYS = [ARENA_LS_PENDING_CLIENT_SETUP] as const;

export function setPendingClientSetupAfterSignup(): void {
  try {
    localStorage.setItem(ARENA_LS_PENDING_CLIENT_SETUP, "1");
  } catch {
    /* private mode / quota */
  }
}

export function hasPendingClientSetup(): boolean {
  try {
    return localStorage.getItem(ARENA_LS_PENDING_CLIENT_SETUP) === "1";
  } catch {
    return false;
  }
}

export function clearPendingClientSetup(): void {
  try {
    localStorage.removeItem(ARENA_LS_PENDING_CLIENT_SETUP);
  } catch {
    /* ignore */
  }
}

/** Clears known Arena-owned localStorage keys (onboarding, etc.). Does not log the user out. */
export function clearArenaLocalPreferences(): { clearedKeys: string[] } {
  const clearedKeys: string[] = [];
  for (const k of ALL_ARENA_LOCAL_KEYS) {
    try {
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
        clearedKeys.push(k);
      }
    } catch {
      /* ignore */
    }
  }
  return { clearedKeys };
}
