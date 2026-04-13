import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyTextToClipboard } from "@/lib/clipboard";

describe("copyTextToClipboard", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false for empty string", async () => {
    expect(await copyTextToClipboard("   ")).toBe(false);
  });

  it("uses navigator.clipboard when available", async () => {
    const spy = vi.mocked(navigator.clipboard.writeText);
    const ok = await copyTextToClipboard("ARENA-TEST");
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("ARENA-TEST");
  });

  it("returns false when clipboard rejects and execCommand is unavailable", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    const ok = await copyTextToClipboard("x");
    expect(ok).toBe(false);
  });
});
