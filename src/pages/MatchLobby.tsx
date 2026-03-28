import { useState, useRef, useEffect, useCallback } from "react";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { useWalletStore } from "@/stores/walletStore";
import { useMatchPolling } from "@/hooks/useMatchPolling";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Swords, Clock, Users, Lock, Gamepad2, CheckCircle,
  Search, Copy, UserPlus, Crown, Shield, Hash, KeyRound, Eye, EyeOff,
  AlertCircle, ChevronDown, Monitor, Smartphone, Zap, TrendingUp,
  Wallet, Loader2, ScanLine, LogOut, AlertTriangle, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatchStatus, Game, Match, MatchMode } from "@/types";
import { GAME_MODES, getDefaultMode, getTeamSize, getTotalPlayers } from "@/config/gameModes";

// ─── Game configs ─────────────────────────────────────────────────────────────
const PC_GAME_CONFIG: Record<string, { logo: string; color: string }> = {
  "CS2":          { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg",     color: "#F97316" },
  "Valorant":     { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg", color: "#FF4655" },
  "Fortnite":     { logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120", color: "#38BDF8" },
  "Apex Legends": { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg", color: "#FC4B08" },
};
const MOBILE_GAME_CONFIG: Record<string, { logo: string; color: string }> = {
  "MLBB":        { logo: "https://play-lh.googleusercontent.com/Op7v9XdsyxjrKImMD5RLyiLRCAHs3DMQFANwfsuMTw1hq0lH4j8tOqD3Fd7zyr4ixmC0xoqqRkQDBjAd46NsFQ=s120", color: "#EF4444" },
  "Wild Rift":   { logo: "https://play-lh.googleusercontent.com/7-kbcpgrCOE1mleJ9g0d61sJeoqKcQRIj4iFvJ8DjPlRIfocOWfOQsXzKWw2I5oHySVdbjR2fvzfCCz1FYQ-RQ=s120",  color: "#6366F1" },
  "COD Mobile":  { logo: "https://play-lh.googleusercontent.com/cfGSXkDwxa1jW3TlhhkDJBN16-1_KEtEDhnILPcs9rXcC25g14XY6MRGCtlXHFHs0g=s120",                         color: "#84CC16" },
  "PUBG Mobile": { logo: "https://play-lh.googleusercontent.com/zCSGnBtZk0Lmp1BAbyaZfLktDzHmC6oke67qzz3G1lBegAF2asyt5KzXOJ2PVdHDYkU=s120",                         color: "#F59E0B" },
};
const ALL_GAME_CONFIG = { ...PC_GAME_CONFIG, ...MOBILE_GAME_CONFIG };

// Identity provider per game — used in deposit modal to show correct verification field
const IDENTITY_PROVIDER: Record<string, { name: string; field: string }> = {
  "CS2":               { name: "Steam",       field: "SteamID"    },
  "Valorant":          { name: "Riot",        field: "RiotID"     },
  "Fortnite":          { name: "Epic Games",  field: "EpicID"     },
  "Apex Legends":      { name: "Steam",       field: "SteamID"    },
  "PUBG":              { name: "Steam",       field: "SteamID"    },
  "PUBG Mobile":       { name: "PUBG Corp",   field: "PlayerTag"  },
  "COD":               { name: "Battle.net",  field: "BattleTag"  },
  "COD Mobile":        { name: "Activision",  field: "PlayerTag"  },
  "League of Legends": { name: "Riot",        field: "RiotID"     },
  "Wild Rift":         { name: "Riot",        field: "RiotID"     },
  "MLBB":              { name: "Moonton",     field: "PlayerID"   },
};

const BET_AMOUNTS = [5, 10, 25, 50];
const CREATE_BET_AMOUNTS = [5, 10, 25, 50, 100];

const statusConfig: Record<MatchStatus, { label: string; color: string; icon: React.ElementType }> = {
  waiting:     { label: "Waiting",   color: "bg-arena-gold/15 text-arena-gold border-arena-gold/30",       icon: Clock },
  in_progress: { label: "Live",      color: "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30",       icon: Zap },
  completed:   { label: "Completed", color: "bg-muted text-muted-foreground border-border",                icon: CheckCircle },
  cancelled:   { label: "Cancelled", color: "bg-destructive/15 text-destructive border-destructive/30",    icon: CheckCircle },
  disputed:    { label: "Disputed",  color: "bg-arena-orange/15 text-arena-orange border-arena-orange/30", icon: AlertCircle },
};

// Player avatar color — deterministic, DB-ready (will be replaced by real avatar)
const playerColor = (name: string) => {
  const palette = ["#F97316","#38BDF8","#A855F7","#22C55E","#EAB308","#EC4899","#14B8A6","#F43F5E","#6366F1","#84CC16"];
  return palette[(name.charCodeAt(0) + name.charCodeAt(name.length - 1)) % palette.length];
};

// ─── MiniAvatar ───────────────────────────────────────────────────────────────
// avatar prop: undefined = initials fallback (DB-ready: will accept "emoji" | "upload:{url}" | CDN)
const MiniAvatar = ({ name, avatar, size = 20 }: { name: string; avatar?: string; size?: number }) => {
  const style = { width: size, height: size, background: playerColor(name), fontSize: size * 0.45 };
  if (avatar && avatar.startsWith("upload:")) return (
    <img src={avatar.slice(7)} alt={name} style={{ width: size, height: size }}
      className="rounded-full object-cover border-2 border-card shrink-0" />
  );
  if (avatar && avatar !== "initials") return (
    <span style={{ ...style, fontSize: size * 0.6 }} className="rounded-full flex items-center justify-center border-2 border-card shrink-0">{avatar}</span>
  );
  return (
    <div style={style} className="rounded-full flex items-center justify-center font-bold border-2 border-card text-white shrink-0">
      {name[0]?.toUpperCase()}
    </div>
  );
};

// ─── AvatarStack — player pile shown inline on match rows ─────────────────────
const AvatarStack = ({ players, max = 5 }: { players: string[]; max?: number }) => {
  const shown = players.slice(0, max);
  const extra = players.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: shown.length - i }}>
          <MiniAvatar name={p} size={20} />
        </div>
      ))}
      {extra > 0 && (
        <div className="w-5 h-5 rounded-full bg-secondary border-2 border-card flex items-center justify-center text-[9px] text-muted-foreground font-bold"
          style={{ marginLeft: -6 }}>
          +{extra}
        </div>
      )}
    </div>
  );
};

// ─── PlayerRow ────────────────────────────────────────────────────────────────
const PlayerRow = ({ name, isHost, index }: { name: string; isHost?: boolean; index: number }) => (
  <div className="flex items-center gap-2 py-0.5">
    {isHost && index === 0 ? <Crown className="h-3 w-3 text-arena-gold shrink-0" /> : <div className="w-3 h-3 shrink-0" />}
    <MiniAvatar name={name} size={18} />
    <span className="text-sm truncate">{name}</span>
  </div>
);

// ─── GameLogo ─────────────────────────────────────────────────────────────────
const GameLogo = ({ game, size = 28 }: { game: string; size?: number }) => {
  const cfg = ALL_GAME_CONFIG[game];
  if (!cfg) return <Gamepad2 style={{ width: size, height: size }} className="text-muted-foreground" />;
  return (
    <img src={cfg.logo} alt={game} style={{ width: size, height: size }}
      className="rounded object-cover shrink-0"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
  );
};

// ─── GameDropdown ─────────────────────────────────────────────────────────────
interface GameDropdownProps {
  label: string; icon: React.ElementType;
  games: Record<string, { logo: string; color: string }>;
  activeGame: string; onSelect: (g: string) => void; comingSoon?: boolean;
}
const GameDropdown = ({ label, icon: Icon, games, activeGame, onSelect, comingSoon }: GameDropdownProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasActive = !comingSoon && Object.keys(games).some((g) => g === activeGame);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-display transition-all ${
          hasActive ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
        }`}>
        <Icon className="h-3.5 w-3.5" />{label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[170px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          {comingSoon
            ? <div className="px-4 py-3 text-xs text-muted-foreground text-center">Coming soon</div>
            : Object.entries(games).map(([name, cfg]) => (
              <button key={name} onClick={() => { onSelect(name); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary/60 transition-colors text-left ${activeGame === name ? "bg-primary/10 text-primary" : "text-foreground"}`}>
                <img src={cfg.logo} alt={name} className="w-6 h-6 rounded object-cover shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                <span className="font-medium truncate">{name}</span>
                {activeGame === name && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

// ─── LiveTicker ──────────────────────────────────────────────────────────────
// Displays a scrolling strip of recent completed matches
// DB-ready: receives Match[] — will be real data when connected
const LiveTicker = ({ matches }: { matches: Match[] }) => {
  const completed = matches.filter(m => m.status === "completed" && m.winnerId);
  if (completed.length === 0) return null;
  const items = [...completed, ...completed]; // duplicate for seamless loop
  return (
    <div className="relative w-full rounded-xl border border-border bg-secondary/30 h-8" style={{ overflow: "hidden" }}>
      <div className="absolute left-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-r from-card to-transparent pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-l from-card to-transparent pointer-events-none" />
      <div className="absolute left-2 top-1/2 -translate-y-1/2 z-20">
        <TrendingUp className="h-3 w-3 text-arena-gold" />
      </div>
      <style>{`@keyframes arenaT { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }`}</style>
      <div className="absolute top-0 left-0 h-full flex items-center" style={{ animation: "arenaT 32s linear infinite", whiteSpace: "nowrap" }}>
        {items.map((m, i) => {
          const cfg = ALL_GAME_CONFIG[m.game];
          const winner = m.winnerId === m.host ? m.host : (m.players.find(p => p === m.winnerId) ?? m.winnerId);
          return (
            <span key={`${m.id}-${i}`} className="inline-flex items-center gap-1.5 pl-8 text-xs text-muted-foreground">
              {cfg && <img src={cfg.logo} alt={m.game} className="w-4 h-4 rounded object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
              <span className="text-foreground font-medium">{winner}</span>
              <span>won</span>
              <span className="text-arena-gold font-bold">${m.betAmount}</span>
              <span style={{ color: cfg?.color }}>· {m.game}</span>
              <span className="text-border mx-3">|</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const MatchLobby = () => {
  const { user } = useUserStore();
  const { matches, addMatch, joinMatch, leaveMatch, updateMatchStatus, getMatchByCode } = useMatchStore();
  const { lockEscrow, cancelEscrow } = useWalletStore();
  useMatchPolling({ interval: 5000 });

  const [selectedBet, setSelectedBet] = useState<number | null>(null);
  const [customCode, setCustomCode] = useState("");
  const [selectedGame, setSelectedGame] = useState<string>("");
  const [createMode, setCreateMode] = useState(false);
  const [newMatchBet, setNewMatchBet] = useState<number | null>(null);
  const [newMatchGame, setNewMatchGame] = useState<Game | "">("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [newMatchMode, setNewMatchMode] = useState<MatchMode | null>(null);
  const [newMatchPassword, setNewMatchPassword] = useState("");
  const [selectedPublicLobbyId, setSelectedPublicLobbyId] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ matchId: string; bet: number; team?: "A" | "B" } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [showPassword, setShowPassword]       = useState(false);
  const [filterGame, setFilterGame]           = useState<string>("");
  const [filterMode, setFilterMode]           = useState<MatchMode | null>(null);
  const [depositConfirm, setDepositConfirm]   = useState<{ match: Match; team?: "A" | "B" } | null>(null);
  const [depositStep, setDepositStep]         = useState<"idle" | "verifying" | "confirmed">("idle");
  const [myRoomMatchId, setMyRoomMatchId] = useState<string | null>(null);
  const [roomLocked, setRoomLocked]       = useState(false);
  const [countdown, setCountdown]         = useState<number | null>(null);

  const publicMatches = matches.filter(m => m.type === "public");
  const customMatches = matches.filter(m => m.type === "custom");
  const selectedPublicLobby = selectedPublicLobbyId
    ? publicMatches.find(m => m.id === selectedPublicLobbyId) ?? null : null;

  const getPublicLobbyTeams = (match: Match) => {
    const maxPerTeam = Math.max(1, Math.ceil(match.maxPlayers / 2));
    return { maxPerTeam, teamA: match.players.slice(0, maxPerTeam), teamB: match.players.slice(maxPerTeam, maxPerTeam * 2) };
  };

  const handleJoinPublic = (matchId: string, betAmount?: number) => {
    if (!user) return;
    const bet = betAmount ?? selectedBet;
    if (!bet) return;
    setSelectedBet(bet);
    const match = publicMatches.find(m => m.id === matchId);
    if (!match) return;
    // No team for public matches — deposit modal handles both public and custom
    setDepositConfirm({ match });
    setDepositStep("idle");
  };
  const handleOpenPublicLobby = (matchId: string) => setSelectedPublicLobbyId(matchId);
  const handleJoinCustom = (matchId: string, bet: number, team?: "A" | "B") => {
    setPasswordPrompt({ matchId, bet, team }); setPasswordInput(""); setPasswordError(false); setShowPassword(false);
  };
  const handlePasswordSubmit = () => {
    if (!passwordPrompt) return;
    const match = customMatches.find(m => m.id === passwordPrompt.matchId);
    if (match && passwordInput === match.password) {
      setPasswordPrompt(null); setPasswordInput("");
      setDepositConfirm({ match, team: passwordPrompt.team });
      setDepositStep("idle");
    } else { setPasswordError(true); }
  };
  const handleDepositConfirm = () => {
    if (!depositConfirm || !user) return;
    setDepositStep("verifying");
    // Simulates contract pre-check (wallet + identity + amount).
    // DB-ready: replace with wagmi readContract / balanceOf check in Issue #Frontend-Wallet
    setTimeout(() => setDepositStep("confirmed"), 2200);
  };
  const handleDepositFinal = () => {
    if (!depositConfirm || !user) return;
    const { match, team } = depositConfirm;
    // DB-ready: replace with wagmi writeContract(joinMatch, { value: stakePerPlayer }) in Issue #Frontend-Wallet
    lockEscrow(match.betAmount, match.id);
    joinMatch(match.id, user.username, team);
    setMyRoomMatchId(match.id);
    setRoomLocked(false);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "🔒 Deposit Confirmed",
      message: `$${match.betAmount} locked in escrow for ${match.game} ${match.mode}. Waiting for all players.`,
    });
    setDepositConfirm(null);
    setDepositStep("idle");
  };
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code); setCopiedCode(code);
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "system", title: "📋 Code Copied", message: `Match code ${code} copied. Share with your team!` });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredCustom = customMatches.filter(m => !selectedGame || m.game === selectedGame);
  const filteredPublicMatches = publicMatches.filter(m => {
    if (selectedBet !== null && m.betAmount !== selectedBet) return false;
    if (filterGame && m.game !== filterGame) return false;
    if (filterMode && m.mode !== filterMode) return false;
    return true;
  });
  // Unique games that actually have public matches (drives the filter bar)
  const uniquePublicGames = [...new Set(publicMatches.map(m => m.game))];

  // Stats for header strip — DB-ready: computed from real matches when connected
  const liveCount   = publicMatches.filter(m => m.status === "in_progress").length;
  const openCount   = publicMatches.filter(m => m.status === "waiting").length;
  const totalPool   = publicMatches.reduce((s, m) => s + m.betAmount * m.players.length, 0);

  const myActiveRoom = myRoomMatchId
    ? matches.find((m) => m.id === myRoomMatchId) ?? null
    : null;

  useEffect(() => {
    if (!myActiveRoom?.lockCountdownStart) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const elapsed   = (Date.now() - new Date(myActiveRoom.lockCountdownStart!).getTime()) / 1000;
      const remaining = Math.max(0, 10 - Math.floor(elapsed));
      setCountdown(remaining);
      if (remaining === 0) {
        // Time's up — contract locks, match goes in_progress
        updateMatchStatus(myActiveRoom.id, "in_progress");
        setMyRoomMatchId(null);
        setRoomLocked(true);
        useNotificationStore.getState().addNotification({
          type: "system",
          title: "🔒 Match Locked",
          message: `Your match is locked and in progress. Good luck!`,
        });
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [myActiveRoom?.lockCountdownStart, myActiveRoom?.id]);

  useEffect(() => {
    if (myActiveRoom?.status === "in_progress" && myRoomMatchId) {
      setMyRoomMatchId(null);
      setRoomLocked(true);
    }
  }, [myActiveRoom?.status]);

  const handleLeaveRoom = useCallback(() => {
    if (!myActiveRoom || !user) return;
    const left = leaveMatch(myActiveRoom.id, user.username);
    if (left) {
      cancelEscrow(myActiveRoom.id);
      setMyRoomMatchId(null);
      setCountdown(null);
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "↩️ Left Room",
        message: `You left the match room. Your $${myActiveRoom.betAmount} has been refunded.`,
      });
    }
  }, [myActiveRoom, user, leaveMatch, cancelEscrow]);

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mb-0.5">Arena</p>
          <h1 className="font-display text-3xl font-bold tracking-wide">Match Lobby</h1>
        </div>
        {/* Live stats strip */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-arena-cyan animate-pulse" />
            <span className="text-arena-cyan font-semibold">{liveCount}</span> live
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-arena-gold" />
            <span className="text-arena-gold font-semibold">{openCount}</span> open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-foreground font-semibold">${totalPool.toLocaleString()}</span> in pool
          </span>
        </div>
      </div>

      {/* ── Live Activity Ticker ── */}
      <LiveTicker matches={matches} />

      {/* ── Password Prompt ── */}
      {passwordPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-arena-cyan/30 bg-card shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-arena-cyan/10 flex items-center justify-center">
                <KeyRound className="h-5 w-5 text-arena-cyan" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold">Match Password</h3>
                <p className="text-xs text-muted-foreground">Enter the host's password to join</p>
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Input type={showPassword ? "text" : "password"} placeholder="Enter password..."
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                  onKeyDown={(e) => e.key === "Enter" && handlePasswordSubmit()}
                  autoFocus
                  className={`font-mono bg-secondary border-border pr-10 ${passwordError ? "border-destructive" : ""}`} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={handlePasswordSubmit} className="font-display shrink-0">
                <Lock className="mr-2 h-4 w-4" /> Verify
              </Button>
            </div>
            {passwordError && (
              <p className="text-destructive text-sm flex items-center gap-1 mb-3">
                <AlertCircle className="h-3 w-3" /> Wrong password. Try again.
              </p>
            )}
            <button onClick={() => setPasswordPrompt(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Deposit Confirmation Modal (Public & Custom matches) ── */}
      {depositConfirm && (() => {
        const { match, team } = depositConfirm;
        const cfg = ALL_GAME_CONFIG[match.game];
        const idp = IDENTITY_PROVIDER[match.game] ?? { name: "Platform", field: "Account ID" };
        const isVerifying  = depositStep === "verifying";
        const isConfirmed  = depositStep === "confirmed";
        const checks: { icon: React.ElementType; label: string; detail: string }[] = [
          { icon: Wallet,      label: "Wallet connected",          detail: "0x•••••••" },
          { icon: ScanLine,    label: `${idp.field} verified`,     detail: idp.name    },
          { icon: CheckCircle, label: "Bet amount confirmed",      detail: `$${match.betAmount}` },
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl border border-arena-gold/30 bg-card shadow-2xl overflow-hidden">
              <div className="h-0.5 w-full bg-gradient-to-r from-arena-gold via-primary to-arena-purple" />
              <div className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-arena-gold/10 flex items-center justify-center shrink-0">
                    <Lock className="h-5 w-5 text-arena-gold" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold">Confirm Deposit</h3>
                    <p className="text-xs text-muted-foreground">Smart contract locks funds until match resolves</p>
                  </div>
                </div>
                {/* Match info */}
                <div className="rounded-xl border border-border bg-secondary/30 p-3 flex items-center gap-3">
                  <GameLogo game={match.game} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{match.host}'s {match.mode}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {match.game}
                      {team ? ` · Team ${team}` : match.type === "custom" ? " · Any team" : " · Public Match"}
                      {match.code ? ` · ${match.code}` : ` · #${match.id}`}
                    </p>
                  </div>
                  <span className="font-display text-xl font-bold text-arena-gold shrink-0">${match.betAmount}</span>
                </div>
                {/* Verification checklist */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
                    <span className="w-1 h-3 rounded-full bg-arena-cyan inline-block" /> Contract Verification
                  </p>
                  {checks.map(({ icon: Icon, label, detail }) => (
                    <div key={label} className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                      {isVerifying
                        ? <Loader2 className="h-4 w-4 text-arena-cyan animate-spin shrink-0" />
                        : <Icon className="h-4 w-4 text-arena-cyan shrink-0" />}
                      <span className="text-sm flex-1">{label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{detail}</span>
                      {!isVerifying && <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                    </div>
                  ))}
                  {isVerifying && (
                    <p className="text-xs text-arena-cyan flex items-center gap-1.5 pl-1 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-arena-cyan" />
                      Awaiting contract confirmation…
                    </p>
                  )}
                </div>
                {/* ── Final confirmation panel (appears after verification passes) ── */}
                {isConfirmed && (
                  <div className="rounded-xl border border-arena-gold/40 bg-arena-gold/5 p-4 space-y-3">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                      All checks passed — ready to lock funds
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Pressing <span className="text-foreground font-semibold">Confirm &amp; Lock</span> will call the smart
                      contract and transfer <span className="text-arena-gold font-bold">${match.betAmount}</span> into escrow.
                      This action cannot be undone until the match resolves.
                    </p>
                    <div className="flex gap-2">
                      <Button onClick={handleDepositFinal} className="flex-1 font-display glow-green">
                        <Lock className="mr-2 h-4 w-4" /> Confirm &amp; Lock ${match.betAmount}
                      </Button>
                      <Button variant="outline" onClick={() => { setDepositConfirm(null); setDepositStep("idle"); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Initial deposit button (hidden once confirmed) ── */}
                {!isConfirmed && (
                  <div className="flex gap-2 pt-1">
                    <Button onClick={handleDepositConfirm} disabled={isVerifying} className="flex-1 font-display glow-green">
                      {isVerifying
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</>
                        : <><Lock className="mr-2 h-4 w-4" /> Deposit ${match.betAmount}</>}
                    </Button>
                    {!isVerifying && (
                      <Button variant="outline" onClick={() => { setDepositConfirm(null); setDepositStep("idle"); }}>
                        Cancel
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Public Lobby Details Overlay ── */}
      {selectedPublicLobby && (() => {
        const { teamA, teamB, maxPerTeam } = getPublicLobbyTeams(selectedPublicLobby);
        const cfg = ALL_GAME_CONFIG[selectedPublicLobby.game];
        const isLive = selectedPublicLobby.status === "in_progress";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-5xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
              {isLive && <div className="h-0.5 w-full bg-gradient-to-r from-arena-cyan via-primary to-arena-purple animate-pulse" />}
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <GameLogo game={selectedPublicLobby.game} size={36} />
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.15em]">Lobby Details</p>
                      <h3 className="font-display text-xl font-bold truncate">{selectedPublicLobby.host}'s Match</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                        <span>{selectedPublicLobby.game}</span><span>•</span>
                        <Hash className="h-3 w-3 inline" /> {selectedPublicLobby.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-display text-2xl font-bold text-arena-gold">${selectedPublicLobby.betAmount}</span>
                    <button onClick={() => setSelectedPublicLobbyId(null)}
                      className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors font-display">
                      Close
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { label: "Team A", players: teamA, accent: "primary", border: "border-primary/20", bg: "bg-primary/5", text: "text-primary" },
                    { label: "Team B", players: teamB, accent: "arena-orange", border: "border-arena-orange/20", bg: "bg-arena-orange/5", text: "text-arena-orange" },
                  ].map(({ label, players, border, bg, text }) => (
                    <div key={label} className={`rounded-xl border ${border} ${bg} p-3`}>
                      <p className={`text-xs ${text} font-display uppercase tracking-wider mb-2 flex items-center gap-1`}>
                        <Shield className="h-3 w-3" /> {label} ({players.length}/{maxPerTeam})
                      </p>
                      <div className="space-y-0.5">
                        {players.map((p, i) => <PlayerRow key={`${p}-${i}`} name={p} isHost={label === "Team A"} index={i} />)}
                        {Array.from({ length: maxPerTeam - players.length }).map((_, i) => (
                          <p key={i} className="text-sm text-muted-foreground/30 italic pl-5">Empty slot</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border">
                  <p className="text-xs text-muted-foreground">{selectedPublicLobby.players.length}/{selectedPublicLobby.maxPlayers} players in lobby</p>
                  <Button
                    disabled={selectedPublicLobby.status !== "waiting" || selectedPublicLobby.players.length >= selectedPublicLobby.maxPlayers}
                    onClick={() => { setSelectedPublicLobbyId(null); handleJoinPublic(selectedPublicLobby.id, selectedPublicLobby.betAmount); }}
                    className="font-display"
                    style={cfg ? { boxShadow: `0 0 16px ${cfg.color}40` } : {}}>
                    <Swords className="mr-1.5 h-4 w-4" /> Join This Lobby
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── IN-ROOM PANEL ───────────────────────────────────────────── */}
      {myActiveRoom && (
        <div className={cn(
          "rounded-2xl border p-4 mb-4 transition-all",
          countdown !== null && countdown <= 3
            ? "border-destructive/60 bg-destructive/10 animate-pulse"
            : countdown !== null
              ? "border-arena-gold/60 bg-arena-gold/10"
              : "border-primary/40 bg-primary/5"
        )}>
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                countdown !== null ? "bg-arena-gold" : "bg-primary"
              )} />
              <span className="text-xs font-display font-bold uppercase tracking-widest text-foreground">
                {countdown !== null ? "Room Filling — Leave Window" : "You're In The Room"}
              </span>
            </div>

            {/* Countdown or status badge */}
            {countdown !== null ? (
              <div className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold font-mono",
                countdown <= 3
                  ? "bg-destructive/20 text-destructive border border-destructive/40"
                  : "bg-arena-gold/20 text-arena-gold border border-arena-gold/40"
              )}>
                <Timer className="w-3 h-3" />
                {countdown}s to lock
              </div>
            ) : (
              <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded-full border border-border/40 bg-secondary/40">
                Waiting for players
              </span>
            )}
          </div>

          {/* Match info */}
          <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
            <span className="font-mono text-foreground font-semibold">{myActiveRoom.game}</span>
            <span>·</span>
            <span>{myActiveRoom.mode}</span>
            <span>·</span>
            <span className="text-arena-gold font-bold">${myActiveRoom.betAmount} stake</span>
            {myActiveRoom.code && (
              <>
                <span>·</span>
                <span className="font-mono text-primary">{myActiveRoom.code}</span>
              </>
            )}
          </div>

          {/* Player slots progress */}
          <div className="mb-3">
            {myActiveRoom.type === "custom" ? (
              <div className="grid grid-cols-2 gap-2">
                {/* Team A */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Team A</p>
                  <div className="space-y-1">
                    {Array.from({ length: myActiveRoom.maxPerTeam ?? myActiveRoom.teamSize ?? 5 }).map((_, i) => {
                      const player = (myActiveRoom.teamA ?? [])[i];
                      return (
                        <div key={i} className={cn(
                          "h-6 rounded flex items-center px-2 text-[10px]",
                          player ? "bg-primary/15 border border-primary/30 text-foreground" : "bg-secondary/30 border border-border/30 text-muted-foreground/40"
                        )}>
                          {player ?? `Slot ${i + 1}`}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Team B */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Team B</p>
                  <div className="space-y-1">
                    {Array.from({ length: myActiveRoom.maxPerTeam ?? myActiveRoom.teamSize ?? 5 }).map((_, i) => {
                      const player = (myActiveRoom.teamB ?? [])[i];
                      return (
                        <div key={i} className={cn(
                          "h-6 rounded flex items-center px-2 text-[10px]",
                          player ? "bg-arena-purple/15 border border-arena-purple/30 text-foreground" : "bg-secondary/30 border border-border/30 text-muted-foreground/40"
                        )}>
                          {player ?? `Slot ${i + 1}`}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Public match — simple progress bar */
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Players</span>
                  <span className="font-mono">{myActiveRoom.players.length} / {myActiveRoom.maxPlayers}</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${(myActiveRoom.players.length / myActiveRoom.maxPlayers) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action row */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className={cn(
                "text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/70",
                countdown !== null && countdown <= 3 && "animate-pulse"
              )}
              onClick={handleLeaveRoom}
            >
              <LogOut className="mr-1.5 h-3 w-3" />
              Leave Room
            </Button>

            {countdown !== null && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-arena-gold" />
                {countdown > 0
                  ? `${countdown}s left to leave — funds lock when timer hits 0`
                  : "Locking funds…"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <Tabs defaultValue="public" className="w-full">
        <TabsList className="bg-secondary border border-border w-full sm:w-auto">
          <TabsTrigger value="public" className="font-display data-[state=active]:bg-primary/20 data-[state=active]:text-primary flex-1 sm:flex-none gap-2">
            <Swords className="h-4 w-4" /> Public Matches
          </TabsTrigger>
          <TabsTrigger value="custom" className="font-display data-[state=active]:bg-arena-purple/20 data-[state=active]:text-arena-purple flex-1 sm:flex-none gap-2">
            <Users className="h-4 w-4" /> Custom Matches
          </TabsTrigger>
        </TabsList>

        {/* ═══════════ PUBLIC ═══════════ */}
        <TabsContent value="public" className="space-y-4 mt-4">

          {/* ── Game + Mode filter bar ── */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] mb-3 flex items-center gap-1.5">
              <span className="w-1 h-3 rounded-full bg-arena-purple inline-block" /> Filter by Game
            </p>
            <div className="flex gap-2 flex-wrap">
              {/* All games button */}
              <button
                onClick={() => { setFilterGame(""); setFilterMode(null); }}
                className={`px-3 py-1.5 rounded-xl border font-display text-sm transition-all ${
                  !filterGame
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}>
                All
              </button>
              {/* One button per game that has public matches */}
              {uniquePublicGames.map((game) => {
                const cfg = ALL_GAME_CONFIG[game];
                const active = filterGame === game;
                return (
                  <button key={game}
                    onClick={() => { setFilterGame(active ? "" : game); setFilterMode(null); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border font-display text-sm transition-all ${
                      active
                        ? "border-primary text-foreground"
                        : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                    style={active && cfg ? { borderColor: `${cfg.color}80`, background: `${cfg.color}18`, color: cfg.color } : {}}>
                    {cfg
                      ? <img src={cfg.logo} alt={game} className="w-5 h-5 rounded object-cover shrink-0"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                      : <Gamepad2 className="w-5 h-5 shrink-0" />}
                    <span className="hidden sm:inline">{game}</span>
                  </button>
                );
              })}
            </div>

            {/* Mode sub-filter — only when the selected game has defined modes */}
            {filterGame && GAME_MODES[filterGame as Game] && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] mb-2 flex items-center gap-1.5">
                  <span className="w-1 h-3 rounded-full bg-arena-cyan inline-block" /> Format
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setFilterMode(null)}
                    className={`px-3 py-1 rounded-lg border font-display text-xs transition-all ${
                      !filterMode
                        ? "border-arena-cyan bg-arena-cyan/10 text-arena-cyan"
                        : "border-border bg-secondary/40 text-muted-foreground hover:border-arena-cyan/40"
                    }`}>
                    All Formats
                  </button>
                  {GAME_MODES[filterGame as Game].map((opt) => (
                    <button key={opt.mode}
                      onClick={() => setFilterMode(filterMode === opt.mode ? null : opt.mode)}
                      className={`px-3 py-1 rounded-lg border font-display text-xs font-bold transition-all ${
                        filterMode === opt.mode
                          ? "border-arena-cyan bg-arena-cyan/10 text-arena-cyan"
                          : "border-border bg-secondary/40 text-muted-foreground hover:border-arena-cyan/40"
                      }`}>
                      {opt.mode}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bet selector */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] mb-3 flex items-center gap-1.5">
              <span className="w-1 h-3 rounded-full bg-arena-gold inline-block" /> Select Bet Amount
            </p>
            <div className="flex gap-2 flex-wrap">
              {BET_AMOUNTS.map((amount) => {
                const matchCount = publicMatches.filter(m => m.status === "waiting" && m.betAmount === amount).length;
                return (
                  <button key={amount} disabled={depositConfirm !== null}
                    onClick={() => setSelectedBet(selectedBet === amount ? null : amount)}
                    className={`relative px-5 py-2 rounded-xl border font-display text-base font-bold transition-all ${
                      selectedBet === amount
                        ? "border-primary bg-primary/15 text-primary shadow-[0_0_18px_rgba(var(--primary-rgb),0.4)]"
                        : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}>
                    ${amount}
                    {matchCount > 0 && (
                      <span className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                        selectedBet === amount ? "bg-primary text-primary-foreground" : "bg-arena-gold text-black"
                      }`}>{matchCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedBet && (
              <p className="text-xs text-primary mt-2.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                ${selectedBet} selected — showing {filteredPublicMatches.length} matching {filteredPublicMatches.length === 1 ? "lobby" : "lobbies"}
              </p>
            )}
          </div>

          {/* Match list */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-arena-purple" />
                <span className="font-display text-sm font-semibold uppercase tracking-wider">Available Matches</span>
              </div>
              <span className="text-xs text-muted-foreground">{filteredPublicMatches.length} lobbies</span>
            </div>
            <div className="divide-y divide-border/40">
              {filteredPublicMatches.map((match) => {
                const status = statusConfig[match.status];
                const StatusIcon = status.icon;
                const isLive = match.status === "in_progress";
                const canJoin = match.status === "waiting" && match.players.length < match.maxPlayers;
                const cfg = ALL_GAME_CONFIG[match.game];
                // Smart dimming: when a bet is selected, grey out non-matching matches
                const dimmed = selectedBet !== null && match.betAmount !== selectedBet;
                const glowing = selectedBet !== null && match.betAmount === selectedBet && canJoin;

                return (
                  <div key={match.id}
                    className={`relative flex items-center justify-between px-4 py-3.5 cursor-pointer transition-all ${
                      dimmed ? "opacity-35 grayscale pointer-events-none" : "hover:bg-secondary/30"
                    }`}
                    style={{
                      borderLeft: `3px solid ${cfg?.color ?? "#555"}`,
                      ...(glowing ? { boxShadow: `inset 0 0 30px ${cfg?.color ?? "#888"}08` } : {}),
                    }}
                    onClick={() => !dimmed && handleOpenPublicLobby(match.id)}>
                    {isLive && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-arena-cyan/50 to-transparent" />}
                    {dimmed && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex items-center gap-3 min-w-0">
                      <GameLogo game={match.game} size={32} />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{match.host}'s Match</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {/* Mini avatar stack */}
                          <AvatarStack players={match.players} max={5} />
                          <span className="text-xs text-muted-foreground">{match.players.length}/{match.maxPlayers}</span>
                          {match.timeLeft && (
                            <span className="text-xs text-arena-cyan flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />{match.timeLeft}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge className={`${status.color} border text-xs gap-1`}>
                        <StatusIcon className="h-3 w-3" />{status.label}
                      </Badge>
                      <span className="font-display text-base font-bold text-arena-gold">${match.betAmount}</span>
                      {canJoin ? (
                        <Button size="sm" disabled={depositConfirm !== null}
                          onClick={(e) => { e.stopPropagation(); handleJoinPublic(match.id, match.betAmount); }}
                          className="font-display text-xs"
                          style={glowing && cfg ? { boxShadow: `0 0 12px ${cfg.color}60` } : {}}>
                          <Swords className="mr-1 h-3 w-3" /> Join
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled className="font-display text-xs">
                          {match.status === "completed" ? "Ended" : match.status === "in_progress" ? "Live" : "Full"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredPublicMatches.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {selectedBet ? `No open lobbies for $${selectedBet}.` : "No matches available."}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══════════ CUSTOM ═══════════ */}
        <TabsContent value="custom" className="space-y-4 mt-4">
          {/* Join / Create */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] flex items-center gap-1.5">
              <span className="w-1 h-3 rounded-full bg-arena-cyan inline-block" /> Join or Create
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider">Join by Game ID</label>
              <div className="flex gap-2">
                <Input placeholder="Enter match code (e.g. ARENA-7X2K)" value={customCode}
                  onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                  className="font-mono bg-secondary border-border placeholder:text-muted-foreground/40" />
                <Button disabled={!customCode}
                  onClick={() => { const found = customMatches.find(m => m.code === customCode); if (found) handleJoinCustom(found.id, found.betAmount); }}
                  className="font-display shrink-0">
                  <Search className="mr-2 h-4 w-4" /> Find
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground uppercase tracking-widest">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {!createMode ? (
              <button onClick={() => setCreateMode(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-arena-purple/30 text-arena-purple hover:bg-arena-purple/10 transition-colors font-display text-sm font-semibold">
                <Crown className="h-4 w-4" /> Create Custom Match
              </button>
            ) : (
              <div className="space-y-4 p-4 rounded-xl border border-arena-purple/30 bg-arena-purple/5">
                <h4 className="font-display font-semibold flex items-center gap-2 text-sm">
                  <Crown className="h-4 w-4 text-arena-purple" /> New Custom Match
                </h4>
                {/* Game selection */}
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">Select Game</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {newMatchGame && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary border border-border text-xs font-medium">
                        <GameLogo game={newMatchGame} size={16} />
                        {newMatchGame}
                        <button onClick={() => setNewMatchGame("")} className="ml-1 text-muted-foreground hover:text-foreground">✕</button>
                      </div>
                    )}
                    <GameDropdown label="PC Games" icon={Monitor} games={PC_GAME_CONFIG}
                      activeGame={newMatchGame} onSelect={(g) => {
                        setNewMatchGame(g as Game);
                        setNewMatchMode(getDefaultMode(g as Game).mode);
                      }} />
                    <GameDropdown label="Mobile" icon={Smartphone} games={MOBILE_GAME_CONFIG}
                      activeGame={newMatchGame} onSelect={(g) => setNewMatchGame(g as Game)} comingSoon />
                  </div>
                </div>
                {/* Mode selection — available modes depend on selected game */}
                {newMatchGame && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">Match Format</label>
                    <div className="flex gap-2 flex-wrap">
                      {GAME_MODES[newMatchGame as Game].map((opt) => (
                        <button key={opt.mode} onClick={() => setNewMatchMode(opt.mode)}
                          className={`px-4 py-1.5 rounded-xl border font-display text-sm font-bold transition-all ${
                            newMatchMode === opt.mode
                              ? "border-primary bg-primary/15 text-primary shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
                              : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}>
                          {opt.mode}
                        </button>
                      ))}
                    </div>
                    {newMatchMode && (
                      <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {getTeamSize(newMatchMode)} players per team · {getTotalPlayers(newMatchMode)} total
                      </p>
                    )}
                  </div>
                )}
                {/* Bet */}
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">Bet Amount</label>
                  <div className="flex gap-2 flex-wrap">
                    {CREATE_BET_AMOUNTS.map((a) => (
                      <button key={a} onClick={() => setNewMatchBet(a)}
                        className={`px-4 py-1.5 rounded-xl border font-display text-sm font-bold transition-all ${
                          newMatchBet === a
                            ? "border-primary bg-primary/15 text-primary shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
                            : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}>
                        ${a}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Password */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1 uppercase tracking-wider">
                    <KeyRound className="h-3 w-3" /> Match Password
                  </label>
                  <Input type="text" placeholder="Set a password for your match" value={newMatchPassword}
                    onChange={(e) => setNewMatchPassword(e.target.value)}
                    className="font-mono bg-secondary border-border placeholder:text-muted-foreground/40" maxLength={20} />
                  <p className="text-xs text-muted-foreground mt-1">Share with teammates to join</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    disabled={!newMatchGame || !newMatchBet || !newMatchPassword || !newMatchMode}
                    onClick={() => {
                      if (!newMatchGame || !newMatchBet || !newMatchMode || !user) return;
                      const teamSize  = getTeamSize(newMatchMode);
                      const created   = addMatch({
                        type: "custom", host: user.username, hostId: user.id, game: newMatchGame as Game,
                        mode: newMatchMode, betAmount: newMatchBet, players: [],
                        maxPlayers: getTotalPlayers(newMatchMode), status: "waiting",
                        password: newMatchPassword, teamA: [user.username], teamB: [],
                        maxPerTeam: teamSize, teamSize, depositsReceived: 1,
                      });
                      lockEscrow(newMatchBet, created.id);
                      const { addNotification } = useNotificationStore.getState();
                      addNotification({ type: "match_invite", title: "⚔️ Match Created", message: `Your ${newMatchGame} ${newMatchMode} ($${newMatchBet}) is live! Code: ${created.code}` });
                      setCreateMode(false); setNewMatchPassword(""); setNewMatchGame(""); setNewMatchBet(null); setNewMatchMode(null);
                    }}
                    className="glow-green font-display">
                    <Swords className="mr-2 h-4 w-4" /> Create {newMatchMode ?? ""} Match
                  </Button>
                  <Button variant="outline" onClick={() => { setCreateMode(false); setNewMatchPassword(""); setNewMatchMode(null); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* Game filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setSelectedGame("")}
              className={`px-3 py-1.5 rounded-lg border text-sm font-display transition-all ${
                !selectedGame ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}>
              All Games
            </button>
            <GameDropdown label="PC Games" icon={Monitor} games={PC_GAME_CONFIG}
              activeGame={selectedGame} onSelect={(g) => setSelectedGame(selectedGame === g ? "" : g)} />
            <GameDropdown label="Mobile" icon={Smartphone} games={MOBILE_GAME_CONFIG}
              activeGame={selectedGame} onSelect={(g) => setSelectedGame(selectedGame === g ? "" : g)} comingSoon />
          </div>

          {/* Custom cards */}
          <div className="space-y-3">
            {filteredCustom.map((match) => {
              const status = statusConfig[match.status];
              const StatusIcon = status.icon;
              const isLive = match.status === "in_progress";
              const teamAFull = match.teamA.length >= match.maxPerTeam;
              const teamBFull = match.teamB.length >= match.maxPerTeam;
              const canJoin = match.status === "waiting" && (!teamAFull || !teamBFull);
              const cfg = ALL_GAME_CONFIG[match.game];

              return (
                <div key={match.id} className="rounded-2xl border border-border bg-card overflow-hidden"
                  style={{ borderLeftWidth: "3px", borderLeftColor: cfg?.color ?? "#555" }}>
                  {isLive && <div className="h-0.5 w-full bg-gradient-to-r from-arena-cyan via-primary to-arena-purple animate-pulse" />}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <GameLogo game={match.game} size={32} />
                        <div>
                          <p className="font-medium text-sm flex items-center gap-1.5">
                            <Crown className="h-3.5 w-3.5 text-arena-gold" />
                            {match.host}'s {match.mode}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                            <span>{match.game}</span><span>·</span>
                            <KeyRound className="h-3 w-3" /> Protected
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`${status.color} border text-xs gap-1`}>
                          <StatusIcon className="h-3 w-3" />{status.label}
                        </Badge>
                        <button onClick={() => handleCopyCode(match.code)}
                          className="flex items-center gap-1 text-xs font-mono bg-secondary px-2 py-1 rounded-lg border border-border hover:border-primary/50 transition-colors">
                          <Copy className="h-3 w-3" />
                          {copiedCode === match.code ? "Copied!" : match.code}
                        </button>
                        <span className="font-display text-base font-bold text-arena-gold">${match.betAmount}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Team A", players: match.teamA, full: teamAFull, border: "border-primary/20", bg: "bg-primary/5", text: "text-primary", joinBorder: "border-primary/30", joinText: "text-primary", joinHover: "hover:bg-primary/10", isA: true },
                        { label: "Team B", players: match.teamB, full: teamBFull, border: "border-arena-orange/20", bg: "bg-arena-orange/5", text: "text-arena-orange", joinBorder: "border-arena-orange/30", joinText: "text-arena-orange", joinHover: "hover:bg-arena-orange/10", isA: false },
                      ].map(({ label, players, full, border, bg, text, joinBorder, joinText, joinHover, isA }) => (
                        <div key={label} className={`rounded-xl border ${border} ${bg} p-3`}>
                          <p className={`text-xs ${text} font-display uppercase tracking-wider mb-2 flex items-center gap-1`}>
                            <Shield className="h-3 w-3" /> {label} ({players.length}/{match.maxPerTeam})
                          </p>
                          <div className="space-y-0.5">
                            {players.map((p, i) => <PlayerRow key={i} name={p} isHost={isA} index={i} />)}
                            {Array.from({ length: match.maxPerTeam - players.length }).map((_, i) => (
                              <p key={i} className="text-sm text-muted-foreground/30 italic pl-5">Empty slot</p>
                            ))}
                          </div>
                          {canJoin && !full && (
                            <button onClick={() => handleJoinCustom(match.id, match.betAmount, isA ? "A" : "B")}
                              className={`mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-lg border ${joinBorder} ${joinText} ${joinHover} transition-colors text-xs font-display`}>
                              <UserPlus className="h-3 w-3" /> Join {label}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredCustom.length === 0 && (
              <div className="rounded-2xl border border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
                No custom matches found{selectedGame ? ` for ${selectedGame}` : ""}.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MatchLobby;
