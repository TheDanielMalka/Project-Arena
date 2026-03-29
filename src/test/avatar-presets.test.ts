import { describe, it, expect } from "vitest";
import {
  AVATAR_PRESETS,
  IDENTITY_ASSET_PX,
  IDENTITY_CATALOG_VERSION,
  identityPortraitCropClassName,
  getPresetById,
  getAvatarImageUrlFromStorage,
  avatarPresetKey,
} from "@/lib/avatarPresets";

describe("avatarPresets — catalog", () => {
  it("has 18 Identity Studio portraits (tiers: free/event/premium)", () => {
    expect(AVATAR_PRESETS).toHaveLength(18);
  });

  it("every entry has id, label, tier, localAsset.png", () => {
    for (const p of AVATAR_PRESETS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(["free", "event", "premium"]).toContain(p.tier);
      expect(p.localAsset).toMatch(/\.png$/);
      expect(p.localAsset).toBe(`${p.id}.png`);
    }
  });

  it("exports stable art pipeline constants", () => {
    expect(IDENTITY_ASSET_PX).toBe(384);
    expect(typeof IDENTITY_CATALOG_VERSION).toBe("string");
    expect(IDENTITY_CATALOG_VERSION.length).toBeGreaterThan(0);
    expect(identityPortraitCropClassName).toContain("object-cover");
  });
});

describe("avatarPresets — legacy DB ids", () => {
  it("maps retired seraph_blade to vermilion_edge preset", () => {
    const legacy = getPresetById("seraph_blade");
    const current = getPresetById("vermilion_edge");
    expect(legacy).toBeDefined();
    expect(current).toBeDefined();
    expect(legacy!.id).toBe("vermilion_edge");
  });
});

describe("avatarPresets — URL resolution", () => {
  it("getAvatarImageUrlFromStorage returns null for non-preset", () => {
    expect(getAvatarImageUrlFromStorage(undefined)).toBeNull();
    expect(getAvatarImageUrlFromStorage("initials")).toBeNull();
    expect(getAvatarImageUrlFromStorage("emoji:🎮")).toBeNull();
  });

  it("getAvatarImageUrlFromStorage returns URL for preset:ash_chieftain", () => {
    const u = getAvatarImageUrlFromStorage(avatarPresetKey("ash_chieftain"));
    expect(u).toBeTruthy();
    expect(u!).toMatch(/ash_chieftain\.png/);
  });
});
