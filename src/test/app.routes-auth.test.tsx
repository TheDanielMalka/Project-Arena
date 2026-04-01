import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";
import { useUserStore } from "@/stores/userStore";

async function loginAs(role: "user" | "admin") {
  const store = useUserStore.getState();
  await store.login(role === "admin" ? "admin@arena.gg" : "player@arena.gg", "test");
}

describe("App routing and admin guard", () => {
  beforeEach(() => {
    useUserStore.getState().logout();
  });

  it("loads terms route correctly", async () => {
    await loginAs("user");
    window.history.pushState({}, "", "/terms-of-service");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /terms of service/i })).toBeInTheDocument();
  });

  it("redirects non-admin users away from admin route", async () => {
    await loginAs("user");
    window.history.pushState({}, "", "/admin");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /ArenaPlayer_01/i })).toBeInTheDocument();
  });

  it("allows admin users to open admin route", async () => {
    await loginAs("admin");
    window.history.pushState({}, "", "/admin");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /admin panel/i })).toBeInTheDocument();
  });
});
