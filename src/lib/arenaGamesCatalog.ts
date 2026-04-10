import type { Game } from "@/types";

/**
 * Canonical game list for marketing + Hub filters.
 * TODO[ENGINE]: when GET /games exists, fetch { name, logo_url, enabled } and replace this module.
 */
export type ArenaCatalogEntry = {
  name: Game;
  logo: string;
  /** false → UI shows “Coming soon” */
  enabled: boolean;
};

export const ARENA_GAMES_CATALOG: ArenaCatalogEntry[] = [
  { name: "CS2", logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg", enabled: true },
  { name: "Valorant", logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg", enabled: true },
  { name: "Fortnite", logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120", enabled: false },
  { name: "Apex Legends", logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg", enabled: false },
  { name: "COD", logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1938090/capsule_sm_120.jpg", enabled: false },
  { name: "PUBG", logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/578080/capsule_sm_120.jpg", enabled: false },
  { name: "League of Legends", logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2801460/capsule_sm_120.jpg", enabled: false },
];

/** Landing hero strip — same rows as catalog */
export const LANDING_GAMES = ARENA_GAMES_CATALOG.map(({ name, logo, enabled }) => ({
  name,
  logo,
  ...(enabled ? {} : { comingSoon: true as const }),
}));

/** Hub match browser filters */
export function hubGameFilters(): Array<{ label: string; value: Game | ""; comingSoon?: boolean }> {
  return [
    { label: "All", value: "" },
    ...ARENA_GAMES_CATALOG.map(({ name, enabled }) => ({
      label: name,
      value: name,
      ...(!enabled ? { comingSoon: true as const } : {}),
    })),
  ];
}
