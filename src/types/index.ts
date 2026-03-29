// ─── Core Enums ──────────────────────────────────────────────

export type MatchStatus = "waiting" | "in_progress" | "completed" | "cancelled" | "disputed";
export type MatchType = "public" | "custom";
export type MatchMode = "1v1" | "2v2" | "4v4" | "5v5";
export type Game = "CS2" | "Valorant" | "Fortnite" | "Apex Legends" | "PUBG" | "COD" | "League of Legends";

// Non-custodial: no deposit/withdrawal — funds move directly wallet ↔ ArenaEscrow contract
// at_purchase = bought AT with USDT in Forge | at_spend = spent AT in Forge store
export type TransactionType = "match_win" | "match_loss" | "fee" | "refund" | "escrow_lock" | "escrow_release" | "at_purchase" | "at_spend";
export type TransactionStatus = "completed" | "pending" | "failed" | "cancelled";

export type DisputeStatus = "open" | "reviewing" | "resolved" | "escalated";
export type DisputeResolution = "pending" | "approved" | "rejected" | "player_a_wins" | "player_b_wins" | "refund" | "void";

export type Network = "bsc" | "solana" | "ethereum";

export type UserRole = "user" | "admin" | "moderator";
export type UserStatus = "active" | "flagged" | "banned" | "suspended";

// ─── Arena ID ─────────────────────────────────────────────────
// Immutable public identifier — format: ARENA-XXXXXX
// DB: users.arena_id (VARCHAR(12) UNIQUE NOT NULL)
// Never changes even if username changes. All public references use this.
export type ArenaId = string;

// ─── User / Profile ─────────────────────────────────────────
// DB-ready: PATCH /api/users/me — send snake_case JSON aligned with `users` row:
//   username, avatar, avatar_bg, equipped_badge_icon (NULL to clear pin),
//   forge_unlocked_item_ids (TEXT[]), vip_expires_at, shop_entitlements (JSONB).
//   Client maps UserProfile camelCase ↔ SQL.

/** DB: users.shop_entitlements[] — time-limited Forge entitlements (boosts, etc.) */
export interface ShopEntitlement {
  itemId: string;
  kind: "boost" | "bundle";
  label: string;
  expiresAt: string; // ISO 8601
}

export interface UserProfile {
  id: string;
  role: UserRole;
  username: string;
  email: string;
  steamId: string;
  walletAddress: string;
  walletShort: string;
  rank: string;
  tier: string;
  verified: boolean;
  avatarInitials: string;
  avatar?: string;    // "initials" | emoji | "upload:{dataURL}" | "preset:{id}" — Identity Studio catalog in avatarPresets.ts · DB: users.avatar TEXT
  avatarBg?: string;  // bgId from avatarBgs.ts — DB: stored as text, defaults to "default"
  /** DB: users.equipped_badge_icon — Forge badge:* string (e.g. badge:founders); shown as small pin on avatar ring */
  equippedBadgeIcon?: string;
  /** DB: users.forge_unlocked_item_ids — Forge catalog item ids the user owns (mirrors purchases; server is source of truth in prod) */
  unlockedForgeItemIds?: string[];
  /** DB: users.vip_expires_at — NULL when inactive; server clears when past */
  vipExpiresAt?: string;
  /** DB: users.shop_entitlements — JSONB array; server prunes expired rows on read or cron */
  shopEntitlements?: ShopEntitlement[];
  preferredGame: Game;
  arenaId: ArenaId;     // DB: users.arena_id — immutable public ID (ARENA-XXXXXX)
  memberSince: string;
  status: UserStatus;
  stats: UserStats;
  balance: UserBalance;
}

export interface UserStats {
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  totalEarnings: number;
  inEscrow: number;
  xp: number;  // DB-ready: stored in user_stats table, earned by completing challenges
}

export interface UserBalance {
  total: number;
  available: number;
  inEscrow: number;
}

/** Client / PATCH payload — `stats` may be partial; merged into existing user_stats row in userStore.updateProfile */
export type UserProfilePatch = Omit<Partial<UserProfile>, "stats"> & {
  stats?: Partial<UserStats>;
};

// ─── Matches ─────────────────────────────────────────────────

export interface Match {
  id: string;
  type: MatchType;
  host: string;
  hostId: string;
  game: Game;
  mode: MatchMode;
  betAmount: number;         // stake per player — DB: matches.bet_amount
  players: string[];
  maxPlayers: number;        // teamSize * 2 — DB: matches.max_players
  status: MatchStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  winnerId?: string;
  timeLeft?: string;
  // Team & escrow fields
  teamSize?: number;         // players per team — DB: matches.max_per_team
  depositsReceived?: number; // how many players locked funds — DB: matches.deposits_received
  lockCountdownStart?: string;   // ISO timestamp set when room fills — starts 10s leave window
                                 // DB: matches.lock_countdown_start (TIMESTAMPTZ)
  expiresAt?: string;            // ISO timestamp (createdAt + 30min) — DB: matches.expires_at (TIMESTAMPTZ GENERATED)
  code?: string;
  password?: string;
  teamA?: string[];
  teamB?: string[];
  maxPerTeam?: number;       // alias for teamSize (kept for UI compat)
}

// ─── Match Players ───────────────────────────────────────────
// DB: match_players table — one row per player per match

export interface MatchPlayer {
  matchId: string;           // DB: match_players.match_id (FK → matches.id)
  userId: string;            // DB: match_players.user_id (FK → users.id)
  team: "A" | "B";          // DB: match_players.team
  walletAddress: string;     // DB: match_players.wallet_address — verified vs users.wallet_address
  hasDeposited: boolean;     // DB: match_players.has_deposited
  depositedAt?: string;      // DB: match_players.deposited_at (ISO 8601)
  depositAmount?: number;    // DB: match_players.deposit_amount — matches matches.bet_amount
  joinedAt: string;          // DB: match_players.joined_at
}

// ─── Transactions / Wallet ───────────────────────────────────

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  token: string;
  usdValue: number;
  status: TransactionStatus;
  timestamp: string;
  txHash?: string;
  from?: string;
  to?: string;
  note?: string;
  matchId?: string;
}

export interface Token {
  symbol: string;
  name: string;
  balance: number;   // DB: wallet_tokens.balance (NUMERIC 18,8)
  usdValue: number;  // DB: wallet_tokens.usd_value
  change24h: number; // DB: wallet_tokens.change_24h
  icon: string;      // derived client-side from symbol (emoji map) — not stored in DB
  network: Network;
}

export interface WalletInfo {
  addresses: Record<Network, string>;      // DB: wallet_addresses table
  selectedNetwork: Network;                // client-side preference only
  platformBettingMax: number;              // DB: platform_settings.daily_betting_max (read-only)
  dailyBettingLimit: number;              // DB: user_settings.daily_betting_limit (user-chosen: 50–max)
  dailyBettingUsed: number;               // computed from transactions WHERE type='escrow_lock' AND date=today
  twoFactorEnabled: boolean;              // DB: user_settings.two_factor_enabled
}

// ─── Disputes ────────────────────────────────────────────────

export interface Dispute {
  id: string;
  matchId: string;
  playerA: string;   // DB: disputes.player_a (UUID → users.username via JOIN)
  playerB: string;   // DB: disputes.player_b (UUID → users.username via JOIN)
  game: Game;        // DB: derived via JOIN matches.game
  stake: number;     // DB: derived via JOIN matches.bet_amount
  reason: string;
  status: DisputeStatus;
  resolution: DisputeResolution;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;  // DB: disputes.resolved_by (UUID → users.username via JOIN)
  evidence?: string;
  adminNotes?: string;
}

// ─── Audit / Admin ───────────────────────────────────────────
// DB: audit_logs table

export interface AuditLog {
  id: string;            // DB: audit_logs.id (UUID)
  adminId: string;       // DB: audit_logs.admin_id (UUID → users.id)
  adminName: string;     // DB: JOIN users.username
  action: string;        // DB: audit_logs.action (e.g. BAN_USER, RESOLVE_DISPUTE)
  target: string;        // DB: audit_logs.target (entity id, e.g. U-301, D-1051)
  detail: string;        // DB: audit_logs.detail
  createdAt: string;     // DB: audit_logs.created_at (ISO 8601)
}

// DB: users table (filtered by status IN ('flagged','banned'))
export interface FlaggedUser {
  id: string;            // DB: users.id (UUID)
  username: string;      // DB: users.username
  walletAddress: string; // DB: users.wallet_address — truncated in UI
  reason: string;        // DB: flag trigger reason (anti-cheat / anomaly)
  winRate: number;       // DB: user_stats.win_rate (0–100)
  matchesPlayed: number; // DB: user_stats.matches_played
  flaggedAt: string;     // DB: users.updated_at when status changed (ISO 8601)
  status: "flagged" | "banned" | "cleared"; // DB: users.status
}

// Live activity feed — real-time events (WebSocket / polling when DB connected)
export interface AdminActivityEvent {
  id: string;
  type: "match_start" | "match_end" | "payout" | "deposit" | "login" | "dispute" | "ban";
  message: string;
  timestamp: string;     // ISO 8601 / locale time
  highlight?: boolean;   // high-severity events (disputes, bans)
}

// DB: platform_settings table (single-row config)
export interface PlatformSettings {
  feePercent: number;               // DB: fee_percent        default 5
  platformBettingMax: number;       // DB: daily_betting_max  default 500
  maintenanceMode: boolean;         // DB: maintenance_mode   default false
  registrationOpen: boolean;        // DB: registration_open  default true
  autoDisputeEscalation: boolean;   // DB: auto_dispute_escalation default true
  killSwitchActive: boolean;        // DB: kill_switch_active default false
}

// ─── Daily Challenges ────────────────────────────────────────
// DB-ready: challenges defined server-side, progress computed from match history

export type ChallengeType =
  | "wins"            // win N matches today
  | "matches_played"  // play N matches today
  | "earnings"        // earn $N today from wins
  | "game_specific"   // win N matches in a specific game
  | "high_stakes"     // win a match with bet >= minBet
  | "streak";         // maintain a win streak of N

export type ChallengeStatus = "locked" | "active" | "completed" | "claimed";

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  icon: string;           // emoji — DB: stored per challenge definition
  type: ChallengeType;
  target: number;         // goal value (e.g. 3 wins, $100 earned)
  reward: number;         // $ bonus on completion
  game?: Game;            // DB: optional — game-specific challenge
  minBet?: number;        // DB: optional — minimum bet for high_stakes type
  expiresAt: string;      // ISO 8601 — set by server at daily reset (midnight UTC)
  // Note: `current` is NOT stored here — computed from Match[] at runtime
  // When DB is connected, current will come from user_challenge_progress table
}

// ─── Notifications ───────────────────────────────────────────

export type NotificationType =
  | "match_result"    // match completed / won / lost           — DB: notifications.type = 'match_result'
  | "payout"          // funds released after win               — DB: notifications.type = 'payout'
  | "system"          // platform / maintenance messages        — DB: notifications.type = 'system'
  | "dispute"         // dispute opened or resolved             — DB: notifications.type = 'dispute'
  | "match_invite"    // room created / code shared             — DB: notifications.type = 'match_invite'
  | "escrow"          // deposit confirmed / refunded           — DB: notifications.type = 'escrow'
  | "friend_request"; // friend request sent or accepted        — DB: notifications.type = 'friend_request'

// ─── Arena Client Status ──────────────────────────────────
// Tracks whether the desktop capture client is running and ready to record.
// DB-ready: synced via POST /api/client/heartbeat (desktop client → server)
// WS-ready: client emits "client:status" event on WebSocket connection

export type ClientStatus =
  | "checking"      // initial state — first health poll not yet complete
  | "disconnected"  // Engine API unreachable — client not running        → DB: client_sessions.status = 'disconnected'
  | "connected"     // Engine API up but capture subsystem not ready yet  → DB: client_sessions.status = 'connected'
  | "ready"         // client running, capture ready, match play allowed   → DB: client_sessions.status = 'ready'
  | "in_match";     // client actively recording a match session           → DB: client_sessions.status = 'in_match'

export interface ClientSession {
  status: ClientStatus;
  version?: string;           // DB: client_sessions.client_version
  uptime?: number;            // seconds — DB: client_sessions.uptime
  lastCheckedAt?: string;     // ISO — DB: client_sessions.last_heartbeat_at
  matchId?: string;           // set when status = 'in_match' — DB: client_sessions.active_match_id
}

export interface Notification {
  id: string;
  userId?: string;   // DB: notifications.user_id — optional on client (known from session)
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;   // DB: notifications.created_at (TIMESTAMPTZ → converted to Date by API)
  read: boolean;
  metadata?: Record<string, unknown>;  // DB: notifications.metadata (JSONB)
}

// ─── Player Reports / Tickets ─────────────────────────────────
// DB: support_tickets table

export type TicketReason =
  | "cheating"
  | "harassment"
  | "fake_screenshot"
  | "disconnect_abuse"
  | "other";

export type TicketStatus = "open" | "investigating" | "dismissed" | "resolved";

export interface SupportTicket {
  id: string;                   // DB: support_tickets.id (UUID)
  reporterId: string;           // DB: support_tickets.reporter_id (FK → users.id)
  reporterName: string;         // DB: JOIN users.username
  reportedId: string;           // DB: support_tickets.reported_id (FK → users.id)
  reportedUsername: string;     // DB: JOIN users.username
  reason: TicketReason;         // DB: support_tickets.reason (enum)
  description: string;          // DB: support_tickets.description
  status: TicketStatus;         // DB: support_tickets.status (enum)
  adminNote?: string;           // DB: support_tickets.admin_note
  createdAt: string;            // DB: support_tickets.created_at (ISO 8601)
  updatedAt?: string;           // DB: support_tickets.updated_at
}

// ─── Public Player Profile ────────────────────────────────────
// Subset of UserProfile — excludes wallet, steamId, email, balance
// DB: SELECT users.*, user_stats.* WHERE id = :id (public fields only)

export interface PublicPlayerProfile {
  id: string;                   // DB: users.id (UUID)
  username: string;             // DB: users.username
  avatarInitials: string;       // DB: users.avatar_initials
  avatar?: string;              // DB: users.avatar
  avatarBg?: string;            // DB: users.avatar_bg
  equippedBadgeIcon?: string;  // DB: users.equipped_badge_icon
  rank: string;                 // DB: users.rank
  tier: string;                 // DB: users.tier
  preferredGame: Game;          // DB: users.preferred_game
  arenaId: ArenaId;             // DB: users.arena_id — immutable public ID
  memberSince: string;          // DB: users.created_at (formatted server-side)
  status: UserStatus;           // DB: users.status
  leaderboardRank?: number;     // DB: computed from leaderboard table — present only if player is top 50
  stats: {
    matches: number;            // DB: user_stats.matches
    wins: number;               // DB: user_stats.wins
    losses: number;             // DB: user_stats.losses
    winRate: number;            // DB: user_stats.win_rate
    totalEarnings: number;      // DB: user_stats.total_earnings
  };
}

// ─── Friendships ──────────────────────────────────────────────
// DB: friendships table

export type FriendshipStatus = "pending" | "accepted" | "blocked";

export interface Friendship {
  id: string;                    // DB: friendships.id (UUID)
  initiatorId: string;           // DB: friendships.initiator_id (FK → users.id) — who sent the request
  receiverId: string;            // DB: friendships.receiver_id (FK → users.id) — who received it
  friendId: string;              // client-computed: the OTHER user's id (not the current user)
  friendUsername: string;        // DB: JOIN users.username
  friendArenaId: ArenaId;        // DB: JOIN users.arena_id
  friendAvatarInitials: string;  // DB: JOIN users.avatar_initials
  friendAvatar?: string;         // DB: JOIN users.avatar
  friendRank: string;            // DB: JOIN users.rank
  friendTier: string;            // DB: JOIN users.tier
  friendPreferredGame: string;   // DB: JOIN users.preferred_game
  status: FriendshipStatus;      // DB: friendships.status
  message?: string;              // DB: friendships.message — optional text sent with the request
  createdAt: string;             // DB: friendships.created_at (ISO 8601)
  updatedAt?: string;            // DB: friendships.updated_at
}

// ─── Direct Messages ──────────────────────────────────────────
// DB: direct_messages table

export interface DirectMessage {
  id: string;           // DB: direct_messages.id (UUID)
  senderId: string;     // DB: direct_messages.sender_id (FK → users.id)
  senderName: string;   // DB: JOIN users.username
  receiverId: string;   // DB: direct_messages.receiver_id (FK → users.id)
  content: string;      // DB: direct_messages.content (TEXT)
  read: boolean;        // DB: direct_messages.read (BOOLEAN DEFAULT FALSE)
  createdAt: string;    // DB: direct_messages.created_at (ISO 8601)
}

// ─── Inbox Messages ───────────────────────────────────────────
// DB: inbox_messages table — formal messages sent by Arena ID (not real-time chat)

// Client ignore list is local until wired; production: POST /api/users/:id/block syncs blocks + prunes inbox/DM edges.
export interface InboxMessage {
  id: string;                  // DB: inbox_messages.id (UUID)
  senderId: string;            // DB: inbox_messages.sender_id (FK → users.id)
  senderName: string;          // DB: JOIN users.username
  senderArenaId: ArenaId;      // DB: JOIN users.arena_id
  receiverId: string;          // DB: inbox_messages.receiver_id (FK → users.id)
  subject: string;             // DB: inbox_messages.subject (VARCHAR 200)
  content: string;             // DB: inbox_messages.content (TEXT)
  read: boolean;               // DB: inbox_messages.read DEFAULT FALSE
  deleted: boolean;            // DB: inbox_messages.deleted DEFAULT FALSE (soft delete)
  createdAt: string;           // DB: inbox_messages.created_at (ISO 8601)
}

// ─── Forge / Store ─────────────────────────────────────────────
// DB: forge_items, forge_challenges, forge_events, forge_drops, forge_purchases, arena_tokens

export type ForgeCategory = "avatar" | "badge" | "boost" | "vip" | "bundle" | "frame";
export type ForgeRarity   = "common" | "rare" | "epic" | "legendary";
export type ForgeChallengeType   = "daily" | "weekly";
export type ForgeChallengeStatus = "active" | "claimable" | "claimed";
export type ForgeEventType   = "tournament" | "seasonal" | "special";
export type ForgeEventStatus = "upcoming" | "active" | "ended";
export type ForgeDropType    = "season_pass" | "bundle" | "flash";

export interface ForgeItem {
  id: string;
  name: string;
  description: string;
  category: ForgeCategory;
  rarity: ForgeRarity;
  icon: string;          // emoji
  priceAT?: number;      // DB: forge_items.price_at
  priceUSDT?: number;    // DB: forge_items.price_usdt
  featured?: boolean;    // DB: forge_items.featured
  limited?: boolean;     // DB: forge_items.limited
  stock?: number;        // DB: forge_items.stock (NULL = unlimited)
  expiresAt?: string;    // DB: forge_items.expires_at (TIMESTAMPTZ)
  ownedBy?: number;      // DB: COUNT(forge_purchases) WHERE item_id = id
}

export interface ForgeChallenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: ForgeChallengeType;
  rewardAT: number;      // DB: forge_challenges.reward_at
  rewardXP: number;      // DB: forge_challenges.reward_xp
  progress: number;      // DB: forge_challenge_progress.progress
  target: number;        // DB: forge_challenges.target
  status: ForgeChallengeStatus;
  expiresAt: string;
}

export interface ForgeEvent {
  id: string;
  name: string;
  description: string;
  game: string;
  type: ForgeEventType;
  icon: string;
  prizePool?: number;        // DB: forge_events.prize_pool
  rewardAT?: number;         // DB: forge_events.reward_at
  entryFee?: number;         // DB: forge_events.entry_fee_usdt (NULL = free)
  participants: number;      // DB: COUNT(forge_event_participants)
  maxParticipants?: number;
  startAt: string;
  endAt: string;
  status: ForgeEventStatus;
  joined?: boolean;          // DB: EXISTS(SELECT 1 FROM forge_event_participants WHERE user_id = me)
}

export interface ForgeDrop {
  id: string;
  name: string;
  description: string;
  type: ForgeDropType;
  icon: string;
  originalPriceUSDT?: number;
  salePriceUSDT?: number;    // DB: forge_drops.sale_price_usdt
  priceAT?: number;
  discountPercent?: number;
  stock?: number;
  expiresAt?: string;
  highlights: string[];      // DB: forge_drops.highlights (JSONB array)
  tag?: string;              // e.g. "BEST VALUE", "40% OFF", "LAST CHANCE"
}

export interface ForgePurchase {
  id: string;
  itemId: string;
  itemName: string;
  currency: "AT" | "USDT";
  amount: number;
  purchasedAt: string;       // DB: forge_purchases.purchased_at (TIMESTAMPTZ)
}

/** API contract preview: live USDT→AT quote for Forge (GET /api/forge/exchange-rate). Not wired in UI logic yet. */
export interface ForgeExchangeRateQuote {
  usdtToAt: number;
  source?: "oracle" | "fixed" | "api";
  validUntil?: string;
}
