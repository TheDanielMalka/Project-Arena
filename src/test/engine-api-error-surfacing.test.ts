/**
 * engine-api.ts silent-catch surfacing (audit 2026-04-19)
 *
 * Before this fix, every fetch wrapper in src/lib/engine-api.ts looked like:
 *   try { ... } catch { return null; }
 * which swallowed real network outages. Callers had no way to tell a failed
 * fetch apart from a legitimate "not ok" server response.
 *
 * The fix:
 *   - Adds reportEngineApiError(err) which surfaces the error via a
 *     `engine-api-network-error` CustomEvent on `window`.
 *   - Every silent `} catch {` was replaced with
 *     `} catch (err) { reportEngineApiError(err); ... }` so the event fires.
 *
 * These tests pick a few representative API wrappers, force `fetch` to throw
 * a network error, and assert:
 *   1. The stable fallback return value is still produced (no callers broken).
 *   2. The CustomEvent is dispatched on window with the error attached.
 *
 * AbortError is explicitly suppressed — we don't want to show "network error"
 * when the caller cancelled the request intentionally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEngineHealth,
  getMatchStatus,
  apiCancelMatch,
  type EngineApiNetworkErrorDetail,
} from "@/lib/engine-api";

type NetEventListener = (ev: CustomEvent<EngineApiNetworkErrorDetail>) => void;

function captureEvents() {
  const events: EngineApiNetworkErrorDetail[] = [];
  const listener: NetEventListener = (ev) => {
    events.push(ev.detail);
  };
  window.addEventListener("engine-api-network-error", listener as EventListener);
  return {
    events,
    teardown: () =>
      window.removeEventListener("engine-api-network-error", listener as EventListener),
  };
}

describe("engine-api network error surfacing", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("getEngineHealth surfaces a network error and still returns offline fallback", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { events, teardown } = captureEvents();

    const result = await getEngineHealth();

    expect(result.status).toBe("offline");
    expect(events.length).toBe(1);
    expect((events[0].error as Error).message).toBe("Failed to fetch");
    expect(typeof events[0].at).toBe("number");
    teardown();
  });

  it("getMatchStatus surfaces a network error and still returns a fallback", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("DNS lookup failed"));
    const { events, teardown } = captureEvents();

    const result = await getMatchStatus("match-123");

    // On error, getMatchStatus falls back to in_progress — but the event MUST fire.
    expect(result.id).toBe("match-123");
    expect(events.length).toBe(1);
    expect((events[0].error as Error).message).toBe("DNS lookup failed");
    teardown();
  });

  it("apiCancelMatch surfaces a network error and returns ok:false", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("connection refused"));
    const { events, teardown } = captureEvents();

    const result = await apiCancelMatch("user-token", "match-123");

    expect(result.ok).toBe(false);
    expect(result.detail).toBe("Network error");
    expect(events.length).toBe(1);
    expect((events[0].error as Error).message).toBe("connection refused");
    teardown();
  });

  it("does NOT surface AbortError (user cancelled — not a real failure)", async () => {
    const abortErr =
      typeof DOMException !== "undefined"
        ? new DOMException("The user aborted a request.", "AbortError")
        : Object.assign(new Error("aborted"), { name: "AbortError" });
    fetchMock.mockRejectedValueOnce(abortErr);
    const { events, teardown } = captureEvents();

    const result = await getEngineHealth();

    expect(result.status).toBe("offline");
    expect(events.length).toBe(0); // silent on intentional cancellation
    teardown();
  });

  it("successful fetch does not fire the error event", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { events, teardown } = captureEvents();

    const result = await getEngineHealth();

    expect(result.status).toBe("ok");
    expect(events.length).toBe(0);
    teardown();
  });
});
