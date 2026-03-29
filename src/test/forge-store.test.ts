import { describe, it, expect, beforeEach } from "vitest";
import { useForgeStore, SEED_ITEMS, SEED_CHALLENGES, SEED_EVENTS, SEED_DROPS } from "@/stores/forgeStore";
import { useWalletStore } from "@/stores/walletStore";

// ─── Helpers ──────────────────────────────────────────────────

function resetForge() {
  useForgeStore.setState({
    arenaTokens: 500,
    // spread to get fresh copies of arrays so mutations don't bleed between tests
    items:      SEED_ITEMS.map((i) => ({ ...i })),
    challenges: SEED_CHALLENGES.map((c) => ({ ...c })),
    events:     SEED_EVENTS.map((e) => ({ ...e })),
    drops:      SEED_DROPS.map((d) => ({ ...d })),
    purchases:  [],
  });
}

function resetWallet() {
  // Non-custodial model: single usdtBalance (read from chain via wagmi in production)
  useWalletStore.setState({
    usdtBalance: 1247.50,
    atBalance: 500,
    transactions: [],
    dailyBettingLimit: 500,
    dailyBettingUsed: 0,
    selectedNetwork: "bsc",
    connectedAddress: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
  });
}

// ─── Seed data integrity ───────────────────────────────────────

describe("forgeStore — seed items integrity", () => {
  it("contains exactly 16 seed items", () => {
    const { items } = useForgeStore.getState();
    expect(items).toHaveLength(16);
  });

  it("every item has a unique id", () => {
    const { items } = useForgeStore.getState();
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every item has required fields (id, name, description, category, rarity, icon)", () => {
    const { items } = useForgeStore.getState();
    for (const item of items) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.rarity).toBeTruthy();
      expect(item.icon).toBeTruthy();
    }
  });

  it("every item has at least one price (AT or USDT)", () => {
    const { items } = useForgeStore.getState();
    for (const item of items) {
      expect(item.priceAT != null || item.priceUSDT != null).toBe(true);
    }
  });

  it("covers all four rarity levels (common, rare, epic, legendary)", () => {
    const { items } = useForgeStore.getState();
    const rarities = new Set(items.map((i) => i.rarity));
    expect(rarities.has("common")).toBe(true);
    expect(rarities.has("rare")).toBe(true);
    expect(rarities.has("epic")).toBe(true);
    expect(rarities.has("legendary")).toBe(true);
  });

  it("covers all six categories (avatar, frame, badge, boost, vip, bundle)", () => {
    const { items } = useForgeStore.getState();
    const cats = new Set(items.map((i) => i.category));
    expect(cats.has("avatar")).toBe(true);
    expect(cats.has("frame")).toBe(true);
    expect(cats.has("badge")).toBe(true);
    expect(cats.has("boost")).toBe(true);
    expect(cats.has("vip")).toBe(true);
    expect(cats.has("bundle")).toBe(true);
  });

  it("exactly one item is featured (Vermilion Edge)", () => {
    const { items } = useForgeStore.getState();
    const featured = items.filter((i) => i.featured);
    expect(featured).toHaveLength(1);
    expect(featured[0].name).toBe("Vermilion Edge");
  });

  it("featured item is legendary rarity", () => {
    const { items } = useForgeStore.getState();
    const featured = items.find((i) => i.featured);
    expect(featured?.rarity).toBe("legendary");
  });
});

// ─── Seed challenges integrity ─────────────────────────────────

describe("forgeStore — seed challenges integrity", () => {
  it("contains exactly 9 challenges", () => {
    const { challenges } = useForgeStore.getState();
    expect(challenges).toHaveLength(9);
  });

  it("contains 6 daily and 3 weekly challenges", () => {
    const { challenges } = useForgeStore.getState();
    const daily  = challenges.filter((c) => c.type === "daily");
    const weekly = challenges.filter((c) => c.type === "weekly");
    expect(daily).toHaveLength(6);
    expect(weekly).toHaveLength(3);
  });

  it("all challenges have positive rewardAT and rewardXP", () => {
    const { challenges } = useForgeStore.getState();
    for (const c of challenges) {
      expect(c.rewardAT).toBeGreaterThan(0);
      expect(c.rewardXP).toBeGreaterThan(0);
    }
  });

  it("all challenges have valid status values", () => {
    const { challenges } = useForgeStore.getState();
    const validStatuses = new Set(["active", "claimable", "claimed"]);
    for (const c of challenges) {
      expect(validStatuses.has(c.status)).toBe(true);
    }
  });

  it("claimed challenges have progress === target", () => {
    const { challenges } = useForgeStore.getState();
    for (const c of challenges.filter((c) => c.status === "claimed")) {
      expect(c.progress).toBe(c.target);
    }
  });

  it("claimable challenges have progress === target", () => {
    const { challenges } = useForgeStore.getState();
    for (const c of challenges.filter((c) => c.status === "claimable")) {
      expect(c.progress).toBe(c.target);
    }
  });
});

// ─── Seed events integrity ─────────────────────────────────────

describe("forgeStore — seed events integrity", () => {
  it("contains exactly 4 events", () => {
    const { events } = useForgeStore.getState();
    expect(events).toHaveLength(4);
  });

  it("has both active and upcoming events", () => {
    const { events } = useForgeStore.getState();
    const statuses = new Set(events.map((e) => e.status));
    expect(statuses.has("active")).toBe(true);
    expect(statuses.has("upcoming")).toBe(true);
  });

  it("all events have valid status values", () => {
    const { events } = useForgeStore.getState();
    const validStatuses = new Set(["upcoming", "active", "ended"]);
    for (const e of events) {
      expect(validStatuses.has(e.status)).toBe(true);
    }
  });

  it("all events have a startAt and endAt", () => {
    const { events } = useForgeStore.getState();
    for (const e of events) {
      expect(e.startAt).toBeTruthy();
      expect(e.endAt).toBeTruthy();
    }
  });
});

// ─── Seed drops integrity ──────────────────────────────────────

describe("forgeStore — seed drops integrity", () => {
  it("contains exactly 4 drops", () => {
    const { drops } = useForgeStore.getState();
    expect(drops).toHaveLength(4);
  });

  it("all drops have highlights array with at least one entry", () => {
    const { drops } = useForgeStore.getState();
    for (const d of drops) {
      expect(Array.isArray(d.highlights)).toBe(true);
      expect(d.highlights.length).toBeGreaterThan(0);
    }
  });

  it("includes a flash-type drop (Double AT Weekend)", () => {
    const { drops } = useForgeStore.getState();
    const flash = drops.find((d) => d.type === "flash");
    expect(flash).toBeDefined();
    expect(flash?.name).toBe("Double AT Weekend");
  });

  it("includes a season_pass-type drop", () => {
    const { drops } = useForgeStore.getState();
    expect(drops.some((d) => d.type === "season_pass")).toBe(true);
  });
});

// ─── getItemsByCategory ────────────────────────────────────────

describe("forgeStore — getItemsByCategory", () => {
  it("returns all items when category is 'all'", () => {
    const items = useForgeStore.getState().getItemsByCategory("all");
    expect(items).toHaveLength(16);
  });

  it("returns only avatar items when category is 'avatar'", () => {
    const items = useForgeStore.getState().getItemsByCategory("avatar");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.category).toBe("avatar");
    }
  });

  it("returns only bundle items when category is 'bundle'", () => {
    const items = useForgeStore.getState().getItemsByCategory("bundle");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.category).toBe("bundle");
    }
  });
});

// ─── getFeaturedItem ───────────────────────────────────────────

describe("forgeStore — getFeaturedItem", () => {
  it("returns the featured item (Vermilion Edge)", () => {
    const item = useForgeStore.getState().getFeaturedItem();
    expect(item).toBeDefined();
    expect(item?.name).toBe("Vermilion Edge");
  });
});

// ─── getDailyChallenges / getWeeklyChallenges ──────────────────

describe("forgeStore — challenge selectors", () => {
  it("getDailyChallenges returns 6 daily challenges", () => {
    const daily = useForgeStore.getState().getDailyChallenges();
    expect(daily).toHaveLength(6);
    for (const c of daily) expect(c.type).toBe("daily");
  });

  it("getWeeklyChallenges returns 3 weekly challenges", () => {
    const weekly = useForgeStore.getState().getWeeklyChallenges();
    expect(weekly).toHaveLength(3);
    for (const c of weekly) expect(c.type).toBe("weekly");
  });
});

// ─── getActiveEvents / getUpcomingEvents ──────────────────────

describe("forgeStore — event selectors", () => {
  it("getActiveEvents returns only active-status events", () => {
    const active = useForgeStore.getState().getActiveEvents();
    expect(active.length).toBeGreaterThan(0);
    for (const e of active) expect(e.status).toBe("active");
  });

  it("getUpcomingEvents returns only upcoming-status events", () => {
    const upcoming = useForgeStore.getState().getUpcomingEvents();
    expect(upcoming.length).toBeGreaterThan(0);
    for (const e of upcoming) expect(e.status).toBe("upcoming");
  });
});

// ─── purchaseItem (AT) ─────────────────────────────────────────

describe("forgeStore — purchaseItem with AT", () => {
  beforeEach(resetForge);

  it("succeeds when user has enough AT (Emerald Samurai costs 320, user has 500)", () => {
    const result = useForgeStore.getState().purchaseItem("item-004", "AT");
    expect(result.success).toBe(true);
  });

  it("deducts correct AT amount after successful purchase", () => {
    useForgeStore.getState().purchaseItem("item-004", "AT"); // -320 AT
    expect(useForgeStore.getState().arenaTokens).toBe(180);
  });

  it("records purchase in purchases array", () => {
    useForgeStore.getState().purchaseItem("item-004", "AT");
    const purchases = useForgeStore.getState().purchases;
    expect(purchases).toHaveLength(1);
    expect(purchases[0].itemName).toBe("Emerald Samurai");
    expect(purchases[0].currency).toBe("AT");
    expect(purchases[0].amount).toBe(320);
  });

  it("fails when user has insufficient AT (Vermilion Edge costs 3200, user has 500)", () => {
    const result = useForgeStore.getState().purchaseItem("item-001", "AT");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient at/i);
  });

  it("AT balance does not change on failed purchase", () => {
    useForgeStore.getState().purchaseItem("item-001", "AT"); // should fail
    expect(useForgeStore.getState().arenaTokens).toBe(500);
  });

  it("fails for items that have no AT price (Founder's Badge is USDT-only)", () => {
    const result = useForgeStore.getState().purchaseItem("item-005", "AT");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available for at/i);
  });

  it("fails for unknown item id", () => {
    const result = useForgeStore.getState().purchaseItem("nonexistent-item", "AT");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── purchaseItem (USDT) ──────────────────────────────────────

describe("forgeStore — purchaseItem with USDT", () => {
  beforeEach(() => { resetForge(); resetWallet(); });

  it("succeeds for Founder's Badge ($9.99 USDT) when wallet has balance", () => {
    const result = useForgeStore.getState().purchaseItem("item-005", "USDT");
    expect(result.success).toBe(true);
  });

  it("records purchase in purchases array with USDT currency", () => {
    useForgeStore.getState().purchaseItem("item-005", "USDT");
    const purchases = useForgeStore.getState().purchases;
    expect(purchases[0].currency).toBe("USDT");
    expect(purchases[0].amount).toBe(9.99);
  });

  it("records at_purchase transaction in wallet on successful USDT purchase", () => {
    useForgeStore.getState().purchaseItem("item-005", "USDT");
    const atTx = useWalletStore.getState().transactions.find((tx) => tx.type === "at_purchase");
    expect(atTx).toBeDefined();
    expect(atTx?.token).toBe("USDT");
  });

  it("fails for items that have no USDT price (Champion's Seal is AT-only)", () => {
    const result = useForgeStore.getState().purchaseItem("item-006", "USDT");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available for usdt/i);
  });
});

// ─── claimChallenge ───────────────────────────────────────────

describe("forgeStore — claimChallenge", () => {
  beforeEach(resetForge);

  it("succeeds for a claimable challenge (ch-d02: Play 5 Games, 100 AT)", () => {
    const result = useForgeStore.getState().claimChallenge("ch-d02");
    expect(result.success).toBe(true);
    expect(result.earned).toBe(100);
  });

  it("adds rewardAT to arenaTokens balance", () => {
    useForgeStore.getState().claimChallenge("ch-d02");
    expect(useForgeStore.getState().arenaTokens).toBe(600); // 500 + 100
  });

  it("marks the challenge status as 'claimed'", () => {
    useForgeStore.getState().claimChallenge("ch-d02");
    const ch = useForgeStore.getState().challenges.find((c) => c.id === "ch-d02");
    expect(ch?.status).toBe("claimed");
  });

  it("fails for a challenge that is still 'active' (not completed)", () => {
    const result = useForgeStore.getState().claimChallenge("ch-d01"); // active
    expect(result.success).toBe(false);
  });

  it("fails for a challenge that is already 'claimed'", () => {
    const result = useForgeStore.getState().claimChallenge("ch-d06"); // already claimed
    expect(result.success).toBe(false);
  });

  it("AT balance does not change when claim fails", () => {
    useForgeStore.getState().claimChallenge("ch-d01"); // active → fails
    expect(useForgeStore.getState().arenaTokens).toBe(500);
  });

  it("can claim second claimable challenge (ch-d04: Chat with Friend, 50 AT)", () => {
    const result = useForgeStore.getState().claimChallenge("ch-d04");
    expect(result.success).toBe(true);
    expect(result.earned).toBe(50);
  });

  it("claiming both claimable daily challenges gives correct total AT", () => {
    useForgeStore.getState().claimChallenge("ch-d02"); // +100
    useForgeStore.getState().claimChallenge("ch-d04"); // +50
    expect(useForgeStore.getState().arenaTokens).toBe(650); // 500 + 150
  });
});

// ─── joinEvent ────────────────────────────────────────────────

describe("forgeStore — joinEvent", () => {
  beforeEach(() => { resetForge(); resetWallet(); });

  it("successfully joins a free active event (Weekend Warrior ev-002)", () => {
    // ev-002 is already joined=true in seed; use a free upcoming event instead
    // ev-004 Free Friday is upcoming and free
    const result = useForgeStore.getState().joinEvent("ev-004");
    expect(result.success).toBe(true);
  });

  it("increments participant count after joining", () => {
    const before = useForgeStore.getState().events.find((e) => e.id === "ev-004")!.participants;
    useForgeStore.getState().joinEvent("ev-004");
    const after = useForgeStore.getState().events.find((e) => e.id === "ev-004")!.participants;
    expect(after).toBe(before + 1);
  });

  it("marks event as joined after joining", () => {
    useForgeStore.getState().joinEvent("ev-004");
    const ev = useForgeStore.getState().events.find((e) => e.id === "ev-004");
    expect(ev?.joined).toBe(true);
  });

  it("fails if already joined (ev-002 Weekend Warrior already joined in seed)", () => {
    const result = useForgeStore.getState().joinEvent("ev-002");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already joined/i);
  });

  it("fails for nonexistent event id", () => {
    const result = useForgeStore.getState().joinEvent("ev-999");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("succeeds for paid event (ev-001 CS2 Grand Prix $50 entry) when wallet has funds", () => {
    // ev-001 has entryFee=50 and joined=false in seed
    const result = useForgeStore.getState().joinEvent("ev-001");
    expect(result.success).toBe(true);
  });

  it("locks escrow when joining paid event", () => {
    useForgeStore.getState().joinEvent("ev-001"); // $50 entry
    const escrowTx = useWalletStore.getState().transactions.find((tx) => tx.type === "escrow_lock");
    expect(escrowTx).toBeDefined();
    expect(Math.abs(escrowTx!.amount)).toBe(50);
  });
});

// ─── purchaseDrop ─────────────────────────────────────────────

describe("forgeStore — purchaseDrop", () => {
  beforeEach(() => { resetForge(); resetWallet(); });

  it("successfully purchases Season 1 Pass ($9.99)", () => {
    const result = useForgeStore.getState().purchaseDrop("dr-001");
    expect(result.success).toBe(true);
  });

  it("records drop purchase in purchases array", () => {
    useForgeStore.getState().purchaseDrop("dr-001");
    const purchases = useForgeStore.getState().purchases;
    expect(purchases).toHaveLength(1);
    expect(purchases[0].itemName).toBe("Season 1 Pass");
    expect(purchases[0].currency).toBe("USDT");
    expect(purchases[0].amount).toBe(9.99);
  });

  it("records at_purchase transaction when purchasing a drop", () => {
    useForgeStore.getState().purchaseDrop("dr-001");
    const atTx = useWalletStore.getState().transactions.find((tx) => tx.type === "at_purchase");
    expect(atTx).toBeDefined();
    expect(Math.abs(atTx!.amount)).toBeCloseTo(9.99, 1);
  });

  it("flash-type drop (dr-004) returns success without recording a transaction", () => {
    const result = useForgeStore.getState().purchaseDrop("dr-004");
    expect(result.success).toBe(true);
    // Flash drops are auto-applied — no USDT charge
    const atTx = useWalletStore.getState().transactions.find((tx) => tx.type === "at_purchase");
    expect(atTx).toBeUndefined();
  });

  it("fails for nonexistent drop id", () => {
    const result = useForgeStore.getState().purchaseDrop("dr-999");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── Initial AT balance ────────────────────────────────────────

describe("forgeStore — initial state", () => {
  beforeEach(resetForge);

  it("starts with 500 Arena Tokens", () => {
    expect(useForgeStore.getState().arenaTokens).toBe(500);
  });

  it("starts with empty purchases array", () => {
    expect(useForgeStore.getState().purchases).toHaveLength(0);
  });
});
