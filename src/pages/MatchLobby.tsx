import { useState } from "react";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { useWalletStore } from "@/stores/walletStore";
import { useMatchPolling } from "@/hooks/useMatchPolling";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Swords, Clock, Users, DollarSign, Lock, Gamepad2, CheckCircle,
  Search, Copy, UserPlus, Crown, Shield, Hash, KeyRound, Eye, EyeOff, AlertCircle
} from "lucide-react";
import type { MatchStatus, Game, Match } from "@/types";

const betAmounts = [10, 25, 50, 100];
const games: Game[] = ["CS2", "Valorant", "Fortnite", "Apex Legends"];

const statusConfig: Record<MatchStatus, { label: string; color: string; icon: React.ElementType }> = {
  waiting: { label: "Waiting", color: "bg-arena-gold/20 text-arena-gold border-arena-gold/30", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-arena-cyan/20 text-arena-cyan border-arena-cyan/30", icon: Gamepad2 },
  completed: { label: "Completed", color: "bg-muted text-muted-foreground border-border", icon: CheckCircle },
  cancelled: { label: "Cancelled", color: "bg-destructive/20 text-destructive border-destructive/30", icon: CheckCircle },
  disputed: { label: "Disputed", color: "bg-arena-orange/20 text-arena-orange border-arena-orange/30", icon: AlertCircle },
};

const MatchLobby = () => {
  const { user } = useUserStore();
  const { matches, addMatch, joinMatch, getMatchByCode } = useMatchStore();
  const { lockEscrow } = useWalletStore();

  // Poll engine for live match updates (desktop client results)
  useMatchPolling({ interval: 5000 });

  const [selectedBet, setSelectedBet] = useState<number | null>(null);
  const [joiningMatch, setJoiningMatch] = useState<string | null>(null);
  const [escrowConfirm, setEscrowConfirm] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [selectedGame, setSelectedGame] = useState<string>("");
  const [createMode, setCreateMode] = useState(false);
  const [newMatchBet, setNewMatchBet] = useState<number | null>(null);
  const [newMatchGame, setNewMatchGame] = useState<Game | "">("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [newMatchPassword, setNewMatchPassword] = useState("");
  const [selectedPublicLobbyId, setSelectedPublicLobbyId] = useState<string | null>(null);

  // Password prompt state
  const [passwordPrompt, setPasswordPrompt] = useState<{ matchId: string; bet: number } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const publicMatches = matches.filter((m) => m.type === "public");
  const customMatches = matches.filter((m) => m.type === "custom");
  const selectedPublicLobby = selectedPublicLobbyId
    ? publicMatches.find((m) => m.id === selectedPublicLobbyId) ?? null
    : null;

  const getPublicLobbyTeams = (match: Match) => {
    const maxPerTeam = Math.max(1, Math.ceil(match.maxPlayers / 2));
    return {
      maxPerTeam,
      teamA: match.players.slice(0, maxPerTeam),
      teamB: match.players.slice(maxPerTeam, maxPerTeam * 2),
    };
  };

  const handleJoinPublic = (matchId: string) => {
    if (!selectedBet || !user) return;
    setJoiningMatch(matchId);
    setEscrowConfirm(true);
  };

  const handleOpenPublicLobby = (matchId: string) => {
    setSelectedPublicLobbyId(matchId);
  };

  const handleJoinCustom = (matchId: string, bet: number) => {
    setPasswordPrompt({ matchId, bet });
    setPasswordInput("");
    setPasswordError(false);
    setShowPassword(false);
  };

  const handlePasswordSubmit = () => {
    if (!passwordPrompt) return;
    const match = customMatches.find(m => m.id === passwordPrompt.matchId);
    if (match && passwordInput === match.password) {
      setPasswordPrompt(null);
      setPasswordInput("");
      setSelectedBet(passwordPrompt.bet);
      setJoiningMatch(passwordPrompt.matchId);
      setEscrowConfirm(true);
    } else {
      setPasswordError(true);
    }
  };

  const handleConfirmEscrow = () => {
    if (!joiningMatch || !selectedBet || !user) return;
    // Lock funds in escrow
    lockEscrow(selectedBet, joiningMatch);
    // Join the match
    joinMatch(joiningMatch, user.username);
    const { addNotification } = useNotificationStore.getState();
    addNotification({
      type: "system",
      title: "🔒 Funds Locked",
      message: `$${selectedBet} has been locked in escrow for match ${joiningMatch}. Good luck!`,
    });
    setEscrowConfirm(false);
    setJoiningMatch(null);
    setSelectedBet(null);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "system", title: "📋 Code Copied", message: `Match code ${code} copied to clipboard. Share it with your team!` });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredCustom = customMatches.filter(
    (m) => !selectedGame || m.game === selectedGame
  );
  const filteredPublicMatches = selectedBet
    ? publicMatches.filter((m) => m.betAmount === selectedBet)
    : publicMatches;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">Match Lobby</h1>
        <p className="text-muted-foreground mt-1">Find a match and play for stakes</p>
      </div>

      {/* Password Prompt Overlay */}
      {passwordPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="bg-card border-arena-cyan/30 glow-purple w-full max-w-md mx-4">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <KeyRound className="h-6 w-6 text-arena-cyan" />
                <h3 className="font-display text-xl font-bold">Enter Match Password</h3>
              </div>
              <p className="text-muted-foreground mb-4 text-sm">
                This match is password-protected. Enter the password shared by the host to join.
              </p>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password..."
                    value={passwordInput}
                    onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                    onKeyDown={(e) => e.key === "Enter" && handlePasswordSubmit()}
                    autoFocus
                    className={`font-mono bg-secondary border-border pr-10 ${passwordError ? "border-destructive" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button onClick={handlePasswordSubmit} className="font-display">
                  <Lock className="mr-2 h-4 w-4" /> Verify
                </Button>
              </div>
              {passwordError && (
                <p className="text-destructive text-sm flex items-center gap-1 mb-3">
                  <AlertCircle className="h-3 w-3" /> Wrong password. Try again.
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPasswordPrompt(null)}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Escrow Confirmation */}
      {escrowConfirm && joiningMatch && (
        <Card className="bg-card border-primary/30 glow-green">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Lock className="h-6 w-6 text-primary" />
              <h3 className="font-display text-xl font-bold">Escrow Confirmation</h3>
            </div>
            <p className="text-muted-foreground mb-4">
              ${selectedBet} will be locked in escrow until the match is resolved.
              This amount will be deducted from your connected wallet.
            </p>
            <div className="flex gap-3">
              <Button onClick={handleConfirmEscrow} className="glow-green font-display">
                <Lock className="mr-2 h-4 w-4" /> Confirm & Lock ${selectedBet}
              </Button>
              <Button variant="outline" onClick={() => { setEscrowConfirm(false); setJoiningMatch(null); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Public Lobby Details Overlay */}
      {selectedPublicLobby && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-5xl bg-card border-border">
            <CardContent className="p-4 md:p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Lobby Details</p>
                  <h3 className="font-display text-xl font-bold truncate">{selectedPublicLobby.host}'s Match</h3>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <Gamepad2 className="h-3 w-3" /> {selectedPublicLobby.game}
                    <span>•</span>
                    <Hash className="h-3 w-3" /> {selectedPublicLobby.id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-xl font-bold text-arena-gold">${selectedPublicLobby.betAmount}</span>
                  <Button variant="outline" size="sm" onClick={() => setSelectedPublicLobbyId(null)}>
                    Close
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs text-primary font-display uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Shield className="h-3 w-3" /> Team A ({getPublicLobbyTeams(selectedPublicLobby).teamA.length}/{getPublicLobbyTeams(selectedPublicLobby).maxPerTeam})
                  </p>
                  <div className="space-y-1">
                    {getPublicLobbyTeams(selectedPublicLobby).teamA.map((player, i) => (
                      <p key={`public-team-a-${player}-${i}`} className="text-sm flex items-center gap-1.5">
                        {i === 0 && <Crown className="h-3 w-3 text-arena-gold" />}
                        {player}
                      </p>
                    ))}
                    {Array.from({
                      length: getPublicLobbyTeams(selectedPublicLobby).maxPerTeam - getPublicLobbyTeams(selectedPublicLobby).teamA.length,
                    }).map((_, i) => (
                      <p key={`public-empty-a-${i}`} className="text-sm text-muted-foreground/30 italic">
                        Empty slot
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-arena-orange/20 bg-arena-orange/5 p-3">
                  <p className="text-xs text-arena-orange font-display uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Shield className="h-3 w-3" /> Team B ({getPublicLobbyTeams(selectedPublicLobby).teamB.length}/{getPublicLobbyTeams(selectedPublicLobby).maxPerTeam})
                  </p>
                  <div className="space-y-1">
                    {getPublicLobbyTeams(selectedPublicLobby).teamB.map((player, i) => (
                      <p key={`public-team-b-${player}-${i}`} className="text-sm">
                        {player}
                      </p>
                    ))}
                    {Array.from({
                      length: getPublicLobbyTeams(selectedPublicLobby).maxPerTeam - getPublicLobbyTeams(selectedPublicLobby).teamB.length,
                    }).map((_, i) => (
                      <p key={`public-empty-b-${i}`} className="text-sm text-muted-foreground/30 italic">
                        Empty slot
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  {selectedPublicLobby.players.length}/{selectedPublicLobby.maxPlayers} players in lobby
                </p>
                <Button
                  disabled={
                    !selectedBet ||
                    selectedBet !== selectedPublicLobby.betAmount ||
                    selectedPublicLobby.status !== "waiting" ||
                    selectedPublicLobby.players.length >= selectedPublicLobby.maxPlayers
                  }
                  onClick={() => {
                    setSelectedPublicLobbyId(null);
                    handleJoinPublic(selectedPublicLobby.id);
                  }}
                  className="font-display"
                >
                  <Swords className="mr-1 h-4 w-4" /> Join This Lobby
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="public" className="w-full">
        <TabsList className="bg-secondary border border-border w-full sm:w-auto">
          <TabsTrigger value="public" className="font-display data-[state=active]:bg-primary/20 data-[state=active]:text-primary flex-1 sm:flex-none gap-2">
            <Swords className="h-4 w-4" />
            Public Matches
          </TabsTrigger>
          <TabsTrigger value="custom" className="font-display data-[state=active]:bg-arena-purple/20 data-[state=active]:text-arena-purple flex-1 sm:flex-none gap-2">
            <Users className="h-4 w-4" />
            Custom 5v5
          </TabsTrigger>
        </TabsList>

        {/* ===== PUBLIC / SOLO MATCHES ===== */}
        <TabsContent value="public" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-arena-gold" />
                Select Bet Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 flex-wrap">
                {betAmounts.slice(0, 3).map((amount) => (
                  <Button
                    key={amount}
                    variant={selectedBet === amount ? "default" : "outline"}
                    disabled={escrowConfirm}
                    onClick={() => setSelectedBet(amount)}
                    className={
                      selectedBet === amount
                        ? "glow-green font-display text-lg px-6"
                        : "border-border font-display text-lg px-6 hover:border-primary/50"
                    }
                  >
                    ${amount}
                  </Button>
                ))}
              </div>
              {selectedBet && (
                <p className="text-sm text-primary mt-3 animate-pulse-glow">
                  ✓ Selected: ${selectedBet} per match
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Swords className="h-5 w-5 text-arena-purple" />
                Available Matches
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredPublicMatches.map((match) => {
                  const status = statusConfig[match.status];
                  const StatusIcon = status.icon;
                  const canJoin = match.status === "waiting" && match.players.length < match.maxPlayers;

                  return (
                    <div
                      key={match.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30 cursor-pointer arena-hover"
                      onClick={() => handleOpenPublicLobby(match.id)}
                    >
                      <div className="flex items-center gap-4">
                        <Badge className={`${status.color} border text-xs gap-1`}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </Badge>
                        <div>
                          <p className="font-medium">{match.host}'s Match</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-2">
                            <Gamepad2 className="h-3 w-3" /> {match.game}
                            <span>•</span>
                            <Users className="h-3 w-3" /> {match.players.length}/{match.maxPlayers}
                            {match.timeLeft && (
                              <>
                                <span>•</span>
                                <Clock className="h-3 w-3" /> {match.timeLeft}
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-display text-lg font-bold text-arena-gold">${match.betAmount}</span>
                        {canJoin ? (
                          <Button
                            size="sm"
                            disabled={!selectedBet || selectedBet !== match.betAmount || escrowConfirm}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJoinPublic(match.id);
                            }}
                            className="font-display"
                          >
                            <Swords className="mr-1 h-4 w-4" /> Join
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled className="font-display">
                            {match.status === "completed" ? "Ended" : "Full"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredPublicMatches.length === 0 && selectedBet && (
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                    No open matches found for ${selectedBet}. Try another bet amount.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== CUSTOM 5v5 MATCHES ===== */}
        <TabsContent value="custom" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Hash className="h-5 w-5 text-arena-cyan" />
                Join or Create Custom Match
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Join by code */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Join by Game ID</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter match code (e.g. ARENA-7X2K)"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                    className="font-mono bg-secondary border-border placeholder:text-muted-foreground/40"
                  />
                  <Button
                    disabled={!customCode}
                    onClick={() => {
                      const found = customMatches.find(m => m.code === customCode);
                      if (found) handleJoinCustom(found.id, found.betAmount);
                    }}
                    className="font-display shrink-0"
                  >
                    <Search className="mr-2 h-4 w-4" /> Find
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground uppercase tracking-widest">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Create new match */}
              {!createMode ? (
                <Button
                  variant="outline"
                  onClick={() => setCreateMode(true)}
                  className="w-full border-arena-purple/30 text-arena-purple hover:bg-arena-purple/10 font-display"
                >
                  <Crown className="mr-2 h-4 w-4" /> Create Custom Match
                </Button>
              ) : (
                <div className="space-y-3 p-4 rounded-lg border border-arena-purple/30 bg-arena-purple/5">
                  <h4 className="font-display font-semibold flex items-center gap-2">
                    <Crown className="h-4 w-4 text-arena-purple" /> New Custom Match
                  </h4>

                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Game</label>
                    <div className="flex gap-2 flex-wrap">
                      {games.map((g) => (
                        <Button
                          key={g}
                          size="sm"
                          variant={newMatchGame === g ? "default" : "outline"}
                          onClick={() => setNewMatchGame(g)}
                          className={newMatchGame === g ? "font-display" : "border-border font-display hover:border-primary/50"}
                        >
                          {g}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Bet Amount</label>
                    <div className="flex gap-2 flex-wrap">
                      {betAmounts.map((a) => (
                        <Button
                          key={a}
                          size="sm"
                          variant={newMatchBet === a ? "default" : "outline"}
                          onClick={() => setNewMatchBet(a)}
                          className={newMatchBet === a ? "glow-green font-display" : "border-border font-display hover:border-primary/50"}
                        >
                          ${a}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Match Password */}
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <KeyRound className="h-3 w-3" /> Match Password
                    </label>
                    <Input
                      type="text"
                      placeholder="Set a password for your match"
                      value={newMatchPassword}
                      onChange={(e) => setNewMatchPassword(e.target.value)}
                      className="font-mono bg-secondary border-border placeholder:text-muted-foreground/40"
                      maxLength={20}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Share this password with your teammates to join
                    </p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      disabled={!newMatchGame || !newMatchBet || !newMatchPassword}
                      onClick={() => {
                        if (!newMatchGame || !newMatchBet || !user) return;
                        const created = addMatch({
                          type: "custom",
                          host: user.username,
                          hostId: user.id,
                          game: newMatchGame as Game,
                          mode: "5v5",
                          betAmount: newMatchBet,
                          players: [],
                          maxPlayers: 10,
                          status: "waiting",
                          password: newMatchPassword,
                          teamA: [user.username],
                          teamB: [],
                          maxPerTeam: 5,
                        });
                        lockEscrow(newMatchBet, created.id);
                        const { addNotification } = useNotificationStore.getState();
                        addNotification({ type: "match_invite", title: "⚔️ Match Created", message: `Your ${newMatchGame} 5v5 match ($${newMatchBet}) is live! Code: ${created.code}` });
                        setCreateMode(false); setNewMatchPassword(""); setNewMatchGame(""); setNewMatchBet(null);
                      }}
                      className="glow-green font-display"
                    >
                      <Swords className="mr-2 h-4 w-4" /> Create 5v5 Match
                    </Button>
                    <Button variant="outline" onClick={() => { setCreateMode(false); setNewMatchPassword(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Filter by game */}
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={!selectedGame ? "default" : "outline"}
              onClick={() => setSelectedGame("")}
              className="font-display"
            >
              All Games
            </Button>
            {games.slice(0, 2).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={selectedGame === g ? "default" : "outline"}
                onClick={() => setSelectedGame(g)}
                className={selectedGame === g ? "font-display" : "border-border font-display hover:border-primary/50"}
              >
                {g}
              </Button>
            ))}
          </div>

          {/* Custom matches list */}
          <div className="space-y-4">
            {filteredCustom.map((match) => {
              const status = statusConfig[match.status];
              const StatusIcon = status.icon;
              const teamAFull = match.teamA.length >= match.maxPerTeam;
              const teamBFull = match.teamB.length >= match.maxPerTeam;
              const canJoin = match.status === "waiting" && (!teamAFull || !teamBFull);

              return (
                <Card key={match.id} className="bg-card border-border cursor-pointer arena-hover">
                  <CardContent className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge className={`${status.color} border text-xs gap-1`}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </Badge>
                        <div>
                          <p className="font-medium flex items-center gap-2">
                            <Crown className="h-4 w-4 text-arena-gold" />
                            {match.host}'s {match.mode}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-2">
                            <Gamepad2 className="h-3 w-3" /> {match.game}
                            <span>•</span>
                            <KeyRound className="h-3 w-3" /> Password Protected
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleCopyCode(match.code)}
                          className="flex items-center gap-1 text-xs font-mono bg-secondary px-2 py-1 rounded border border-border hover:border-primary/50 transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedCode === match.code ? "Copied!" : match.code}
                        </button>
                        <span className="font-display text-lg font-bold text-arena-gold">${match.betAmount}</span>
                      </div>
                    </div>

                    {/* Teams */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Team A */}
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <p className="text-xs text-primary font-display uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Shield className="h-3 w-3" /> Team A ({match.teamA.length}/{match.maxPerTeam})
                        </p>
                        <div className="space-y-1">
                          {match.teamA.map((player, i) => (
                            <p key={i} className="text-sm flex items-center gap-1.5">
                              {i === 0 && <Crown className="h-3 w-3 text-arena-gold" />}
                              {player}
                            </p>
                          ))}
                          {Array.from({ length: match.maxPerTeam - match.teamA.length }).map((_, i) => (
                            <p key={`empty-a-${i}`} className="text-sm text-muted-foreground/30 italic">
                              Empty slot
                            </p>
                          ))}
                        </div>
                        {canJoin && !teamAFull && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleJoinCustom(match.id, match.betAmount)}
                            className="mt-2 w-full border-primary/30 text-primary hover:bg-primary/10 font-display text-xs"
                          >
                            <UserPlus className="mr-1 h-3 w-3" /> Join Team A
                          </Button>
                        )}
                      </div>

                      {/* Team B */}
                      <div className="rounded-lg border border-arena-orange/20 bg-arena-orange/5 p-3">
                        <p className="text-xs text-arena-orange font-display uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Shield className="h-3 w-3" /> Team B ({match.teamB.length}/{match.maxPerTeam})
                        </p>
                        <div className="space-y-1">
                          {match.teamB.map((player, i) => (
                            <p key={i} className="text-sm">{player}</p>
                          ))}
                          {Array.from({ length: match.maxPerTeam - match.teamB.length }).map((_, i) => (
                            <p key={`empty-b-${i}`} className="text-sm text-muted-foreground/30 italic">
                              Empty slot
                            </p>
                          ))}
                        </div>
                        {canJoin && !teamBFull && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleJoinCustom(match.id, match.betAmount)}
                            className="mt-2 w-full border-arena-orange/30 text-arena-orange hover:bg-arena-orange/10 font-display text-xs"
                          >
                            <UserPlus className="mr-1 h-3 w-3" /> Join Team B
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MatchLobby;
