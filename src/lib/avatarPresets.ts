// ── Avatar portraits — sharp pixel busts (DiceBear), readable at small sizes ───
// Storage: `preset:{id}`  ·  Not IP characters — original seeds only
// API: https://www.dicebear.com/licenses/

export type DicebearPortraitCollection = "pixel-art" | "micah";

export type AvatarPresetTier = "free" | "event" | "premium";

export interface AvatarPreset {
  id: string;
  label: string;
  seed: string;
  tier: AvatarPresetTier;
  /** DiceBear collection — pixel-art reads “game-sharp” in tiny circles */
  collection?: DicebearPortraitCollection;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "storm_swordsman", label: "Storm Swordsman", seed: "StormSwordsmanArena", tier: "free" },
  { id: "shadow_ronin",    label: "Shadow Ronin",    seed: "ShadowRoninArena",    tier: "free" },
  { id: "desert_prince",   label: "Desert Prince",   seed: "DesertPrinceArena",   tier: "free" },
  { id: "neon_hunter",     label: "Neon Hunter",     seed: "NeonHunterArena",     tier: "free" },
  { id: "frost_reaper",    label: "Frost Reaper",    seed: "FrostReaperArena",    tier: "free" },
  { id: "crimson_hawk",    label: "Crimson Hawk",    seed: "CrimsonHawkArena",    tier: "free" },
  { id: "void_mage",       label: "Void Mage",       seed: "VoidMageArena",       tier: "free" },

  { id: "celestial_hero",   label: "Celestial Hero",   seed: "CelestialHeroS1",    tier: "event", collection: "micah" },
  { id: "eclipse_assassin", label: "Eclipse Assassin", seed: "EclipseAssassinCup", tier: "event" },
  { id: "purple_demon",     label: "Purple Demon",     seed: "PurpleDemonEvent",   tier: "event", collection: "micah" },
  { id: "gearburst_ace",    label: "Gearburst Ace",    seed: "GearburstAceEvent",  tier: "event" },

  // Premium (Forge) — was “Seraph Blade”; renamed to avoid odd copy overlap in UI
  { id: "vermilion_edge",  label: "Vermilion Edge",  seed: "VermilionEdgeForge",  tier: "premium", collection: "micah" },
  { id: "titan_shifter",   label: "Titan Shifter",   seed: "TitanShifterForge",   tier: "premium" },
  { id: "arcane_emperor",  label: "Arcane Emperor",  seed: "ArcaneEmperorForge",  tier: "premium", collection: "micah" },
  { id: "emerald_samurai", label: "Emerald Samurai", seed: "EmeraldSamuraiForge", tier: "premium" },
];

export const FREE_AVATAR_PRESETS = AVATAR_PRESETS.filter((p) => p.tier === "free");
export const EVENT_AVATAR_PRESETS = AVATAR_PRESETS.filter((p) => p.tier === "event");
export const PREMIUM_AVATAR_PRESETS = AVATAR_PRESETS.filter((p) => p.tier === "premium");

export const FREE_AVATAR_IDS = new Set(FREE_AVATAR_PRESETS.map((p) => p.id));
export const EVENT_AVATAR_IDS = new Set(EVENT_AVATAR_PRESETS.map((p) => p.id));
export const PREMIUM_AVATAR_IDS = new Set(PREMIUM_AVATAR_PRESETS.map((p) => p.id));

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

export function getDicebearCollectionForPresetId(id: string): DicebearPortraitCollection {
  return AVATAR_PRESETS.find((p) => p.id === id)?.collection ?? "pixel-art";
}

export function getAvatarPresetImageUrl(
  seed: string,
  collection: DicebearPortraitCollection = "pixel-art",
): string {
  return `https://api.dicebear.com/7.x/${collection}/svg?${new URLSearchParams({ seed })}`;
}

export function getAvatarImageUrlFromStorage(avatar: string | undefined): string | null {
  const pid = getPresetId(avatar);
  if (!pid) return null;
  const p = getPresetById(pid);
  return p ? getAvatarPresetImageUrl(p.seed, p.collection ?? "pixel-art") : null;
}

export function getPresetById(id: string): AvatarPreset | undefined {
  if (id === "seraph_blade") {
    return AVATAR_PRESETS.find((pr) => pr.id === "vermilion_edge");
  }
  return AVATAR_PRESETS.find((pr) => pr.id === id);
}
