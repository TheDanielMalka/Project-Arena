import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Radio, Clock, Users, Zap, ChevronDown, ChevronUp, Shield, Gamepad2 } from "lucide-react";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import { usePlayerStore } from "@/stores/playerStore";
import { PlayerPopoverLayer } from "@/components/players/PlayerCardPopover";
import type { Match } from "@/types";
import { MatchRosterAvatar } from "@/components/match/MatchRosterAvatar";
import { rosterDisplayUsername } from "@/lib/matchPlayerDisplay";

const GAME_CONFIG: Record<string, { logo: string; color: string }> = {
  "CS2":          { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg",     color: "#F97316" },
  "Valorant":     { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg", color: "#FF4655" },
  "Fortnite":     { logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120", color: "#38BDF8" },
  "Apex Legends": { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg", color: "#FC4B08" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmtBet = (m: Match) =>
  m.stakeCurrency === "AT" ? `${m.betAmount} AT` : `$${m.betAmount}`;

const fmtPot = (m: Match) => {
  const count = m.filledPlayerCount ?? m.players.length ?? m.maxPlayers;
  const pot = m.betAmount * Math.max(count, 2);
  return m.stakeCurrency === "AT" ? `${pot} AT` : `$${pot}`;
};

const LiveMatchTracker = () => {
  const { matches } = useMatchStore();
  const { user, token } = useUserStore();
  const { players: catalog, fetchPublicPlayerById } = usePlayerStore();
  const liveMatches = matches.filter(m => m.status === "in_progress");
  const [now, setNow] = useState(Date.now());
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [playerPopover, setPlayerPopover] = useState<{ slotValue: string; rect: DOMRect } | null>(null);

  const openPlayer = (e: React.MouseEvent, slotValue: string) => {
    e.stopPropagation();
    setPlayerPopover({
      slotValue,
      rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
    });
  };

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-fetch profiles for any UUID slots not yet in catalog
  useEffect(() => {
    if (!token) return;
    const catalogIds = new Set(catalog.map(p => p.id));
    const allSlots = liveMatches.flatMap(m => [
      ...m.players,
      ...(m.teamA ?? []),
      ...(m.teamB ?? []),
    ]);
    const missing = [...new Set(allSlots)].filter(
      s => UUID_RE.test(s) && !catalogIds.has(s) && s !== user?.id,
    );
    for (const id of missing) {
      void fetchPublicPlayerById(id, token);
    }
  }, [liveMatches, catalog, token, user?.id, fetchPublicPlayerById]);

  const getElapsed = (match: Match) => {
    if (!match.startedAt) return match.timeLeft ?? "--:--";
    const diff = Math.floor((now - new Date(match.startedAt).getTime()) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, "0");
    const secs = (diff % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const displayName = (slot: string) =>
    rosterDisplayUsername(slot, user?.id, user?.username, catalog);

  if (liveMatches.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-8 flex flex-col items-center text-center space-y-2">
        <Radio className="h-7 w-7 text-muted-foreground/30 mb-1 animate-pulse" />
        <p className="text-sm text-muted-foreground font-display">No live matches right now</p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          Open the{" "}
          <Link to="/lobby" className="text-primary hover:underline">Match Lobby</Link>
          {" "}to join or create. When you play for stakes, keep the{" "}
          <Link to="/client" className="text-primary hover:underline">Arena Client</Link>{" "}
          running so results can verify.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PlayerPopoverLayer
        open={!!playerPopover && !!user}
        slotValue={playerPopover?.slotValue ?? null}
        rect={playerPopover?.rect ?? null}
        onClose={() => setPlayerPopover(null)}
        enableLeaveRoom={false}
      />
      {liveMatches.map((match) => {
        const isExpanded = expandedMatchId === match.id;
        const cfg = GAME_CONFIG[match.game];
        const allPlayers = match.players.length > 0
          ? match.players
          : [...(match.teamA ?? []), ...(match.teamB ?? [])];

        return (
          <div key={match.id}
            className="rounded-2xl border border-arena-cyan/20 bg-card overflow-hidden cursor-pointer hover:border-arena-cyan/40 transition-all"
            style={{ borderLeftWidth: "3px", borderLeftColor: cfg?.color ?? "#38BDF8" }}
            onClick={() => setExpandedMatchId(prev => prev === match.id ? null : match.id)}>

            <div className="h-px w-full bg-gradient-to-r from-transparent via-arena-cyan/50 to-transparent animate-pulse" />

            <div className="p-4">
              <div className="flex items-center gap-3">
                {cfg ? (
                  <img src={cfg.logo} alt={match.game} className="w-9 h-9 rounded-lg object-cover shrink-0"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    <Gamepad2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-arena-cyan animate-pulse shrink-0" />
                    <p className="font-display font-semibold text-sm min-w-0 flex items-baseline gap-0">
                      <button
                        type="button"
                        onClick={(e) => openPlayer(e, match.host)}
                        className="truncate min-w-0 text-left hover:text-primary hover:underline underline-offset-2"
                      >
                        {displayName(match.host)}
                      </button>
                      <span className="shrink-0">'s Match</span>
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span style={{ color: cfg?.color }}>{match.game}</span>
                    <span>·</span>
                    <Users className="h-3 w-3" /> {allPlayers.length}/{match.maxPlayers}
                    <span>·</span>
                    <span>{match.mode}</span>
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-arena-cyan font-mono text-sm font-bold">
                      <Clock className="h-3.5 w-3.5" />
                      {getElapsed(match)}
                    </div>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <Zap className="h-3 w-3 text-arena-gold" />
                      <span className="text-xs font-display font-bold text-arena-gold">{fmtBet(match)}</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {/* 1v1 progress bar */}
              {match.mode === "1v1" && allPlayers.length === 2 && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => openPlayer(e, allPlayers[0])}
                      className="flex items-center gap-1.5 min-w-0 rounded-lg hover:bg-secondary/40 -mx-0.5 px-0.5 py-0.5"
                    >
                      <MatchRosterAvatar slotValue={allPlayers[0]} size={20} className="border-2 border-card" />
                      <span className="text-xs font-display font-medium text-primary truncate max-w-[80px]">
                        {displayName(allPlayers[0])}
                      </span>
                    </button>
                  </div>
                  <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-primary to-arena-cyan animate-pulse" />
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0 justify-end">
                    <button
                      type="button"
                      onClick={(e) => openPlayer(e, allPlayers[1])}
                      className="flex items-center gap-1.5 min-w-0 rounded-lg hover:bg-secondary/40 -mx-0.5 px-0.5 py-0.5"
                    >
                      <span className="text-xs font-display font-medium text-arena-orange truncate max-w-[80px] text-right">
                        {displayName(allPlayers[1])}
                      </span>
                      <MatchRosterAvatar slotValue={allPlayers[1]} size={20} className="border-2 border-card" />
                    </button>
                  </div>
                </div>
              )}

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: "Map",      value: "Pending" },
                      { label: "Match ID", value: match.id, mono: true },
                      { label: "Type",     value: `${match.type} · ${match.mode}` },
                      { label: "Pot",      value: fmtPot(match), gold: true },
                    ].map(({ label, value, mono, gold }) => (
                      <div key={label} className="rounded-lg bg-background/60 p-2">
                        <p className="text-muted-foreground mb-0.5">{label}</p>
                        <p className={`font-medium truncate ${gold ? "text-arena-gold" : ""} ${mono ? "font-mono" : ""} ${label === "Map" ? "text-muted-foreground/50 italic" : ""}`}>
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <Shield className="h-3 w-3" /> Players in lobby
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {allPlayers.length > 0 ? allPlayers.map(player => (
                        <button
                          key={`${match.id}-${player}`}
                          type="button"
                          onClick={(e) => openPlayer(e, player)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-secondary/40 text-xs hover:border-primary/40 hover:bg-secondary/60 transition-colors"
                        >
                          <MatchRosterAvatar slotValue={player} size={16} className="border border-card" />
                          {displayName(player)}
                        </button>
                      )) : (
                        <span className="text-xs text-muted-foreground">No players listed yet</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LiveMatchTracker;
