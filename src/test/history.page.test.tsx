import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import History from "@/pages/History";
import { useMatchStore } from "@/stores/matchStore";

const seedMatches = useMatchStore.getState().matches;

describe("History page", () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: seedMatches });
  });

  it("filters matches by search input", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    expect(screen.getByText("YOU vs ShadowKill3r")).toBeInTheDocument();
    expect(screen.getByText("YOU vs NightHawk")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search by opponent/i), {
      target: { value: "NightHawk" },
    });

    expect(screen.getByText("YOU vs NightHawk")).toBeInTheDocument();
    expect(screen.queryByText("YOU vs ShadowKill3r")).not.toBeInTheDocument();
  });

  it("expands and collapses match details on card click", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    const targetCardTitle = screen.getByText("YOU vs ShadowKill3r");
    fireEvent.click(targetCardTitle);

    expect(screen.getByText(/team a \(/i)).toBeInTheDocument();
    expect(screen.getByText(/team b \(/i)).toBeInTheDocument();
    expect(screen.getByText(/winner/i)).toBeInTheDocument();

    fireEvent.click(targetCardTitle);

    expect(screen.queryByText(/team a \(/i)).not.toBeInTheDocument();
  });
});
