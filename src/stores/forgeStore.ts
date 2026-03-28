import { create } from "zustand";
import type {
  ForgeItem, ForgeChallenge, ForgeEvent, ForgeDrop, ForgePurchase,
  ForgeCategory,
} from "@/types";
import { useWalletStore } from "@/stores/walletStore";

// ─── Seed Data ────────────────────────────────────────────────
// DB-ready: replace with GET /api/forge/items
export const SEED_ITEMS: ForgeItem[] = [
  { id: "item-001", name: "Shadow Phoenix", category: "avatar", rarity: "legendary", icon: "🔥", priceAT: 2400, description: "A mythical creature reborn from the ashes of defeat.", featured: true, limited: true, stock: 47, expiresAt: "2026-03-30T00:00:00Z", ownedBy: 23 },
  { id: "item-002", name: "Neon Samurai",   category: "avatar", rarity: "epic",      icon: "⚔️", priceAT: 1200, description: "Strike fast, vanish faster.", ownedBy: 156 },
  { id: "item-003", name: "Arctic Wolf",    category: "avatar", rarity: "rare",      icon: "🐺", priceAT: 600,  description: "Cold, calculated, dominant.", ownedBy: 489 },
  { id: "item-004", name: "Iron Knight",    category: "avatar", rarity: "common",    icon: "🛡️", priceAT: 200,  description: "Honor through battle.", ownedBy: 1240 },
  { id: "item-005", name: "Founder's Badge", category: "badge", rarity: "legendary", icon: "🏅", priceUSDT: 9.99, description: "Exclusive badge for Arena's earliest supporters.", limited: true, stock: 100, ownedBy: 89 },
  { id: "item-006", name: "Champion's Seal", category: "badge", rarity: "epic",      icon: "🔱", priceAT: 900, description: "Earned by the elite.", ownedBy: 234 },
  { id: "item-007", name: "Veteran's Mark",  category: "badge", rarity: "rare",      icon: "⚜️", priceAT: 400, description: "For those who've seen it all.", ownedBy: 678 },
  { id: "item-008", name: "Double XP (24h)", category: "boost", rarity: "common",    icon: "⚡", priceAT: 150, description: "Earn 2× XP on all matches for 24 hours." },
  { id: "item-009", name: "Win Shield",      category: "boost", rarity: "rare",      icon: "🔒", priceAT: 500, description: "Protect your win streak — one loss won't count." },
  { id: "item-010", name: "VIP Pass (30d)",  category: "vip",   rarity: "epic",      icon: "👑", priceAT: 3000, priceUSDT: 14.99, description: "Priority matchmaking, 5% cashback, exclusive VIP badge." },
  { id: "item-011", name: "VIP Pass (7d)",   category: "vip",   rarity: "rare",      icon: "💎", priceAT: 900,  priceUSDT: 4.99,  description: "A week of VIP treatment." },
  { id: "item-012", name: "Elite Bundle",    category: "bundle", rarity: "legendary", icon: "📦", priceAT: 5000, priceUSDT: 24.99, description: "Neon Samurai + Champion's Seal + 30d VIP + 3× Double XP. Best value.", ownedBy: 12 },
];

// DB-ready: replace with GET /api/forge/challenges?type=daily&type=weekly
export const SEED_CHALLENGES: ForgeChallenge[] = [
  { id: "ch-d01", title: "Win 3 Matches",   description: "Win 3 ranked matches today",            icon: "🏆", type: "daily",  rewardAT: 150,  rewardXP: 50,  progress: 2, target: 3, status: "active",    expiresAt: "2026-03-28T00:00:00Z" },
  { id: "ch-d02", title: "Play 5 Games",    description: "Complete any 5 matches",                icon: "🎮", type: "daily",  rewardAT: 100,  rewardXP: 30,  progress: 5, target: 5, status: "claimable", expiresAt: "2026-03-28T00:00:00Z" },
  { id: "ch-d03", title: "Submit a Result", description: "Upload a match result screenshot",      icon: "📸", type: "daily",  rewardAT: 75,   rewardXP: 20,  progress: 0, target: 1, status: "active",    expiresAt: "2026-03-28T00:00:00Z" },
  { id: "ch-d04", title: "Chat with Friend",description: "Send a message to a friend",            icon: "💬", type: "daily",  rewardAT: 50,   rewardXP: 15,  progress: 1, target: 1, status: "claimable", expiresAt: "2026-03-28T00:00:00Z" },
  { id: "ch-d05", title: "1v1 Flawless",    description: "Win a 1v1 without dropping a point",   icon: "🎯", type: "daily",  rewardAT: 250,  rewardXP: 80,  progress: 0, target: 1, status: "active",    expiresAt: "2026-03-28T00:00:00Z" },
  { id: "ch-d06", title: "Daily Login",     description: "Log in to Arena today",                 icon: "⚡", type: "daily",  rewardAT: 25,   rewardXP: 10,  progress: 1, target: 1, status: "claimed",   expiresAt: "2026-03-28T00:00:00Z" },
  { id: "ch-w01", title: "Win 15 Matches",  description: "Win 15 ranked matches this week",       icon: "🔥", type: "weekly", rewardAT: 750,  rewardXP: 250, progress: 7, target: 15, status: "active",   expiresAt: "2026-04-03T00:00:00Z" },
  { id: "ch-w02", title: "Make a Deposit",  description: "Deposit any amount to your wallet",     icon: "💰", type: "weekly", rewardAT: 500,  rewardXP: 200, progress: 1, target: 1,  status: "claimable",expiresAt: "2026-04-03T00:00:00Z" },
  { id: "ch-w03", title: "Reach Gold Rank", description: "Achieve Gold rank or higher this week", icon: "🥇", type: "weekly", rewardAT: 1500, rewardXP: 500, progress: 0, target: 1,  status: "active",   expiresAt: "2026-04-03T00:00:00Z" },
];

// DB-ready: replace with GET /api/forge/events
export const SEED_EVENTS: ForgeEvent[] = [
  { id: "ev-001", name: "CS2 Grand Prix",       description: "Weekend 5v5 championship. Top 3 teams split the prize pool.",           game: "CS2",     type: "tournament", icon: "🏆", prizePool: 5000, entryFee: 50, participants: 87,  maxParticipants: 128, startAt: "2026-03-27T18:00:00Z", endAt: "2026-03-29T22:00:00Z", status: "active",   joined: false },
  { id: "ev-002", name: "Weekend Warrior",       description: "Play any 10 matches this weekend. Top earners win bonus AT.",            game: "Any",     type: "special",    icon: "⚔️", rewardAT: 1000,              participants: 234,                    startAt: "2026-03-27T00:00:00Z", endAt: "2026-03-30T23:59:00Z", status: "active",   joined: true  },
  { id: "ev-003", name: "Valorant Invitational", description: "Elite 5v5 Valorant tournament — only the best qualify.",                game: "Valorant",type: "tournament", icon: "🎯", prizePool: 2500, entryFee: 25, participants: 12,  maxParticipants: 32,  startAt: "2026-04-05T16:00:00Z", endAt: "2026-04-07T22:00:00Z", status: "upcoming", joined: false },
  { id: "ev-004", name: "Free Friday",           description: "No entry fee. Play 5 matches this Friday and earn Arena Tokens.",       game: "Any",     type: "special",    icon: "🎁", rewardAT: 500,               participants: 0,                      startAt: "2026-04-04T00:00:00Z", endAt: "2026-04-05T23:59:00Z", status: "upcoming", joined: false },
];

// DB-ready: replace with GET /api/forge/drops
export const SEED_DROPS: ForgeDrop[] = [
  { id: "dr-001", name: "Season 1 Pass",     description: "Full access to Season 1 — 100 reward tiers, exclusive cosmetics, bonus AT.",                 type: "season_pass", icon: "🌟", salePriceUSDT: 9.99,  highlights: ["100 reward tiers", "Exclusive Season 1 avatar", "500 AT sign-on bonus", "Unique Season badge", "5% cashback all season"],                        tag: "BEST VALUE"  },
  { id: "dr-002", name: "Spring Frenzy Bundle", description: "Celebrate Spring with this limited pack. Includes Neon Samurai + 7d VIP + 3× Double XP.", type: "bundle",     icon: "🌸", originalPriceUSDT: 29.99, salePriceUSDT: 17.99, discountPercent: 40, stock: 150, expiresAt: "2026-03-31T00:00:00Z", highlights: ["Neon Samurai avatar (Epic)", "VIP Pass 7 days", "3× Double XP tokens", "Spring-exclusive badge"],          tag: "40% OFF"     },
  { id: "dr-003", name: "Founder's Pack",    description: "Forever exclusive. Never available again after this weekend. Includes the rarest items.",      type: "bundle",     icon: "👑", originalPriceUSDT: 49.99, salePriceUSDT: 19.99, discountPercent: 60, stock: 12,  expiresAt: "2026-03-30T00:00:00Z", highlights: ["Founder's Badge (Legendary)", "Shadow Phoenix avatar", "VIP Pass 30 days", "1 000 AT bonus", "Early feature access"], tag: "LAST CHANCE" },
  { id: "dr-004", name: "Double AT Weekend", description: "Earn 2× Arena Tokens on ALL challenges and events this weekend. Active now!",                  type: "flash",      icon: "⚡",                                                              expiresAt: "2026-03-30T23:59:00Z", highlights: ["2× AT on daily challenges", "2× AT on weekly challenges", "2× AT on event rewards"],                                   tag: "ACTIVE NOW"  },
];

// ─── Store ────────────────────────────────────────────────────

interface ForgeState {
  arenaTokens: number;
  items: ForgeItem[];
  challenges: ForgeChallenge[];
  events: ForgeEvent[];
  drops: ForgeDrop[];
  purchases: ForgePurchase[];

  // DB-ready: replace with GET /api/forge/items?category=X
  getItemsByCategory: (category: ForgeCategory | "all") => ForgeItem[];
  // DB-ready: replace with GET /api/forge/items?featured=true
  getFeaturedItem: () => ForgeItem | undefined;

  // DB-ready: replace with POST /api/forge/purchase
  purchaseItem: (itemId: string, currency: "AT" | "USDT") => { success: boolean; error?: string };
  // DB-ready: replace with POST /api/forge/drops/:id/purchase
  purchaseDrop: (dropId: string) => { success: boolean; error?: string };
  // DB-ready: replace with POST /api/forge/challenges/:id/claim
  claimChallenge: (challengeId: string) => { success: boolean; earned?: number };
  // DB-ready: replace with POST /api/forge/events/:id/join
  joinEvent: (eventId: string) => { success: boolean; error?: string };

  // DB-ready: replace with GET /api/forge/challenges?type=daily
  getDailyChallenges: () => ForgeChallenge[];
  // DB-ready: replace with GET /api/forge/challenges?type=weekly
  getWeeklyChallenges: () => ForgeChallenge[];
  // DB-ready: replace with GET /api/forge/events?status=active
  getActiveEvents: () => ForgeEvent[];
  // DB-ready: replace with GET /api/forge/events?status=upcoming
  getUpcomingEvents: () => ForgeEvent[];
}

export const useForgeStore = create<ForgeState>((set, get) => ({
  arenaTokens: 500,
  items:      SEED_ITEMS,
  challenges: SEED_CHALLENGES,
  events:     SEED_EVENTS,
  drops:      SEED_DROPS,
  purchases:  [],

  getItemsByCategory: (category) =>
    category === "all"
      ? get().items
      : get().items.filter((i) => i.category === category),

  getFeaturedItem: () => get().items.find((i) => i.featured),

  purchaseItem: (itemId, currency) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return { success: false, error: "Item not found" };

    if (currency === "AT") {
      if (!item.priceAT) return { success: false, error: "Not available for AT" };
      if (get().arenaTokens < item.priceAT) return { success: false, error: `Insufficient AT — need ${item.priceAT} AT` };
      const purchase: ForgePurchase = { id: `pur-${Date.now()}`, itemId, itemName: item.name, currency: "AT", amount: item.priceAT, purchasedAt: new Date().toISOString() };
      set((s) => ({ arenaTokens: s.arenaTokens - item.priceAT!, purchases: [purchase, ...s.purchases] }));
      return { success: true };
    }

    if (currency === "USDT") {
      if (!item.priceUSDT) return { success: false, error: "Not available for USDT" };
      // DB-ready: replace with POST /api/forge/purchase → server charges wallet
      const result = useWalletStore.getState().withdraw(item.priceUSDT, "USDT", "forge_store_purchase");
      if (!result) return { success: false, error: "Insufficient USDT balance" };
      const purchase: ForgePurchase = { id: `pur-${Date.now()}`, itemId, itemName: item.name, currency: "USDT", amount: item.priceUSDT, purchasedAt: new Date().toISOString() };
      set((s) => ({ purchases: [purchase, ...s.purchases] }));
      return { success: true };
    }

    return { success: false, error: "Invalid currency" };
  },

  purchaseDrop: (dropId) => {
    const drop = get().drops.find((d) => d.id === dropId);
    if (!drop) return { success: false, error: "Drop not found" };
    if (drop.type === "flash") return { success: true }; // flash = auto-applied, no purchase needed
    const price = drop.salePriceUSDT ?? drop.originalPriceUSDT;
    if (!price) return { success: false, error: "No price set" };
    // DB-ready: replace with POST /api/forge/drops/:id/purchase
    const result = useWalletStore.getState().withdraw(price, "USDT", "forge_drop_purchase");
    if (!result) return { success: false, error: "Insufficient USDT balance" };
    const purchase: ForgePurchase = { id: `pur-drop-${Date.now()}`, itemId: dropId, itemName: drop.name, currency: "USDT", amount: price, purchasedAt: new Date().toISOString() };
    set((s) => ({ purchases: [purchase, ...s.purchases] }));
    return { success: true };
  },

  claimChallenge: (challengeId) => {
    const challenge = get().challenges.find((c) => c.id === challengeId);
    if (!challenge || challenge.status !== "claimable") return { success: false };
    // DB-ready: replace with POST /api/forge/challenges/:id/claim → awards AT + XP server-side
    set((s) => ({
      challenges: s.challenges.map((c) =>
        c.id === challengeId ? { ...c, status: "claimed" as const } : c
      ),
      arenaTokens: s.arenaTokens + challenge.rewardAT,
    }));
    return { success: true, earned: challenge.rewardAT };
  },

  joinEvent: (eventId) => {
    const event = get().events.find((e) => e.id === eventId);
    if (!event) return { success: false, error: "Event not found" };
    if (event.joined) return { success: false, error: "Already joined" };
    if (event.status === "ended") return { success: false, error: "Event has ended" };

    if (event.entryFee) {
      // DB-ready: replace with POST /api/forge/events/:id/join → locks escrow server-side
      const result = useWalletStore.getState().lockEscrow(event.entryFee, `forge-event-${eventId}`);
      if (!result) return { success: false, error: `Insufficient balance — entry fee is $${event.entryFee}` };
    }
    set((s) => ({
      events: s.events.map((e) =>
        e.id === eventId ? { ...e, joined: true, participants: e.participants + 1 } : e
      ),
    }));
    return { success: true };
  },

  getDailyChallenges:    () => get().challenges.filter((c) => c.type === "daily"),
  getWeeklyChallenges:   () => get().challenges.filter((c) => c.type === "weekly"),
  getActiveEvents:       () => get().events.filter((e) => e.status === "active"),
  getUpcomingEvents:     () => get().events.filter((e) => e.status === "upcoming"),
}));
