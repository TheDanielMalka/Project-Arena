import { describe, expect, it } from "vitest";
import {
  softenNotificationForDisplay,
  userFacingNotification,
} from "@/lib/userFacingNotification";

describe("softenNotificationForDisplay", () => {
  it("rewrites legacy profile DB-field copy", () => {
    const out = softenNotificationForDisplay(
      "✅ Profile Updated",
      'Identity saved for "DUNELZ" — users.avatar, avatar_bg, equipped_badge_icon.',
    );
    expect(out).toEqual(userFacingNotification.profileSaved);
  });

  it("rewrites look-applied toast copy", () => {
    const out = softenNotificationForDisplay(
      "Look locked in",
      "Synced to your Arena profile (sidebar, Forge preview, DB fields on deploy).",
    );
    expect(out).toEqual(userFacingNotification.lookApplied);
  });

  it("leaves unrelated notifications unchanged", () => {
    const out = softenNotificationForDisplay("Match Invite", "xDragon99 challenged you.");
    expect(out).toEqual({ title: "Match Invite", message: "xDragon99 challenged you." });
  });
});
