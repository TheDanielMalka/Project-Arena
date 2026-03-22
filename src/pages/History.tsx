import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMatchStore } from "@/stores/matchStore";
import { useNavigate } from "react-router-dom";
import { Search, Swords, Inbox, ChevronLeft, ChevronRight, Gamepad2, Filter, Users, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import type { Game, MatchStatus } from "@/types";

const ITEMS_PER_PAGE = 8;

const History = () => {
  const navigate = useNavigate();
  const { matches } = useMatchStore();
  const [search, setSearch] = useState("");
  const [gameFilter, setGameFilter] = useState<Game | "all">("all");
  const [statusFilter, setStatusFilter] = useState<MatchStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const filtered = matches.filter((m) => {
    const matchSearch =
      m.host.toLowerCase().includes(search.toLowerCase()) ||
      m.game.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase());
    const matchGame = gameFilter === "all" || m.game === gameFilter;
    const matchStatus = statusFilter === "all" || m.status === statusFilter;
    return matchSearch && matchGame && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const statusBadge = (status: MatchStatus) => {
    const map: Record<MatchStatus, { label: string; class: string }> = {
      waiting: { label: "Waiting", class: "bg-arena-gold/20 text-arena-gold border-arena-gold/30" },
      in_progress: { label: "Live", class: "bg-arena-cyan/20 text-arena-cyan border-arena-cyan/30" },
      completed: { label: "Completed", class: "bg-muted text-muted-foreground border-border" },
      cancelled: { label: "Cancelled", class: "bg-destructive/20 text-destructive border-destructive/30" },
      disputed: { label: "Disputed", class: "bg-arena-orange/20 text-arena-orange border-arena-orange/30" },
    };
    const cfg = map[status];
    return <Badge variant="outline" className={`text-xs ${cfg.class}`}>{cfg.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">Match History</h1>
        <p className="text-muted-foreground mt-1">All your past and active matches</p>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by opponent, game, or match ID..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9 bg-secondary border-border"
              />
            </div>
            <Select value={gameFilter} onValueChange={(v) => { setGameFilter(v as Game | "all"); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40 bg-secondary border-border">
                <Gamepad2 className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Game" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Games</SelectItem>
                <SelectItem value="CS2">CS2</SelectItem>
                <SelectItem value="Valorant">Valorant</SelectItem>
                <SelectItem value="Fortnite">Fortnite</SelectItem>
                <SelectItem value="Apex Legends">Apex Legends</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as MatchStatus | "all"); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40 bg-secondary border-border">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="waiting">Waiting</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {paged.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-display text-lg">No matches found</p>
            <p className="text-sm opacity-60 mb-4">
              {search || gameFilter !== "all" || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "You haven't played any matches yet"
              }
            </p>
            <Button onClick={() => navigate("/lobby")} className="glow-green font-display">
              <Swords className="mr-2 h-4 w-4" /> Find a Match
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {paged.map((m) => {
            const isWin = m.status === "completed" && m.winnerId === "user-001";
            const isLoss = m.status === "completed" && m.winnerId && m.winnerId !== "user-001";
            const isExpanded = expandedMatchId === m.id;
            const maxPerTeam = m.maxPerTeam ?? Math.max(1, Math.ceil(m.maxPlayers / 2));
            const teamA = m.teamA ?? m.players.slice(0, maxPerTeam);
            const teamB = m.teamB ?? m.players.slice(maxPerTeam, maxPerTeam * 2);

            return (
              <Card
                key={m.id}
                className="bg-card border-border cursor-pointer arena-hover"
                onClick={() => setExpandedMatchId((prev) => (prev === m.id ? null : m.id))}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {statusBadge(m.status)}
                      <div>
                        <p className="font-medium text-sm">
                          {m.type === "custom" ? `${m.host}'s Custom` : `vs ${m.host}`}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                          <Gamepad2 className="h-3 w-3" /> {m.game}
                          <span>•</span>
                          {m.mode}
                          {m.code && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-arena-cyan">{m.code}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <div>
                        <p className={`font-display text-lg font-bold ${isWin ? "text-primary" : isLoss ? "text-destructive" : "text-arena-gold"}`}>
                          ${m.betAmount}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{m.id}</p>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div className="rounded-md border border-border bg-secondary/20 p-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</p>
                          <p className="text-sm font-medium">{m.status.replace("_", " ")}</p>
                        </div>
                        <div className="rounded-md border border-border bg-secondary/20 p-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Players</p>
                          <p className="text-sm font-medium">{m.players.length}/{m.maxPlayers}</p>
                        </div>
                        <div className="rounded-md border border-border bg-secondary/20 p-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Mode</p>
                          <p className="text-sm font-medium">{m.mode}</p>
                        </div>
                        <div className="rounded-md border border-border bg-secondary/20 p-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Winner</p>
                          <p className="text-sm font-medium flex items-center gap-1">
                            <Trophy className="h-3 w-3 text-arena-gold" />
                            {m.status === "completed" ? (m.winnerId ?? "Pending") : "In Progress"}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <p className="text-xs text-primary uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Users className="h-3 w-3" /> Team A ({teamA.length}/{maxPerTeam})
                          </p>
                          <div className="space-y-1">
                            {teamA.map((player, i) => (
                              <p key={`${m.id}-a-${player}-${i}`} className="text-sm">{player}</p>
                            ))}
                            {Array.from({ length: maxPerTeam - teamA.length }).map((_, i) => (
                              <p key={`${m.id}-a-empty-${i}`} className="text-sm text-muted-foreground/40 italic">Empty slot</p>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-lg border border-arena-orange/20 bg-arena-orange/5 p-3">
                          <p className="text-xs text-arena-orange uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Users className="h-3 w-3" /> Team B ({teamB.length}/{maxPerTeam})
                          </p>
                          <div className="space-y-1">
                            {teamB.map((player, i) => (
                              <p key={`${m.id}-b-${player}-${i}`} className="text-sm">{player}</p>
                            ))}
                            {Array.from({ length: maxPerTeam - teamB.length }).map((_, i) => (
                              <p key={`${m.id}-b-empty-${i}`} className="text-sm text-muted-foreground/40 italic">Empty slot</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            className="border-border font-display"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
            className="border-border font-display"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

    </div>
  );
};

export default History;
