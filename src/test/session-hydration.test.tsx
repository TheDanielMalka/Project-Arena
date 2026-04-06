import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as engineApi from "@/lib/engine-api";
import { ARENA_ACCESS_TOKEN_KEY } from "@/lib/authStorage";
import App from "@/App";
import { useUserStore } from "@/stores/userStore";

function resetStoreLoggedOut() {
  useUserStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    authHydrated: false,
    walletConnected: false,
    showLoginGreeting: false,
    greetingType: null,
  });
}

describe("Session hydration (1.2)", () => {
  beforeEach(() => {
    localStorage.clear();
    useUserStore.getState().logout();
  });

  it("restores /dashboard from stored token (F5 / new tab simulation)", async () => {
    localStorage.setItem(ARENA_ACCESS_TOKEN_KEY, "token-user");
    resetStoreLoggedOut();
    window.history.pushState({}, "", "/dashboard");

    render(<App />);

    expect(await screen.findByText(/command center/i)).toBeInTheDocument();
  });

  it("restores /lobby from stored token", async () => {
    localStorage.setItem(ARENA_ACCESS_TOKEN_KEY, "token-user");
    resetStoreLoggedOut();
    window.history.pushState({}, "", "/lobby");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /match lobby/i })).toBeInTheDocument();
  });

  it("empty localStorage + /dashboard → auth (no token)", async () => {
    window.history.pushState({}, "", "/dashboard");

    render(<App />);

    expect(await screen.findByText(/play for stakes/i)).toBeInTheDocument();
  });

  it("invalid stored token + /dashboard → cleared session, auth", async () => {
    vi.mocked(engineApi.apiGetMe).mockResolvedValueOnce(null);
    localStorage.setItem(ARENA_ACCESS_TOKEN_KEY, "totally-invalid-jwt");
    resetStoreLoggedOut();
    window.history.pushState({}, "", "/dashboard");

    render(<App />);

    expect(await screen.findByText(/play for stakes/i)).toBeInTheDocument();
    expect(localStorage.getItem(ARENA_ACCESS_TOKEN_KEY)).toBeNull();
  });
});
