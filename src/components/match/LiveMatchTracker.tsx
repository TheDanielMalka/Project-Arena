import { useState, useEffect } from "react";
import { Radio, Clock, Users, Zap, ChevronDown, ChevronUp, Shield, Gamepad2 } from "lucide-react";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import { PlayerPopoverLayer } from "@/components/players/PlayerCardPopover";
import type { Match } from "@/types";

// Game logos — mirrors Profile.tsx / History.tsx
const GAME_CONFIG: Record<string, { logo: string; color: string }> = {
  "CS2":          { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg",     color: "#F97316" },
  "Valorant":     { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg", color: "#FF4655" },
  "Fortnite":     { logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120", color: "#38BDF8" },
  "Apex Legends": { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg", color: "#FC4B08" },
};

// Player avatar color — DB-ready: will be replaced by real avatar field
const playerColor = (name: string) => {
  const palette = ["#F97316","#38BDF8","#A855F7","#22C55E","#EAB308","#EC4899","#14B8A6","#F43F5E"];
  return palette[(name.charCodeAt(0) + name.charCodeAt(name.length - 1)) % palette.length];
};

const LiveMatchTracker = () => {
  const { matches } = useMatchStore();
  const { user } = useUserStore();
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

  const getElapsed = (match: Match) => {
    if (!match.startedAt) return match.timeLeft ?? "--:--";
    const diff = Math.floor((now - new Date(match.startedAt).getTime()) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, "0");
    const secs = (diff % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const getMapForMatch = (match: Match) => {
    const mapPools: Record<string, string[]> = {
      CS2: ["Mirage", "Inferno", "Nuke", "Ancient", "Anubis"],
      Valorant: ["Ascent", "Haven", "Bind", "Split", "Lotus"],
      Fortnite: ["Olympus", "Classy Courts", "Pleasant Piazza"],
      "Apex Legends": ["World's Edge", "Storm Point", "Olympus"],
    };
    const pool = mapPools[match.game] ?? ["Arena Core"];
    const seed = match.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return pool[seed % pool.length];
  };

  const getEstimatedPrize = (match: Match) =>
    match.betAmount * Math.max(match.maxPlayers, 2);

  if (liveMatches.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-8 flex flex-col items-center text-center">
        <Radio className="h-7 w-7 text-muted-foreground/30 mb-3 animate-pulse" />
        <p className="text-sm text-muted-foreground font-display">No live matches right now</p>
        <p className="text-xs text-muted-foreground/50 mt-1">Active matches will appear here in real-time</p>
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

        return (
          <div key={match.id}
            className="rounded-2xl border border-arena-cyan/20 bg-card overflow-hidden cursor-pointer hover:border-arena-cyan/40 transition-all"
            style={{ borderLeftWidth: "3px", borderLeftColor: cfg?.color ?? "#38BDF8" }}
            onClick={() => setExpandedMatchId(prev => prev === match.id ? null : match.id)}>

            {/* Live pulse bar */}
            <div className="h-px w-full bg-gradient-to-r from-transparent via-arena-cyan/50 to-transparent animate-pulse" />

            <div className="p-4">
              {/* Row */}
              <div className="flex items-center gap-3">
                {/* Game logo */}
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
                        {match.host}
                      </button>
                      <span className="shrink-0">'s Match</span>
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span style={{ color: cfg?.color }}>{match.game}</span>
                    <span>·</span>
                    <Users className="h-3 w-3" /> {match.players.length}/{match.maxPlayers}
                    <span>·</span>
                    <span>{match.mode}</span>
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Timer */}
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-arena-cyan font-mono text-sm font-bold">
                      <Clock className="h-3.5 w-3.5" />
                      {getElapsed(match)}
                    </div>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <Zap className="h-3 w-3 text-arena-gold" />
                      <span className="text-xs font-display font-bold text-arena-gold">${match.betAmount}</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {/* 1v1 progress bar */}
              {match.mode === "1v1" && match.players.length === 2 && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => openPlayer(e, match.players[0])}
                      className="flex items-center gap-1.5 min-w-0 rounded-lg hover:bg-secondary/40 -mx-0.5 px-0.5 py-0.5"
                    >
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: playerColor(match.players[0]) }}>
                        {match.players[0][0]?.toUpperCase()}
                      </div>
                      <span className="text-xs font-display font-medium text-primary truncate max-w-[80px]">{match.players[0]}</span>
                    </button>
                  </div>
                  <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-primary to-arena-cyan animate-pulse" />
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0 justify-end">
                    <button
                      type="button"
                      onClick={(e) => openPlayer(e, match.players[1])}
                      className="flex items-center gap-1.5 min-w-0 rounded-lg hover:bg-secondary/40 -mx-0.5 px-0.5 py-0.5"
                    >
                      <span className="text-xs font-display font-medium text-arena-orange truncate max-w-[80px] text-right">{match.players[1]}</span>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: playerColor(match.players[1]) }}>
                        {match.players[1][0]?.toUpperCase()}
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: "Map",          value: getMapForMatch(match) },
                      { label: "Match ID",     value: match.id, mono: true },
                      { label: "Type",         value: `${match.type} · ${match.mode}` },
                      { label: "Pot",          value: `$${getEstimatedPrize(match)}`, gold: true },
                    ].map(({ label, value, mono, gold }) => (
                      <div key={label} className="rounded-lg bg-background/60 p-2">
                        <p className="text-muted-foreground mb-0.5">{label}</p>
                        <p className={`font-medium truncate ${gold ? "text-arena-gold" : ""} ${mono ? "font-mono" : ""}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <Shield className="h-3 w-3" /> Players in lobby
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {match.players.length > 0 ? match.players.map(player => (
                        <button
                          key={`${match.id}-${player}`}
                          type="button"
                          onClick={(e) => openPlayer(e, player)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-secondary/40 text-xs hover:border-primary/40 hover:bg-secondary/60 transition-colors"
                        >
                          <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                            style={{ background: playerColor(player) }}>
                            {player[0]?.toUpperCase()}
                          </div>
                          {player}
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
