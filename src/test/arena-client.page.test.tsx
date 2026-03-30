import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ArenaClientPage from "@/pages/ArenaClient";

describe("ArenaClient page", () => {
  it("renders title and download CTA", () => {
    render(
      <MemoryRouter>
        <ArenaClientPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /arena client/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download client/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to match lobby/i })).toBeInTheDocument();
  });
});
