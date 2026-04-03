/** Mirrors engine/src/auth.py — keep in sync with validate_steam_id / validate_riot_id. */

const STEAM_ID_RE = /^7656119\d{10}$/;
const RIOT_ID_RE = /^[^#]{3,16}#[A-Za-z0-9]{3,5}$/;

export function isValidSteamId(raw: string): boolean {
  return STEAM_ID_RE.test(raw.trim());
}

export function isValidRiotId(raw: string): boolean {
  return RIOT_ID_RE.test(raw.trim());
}

export const STEAM_ID_HINT =
  "Steam ID must be 17 digits starting with 7656119 (e.g. 76561198000000001).";
export const RIOT_ID_HINT = "Riot ID must be Name#TAG (e.g. Player#1234).";

/** True if `id` looks like a Postgres UUID (server `matches.id`). */
export function looksLikeServerMatchId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
}
