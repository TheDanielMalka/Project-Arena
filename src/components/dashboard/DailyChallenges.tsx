import { useState, useEffect } from "react";
import { useMatchStore } from "@/stores/matchStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Trophy, Zap, DollarSign, Swords, Target, Flame, Clock, CheckCircle, Gift } from "lucide-react";
import type { DailyChallenge, ChallengeType, Game } from "@/types";

// ── DB-ready: MY_ID will be replaced by auth session userId ──
const MY_ID = "user-001";

// ── Today boundary helper ─────────────────────────────────────────────────────
const isToday = (iso: string): boolean => {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
};

// ── Midnight countdown ────────────────────────────────────────────────────────
const getMsUntilMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
};
const fmtCountdown = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
};

// ── Challenge definitions — DB-ready: will be fetched from /api/challenges/daily ──
const DAILY_CHALLENGES: DailyChallenge[] = [
  {
    id: "dc-wins-3",
    title: "Triple Threat",
    description: "Win 3 matches today",
    icon: "⚔️",
    type: "wins",
    target: 3,
    reward: 15,
    expiresAt: (() => { const d = new Date(); d.setHours(24,0,0,0); return d.toISOString(); })(),
  },
  {
    id: "dc-matches-5",
    title: "Arena Regular",
    description: "Play 5 matches today",
    icon: "🎮",
    type: "matches_played",
    target: 5,
    reward: 10,
    expiresAt: (() => { const d = new Date(); d.setHours(24,0,0,0); return d.toISOString(); })(),
  },
  {
    id: "dc-earnings-100",
    title: "Money Match",
    description: "Earn $100 from wins today",
    icon: "💰",
    type: "earnings",
    target: 100,
    reward: 20,
    expiresAt: (() => { const d = new Date(); d.setHours(24,0,0,0); return d.toISOString(); })(),
  },
  {
    id: "dc-cs2-win",
    title: "CS2 Dominator",
    description: "Win a CS2 match today",
    icon: "🔫",
    type: "game_specific",
    target: 1,
    game: "CS2" as Game,
    reward: 12,
    expiresAt: (() => { const d = new Date(); d.setHours(24,0,0,0); return d.toISOString(); })(),
  },
];

// ── Challenge icon by type ─────────────────────────────────────────────────────
const TYPE_ICON: Record<ChallengeType, React.ElementType> = {
  wins:           Swords,
  matches_played: Target,
  earnings:       DollarSign,
  game_specific:  Trophy,
  high_stakes:    Flame,
  streak:         Zap,
};

// ── Challenge accent color by type ────────────────────────────────────────────
const TYPE_COLOR: Record<ChallengeType, string> = {
  wins:           "#F97316",
  matches_played: "#38BDF8",
  earnings:       "#EAB308",
  game_specific:  "#FF4655",
  high_stakes:    "#A855F7",
  streak:         "#FC4B08",
};

// ── Main component ─────────────────────────────────────────────────────────────
export function DailyChallenges() {
  const { matches } = useMatchStore();
  const [countdown, setCountdown] = useState(getMsUntilMidnight());
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [claimAnim, setClaimAnim] = useState<string | null>(null);

  // Live countdown tick
  useEffect(() => {
    const t = setInterval(() => setCountdown(getMsUntilMidnight()), 1000);
    return () => clearInterval(t);
  }, []);

  // Compute progress for each challenge from match store
  // DB-ready: this logic will move server-side, returning { challengeId, current } per user
  const getProgress = (challenge: DailyChallenge): number => {
    const todayUserMatches = matches.filter(m =>
      m.status !== "waiting" &&
      isToday(m.endedAt ?? m.createdAt) &&
      (m.players.includes(MY_ID) || m.hostId === MY_ID ||
       (m.teamA ?? []).includes(MY_ID) || (m.teamB ?? []).includes(MY_ID))
    );
    const todayWins = todayUserMatches.filter(m => m.status === "completed" && m.winnerId === MY_ID);

    switch (challenge.type) {
      case "wins":
        return todayWins.length;
      case "matches_played":
        return todayUserMatches.filter(m => m.status === "completed" || m.status === "in_progress").length;
      case "earnings":
        return todayWins.reduce((sum, m) => sum + m.betAmount, 0);
      case "game_specific":
        return challenge.game
          ? todayWins.filter(m => m.game === challenge.game).length
          : 0;
      case "high_stakes":
        return todayWins.filter(m => m.betAmount >= (challenge.minBet ?? 50)).length;
      case "streak":
        return Math.min(todayWins.length, challenge.target);
      default:
        return 0;
    }
  };

  const handleClaim = (challenge: DailyChallenge) => {
    if (claimed.has(challenge.id)) return;
    setClaimed(prev => new Set([...prev, challenge.id]));
    setClaimAnim(challenge.id);
    setTimeout(() => setClaimAnim(null), 800);
    const { addNotification } = useNotificationStore.getState();
    addNotification({
      type: "payout",
      title: `🎁 Challenge Complete!`,
      message: `"${challenge.title}" reward of $${challenge.reward} has been credited to your balance.`,
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Top accent */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-arena-gold/50 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-arena-gold/15 flex items-center justify-center">
            <Gift className="h-3.5 w-3.5 text-arena-gold" />
          </div>
          <span className="font-display text-sm font-semibold uppercase tracking-wider">Daily Challenges</span>
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest hidden sm:inline">
            · resets in
          </span>
        </div>
        {/* Countdown */}
        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Clock className="h-3 w-3 text-arena-gold/60" />
          <span className="text-arena-gold font-bold tabular-nums">{fmtCountdown(countdown)}</span>
        </div>
      </div>

      {/* Challenge list */}
      <div className="divide-y divide-border/40">
        {DAILY_CHALLENGES.map((challenge) => {
          const current    = getProgress(challenge);
          const pct        = Math.min(current / challenge.target, 1);
          const done       = pct >= 1;
          const isClaimed  = claimed.has(challenge.id);
          const isAnimating = claimAnim === challenge.id;
          const color      = TYPE_COLOR[challenge.type];
          const TypeIcon   = TYPE_ICON[challenge.type];

          // Value label in progress
          const progressLabel = challenge.type === "earnings"
            ? `$${current}/$${challenge.target}`
            : `${current}/${challenge.target}`;

          return (
            <div key={challenge.id}
              className={`relative flex items-center gap-3 px-4 py-3.5 transition-all ${
                isClaimed ? "opacity-50" : done ? "" : ""
              }`}
              style={{ borderLeft: `3px solid ${isClaimed ? "#555" : done ? "#22C55E" : color}30` }}>

              {/* Done glow overlay */}
              {done && !isClaimed && (
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: `linear-gradient(90deg, #22C55E06, transparent 60%)` }} />
              )}

              {/* Icon circle */}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                isAnimating ? "scale-125" : ""
              }`}
                style={{
                  background: isClaimed ? "#88888815" : done ? "#22C55E20" : `${color}15`,
                  border: `1.5px solid ${isClaimed ? "#55555530" : done ? "#22C55E40" : `${color}30`}`,
                }}>
                {isClaimed
                  ? <CheckCircle className="h-4 w-4 text-muted-foreground/50" />
                  : done
                  ? <CheckCircle className="h-4 w-4 text-green-400" />
                  : <TypeIcon className="h-4 w-4" style={{ color }} />
                }
              </div>

              {/* Text + bar */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-display text-sm font-semibold truncate">
                    {challenge.icon} {challenge.title}
                  </span>
                  {done && !isClaimed && (
                    <span className="text-[9px] font-display font-bold uppercase tracking-widest text-green-400 bg-green-400/10 border border-green-400/20 px-1.5 py-0.5 rounded-full">
                      Done
                    </span>
                  )}
                  {isClaimed && (
                    <span className="text-[9px] font-display font-bold uppercase tracking-widest text-muted-foreground/40 border border-border px-1.5 py-0.5 rounded-full">
                      Claimed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Progress bar */}
                  <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.round(pct * 100)}%`,
                        background: isClaimed ? "#555" : done ? "#22C55E" : color,
                        boxShadow: done && !isClaimed ? `0 0 8px #22C55E60` : "none",
                      }} />
                  </div>
                  <span className={`text-[10px] font-mono shrink-0 tabular-nums ${
                    done ? "text-green-400" : "text-muted-foreground"
                  }`}>
                    {isClaimed ? "✓" : progressLabel}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{challenge.description}</p>
              </div>

              {/* Reward + Claim */}
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-display font-bold"
                  style={{
                    borderColor: isClaimed ? "#55555540" : done ? "#22C55E40" : `${color}30`,
                    color: isClaimed ? "#666" : done ? "#22C55E" : color,
                    background: isClaimed ? "#88888808" : done ? "#22C55E0a" : `${color}0a`,
                  }}>
                  <span>+${challenge.reward}</span>
                </div>
                {done && !isClaimed && (
                  <button
                    onClick={() => handleClaim(challenge)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-display font-bold uppercase tracking-wider transition-all ${
                      isAnimating ? "scale-110" : "hover:scale-105"
                    }`}
                    style={{
                      background: "linear-gradient(135deg, #22C55E30, #16A34A20)",
                      border: "1px solid #22C55E50",
                      color: "#22C55E",
                      boxShadow: "0 0 12px #22C55E30",
                    }}>
                    <Gift className="h-2.5 w-2.5" />
                    Claim
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom — total unclaimed rewards */}
      {(() => {
        const unclaimedReward = DAILY_CHALLENGES
          .filter(c => getProgress(c) >= c.target && !claimed.has(c.id))
          .reduce((s, c) => s + c.reward, 0);
        if (unclaimedReward === 0) return null;
        return (
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between bg-green-400/5">
            <span className="text-xs text-green-400 font-display font-semibold flex items-center gap-1.5">
              <Zap className="h-3 w-3" />
              {DAILY_CHALLENGES.filter(c => getProgress(c) >= c.target && !claimed.has(c.id)).length} challenge{DAILY_CHALLENGES.filter(c => getProgress(c) >= c.target && !claimed.has(c.id)).length > 1 ? "s" : ""} ready to claim
            </span>
            <span className="text-xs font-display font-bold text-green-400">+${unclaimedReward} waiting</span>
          </div>
        );
      })()}
    </div>
  );
}
