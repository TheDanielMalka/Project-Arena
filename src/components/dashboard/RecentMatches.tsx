import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import { PlayerPopoverLayer } from "@/components/players/PlayerCardPopover";
import { slotToProfileUsername } from "@/lib/matchPlayerDisplay";
import { MatchRosterAvatar } from "@/components/match/MatchRosterAvatar";
import { Swords, Inbox, Gamepad2, Clock } from "lucide-react";

// ── Game logos — mirrors Profile.tsx / History.tsx ──────────────────────────
const GAME_CONFIG: Record<string, { logo: string; color: string }> = {
  "CS2":          { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg",     color: "#F97316" },
  "Valorant":     { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg", color: "#FF4655" },
  "Fortnite":     { logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120", color: "#38BDF8" },
  "Apex Legends": { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg", color: "#FC4B08" },
  "MLBB":         { logo: "https://play-lh.googleusercontent.com/Op7v9XdsyxjrKImMD5RLyiLRCAHs3DMQFANwfsuMTw1hq0lH4j8tOqD3Fd7zyr4ixmC0xoqqRkQDBjAd46NsFQ=s120", color: "#EF4444" },
  "Wild Rift":    { logo: "https://play-lh.googleusercontent.com/7-kbcpgrCOE1mleJ9g0d61sJeoqKcQRIj4iFvJ8DjPlRIfocOWfOQsXzKWw2I5oHySVdbjR2fvzfCCz1FYQ-RQ=s120",  color: "#6366F1" },
  "PUBG Mobile":  { logo: "https://play-lh.googleusercontent.com/zCSGnBtZk0Lmp1BAbyaZfLktDzHmC6oke67qzz3G1lBegAF2asyt5KzXOJ2PVdHDYkU=s120",                         color: "#F59E0B" },
};

// DB-ready: accepts ISO 8601, returns en-US readable string
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`;
};

interface RecentMatchesProps {
  showViewAll?: boolean;
  limit?: number;
}

export function RecentMatches({ showViewAll = true, limit = 5 }: RecentMatchesProps) {
  const navigate = useNavigate();
  const { user } = useUserStore();
  const { matches } = useMatchStore();
  const [playerPopover, setPlayerPopover] = useState<{ slotValue: string; rect: DOMRect } | null>(null);

  // Filter to current user's matches only, exclude waiting
  const myId = user?.id ?? "";
  const recentMatches = matches
    .filter(m =>
      myId &&
      m.status !== "waiting" &&
      (m.players.includes(myId) ||
       m.hostId === myId ||
       (m.teamA ?? []).includes(myId) ||
       (m.teamB ?? []).includes(myId))
    )
    .slice(0, limit);

  const openPlayer = (e: React.MouseEvent, slotValue: string) => {
    e.stopPropagation();
    setPlayerPopover({
      slotValue,
      rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <PlayerPopoverLayer
        open={!!playerPopover && !!user}
        slotValue={playerPopover?.slotValue ?? null}
        rect={playerPopover?.rect ?? null}
        onClose={() => setPlayerPopover(null)}
        enableLeaveRoom={false}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-muted-foreground" />
          <span className="font-display text-sm font-semibold uppercase tracking-wider">Recent Matches</span>
        </div>
        {showViewAll && (
          <button onClick={() => navigate("/history")}
            className="text-xs text-primary hover:text-primary/70 transition-colors font-display flex items-center gap-1">
            View All →
          </button>
        )}
      </div>

      {recentMatches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Inbox className="h-10 w-10 mb-3 opacity-20" />
          <p className="font-display text-sm">No matches yet</p>
          <p className="text-xs opacity-50 mb-4">Jump into your first match!</p>
          <button onClick={() => navigate("/lobby")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/15 border border-primary/30 text-primary font-display text-sm hover:bg-primary/25 transition-all">
            <Swords className="h-3.5 w-3.5" /> Find Match
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {recentMatches.map((m) => {
            const isLive = m.status === "in_progress";
            const isWin  = m.status === "completed" && m.winnerId === myId;
            const isLoss = m.status === "completed" && !!m.winnerId && m.winnerId !== myId;
            const cfg = GAME_CONFIG[m.game];

            const borderColor = isWin ? "#22C55E" : isLoss ? "#EF4444" : isLive ? "#38BDF8" : "#6B7280";
            const badgeClass  = isWin
              ? "bg-primary/15 text-primary border-primary/30"
              : isLoss
              ? "bg-destructive/15 text-destructive border-destructive/30"
              : isLive
              ? "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30"
              : "bg-muted text-muted-foreground border-border";
            const badgeLabel  = isWin ? "Win" : isLoss ? "Loss" : isLive ? "Live" : m.status.replace("_", " ");
            const amountColor = isWin ? "text-primary" : isLoss ? "text-destructive" : isLive ? "text-arena-cyan" : "text-arena-gold";
            const amountLabel = isWin ? `+$${m.betAmount}` : isLoss ? `-$${m.betAmount}` : `$${m.betAmount}`;
            const oppSlot =
              m.type === "custom"
                ? m.host
                : m.hostId === myId
                  ? (m.players.find((p) => p !== myId) ??
                      m.teamB?.[0] ??
                      m.teamA?.find((p) => p !== myId) ??
                      "Opponent")
                  : m.host;
            const oppDisplay = slotToProfileUsername(oppSlot, user?.id, user?.username);

            return (
              <div key={m.id}
                className="relative flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors cursor-pointer"
                style={{ borderLeft: `3px solid ${borderColor}` }}
                onClick={() => navigate("/history")}>
                {isLive && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-arena-cyan/40 to-transparent" />}

                <MatchRosterAvatar slotValue={oppSlot} size={36} className="border-2 border-card" />

                {/* Game logo */}
                {cfg ? (
                  <img src={cfg.logo} alt={m.game} className="w-8 h-8 rounded object-cover shrink-0"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center shrink-0">
                    <Gamepad2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-display font-semibold px-1.5 py-0.5 rounded border shrink-0 ${badgeClass}`}>
                      {badgeLabel}
                    </span>
                    {m.type === "custom" ? (
                      <span className="text-sm font-medium truncate min-w-0">
                        <button
                          type="button"
                          className="hover:text-primary hover:underline rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                          onClick={(e) => openPlayer(e, m.host)}
                        >
                          {m.host}
                        </button>
                        <span className="text-muted-foreground">'s Custom</span>
                      </span>
                    ) : (
                      <span className="text-sm font-medium truncate min-w-0">
                        <span className="text-muted-foreground">vs </span>
                        <button
                          type="button"
                          className="hover:text-primary hover:underline rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                          onClick={(e) => openPlayer(e, oppSlot)}
                        >
                          {oppDisplay}
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span style={{ color: cfg?.color }}>{m.game}</span>
                    <span>·</span>
                    <span>{m.mode}</span>
                    {(m.endedAt ?? m.createdAt) && (
                      <>
                        <span>·</span>
                        <span className="font-mono text-[10px]">{fmtDate(m.endedAt ?? m.createdAt)}</span>
                      </>
                    )}
                  </p>
                </div>

                {/* Amount */}
                <div className="text-right shrink-0">
                  <p className={`font-display text-sm font-bold ${amountColor}`}>{amountLabel}</p>
                  {isLive && m.timeLeft && (
                    <p className="text-[10px] text-arena-cyan flex items-center gap-1 justify-end mt-0.5">
                      <Clock className="h-2.5 w-2.5" />{m.timeLeft}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
