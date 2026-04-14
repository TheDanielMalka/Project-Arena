/**
 * Maps ethers / MetaMask / RPC errors to short user-facing English (toasts / notifications).
 * Never surfaces library diagnostics (ENS, operation=, version=) as the primary message.
 */
function looksLikeEthersDiagnostic(raw: string): boolean {
  const r = raw.toLowerCase();
  return (
    r.includes('operation="') ||
    r.includes("code=unsupported_operation") ||
    r.includes("version=6.") ||
    r.includes("version=5.") ||
    (r.includes("code=") && r.includes("method="))
  );
}

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

  /* ethers may try ENS on chains (e.g. BNB) that don’t support it — often bad/short contract address in env */
  if (
    s.includes("does not support ens") ||
    s.includes("getensaddress") ||
    (s.includes("unsupported_operation") && s.includes("ens"))
  ) {
    return "This network doesn’t support name lookup (ENS). Use a normal 0x… contract address in configuration, confirm you’re on the correct chain (e.g. BNB Smart Chain Testnet), and try again.";
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

  if (s.includes("unsupported_operation")) {
    return "This wallet or network doesn’t support that operation. Confirm you’re on the chain Arena expects and try again.";
  }

  if (raw.length > 220 || looksLikeEthersDiagnostic(raw)) {
    return "Wallet transaction failed. Check BNB balance, the correct network, and try again. If it keeps happening, contact support with the time you tried.";
  }

  return raw.trim() || "Something went wrong with the wallet transaction.";
}
