import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TermsOfService from "@/pages/TermsOfService";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import ResponsibleGaming from "@/pages/ResponsibleGaming";

describe("Terms of Service page", () => {
  it("renders Terms of Service heading", () => {
    render(<MemoryRouter><TermsOfService /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /terms of service/i })).toBeInTheDocument();
  });

  it("shows Skill-Based Platform badge", () => {
    render(<MemoryRouter><TermsOfService /></MemoryRouter>);
    expect(screen.getByText(/skill-based platform/i)).toBeInTheDocument();
  });

  it("shows smart contract escrow section title", () => {
    render(<MemoryRouter><TermsOfService /></MemoryRouter>);
    // Accordion section titles are always visible
    expect(screen.getByText(/smart contract escrow/i)).toBeInTheDocument();
  });

  it("has expand all toggle button", () => {
    render(<MemoryRouter><TermsOfService /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /expand all/i })).toBeInTheDocument();
  });
});

describe("Privacy Policy page", () => {
  it("renders Privacy Policy heading", () => {
    render(<MemoryRouter><PrivacyPolicy /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /privacy policy/i })).toBeInTheDocument();
  });

  it("shows Minimal Collection badge", () => {
    render(<MemoryRouter><PrivacyPolicy /></MemoryRouter>);
    expect(screen.getByText(/minimal collection/i)).toBeInTheDocument();
  });

  it("shows 18+ enforcement notice", () => {
    render(<MemoryRouter><PrivacyPolicy /></MemoryRouter>);
    expect(screen.getAllByText((_, el) => !!el?.textContent?.includes("18+")).length).toBeGreaterThan(0);
  });
});

describe("Responsible Gaming page", () => {
  it("renders Responsible Gaming heading", () => {
    render(<MemoryRouter><ResponsibleGaming /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /responsible gaming/i })).toBeInTheDocument();
  });

  it("shows Self-Exclusion section title", () => {
    render(<MemoryRouter><ResponsibleGaming /></MemoryRouter>);
    expect(screen.getAllByText((_, el) => !!el?.textContent?.toLowerCase().includes("self-exclusion")).length).toBeGreaterThan(0);
  });
});
