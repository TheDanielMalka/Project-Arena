import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Profile from "@/pages/Profile";
import { useUserStore } from "@/stores/userStore";

describe("Profile page", () => {
  beforeEach(async () => {
    await useUserStore.getState().login("player@arena.gg", "test");
  });

  it("renders username in profile", () => {
    render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(screen.getAllByText(/ArenaPlayer_01/i).length).toBeGreaterThan(0);
  });

  it("shows win rate stat", () => {
    render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(screen.getAllByText(/win rate/i).length).toBeGreaterThan(0);
  });

  it("shows Matches stat", () => {
    render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(screen.getAllByText(/matches/i).length).toBeGreaterThan(0);
  });

  it("toggles Edit Profile mode on button click", () => {
    render(<MemoryRouter><Profile /></MemoryRouter>);
    const editBtn = screen.getByRole("button", { name: /edit profile/i });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("shows Edit Profile button when not in edit mode", () => {
    render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /edit profile/i })).toBeInTheDocument();
  });

  it("renders avatar section with username initials", () => {
    const { container } = render(<MemoryRouter><Profile /></MemoryRouter>);
    // "ArenaPlayer_01".slice(0,2).toUpperCase() === "AR"
    expect(container.firstChild).toBeTruthy();
    expect(container.innerHTML).toContain("AR");
  });
});
