import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MatchRosterAvatar         } from "@/components/match/MatchRosterAvatar";
import { useUserStore             } from "@/stores/userStore";
import { usePlayerStore           } from "@/stores/playerStore";
import { avatarPresetKey, getAvatarImageUrlFromStorage } from "@/lib/avatarPresets";

describe("MatchRosterAvatar", () => {
  beforeEach(async () => {
    useUserStore.getState().logout();
    await useUserStore.getState().login("player@arena.gg", "test");
    usePlayerStore.setState({ players: [] });
    const tok = useUserStore.getState().token;
    await usePlayerStore.getState().searchPlayers("", undefined, tok);
  });

  it("resolves catalog player by user id and renders preset portrait src", () => {
    const { container } = render(<MatchRosterAvatar slotValue="user-003" size={32} highlightSelf={false} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    const expected = getAvatarImageUrlFromStorage(avatarPresetKey("green_blade"));
    expect(expected).toBeTruthy();
    expect(img?.getAttribute("src")).toBe(expected);
  });

  it("uses session user avatar for current user slot (by id)", () => {
    useUserStore.getState().updateProfile({ avatar: avatarPresetKey("spiral_hero") });
    const { container } = render(<MatchRosterAvatar slotValue="user-001" size={32} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    const expected = getAvatarImageUrlFromStorage(avatarPresetKey("spiral_hero"));
    expect(img?.getAttribute("src")).toBe(expected);
  });

  it("falls back to initials for unknown roster slot with no catalog match", () => {
    const { container } = render(
      <MatchRosterAvatar slotValue="TotallyUnknownXx" size={32} highlightSelf={false} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("TO");
  });
});
