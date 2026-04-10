import { useState, useEffect, useCallback } from "react";
import { useUserStore } from "@/stores/userStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useToast } from "@/hooks/use-toast";
import { Zap, Clock, CheckCircle, Gift, Target } from "lucide-react";
import type { ChallengeType } from "@/types";
import {
  apiGetForgeChallenges,
  apiClaimForgeChallenge,
  type ApiForgeChallengeRow,
} from "@/lib/engine-api";

// ── Today boundary helper (countdown only) ─────────────────────────────────────
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

// Server daily rows use DB `type` daily|weekly — UI treats all as generic progress (Forge pipeline).
const SERVER_CHALLENGE_DISPLAY_TYPE: ChallengeType = "matches_played";
const TYPE_COLOR: Record<ChallengeType, string> = {
  wins: "#F97316",
  matches_played: "#38BDF8",
  earnings: "#EAB308",
  game_specific: "#FF4655",
  high_stakes: "#A855F7",
  streak: "#FC4B08",
};

export function DailyChallenges() {
  const { user, token, updateProfile, refreshProfileFromServer } = useUserStore();
  const { toast } = useToast();
  const [countdown, setCountdown] = useState(getMsUntilMidnight());
  const [rows, setRows] = useState<ApiForgeChallengeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await apiGetForgeChallenges(token);
    setLoading(false);
    const daily = (list ?? []).filter((c) => c.type === "daily");
    setRows(daily);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setCountdown(getMsUntilMidnight()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleClaim = async (challenge: ApiForgeChallengeRow) => {
    if (!token || !user || challenge.status !== "claimable") return;
    setClaimingId(challenge.id);
    const res = await apiClaimForgeChallenge(token, challenge.id);
    setClaimingId(null);
    if (res.ok === false) {
      toast({
        title: "Could not claim",
        description: res.detail ?? "Try again in a moment.",
        variant: "destructive",
      });
      return;
    }
    updateProfile({
      stats: { ...user.stats, xp: (user.stats.xp ?? 0) + res.reward_xp },
      atBalance: res.at_balance,
    });
    void refreshProfileFromServer();
    void load();
    const { addNotification } = useNotificationStore.getState();
    addNotification({
      type: "payout",
      title: `Challenge claimed +${res.reward_at} AT`,
      message: `"${challenge.title}" — +${res.reward_xp} XP`,
    });
  };

  const color = TYPE_COLOR[SERVER_CHALLENGE_DISPLAY_TYPE];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-arena-gold/50 to-transparent" />

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
        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Clock className="h-3 w-3 text-arena-gold/60" />
          <span className="text-arena-gold font-bold tabular-nums">{fmtCountdown(countdown)}</span>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {loading && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading challenges…</div>
        )}
        {!loading && !token && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Sign in to see daily challenges.</div>
        )}
        {!loading && token && rows.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">No daily challenges right now.</div>
        )}
        {!loading &&
          rows.map((challenge) => {
            const current = challenge.progress;
            const target = Math.max(1, challenge.target);
            const pct = Math.min(current / target, 1);
            const isClaimed = challenge.status === "claimed";
            const isClaimable = challenge.status === "claimable";
            const isAnimating = claimingId === challenge.id;
            const TypeIcon = Target;

            return (
              <div
                key={challenge.id}
                className={`relative flex items-center gap-3 px-4 py-3.5 transition-all ${
                  isClaimed ? "opacity-50" : ""
                }`}
                style={{
                  borderLeft: `3px solid ${isClaimed ? "#555" : isClaimable ? "#22C55E" : `${color}30`}`,
                }}
              >
                {isClaimable && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: `linear-gradient(90deg, #22C55E06, transparent 60%)` }}
                  />
                )}

                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                    isAnimating ? "scale-125" : ""
                  }`}
                  style={{
                    background: isClaimed ? "#88888815" : isClaimable ? "#22C55E20" : `${color}15`,
                    border: `1.5px solid ${isClaimed ? "#55555530" : isClaimable ? "#22C55E40" : `${color}30`}`,
                  }}
                >
                  {isClaimed ? (
                    <CheckCircle className="h-4 w-4 text-muted-foreground/50" />
                  ) : isClaimable ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <TypeIcon className="h-4 w-4" style={{ color }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-display text-sm font-semibold truncate">
                      {challenge.icon ? `${challenge.icon} ` : ""}
                      {challenge.title}
                    </span>
                    {isClaimable && (
                      <span className="text-[9px] font-display font-bold uppercase tracking-widest text-green-400 bg-green-400/10 border border-green-400/20 px-1.5 py-0.5 rounded-full">
                        Ready
                      </span>
                    )}
                    {isClaimed && (
                      <span className="text-[9px] font-display font-bold uppercase tracking-widest text-muted-foreground/40 border border-border px-1.5 py-0.5 rounded-full">
                        Claimed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.round(pct * 100)}%`,
                          background: isClaimed ? "#555" : isClaimable ? "#22C55E" : color,
                          boxShadow: isClaimable && !isClaimed ? `0 0 8px #22C55E60` : "none",
                        }}
                      />
                    </div>
                    <span
                      className={`text-[10px] font-mono shrink-0 tabular-nums ${
                        isClaimable || isClaimed ? "text-green-400" : "text-muted-foreground"
                      }`}
                    >
                      {isClaimed ? "✓" : `${current}/${target}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{challenge.description}</p>
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <div
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-display font-bold"
                    style={{
                      borderColor: isClaimed ? "#55555540" : isClaimable ? "#22C55E40" : `${color}30`,
                      color: isClaimed ? "#666" : isClaimable ? "#22C55E" : color,
                      background: isClaimed ? "#88888808" : isClaimable ? "#22C55E0a" : `${color}0a`,
                    }}
                  >
                    <span>+{challenge.rewardAT} AT</span>
                  </div>
                  {isClaimable && (
                    <button
                      type="button"
                      disabled={claimingId !== null}
                      onClick={() => void handleClaim(challenge)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-display font-bold uppercase tracking-wider transition-all ${
                        isAnimating ? "scale-110" : "hover:scale-105"
                      }`}
                      style={{
                        background: "linear-gradient(135deg, #22C55E30, #16A34A20)",
                        border: "1px solid #22C55E50",
                        color: "#22C55E",
                        boxShadow: "0 0 12px #22C55E30",
                      }}
                    >
                      <Gift className="h-2.5 w-2.5" />
                      {claimingId === challenge.id ? "…" : "Claim"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {(() => {
        const unclaimedReward = rows
          .filter((c) => c.status === "claimable")
          .reduce((s, c) => s + c.rewardAT, 0);
        if (unclaimedReward === 0) return null;
        const n = rows.filter((c) => c.status === "claimable").length;
        return (
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between bg-green-400/5">
            <span className="text-xs text-green-400 font-display font-semibold flex items-center gap-1.5">
              <Zap className="h-3 w-3" />
              {n} challenge{n > 1 ? "s" : ""} ready to claim
            </span>
            <span className="text-xs font-display font-bold text-green-400">+{unclaimedReward} AT waiting</span>
          </div>
        );
      })()}
    </div>
  );
}
