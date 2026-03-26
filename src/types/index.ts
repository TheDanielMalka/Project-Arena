// ─── Core Enums ──────────────────────────────────────────────

export type MatchStatus = "waiting" | "in_progress" | "completed" | "cancelled" | "disputed";
export type MatchType = "public" | "custom";
export type MatchMode = "1v1" | "5v5";
export type Game = "CS2" | "Valorant" | "Fortnite" | "Apex Legends";

export type TransactionType = "deposit" | "withdrawal" | "match_win" | "match_loss" | "fee" | "refund" | "escrow_lock" | "escrow_release";
export type TransactionStatus = "completed" | "pending" | "failed";

export type DisputeStatus = "open" | "reviewing" | "resolved" | "escalated";
export type DisputeResolution = "pending" | "approved" | "rejected" | "player_a_wins" | "player_b_wins" | "refund" | "void";

export type Network = "bsc" | "solana" | "ethereum";

export type UserRole = "user" | "admin" | "moderator";
export type UserStatus = "active" | "flagged" | "banned" | "suspended";

// ─── User / Profile ─────────────────────────────────────────

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
  avatar?: string;    // "initials" | emoji | "upload:{dataURL}" — DB: stored as text
  avatarBg?: string;  // bgId from avatarBgs.ts — DB: stored as text, defaults to "default"
  preferredGame: Game;
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

// ─── Matches ─────────────────────────────────────────────────

export interface Match {
  id: string;
  type: MatchType;
  host: string;
  hostId: string;
  game: Game;
  mode: MatchMode;
  betAmount: number;
  players: string[];
  maxPlayers: number;
  status: MatchStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  winnerId?: string;
  timeLeft?: string;
  // Custom match fields
  code?: string;
  password?: string;
  teamA?: string[];
  teamB?: string[];
  maxPerTeam?: number;
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
  balance: number;
  usdValue: number;
  change24h: number;
  icon: string;
  network: Network;
}

export interface WalletInfo {
  addresses: Record<Network, string>;
  selectedNetwork: Network;
  platformBettingMax: number;   // platform hard cap (500) — read-only
  dailyBettingLimit: number;    // user-chosen: 50–platformBettingMax
  dailyBettingUsed: number;     // resets daily
  twoFactorEnabled: boolean;
  withdrawWhitelist: boolean;
}

// ─── Disputes ────────────────────────────────────────────────

export interface Dispute {
  id: string;
  matchId: string;
  playerA: string;
  playerB: string;
  game: Game;
  stake: number;
  reason: string;
  status: DisputeStatus;
  resolution: DisputeResolution;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
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

export type NotificationType = "match_result" | "payout" | "system" | "dispute" | "match_invite" | "escrow";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  metadata?: Record<string, unknown>;
}
