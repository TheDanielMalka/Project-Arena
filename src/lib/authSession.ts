/**
 * Registered from App after mount — clears Zustand session + storage on HTTP 401
 * from website user JWT calls (see arenaUserFetch in engine-api).
 */
let onUnauthorized: (() => void) | null = null;

export function registerAuth401Handler(handler: () => void): void {
  onUnauthorized = handler;
}

export function clearAuth401Handler(): void {
  onUnauthorized = null;
}

export function notifyAuth401(): void {
  try {
    onUnauthorized?.();
  } catch {
    /* ignore */
  }
}
