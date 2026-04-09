import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Settings from "@/pages/Settings";
import { useUserStore } from "@/stores/userStore";
import * as engineApi from "@/lib/engine-api";

describe("Settings — 2FA setup flow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useUserStore.getState().login("player@arena.gg", "test");
    vi.mocked(engineApi.apiAuth2faSetup).mockResolvedValue({
      ok: true,
      secret: "JBSWY3DPEHPK3PXP",
      qr_uri: "otpauth://totp/ProjectArena:test@arena.gg?secret=JBSWY3DPEHPK3PXP&issuer=ProjectArena",
    });
    vi.mocked(engineApi.apiAuth2faVerify).mockResolvedValue({ ok: true });
  });

  it("setup shows QR data from POST /auth/2fa/setup; verify calls POST /auth/2fa/verify; idle → setup-qr → setup-verify → setup-backup", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /security/i }));

    const switches = screen.getAllByRole("switch");
    const twoFaSwitch = switches[0];
    fireEvent.click(twoFaSwitch);

    await waitFor(() => {
      expect(engineApi.apiAuth2faSetup).toHaveBeenCalled();
    });

    expect(screen.getByText(/set up authenticator/i)).toBeInTheDocument();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next — enter code/i }));

    expect(screen.getByText(/verify your code/i)).toBeInTheDocument();

    const codeInput = screen.getByPlaceholderText("000000");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));

    await waitFor(() => {
      expect(engineApi.apiAuth2faVerify).toHaveBeenCalledWith(expect.any(String), "123456");
    });

    expect(screen.getByText(/2fa enabled!/i)).toBeInTheDocument();
  });
});
