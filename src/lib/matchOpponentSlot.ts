import type { Match } from "@/types";

/** Primary opponent slot for 1v1-style display / tickets — mirrors RecentMatches / History. */
export function getOpponentSlotForUser(m: Match, myId: string): string {
  if (m.type === "custom") return m.host;
  if (m.hostId === myId) {
    return (
      m.players.find((p) => p !== myId) ??
      m.teamB?.[0] ??
      m.teamA?.find((p) => p !== myId) ??
      "Opponent"
    );
  }
  return m.host;
}
