/**
 * Maps ethers / MetaMask / RPC errors to short user-facing English (toasts / notifications).
 */
export function friendlyChainErrorMessage(e: unknown): string {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e !== null && "message" in e
        ? String((e as { message?: unknown }).message ?? "")
        : String(e);
  const s = raw.toLowerCase();

  if (
    s.includes("user rejected") ||
    s.includes("user denied") ||
    s.includes("action_rejected") ||
    s.includes("rejected the request") ||
    s.includes("4001")
  ) {
    return "Transaction was cancelled in your wallet.";
  }

  if (s.includes("unpredictable_gas_limit") || s.includes("missing revert data")) {
    return "Cannot complete on-chain step — often not enough BNB for stake + gas, wrong network, or the contract rejected the match. Top up BNB on the configured chain and try again.";
  }

  if (s.includes("insufficient funds") || s.includes("insufficient_funds")) {
    return "Not enough BNB in your wallet for this stake and gas fees.";
  }

  if (s.includes("nonce") && (s.includes("too low") || s.includes("already been used"))) {
    return "Wallet transactions are out of order. Clear pending txs in your wallet or wait and try again.";
  }

  if (s.includes("vite_contract_address") || s.includes("contract_address is not set")) {
    return "Arena contract address is not configured (VITE_CONTRACT_ADDRESS).";
  }

  if (s.includes("metamask not found") || s.includes("no injected wallet")) {
    return "No wallet found. Install MetaMask or another EIP-1193 wallet.";
  }

  if (
    s.includes("wallet_switchethereumchain") ||
    (s.includes("chain") && s.includes("switch"))
  ) {
    return "Switch to the correct network in your wallet (BNB Smart Chain Testnet if that is what Arena expects) and try again.";
  }

  if (s.includes("execution reverted")) {
    return "The contract rejected the transaction. Check stake, match rules, and network.";
  }

  if (raw.length > 220) {
    return "Wallet transaction failed. Check BNB balance and network, then try again. Open the browser console for technical details.";
  }

  return raw.trim() || "Something went wrong with the wallet transaction.";
}
