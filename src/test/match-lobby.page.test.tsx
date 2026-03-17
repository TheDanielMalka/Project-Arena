import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MatchLobby from "@/pages/MatchLobby";
import { useMatchStore } from "@/stores/matchStore";

vi.mock("@/hooks/useMatchPolling", () => ({
  useMatchPolling: () => ({ pollNow: vi.fn(), resetEngineCheck: vi.fn() }),
}));

const seedMatches = useMatchStore.getState().matches;

describe("MatchLobby page", () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: seedMatches });
  });

  it("shows only selected stake matches in public tab", () => {
    render(
      <MemoryRouter>
        <MatchLobby />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "$10" }));

    expect(screen.getByText("BlazeFury's Match")).toBeInTheDocument();
    expect(screen.queryByText("ShadowKill3r's Match")).not.toBeInTheDocument();
    expect(screen.queryByText("NightHawk's Match")).not.toBeInTheDocument();
  });

  it("opens full match details while keeping join blocked", () => {
    render(
      <MemoryRouter>
        <MatchLobby />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "$50" }));
    fireEvent.click(screen.getByText("NightHawk's Match"));

    expect(screen.getByText("Lobby Details")).toBeInTheDocument();
    expect(screen.getByText("10/10 players in lobby")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join this lobby/i })).toBeDisabled();
  });
});
