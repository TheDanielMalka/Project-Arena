/** Persisted JWT for website session (same tab, refresh, new tab same origin). */
export const ARENA_ACCESS_TOKEN_KEY = "arena_access_token";

export function readStoredAccessToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ARENA_ACCESS_TOKEN_KEY);
}

export function writeStoredAccessToken(token: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ARENA_ACCESS_TOKEN_KEY, token);
}

export function clearStoredAccessToken(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(ARENA_ACCESS_TOKEN_KEY);
}
