import { describe, expect, it } from "vitest";
import { friendlyChainErrorMessage } from "@/lib/friendlyChainError";

describe("friendlyChainErrorMessage", () => {
  it("maps UNPREDICTABLE_GAS_LIMIT style text", () => {
    const msg = friendlyChainErrorMessage(
      new Error('missing revert data (code=UNPREDICTABLE_GAS_LIMIT, method="estimateGas")'),
    );
    expect(msg).toMatch(/bnb/i);
    expect(msg).not.toMatch(/estimateGas/i);
  });

  it("maps user rejection", () => {
    expect(friendlyChainErrorMessage(new Error("user rejected transaction"))).toMatch(/cancelled/i);
  });
});
