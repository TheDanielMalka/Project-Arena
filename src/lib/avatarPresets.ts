// ── Identity Studio — bundled gaming-grade portraits ──────────────────────────
// Storage: users.avatar = `preset:{id}` (DB-ready: TEXT, unchanged contract)
// Assets: public/avatars/identity/{id}.png — square IDENTITY_ASSET_PX (384); face crop via identityPortraitCropClassName in UI
// Production: set VITE_AVATAR_CDN_BASE=https://your-bucket.s3.../identity/ to serve from S3/CDN.
// Optional dev-only fallback if a file is missing: VITE_IDENTITY_PORTRAITS=pollinations (not recommended).

export type AvatarPresetTier = "free" | "event" | "premium";

export interface AvatarPreset {
  id: string;
  label: string;
  tier: AvatarPresetTier;
  /** Filename under avatars/identity/ (bundled) or CDN path suffix when using VITE_AVATAR_CDN_BASE */
  localAsset: string;
  /** Notes for future art swaps / prompts */
  portraitPrompt?: string;
}

/** Maps retired preset ids (already saved in DB) → current catalog */
const LEGACY_PRESET_IDS: Record<string, string> = {
  seraph_blade: "vermilion_edge",
  storm_swordsman: "ash_chieftain",
  shadow_ronin: "green_blade",
  desert_prince: "crimson_veil",
  neon_hunter: "steel_fury",
  frost_reaper: "solar_grin",
  crimson_hawk: "void_archon",
  void_mage: "crown_duelist",
  celestial_hero: "storm_warden",
  eclipse_assassin: "ember_valkyrie",
  purple_demon: "frost_oracle",
  gearburst_ace: "rift_runner",
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: "ash_chieftain",
    label: "Ash Chieftain",
    tier: "free",
    localAsset: "ash_chieftain.png",
    portraitPrompt: "Crimson tribal mark warrior bust",
  },
  {
    id: "green_blade",
    label: "Jade Swordsman",
    tier: "free",
    localAsset: "green_blade.png",
    portraitPrompt: "Green-haired swordsman scar",
  },
  {
    id: "crimson_veil",
    label: "Crimson Veil",
    tier: "free",
    localAsset: "crimson_veil.png",
    portraitPrompt: "Red-haired captain",
  },
  {
    id: "steel_fury",
    label: "Steel Fury",
    tier: "free",
    localAsset: "steel_fury.png",
    portraitPrompt: "Dark soldier intense eyes",
  },
  {
    id: "solar_grin",
    label: "Solar Grin",
    tier: "free",
    localAsset: "solar_grin.png",
    portraitPrompt: "White-haired grinning fighter",
  },
  {
    id: "void_archon",
    label: "Void Archon",
    tier: "free",
    localAsset: "void_archon.png",
    portraitPrompt: "Pale void mage",
  },
  {
    id: "crown_duelist",
    label: "Crown Duelist",
    tier: "free",
    localAsset: "crown_duelist.png",
    portraitPrompt: "Two-tone hair duelist",
  },
  {
    id: "spiral_hero",
    label: "Spiral Hero",
    tier: "free",
    localAsset: "spiral_hero.png",
    portraitPrompt: "Blonde spiky hero",
  },
  {
    id: "storm_warden",
    label: "Storm Warden",
    tier: "event",
    localAsset: "storm_warden.png",
    portraitPrompt: "Storm lightning heroine",
  },
  {
    id: "ember_valkyrie",
    label: "Ember Valkyrie",
    tier: "event",
    localAsset: "ember_valkyrie.png",
    portraitPrompt: "Fire valkyrie",
  },
  {
    id: "frost_oracle",
    label: "Frost Oracle",
    tier: "event",
    localAsset: "frost_oracle.png",
    portraitPrompt: "Ice oracle",
  },
  {
    id: "dusk_raven",
    label: "Dusk Raven",
    tier: "event",
    localAsset: "dusk_raven.png",
    portraitPrompt: "Feather hood assassin",
  },
  {
    id: "gold_tempest",
    label: "Gold Tempest",
    tier: "event",
    localAsset: "gold_tempest.png",
    portraitPrompt: "Gold warpaint striker",
  },
  {
    id: "rift_runner",
    label: "Rift Runner",
    tier: "event",
    localAsset: "rift_runner.png",
    portraitPrompt: "Cyan tech-mystic",
  },
  {
    id: "vermilion_edge",
    label: "Vermilion Edge",
    tier: "premium",
    localAsset: "vermilion_edge.png",
    portraitPrompt: "Legendary crimson duelist",
  },
  {
    id: "titan_shifter",
    label: "Titan Shifter",
    tier: "premium",
    localAsset: "titan_shifter.png",
    portraitPrompt: "Colossal warpaint warrior",
  },
  {
    id: "arcane_emperor",
    label: "Arcane Emperor",
    tier: "premium",
    localAsset: "arcane_emperor.png",
    portraitPrompt: "Arcane emperor mage",
  },
  {
    id: "emerald_samurai",
    label: "Emerald Samurai",
    tier: "premium",
    localAsset: "emerald_samurai.png",
    portraitPrompt: "Jade samurai",
  },
];

export const FREE_AVATAR_PRESETS = AVATAR_PRESETS.filter((p) => p.tier === "free");
export const EVENT_AVATAR_PRESETS = AVATAR_PRESETS.filter((p) => p.tier === "event");
export const PREMIUM_AVATAR_PRESETS = AVATAR_PRESETS.filter((p) => p.tier === "premium");

export const FREE_AVATAR_IDS = new Set(FREE_AVATAR_PRESETS.map((p) => p.id));
export const EVENT_AVATAR_IDS = new Set(EVENT_AVATAR_PRESETS.map((p) => p.id));
export const PREMIUM_AVATAR_IDS = new Set(PREMIUM_AVATAR_PRESETS.map((p) => p.id));

/** Square pixel size of bundled PNGs (center-crop from hero renders). Sync with art / S3 pipeline. */
export const IDENTITY_ASSET_PX = 384;

/** Expose to API for ETag / cache-bust when catalog files change (DB-ready: optional users.avatar_catalog_rev) */
export const IDENTITY_CATALOG_VERSION = "2026.03.identity.v1";

/**
 * Use on every avatar <img> sourced from Identity Studio (preset:*).
 * Biases crop slightly upward so faces read in tiny circles and shop squares.
 */
export const identityPortraitCropClassName = "object-cover object-[center_22%]";

/** Identity Studio grid tile — circular thumb inside aspect-square card */
export function identityGridPortraitClassName(unlocked = true): string {
  const base =
    "h-[60%] w-[60%] min-h-0 min-w-0 shrink-0 rounded-full ring-1 ring-black/40 shadow-[0_2px_12px_rgba(0,0,0,0.55)] transition-transform duration-200 group-hover:scale-105 " +
    identityPortraitCropClassName;
  return unlocked ? base : `${base} grayscale-[25%]`;
}

export function avatarPresetKey(id: string): string {
  return `preset:${id}`;
}

export function isPresetAvatar(avatar: string | undefined): boolean {
  return !!avatar?.startsWith("preset:");
}

export function getPresetId(avatar: string | undefined): string | null {
  if (!avatar?.startsWith("preset:")) return null;
  return avatar.slice(7);
}

function portraitSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483647;
}

function pollinationsPortraitUrl(p: AvatarPreset): string {
  const extras = p.portraitPrompt ?? p.label;
  const prompt =
    `Semi-realistic anime digital painting, bust portrait chest-up, ${extras}, ` +
    `sharp eyes, cinematic rim light, dark charcoal background, premium game UI hero art, original character, no text no logo`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&seed=${portraitSeed(p.id)}&nologo=true`;
}

function dicebearMicahPortraitUrl(p: AvatarPreset): string {
  return `https://api.dicebear.com/7.x/micah/png?seed=${encodeURIComponent(`ArenaIdentity-${p.id}`)}&size=256`;
}

/** Public URL for one catalog entry (local file, CDN prefix, or dev fallback). */
export function getPortraitUrlForPreset(p: AvatarPreset): string {
  const cdn = import.meta.env.VITE_AVATAR_CDN_BASE as string | undefined;
  if (cdn && cdn.length > 0) {
    const base = cdn.endsWith("/") ? cdn : `${cdn}/`;
    return `${base}${p.localAsset}`;
  }
  const baseUrl = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const local = `${baseUrl}avatars/identity/${p.localAsset}`;
  const mode = import.meta.env.VITE_IDENTITY_PORTRAITS as string | undefined;
  if (mode === "pollinations") return pollinationsPortraitUrl(p);
  if (mode === "dicebear") return dicebearMicahPortraitUrl(p);
  return local;
}

export function getPresetById(id: string): AvatarPreset | undefined {
  const resolved = LEGACY_PRESET_IDS[id] ?? id;
  return AVATAR_PRESETS.find((pr) => pr.id === resolved);
}

export function getAvatarImageUrlFromStorage(avatar: string | undefined): string | null {
  const pid = getPresetId(avatar);
  if (!pid) return null;
  const preset = getPresetById(pid);
  return preset ? getPortraitUrlForPreset(preset) : null;
}
