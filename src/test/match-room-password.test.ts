import { describe, it, expect } from "vitest";
import { mapApiMatchRowToMatch } from "@/lib/engine-api";
import { joinPasswordFailureMessage, MATCH_JOIN_PASSWORD_FIELD } from "@/lib/matchRoomPassword";

describe("matchRoomPassword", () => {
  it("uses password as the join JSON field name (engine contract)", () => {
    expect(MATCH_JOIN_PASSWORD_FIELD).toBe("password");
  });

  it("joinPasswordFailureMessage returns English fallback when detail empty", () => {
    const msg = joinPasswordFailureMessage(null);
    expect(msg).toContain("Incorrect room password");
  });

  it("joinPasswordFailureMessage keeps short server messages about passwords", () => {
    expect(joinPasswordFailureMessage("Wrong room password")).toBe("Wrong room password");
  });
});

describe("mapApiMatchRowToMatch — room password flags", () => {
  it("maps has_password and does not set password from API row", () => {
    const m = mapApiMatchRowToMatch({
      id: "550e8400-e29b-41d4-a716-446655440000",
      game: "CS2",
      mode: "1v1",
      type: "custom",
      bet_amount: 10,
      status: "waiting",
      max_players: 2,
      created_at: "2026-01-01T00:00:00Z",
      host_id: "u1",
      host_username: "Host",
      has_password: true,
      password: "secret-should-not-appear-on-client",
    });
    expect(m).not.toBeNull();
    expect(m!.hasPassword).toBe(true);
    expect(m!.password).toBeUndefined();
  });
});
