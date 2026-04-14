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

  it("maps BNB chain ENS / getEnsAddress (ethers v6) to a human message", () => {
    const ugly =
      'network does not support ENS (operation="getEnsAddress", info={ "network": { "chainId": "97", "name": "bnbt" } }, code=UNSUPPORTED_OPERATION, version=6.13.5)';
    const msg = friendlyChainErrorMessage(new Error(ugly));
    expect(msg).toMatch(/0x/i);
    expect(msg).not.toMatch(/getEnsAddress/i);
    expect(msg).not.toMatch(/version=6/i);
  });

  it("hides ethers diagnostic blobs for unknown long errors", () => {
    const msg = friendlyChainErrorMessage(
      new Error('foo failed (operation="estimateGas", code=CALL_EXCEPTION, version=6.0.0)'),
    );
    expect(msg).toMatch(/wallet transaction failed/i);
    expect(msg).not.toMatch(/estimateGas/i);
  });
});
