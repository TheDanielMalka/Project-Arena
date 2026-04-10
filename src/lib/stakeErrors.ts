import type { StakeCurrency } from "@/types";

export type ApiFail = { status: number; detail: string | null };

export function stakeFriendlyActionLabel(sc: StakeCurrency): string {
  return sc === "AT" ? "Arena Tokens (AT)" : "Crypto escrow";
}

export function joinFailureMessage(sc: StakeCurrency, fail: ApiFail): string {
  const detail = (fail.detail ?? "").trim();
  if (fail.status === 402) {
    return sc === "AT"
      ? "Insufficient AT balance to join this room."
      : "Insufficient balance to join this staked room.";
  }
  if (fail.status === 400) {
    if (sc === "CRYPTO") {
      return detail || "Link a wallet before joining a staked room.";
    }
    return detail || "Could not join this room.";
  }
  if (fail.status === 403) {
    // Password handled separately by password gate.
    return detail || "Join not allowed.";
  }
  if (fail.status === 409) {
    return detail || "You already have an active match room.";
  }
  if (fail.status === 404) {
    return "Room not found.";
  }
  return detail || "Join failed. Please try again.";
}

export function createFailureMessage(sc: StakeCurrency, fail: ApiFail): string {
  const detail = (fail.detail ?? "").trim();
  if (fail.status === 402) {
    return sc === "AT"
      ? "Insufficient AT balance to create this room."
      : "Insufficient balance to create this staked room.";
  }
  if (fail.status === 409) {
    return detail || "You already have an active match room.";
  }
  if (fail.status === 400 || fail.status === 422) {
    return detail || "Could not create this match.";
  }
  if (fail.status === 403) {
    return detail || "You are not allowed to create this match.";
  }
  if (fail.status === 404) {
    return detail || "Create request could not be completed.";
  }
  // Prefer server `detail` whenever present; otherwise surface HTTP status (e.g. 500) for support.
  if (detail) return detail;
  if (fail.status >= 400) {
    return `Match creation failed (HTTP ${fail.status}). Please try again.`;
  }
  return "Match creation failed. Please try again.";
}

export function inviteFailureMessage(sc: StakeCurrency, fail: ApiFail): string {
  const detail = (fail.detail ?? "").trim();
  if (fail.status === 402) {
    return sc === "AT"
      ? "Your friend does not have enough AT to join this room."
      : "Your friend does not have enough balance to join this staked room.";
  }
  if (fail.status === 400) {
    return detail || (sc === "CRYPTO"
      ? "Your friend must link a wallet before joining this staked room."
      : "Invite blocked.");
  }
  if (fail.status === 409) {
    return detail || "Invite blocked.";
  }
  return detail || "Could not send invite. Please try again.";
}

