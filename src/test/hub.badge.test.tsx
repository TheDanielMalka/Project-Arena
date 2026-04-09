import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Hub from "@/pages/Hub";
import { useUserStore } from "@/stores/userStore";
import { useFriendStore } from "@/stores/friendStore";
import { friendApiFixture } from "@/test/friendApiFixture";
import * as engineApi from "@/lib/engine-api";

function renderHub() {
  return render(
    <MemoryRouter initialEntries={["/hub"]}>
      <Routes>
        <Route path="/hub" element={<Hub />} />
        <Route path="/players/:username" element={<div>PlayerProfile</div>} />
        <Route path="/players" element={<div>Players</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Hub — Messages tab server unread badge", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useUserStore.getState().login("player@arena.gg", "test");
    useFriendStore.setState({ ignoredUsers: [] });
    friendApiFixture.friends = [];
    friendApiFixture.incoming = [];
    friendApiFixture.outgoing = [];
    await useFriendStore.getState().fetchSocialFromServer();
  });

  it("hides badge when server unread count is 0", async () => {
    vi.mocked(engineApi.apiGetUnreadCount).mockResolvedValue({ count: 0 });
    renderHub();
    const msgBtn = screen.getByRole("button", { name: /messages/i });
    await waitFor(() => {
      expect(extractMessagesBadge(msgBtn)).toBeNull();
    });
  });

  it('shows "3" when count is 3', async () => {
    vi.mocked(engineApi.apiGetUnreadCount).mockResolvedValue({ count: 3 });
    renderHub();
    const msgBtn = screen.getByRole("button", { name: /messages/i });
    await waitFor(() => {
      expect(extractMessagesBadge(msgBtn)).toBe("3");
    });
  });

  it("updates badge after poll interval (second fetch returns higher count)", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValue({ count: 5 });
    vi.mocked(engineApi.apiGetUnreadCount).mockImplementation(spy);

    vi.useFakeTimers();
    renderHub();
    const msgBtn = screen.getByRole("button", { name: /messages/i });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(extractMessagesBadge(msgBtn)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(extractMessagesBadge(msgBtn)).toBe("5");
    });
  });
});

/** Server-driven unread badge on Messages tab (destructive pill). */
function extractMessagesBadge(btn: HTMLElement): string | null {
  const s = btn.querySelector("span.rounded-full.bg-destructive");
  return s?.textContent?.trim() ?? null;
}
