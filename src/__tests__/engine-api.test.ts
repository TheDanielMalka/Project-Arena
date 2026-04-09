import { beforeEach, describe, expect, it, vi } from "vitest";

function mockFetch(resp: Partial<Response> & { json?: () => unknown | Promise<unknown> }) {
  const fn = vi.fn(async (_input: unknown, _init?: RequestInit) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      ...resp,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function importRealEngineApi() {
  // src/test/setup.ts globally mocks "@/lib/engine-api" for most tests.
  // For these unit tests we need the real implementation to verify fetch calls.
  vi.resetModules();
  vi.unmock("@/lib/engine-api");
  return await import("@/lib/engine-api");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("engine-api.ts — fetch contracts", () => {
  it("apiJoinMatch sends team in body when provided", async () => {
    const fetchFn = mockFetch({ ok: true, json: async () => ({ joined: true, team: "A" }) });
    const { apiJoinMatch } = await importRealEngineApi();

    await apiJoinMatch("token", "M-1", { team: "A" });

    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    expect(body.team).toBe("A");
  });

  it("apiJoinMatch does not send team when null", async () => {
    const fetchFn = mockFetch({ ok: true, json: async () => ({ joined: true }) });
    const { apiJoinMatch } = await importRealEngineApi();

    await apiJoinMatch("token", "M-1", { team: null });

    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    expect(body.team).toBeUndefined();
  });

  it("apiMatchHeartbeat returns null on server 500", async () => {
    mockFetch({ ok: false, status: 500 });
    const { apiMatchHeartbeat } = await importRealEngineApi();

    const result = await apiMatchHeartbeat("token", "M-1", { game: "CS2", mode: "1v1", code: "CODE" });
    expect(result).toBeNull();
  });

  it("apiMatchHeartbeat returns HeartbeatResponse when ok", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        in_match: true,
        match_id: "M-1",
        status: "waiting",
        game: "CS2",
        mode: "1v1",
        code: "CODE",
        max_players: 2,
        max_per_team: 1,
        host_id: "U-1",
        type: "public",
        bet_amount: 10,
        stake_currency: "AT",
        created_at: new Date().toISOString(),
        your_user_id: "U-1",
        your_team: "A",
        stale_removed: false,
        players: [],
      }),
    });
    const { apiMatchHeartbeat } = await importRealEngineApi();

    const result = await apiMatchHeartbeat("token", "M-1", { game: "CS2", mode: "1v1", code: "CODE" });
    expect(result?.in_match).toBe(true);
  });

  it("apiRespondToNotification accept returns match_id", async () => {
    mockFetch({ ok: true, json: async () => ({ action: "accept", match_id: "M-99" }) });
    const { apiRespondToNotification } = await importRealEngineApi();

    const result = await apiRespondToNotification("token", "N-1", "accept");
    expect(result?.match_id).toBe("M-99");
  });

  it("apiRespondToNotification decline returns { action: 'decline' }", async () => {
    mockFetch({ ok: true, json: async () => ({ action: "decline" }) });
    const { apiRespondToNotification } = await importRealEngineApi();

    const result = await apiRespondToNotification("token", "N-1", "decline");
    expect(result?.action).toBe("decline");
  });

  it("apiKickPlayer 403 returns ok:false", async () => {
    mockFetch({ ok: false, status: 403 });
    const { apiKickPlayer } = await importRealEngineApi();

    const result = await apiKickPlayer("token", "M-1", "U-2");
    expect(result.ok).toBe(false);
  });

  it("apiKickPlayer 200 returns ok:true", async () => {
    mockFetch({ ok: true, json: async () => ({ kicked: true }) });
    const { apiKickPlayer } = await importRealEngineApi();

    const result = await apiKickPlayer("token", "M-1", "U-2");
    expect(result.ok).toBe(true);
  });
});

