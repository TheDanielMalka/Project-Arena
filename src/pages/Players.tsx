import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { usePlayerStore } from "@/stores/playerStore";
import { Search, Users2, ChevronRight } from "lucide-react";
import type { Game } from "@/types";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────

// DB-ready: comingSoon driven by games.enabled — flip to false when Client supports the game
const GAME_FILTERS: Array<{ label: string; value: Game | ""; comingSoon?: boolean }> = [
  { label: "All Games",         value: ""                  },
  { label: "CS2",               value: "CS2"               },
  { label: "Valorant",          value: "Valorant"          },
  { label: "Fortnite",          value: "Fortnite",          comingSoon: true },
  { label: "Apex Legends",      value: "Apex Legends",      comingSoon: true },
  { label: "PUBG",              value: "PUBG",              comingSoon: true },
  { label: "COD",               value: "COD",               comingSoon: true },
  { label: "League of Legends", value: "League of Legends", comingSoon: true },
];

const TIER_COLOR: Record<string, string> = {
  Bronze:   "#CD7F32",
  Silver:   "#A0A0A0",
  Gold:     "#FFD700",
  Platinum: "#00C9C9",
  Diamond:  "#A855F7",
  Master:   "#FF2D55",
};

// ─── Component ────────────────────────────────────────────────

export default function Players() {
  const navigate      = useNavigate();
  const searchPlayers = usePlayerStore((s) => s.searchPlayers);

  const [query,      setQuery]      = useState("");
  const [gameFilter, setGameFilter] = useState<Game | "">("");

  const results = useMemo(
    () => searchPlayers(query, gameFilter || undefined),
    [query, gameFilter, searchPlayers]
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
          <Users2 className="h-6 w-6 text-primary" />
          Players
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search players, view public stats, and report misconduct
        </p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by username…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 bg-secondary/50 border-border/50"
        />
      </div>

      {/* Game filter pills */}
      <div className="flex flex-wrap gap-2">
        {GAME_FILTERS.map((f) =>
          f.comingSoon ? (
            <span key={f.value}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-border/30 bg-secondary/20 text-muted-foreground/35 cursor-not-allowed select-none">
              {f.label}
              <span className="text-[8px] font-bold tracking-wide text-muted-foreground/30">SOON</span>
            </span>
          ) : (
            <button
              key={f.value}
              onClick={() => setGameFilter(f.value as Game | "")}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                gameFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary/40 border-border/40 text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          )
        )}
      </div>

      {/* Result count */}
      <p className="text-xs text-muted-foreground">
        {results.length} player{results.length !== 1 ? "s" : ""} found
      </p>

      {/* Player grid */}
      {results.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No players found{query ? ` matching "${query}"` : ""}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((player) => {
            const tierColor = TIER_COLOR[player.tier] ?? "#888";
            return (
              <button
                key={player.id}
                onClick={() => navigate(`/players/${player.username}`)}
                className="text-left rounded-2xl border border-border/40 bg-secondary/20 p-4 hover:border-primary/40 hover:bg-secondary/40 transition-all group"
              >
                {/* Top row: avatar + name + arrow */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center font-display text-sm font-bold shrink-0"
                      style={{
                        background: `${tierColor}20`,
                        border: `1.5px solid ${tierColor}50`,
                        color: tierColor,
                      }}
                    >
                      {player.avatar && player.avatar !== "initials"
                        ? <span className="text-base">{player.avatar}</span>
                        : player.avatarInitials}
                    </div>
                    <div>
                      <p className="font-display text-sm font-semibold leading-tight">
                        {player.username}
                      </p>
                      <p className="text-xs text-muted-foreground">{player.preferredGame}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </div>

                {/* Bottom row: rank + status + win rate */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        color: tierColor,
                        background: `${tierColor}18`,
                        border: `1px solid ${tierColor}35`,
                      }}
                    >
                      {player.rank}
                    </span>
                    {player.status !== "active" && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] py-0 px-1.5",
                          player.status === "banned"
                            ? "border-destructive/50 text-destructive"
                            : "border-arena-orange/50 text-arena-orange"
                        )}
                      >
                        {player.status}
                      </Badge>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-primary">
                      {player.stats.winRate.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {player.stats.matches} matches
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
