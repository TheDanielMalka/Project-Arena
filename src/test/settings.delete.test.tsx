import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Settings from "@/pages/Settings";
import { useUserStore } from "@/stores/userStore";
import * as engineApi from "@/lib/engine-api";

describe("Settings — delete account flow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useUserStore.getState().login("player@arena.gg", "test");
  });

  it("countdown starts at 10 after typing delete; button disabled until 10s elapses; DELETE /users/me on confirm; navigates home", async () => {
    const delSpy = vi.mocked(engineApi.apiDeleteMyAccount).mockResolvedValue({ ok: true });

    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<div data-testid="home-root">Home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /danger zone/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));

    const input = screen.getByPlaceholderText(/type "delete"/i);
    fireEvent.change(input, { target: { value: "delete" } });

    expect(screen.getByText(/deleting in 10/i)).toBeInTheDocument();

    const deleteBtn = screen.getByRole("button", { name: /delete my account permanently/i });
    expect(deleteBtn).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(deleteBtn).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(deleteBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(delSpy).toHaveBeenCalledWith(expect.any(String), "delete");

    vi.useRealTimers();

    expect(await screen.findByTestId("home-root", {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
