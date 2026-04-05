import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { consumeLastLockEscrowFailureMessage, useWalletStore } from "@/stores/walletStore";
import { useMatchPolling } from "@/hooks/useMatchPolling";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Swords, Clock, Users, Lock, Gamepad2, CheckCircle,
  Search, Copy, UserPlus, Crown, Shield, Hash, KeyRound, Eye, EyeOff,
  AlertCircle, ChevronDown, Monitor, MonitorPlay, Smartphone, Zap, TrendingUp,
  Wallet, Loader2, ScanLine, LogOut, AlertTriangle, Timer,
  Trash2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MatchRosterAvatar } from "@/components/match/MatchRosterAvatar";
import type { MatchStatus, Game, Match, MatchMode, StakeCurrency } from "@/types";
import { useClientStore }  from "@/stores/clientStore";
import { GAME_MODES, getDefaultMode, getTeamSize, getTotalPlayers, isGameActive } from "@/config/gameModes";
import { PlayerPopoverLayer } from "@/components/players/PlayerCardPopover";
import { ClientReadinessStrip } from "@/components/match/ClientReadinessStrip";
import {
  apiCreateMatch,
  apiJoinMatch,
  apiGetActiveMatch,
  apiCancelMatch,
  apiLeaveMatch,
  apiInviteToMatch,
  apiListFriends,
  mapApiMatchRowToMatch,
  type ApiFriendRow,
} from "@/lib/engine-api";
import { looksLikeServerMatchId } from "@/lib/gameAccounts";
import { friendlyChainErrorMessage } from "@/lib/friendlyChainError";
import { createMatchOnChain, getBnbBalance } from "@/lib/metamaskBsc";

// ─── Game configs ─────────────────────────────────────────────────────────────
// comingSoon: true → game visible in dropdowns but non-selectable (greyed, locked)
// DB-ready: driven by games.enabled in DB when Arena Client adds support
const PC_GAME_CONFIG: Record<string, { logo: string; color: string; comingSoon?: boolean }> = {
  "CS2":          { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg",     color: "#F97316" },
  "Valorant":     { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg", color: "#FF4655" },
  "Fortnite":     { logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120", color: "#38BDF8", comingSoon: true },
  "Apex Legends": { logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg", color: "#FC4B08", comingSoon: true },
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
const AT_BET_AMOUNTS = [500, 1000, 2500, 5000];

function matchStakeCurrency(m: Pick<Match, "stakeCurrency">): StakeCurrency {
  return m.stakeCurrency ?? "CRYPTO";
}

/** List row / badges: "$10" or "1,000 AT" */
function formatMatchStakeShort(m: Pick<Match, "betAmount" | "stakeCurrency">): string {
  return matchStakeCurrency(m) === "AT" ? `${m.betAmount.toLocaleString()} AT` : `$${m.betAmount}`;
}

const statusConfig: Record<MatchStatus, { label: string; color: string; icon: React.ElementType }> = {
  waiting:     { label: "Waiting",   color: "bg-arena-gold/15 text-arena-gold border-arena-gold/30",       icon: Clock },
  in_progress: { label: "Live",      color: "bg-arena-cyan/15 text-arena-cyan border-arena-cyan/30",       icon: Zap },
  completed:   { label: "Completed", color: "bg-muted text-muted-foreground border-border",                icon: CheckCircle },
  cancelled:   { label: "Cancelled", color: "bg-destructive/15 text-destructive border-destructive/30",    icon: CheckCircle },
  disputed:    { label: "Disputed",  color: "bg-arena-orange/15 text-arena-orange border-arena-orange/30", icon: AlertCircle },
};

// ─── AvatarStack — player pile shown inline on match rows ─────────────────────
const AvatarStack = ({ players, max = 5 }: { players: string[]; max?: number }) => {
  const shown = players.slice(0, max);
  const extra = players.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -5, zIndex: shown.length - i }}>
          <MatchRosterAvatar slotValue={p} size={16} highlightSelf={false} className="border-2 border-card" />
        </div>
      ))}
      {extra > 0 && (
        <div className="w-4 h-4 rounded-full bg-secondary border-2 border-card flex items-center justify-center text-[8px] text-muted-foreground font-bold"
          style={{ marginLeft: -5 }}>
          +{extra}
        </div>
      )}
    </div>
  );
};

// ─── PlayerRow ────────────────────────────────────────────────────────────────
// onPlayerClick: optional — when provided the row becomes a button that opens the player popover
const PlayerRow = ({
  name, isHost, index,
  onPlayerClick,
}: {
  name: string;
  isHost?: boolean;
  index: number;
  onPlayerClick?: (name: string, rect: DOMRect) => void;
}) => {
  const inner = (
    <>
      {isHost && index === 0 ? <Crown className="h-2.5 w-2.5 text-arena-gold shrink-0" /> : <div className="w-2.5 h-2.5 shrink-0" />}
      <MatchRosterAvatar slotValue={name} size={14} highlightSelf={false} className="border-2 border-card" />
      <span className="text-xs truncate">{name}</span>
    </>
  );
  if (onPlayerClick) {
    return (
      <button
        className="flex items-center gap-1.5 py-0.5 w-full text-left hover:text-primary transition-colors rounded"
        onClick={(e) => onPlayerClick(name, e.currentTarget.getBoundingClientRect())}
      >
        {inner}
      </button>
    );
  }
  return <div className="flex items-center gap-1.5 py-0.5">{inner}</div>;
};

// ─── GameLogo ─────────────────────────────────────────────────────────────────
const GameLogo = ({ game, size = 22 }: { game: string; size?: number }) => {
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
  games: Record<string, { logo: string; color: string; comingSoon?: boolean }>;
  activeGame: string; onSelect: (g: string) => void; comingSoon?: boolean;
}
const GameDropdown = ({ label, icon: Icon, games, activeGame, onSelect, comingSoon }: GameDropdownProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasActive = !comingSoon && Object.keys(games).some((g) => g === activeGame && !games[g].comingSoon);
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
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[190px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          {comingSoon
            ? <div className="px-4 py-3 text-xs text-muted-foreground text-center">Coming soon</div>
            : Object.entries(games).map(([name, cfg]) => {
              const isCS = cfg.comingSoon;
              return isCS ? (
                // ── Coming Soon game row — visible but non-selectable ──────────
                <div
                  key={name}
                  title="Coming soon: Arena Client support and engine calibration for this title."
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm cursor-not-allowed opacity-50"
                >
                  <img src={cfg.logo} alt={name} className="w-6 h-6 rounded object-cover shrink-0 grayscale"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  <span className="font-medium truncate text-muted-foreground">{name}</span>
                  <span className="ml-auto text-[9px] font-display font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground/70 tracking-wide shrink-0">SOON</span>
                </div>
              ) : (
                <button key={name} onClick={() => { onSelect(name); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary/60 transition-colors text-left ${activeGame === name ? "bg-primary/10 text-primary" : "text-foreground"}`}>
                  <img src={cfg.logo} alt={name} className="w-6 h-6 rounded object-cover shrink-0"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  <span className="font-medium truncate">{name}</span>
                  {activeGame === name && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                </button>
              );
            })}
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
              <span className="text-arena-gold font-bold">{formatMatchStakeShort(m)}</span>
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
  const { user, token, connectWallet: syncProfileWalletConnected } = useUserStore();
  const websiteUserId = user?.id;
  const {
    matches,
    addMatch,
    joinMatch,
    leaveMatch,
    updateMatchStatus,
    getMatchByCode,
    deleteMatch,
    expireOldMatches,
    refreshMatchesFromServer,
    activeRoomId:    myRoomMatchId,
    setActiveRoomId: setMyRoomMatchId,
  } = useMatchStore();
  const { lockEscrow, cancelEscrow, connectedAddress, connectWallet: linkMetaMaskForMatch } = useWalletStore();
  const canPlay      = useClientStore((s) => s.canPlayForUser(websiteUserId));
  /** CRYPTO matches need MetaMask; AT stakes use server AT balance (still need client for play). */
  const canPlayStaked = canPlay && !!connectedAddress;
  const stakedActionTitle =
    !connectedAddress ? "Connect Wallet (MetaMask, BSC Testnet)" : !canPlay ? "Arena Client not connected" : undefined;
  const canJoinAtStake = canPlay;
  const clientStatus = useClientStore((s) => s.status);
  const clientVersion = useClientStore((s) => s.version);
  const clientStatusLabel = useClientStore((s) => s.statusLabel);
  const markInMatch  = useClientStore((s) => s.markInMatch);
  const markIdle     = useClientStore((s) => s.markIdle);
  useMatchPolling({ interval: 5000 });

  useEffect(() => {
    void refreshMatchesFromServer(token ?? null);
  }, [token, refreshMatchesFromServer]);

  // ── Lobby persistence: restore active room on mount / login ────────────────
  useEffect(() => {
    if (!token || myRoomMatchId) return;
    apiGetActiveMatch(token).then((res) => {
      if (!res?.match?.match_id) return;
      const m = res.match;
      // Convert the API response to a full Match object and inject into the
      // Zustand store so that `myActiveRoom = matches.find(m.id)` resolves
      // correctly after navigation (BUG 1 fix).
      const matchObj = mapApiMatchRowToMatch({
        id:             m.match_id,
        match_id:       m.match_id,
        game:           m.game,
        status:         m.status,
        bet_amount:     m.bet_amount,
        stake_currency: m.stake_currency,
        type:           m.type,
        code:           m.code,
        created_at:     m.created_at,
        mode:           m.mode,
        host_id:        m.host_id,
        host_username:  m.host_username,
        max_players:    m.max_players,
        max_per_team:   m.max_per_team,
        // players array contains full player objects — extract for match_players
        match_players:  m.players,
      });
      if (matchObj) {
        // addMatch is idempotent: won't duplicate if already in store
        useMatchStore.getState().addMatch(matchObj);
      }
      setMyRoomMatchId(m.match_id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const [selectedBet, setSelectedBet] = useState<number | null>(null);
  const [customCode, setCustomCode] = useState("");
  const [selectedGame, setSelectedGame] = useState<string>("");
  const [createMode, setCreateMode] = useState(false);
  const [newMatchBet, setNewMatchBet] = useState<number | null>(null);
  const [createStakeCurrency, setCreateStakeCurrency] = useState<StakeCurrency>("CRYPTO");
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
  const [depositStep, setDepositStep]         = useState<"idle" | "verifying" | "confirmed" | "failed">("idle");
  const [checkResults, setCheckResults]       = useState<{
    client: boolean;
    wallet: boolean;
    identity: boolean;
    balance: boolean;
    balanceDetail: string;
  } | null>(null);
  // myRoomMatchId / setMyRoomMatchId now come from Zustand (see useMatchStore destructure above).
  // Using Zustand means the active-room ID survives React navigation (useState would reset on unmount).
  const [roomLocked, setRoomLocked]       = useState(false);
  const [countdown, setCountdown]         = useState<number | null>(null);
  const [leaveConfirmOpen,      setLeaveConfirmOpen]      = useState(false);
  const [deleteRoomConfirmOpen, setDeleteRoomConfirmOpen] = useState(false);
  const [playerPopover,         setPlayerPopover]         = useState<{ slotValue: string; rect: DOMRect } | null>(null);
  const [walletLinkBusy, setWalletLinkBusy]               = useState(false);
  const [inviteModalOpen,      setInviteModalOpen]      = useState(false);
  const [inviteFriends,        setInviteFriends]        = useState<ApiFriendRow[]>([]);
  const [inviteFriendsLoading, setInviteFriendsLoading] = useState(false);
  const [invitingFriendId,     setInvitingFriendId]     = useState<string | null>(null);
  const [invitedFriendIds,     setInvitedFriendIds]     = useState<Set<string>>(new Set());

  const publicMatches = matches.filter(m => m.type === "public" && (m.status === "waiting" || m.status === "in_progress"));
  const customMatches = matches.filter(m => m.type === "custom" && (m.status === "waiting" || m.status === "in_progress"));
  const selectedPublicLobby = selectedPublicLobbyId
    ? publicMatches.find(m => m.id === selectedPublicLobbyId) ?? null : null;

  const getPublicLobbyTeams = (match: Match) => {
    const maxPerTeam = Math.max(1, Math.ceil(match.maxPlayers / 2));
    return { maxPerTeam, teamA: match.players.slice(0, maxPerTeam), teamB: match.players.slice(maxPerTeam, maxPerTeam * 2) };
  };

  /** MetaMask on BSC Testnet — required for create/join (Issue #23). */
  const guardWalletConnected = useCallback((): boolean => {
    if (useWalletStore.getState().connectedAddress) return true;
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Connect Wallet",
      message: "Connect MetaMask on BNB Smart Chain Testnet before creating or joining a match.",
    });
    return false;
  }, []);

  /** Same rules as Join buttons — blocks programmatic / race paths until client is ready AND bound to this user. */
  const guardCanPlay = useCallback((): boolean => {
    if (useClientStore.getState().canPlayForUser(websiteUserId)) return true;
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Arena Client required",
      message:
        clientStatus === "connected"
          ? "Wait until the desktop client finishes starting, then try again."
          : "Download and run the Arena desktop client before joining a match.",
    });
    return false;
  }, [clientStatus, websiteUserId]);

  const handleJoinPublic = (matchId: string, betAmount?: number) => {
    if (!user) return;
    if (!guardNotInRoom()) return;
    const bet = betAmount ?? selectedBet;
    if (!bet) return;
    setSelectedBet(bet);
    const match = publicMatches.find(m => m.id === matchId);
    if (!match) return;
    if (matchStakeCurrency(match) !== "AT" && !guardWalletConnected()) return;
    if (!guardCanPlay()) return;
    // No team for public matches — deposit modal handles both public and custom
    setDepositConfirm({ match });
    setDepositStep("idle");
    setCheckResults(null);
  };
  const handleOpenPublicLobby = (matchId: string) => setSelectedPublicLobbyId(matchId);
  const handleJoinCustom = (matchId: string, bet: number, team?: "A" | "B") => {
    if (!guardNotInRoom()) return;
    const m = customMatches.find((x) => x.id === matchId);
    if (m && matchStakeCurrency(m) !== "AT" && !guardWalletConnected()) return;
    if (!guardCanPlay()) return;
    setPasswordPrompt({ matchId, bet, team }); setPasswordInput(""); setPasswordError(false); setShowPassword(false);
  };
  const handlePasswordSubmit = () => {
    if (!passwordPrompt) return;
    const match = customMatches.find(m => m.id === passwordPrompt.matchId);
    if (match && passwordInput === match.password) {
      if (matchStakeCurrency(match) !== "AT" && !guardWalletConnected()) return;
      if (!guardCanPlay()) return;
      setPasswordPrompt(null); setPasswordInput("");
      setDepositConfirm({ match, team: passwordPrompt.team });
      setDepositStep("idle");
      setCheckResults(null);
    } else { setPasswordError(true); }
  };
  const handleDepositConfirm = async () => {
    if (!depositConfirm || !user) return;
    const { match } = depositConfirm;
    if (matchStakeCurrency(match) !== "AT" && !guardWalletConnected()) return;
    if (!guardCanPlay()) return;
    setDepositStep("verifying");
    setCheckResults(null);

    // 1. Arena Client — same gate as Join (desktop client + version_ok + user binding).
    const clientOk = useClientStore.getState().canPlayForUser(websiteUserId);

    // 2. Wallet — MetaMask for CRYPTO; AT stakes skip (balance checked in step 4).
    const walletAddr = useWalletStore.getState().connectedAddress;
    const walletOk = matchStakeCurrency(match) === "AT" ? true : !!walletAddr;

    // 3. Identity — game account on profile (matches create/join API gates).
    const isCs2 = match.game === "CS2";
    const identityOk = isCs2
      ? !!user.steamId
      : match.game === "Valorant"
        ? !!user.riotId
        : !!(user.steamId || user.riotId);

    // 4. Balance — AT (DB) or native BNB on chain ≥ stake
    let balanceOk = false;
    let balanceDetail = "–";
    if (matchStakeCurrency(match) === "AT") {
      const atBal = user.atBalance ?? 0;
      balanceOk = atBal >= match.betAmount;
      balanceDetail = `${atBal.toLocaleString()} AT (need ≥${match.betAmount.toLocaleString()})`;
    } else if (walletAddr) {
      try {
        const bnb = await getBnbBalance(walletAddr);
        balanceOk = bnb >= match.betAmount;
        balanceDetail = `${bnb.toFixed(4)} BNB (need ≥${match.betAmount})`;
      } catch {
        balanceOk = false;
        balanceDetail = "Error reading balance";
      }
    }

    setCheckResults({
      client: clientOk,
      wallet: walletOk,
      identity: identityOk,
      balance: balanceOk,
      balanceDetail,
    });

    const allPassed = clientOk && walletOk && identityOk && balanceOk;
    setDepositStep(allPassed ? "confirmed" : "failed");
  };
  const handleDepositFinal = async () => {
    if (!depositConfirm || !user) return;
    const { match, team } = depositConfirm;
    if (matchStakeCurrency(match) !== "AT" && !guardWalletConnected()) return;
    if (!guardCanPlay()) return;
    if (token && looksLikeServerMatchId(match.id)) {
      const jr = await apiJoinMatch(token, match.id);
      if (jr.ok === false) {
        // 409 = already in another room → restore it
        if (jr.status === 409 && token) {
          const active = await apiGetActiveMatch(token);
          if (active?.match?.match_id) setMyRoomMatchId(active.match.match_id);
        }
        useNotificationStore.getState().addNotification({
          type: "system",
          title: "Could not join match",
          message: jr.detail ?? "The server rejected your join request.",
        });
        setDepositConfirm(null);
        setDepositStep("idle");
        setCheckResults(null);
        return;
      }
    }
    if (matchStakeCurrency(match) === "AT") {
      joinMatch(match.id, user.username, team);
      setMyRoomMatchId(match.id);
      setRoomLocked(false);
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "🔒 Stake confirmed",
        message: `${match.betAmount.toLocaleString()} AT locked for ${match.game} ${match.mode}. Waiting for all players.`,
      });
      setDepositConfirm(null);
      setDepositStep("idle");
      setCheckResults(null);
      return;
    }
    const escrowTx = await lockEscrow(match.betAmount, match.id);
    if (!escrowTx) {
      const escrowHint = consumeLastLockEscrowFailureMessage();
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Escrow deposit failed",
        message:
          escrowHint ??
          "Could not complete the deposit. Check BNB balance, that the match exists on-chain, and approve the transaction in your wallet.",
      });
      setDepositConfirm(null);
      setDepositStep("idle");
      setCheckResults(null);
      return;
    }
    joinMatch(match.id, user.username, team);
    setMyRoomMatchId(match.id);
    setRoomLocked(false);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "🔒 Deposit Confirmed",
      message: `${match.betAmount} BNB locked in escrow for ${match.game} ${match.mode}. Waiting for all players.`,
    });
    setDepositConfirm(null);
    setDepositStep("idle");
    setCheckResults(null);
  };
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code); setCopiedCode(code);
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "system", title: "📋 Code Copied", message: `Match code ${code} copied. Share with your team!` });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredCustom = customMatches.filter(m => !selectedGame || m.game === selectedGame);
  const filteredPublicMatches = publicMatches.filter(m => {
    if (selectedBet !== null) {
      if (matchStakeCurrency(m) === "AT") return false;
      if (m.betAmount !== selectedBet) return false;
    }
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

  /** True whenever the player is in an active room (waiting OR in_progress). */
  const isInActiveRoom = !!myActiveRoom || roomLocked;

  /** Blocks join/create when already in a room — covers both waiting and in_progress. */
  const guardNotInRoom = useCallback((): boolean => {
    if (!isInActiveRoom) return true;
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Already in a room",
      message: "Leave or finish your current match before joining or creating another.",
    });
    return false;
  }, [isInActiveRoom]);

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
        markInMatch(myActiveRoom.id);
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
    if (!myActiveRoom || !myRoomMatchId) return;
    if (myActiveRoom.status === "in_progress") {
      setMyRoomMatchId(null);
      setRoomLocked(true);
    } else if (myActiveRoom.status === "completed") {
      // DB-ready: Vision Engine called declareWinner → funds released by contract
      markIdle();
      setMyRoomMatchId(null);
      setRoomLocked(false);
    } else if (myActiveRoom.status === "cancelled") {
      markIdle();
      cancelEscrow(myActiveRoom.id);
      setMyRoomMatchId(null);
      setRoomLocked(false);
    }
  }, [myActiveRoom?.status]);

  // DB-ready: server CRON replaces this — client polls as fallback
  // Contract: ArenaEscrow.claimRefund() available after 2h on-chain timeout
  useEffect(() => {
    const poll = () => {
      const expiredIds = expireOldMatches();
      if (myRoomMatchId && expiredIds.includes(myRoomMatchId)) {
        cancelEscrow(myRoomMatchId);
        setMyRoomMatchId(null);
        setCountdown(null);
        useNotificationStore.getState().addNotification({
          type: "system",
          title: "⏰ Room Expired",
          message: "Your match room expired after 30 minutes. Deposit refunded.",
        });
      }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [myRoomMatchId]);

  const handleLeaveRoom = useCallback(() => {
    if (!myActiveRoom || !user) return;
    const matchId    = myActiveRoom.id;
    const stakeLabel = formatMatchStakeShort(myActiveRoom);
    // Optimistic: clear local state immediately
    // Must pass user.id (UUID) — teamA/players arrays contain IDs, not usernames
    leaveMatch(matchId, user.id);
    cancelEscrow(matchId);
    setMyRoomMatchId(null);
    setCountdown(null);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "↩️ Left Room",
      message: `You left the match room. Your ${stakeLabel} stake has been refunded.`,
    });
    // Sync with server so the room doesn't come back on next page load
    if (token && looksLikeServerMatchId(matchId)) {
      void apiLeaveMatch(token, matchId);
    }
  }, [myActiveRoom, user, token, leaveMatch, cancelEscrow]);

  const handleDeleteRoom = useCallback(() => {
    if (!myActiveRoom || !user) return;
    const matchId    = myActiveRoom.id;
    const stakeLabel = formatMatchStakeShort(myActiveRoom);
    // Optimistic: clear local state immediately so UI feels instant
    cancelEscrow(matchId);
    deleteMatch(matchId);
    setMyRoomMatchId(null);
    setDeleteRoomConfirmOpen(false);
    setCountdown(null);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "🗑️ Room Deleted",
      message: `Match room closed. Your ${stakeLabel} deposit has been refunded.`,
    });
    // Sync with server — marks match cancelled in DB so it never restores on refresh
    if (token && looksLikeServerMatchId(matchId)) {
      void apiCancelMatch(token, matchId);
    }
  }, [myActiveRoom, user, token, cancelEscrow, deleteMatch]);

  const handleOpenInviteModal = useCallback(async () => {
    if (!token) return;
    setInviteModalOpen(true);
    setInvitedFriendIds(new Set());
    setInviteFriendsLoading(true);
    const friends = await apiListFriends(token);
    setInviteFriends(friends ?? []);
    setInviteFriendsLoading(false);
  }, [token]);

  const handleInviteFriend = useCallback(async (friendId: string) => {
    if (!token || !myRoomMatchId) return;
    setInvitingFriendId(friendId);
    const result = await apiInviteToMatch(token, myRoomMatchId, friendId);
    setInvitingFriendId(null);
    if (result.ok) {
      setInvitedFriendIds((prev) => new Set(prev).add(friendId));
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Invite Sent",
        message: "Your friend will see the invite in their notifications.",
      });
    } else {
      const failResult = result as { ok: false; detail: string | null };
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Invite Failed",
        message: failResult.detail ?? "Could not send invite. Try again.",
      });
    }
  }, [token, myRoomMatchId]);

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

      {/* ── Client + engine readiness (health poll, manual refresh, explainer) ── */}
      <ClientReadinessStrip />

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
        const stakeIsAt = matchStakeCurrency(match) === "AT";
        const isVerifying  = depositStep === "verifying";
        const isConfirmed  = depositStep === "confirmed";
        const isFailed     = depositStep === "failed";
        const checks: {
          icon: React.ElementType;
          label: string;
          detail: string;
          ok: boolean | null;
        }[] = [
          {
            icon: MonitorPlay,
            label: "Arena Client",
            detail: `${clientStatusLabel()}${clientVersion ? ` · v${clientVersion}` : ""}`,
            ok: checkResults?.client ?? null,
          },
          {
            icon: Wallet,
            label: stakeIsAt ? "Wallet (optional for AT)" : "Wallet connected",
            detail: stakeIsAt
              ? connectedAddress
                ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`
                : "AT stake uses your Arena balance"
              : connectedAddress
                ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`
                : "Not connected",
            ok: checkResults?.wallet ?? null,
          },
          {
            icon: ScanLine,
            label: `${idp.field} verified`,
            detail: idp.name,
            ok: checkResults?.identity ?? null,
          },
          {
            icon: CheckCircle,
            label: stakeIsAt ? "Sufficient AT for stake" : "Sufficient BNB for stake",
            detail: checkResults?.balanceDetail ?? (stakeIsAt ? `≥ ${match.betAmount.toLocaleString()} AT` : `≥ ${match.betAmount} BNB`),
            ok: checkResults?.balance ?? null,
          },
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
                <div className="rounded-xl border border-border bg-secondary/30 p-3 flex items-center gap-2.5">
                  <GameLogo game={match.game} size={29} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{match.host}'s {match.mode}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {match.game}
                      {team ? ` · Team ${team}` : match.type === "custom" ? " · Any team" : " · Public Match"}
                      {match.code ? ` · ${match.code}` : ` · #${match.id}`}
                    </p>
                  </div>
                  <span className="font-display text-lg font-bold text-arena-gold shrink-0">{formatMatchStakeShort(match)}</span>
                </div>
                {/* Verification checklist */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
                    <span className="w-1 h-3 rounded-full bg-arena-cyan inline-block" /> {stakeIsAt ? "Pre-join checks" : "Contract Verification"}
                  </p>
                  {checks.map(({ icon: Icon, label, detail, ok }) => (
                    <div key={label} className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                      {isVerifying
                        ? <Loader2 className="h-4 w-4 text-arena-cyan animate-spin shrink-0" />
                        : <Icon className="h-4 w-4 text-arena-cyan shrink-0" />}
                      <span className="text-sm flex-1">{label}</span>
                      <span className="text-xs text-muted-foreground font-mono text-right max-w-[55%] truncate" title={detail}>{detail}</span>
                      {!isVerifying && ok === true && (
                        <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      )}
                      {!isVerifying && ok === false && (
                        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      )}
                    </div>
                  ))}
                  {isVerifying && (
                    <p className="text-xs text-arena-cyan flex items-center gap-1.5 pl-1 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-arena-cyan" />
                      Running on-chain pre-checks…
                    </p>
                  )}
                  {isFailed && (
                    <p className="text-xs text-red-400 flex items-center gap-1.5 pl-1">
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                      One or more checks failed. Fix the issue and try again.
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
                      {stakeIsAt ? (
                        <>
                          Pressing <span className="text-foreground font-semibold">Confirm &amp; Lock</span> will lock{" "}
                          <span className="text-arena-gold font-bold">{match.betAmount.toLocaleString()} AT</span> for this match
                          (server-side). This action cannot be undone until the match resolves.
                        </>
                      ) : (
                        <>
                          Pressing <span className="text-foreground font-semibold">Confirm &amp; Lock</span> will open MetaMask
                          and lock <span className="text-arena-gold font-bold">{match.betAmount} BNB</span> (stake) into escrow.
                          This action cannot be undone until the match resolves.
                        </>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Button onClick={() => void handleDepositFinal()} className="flex-1 font-display glow-green">
                        <Lock className="mr-2 h-4 w-4" />{" "}
                        {stakeIsAt
                          ? <>Confirm &amp; Lock {match.betAmount.toLocaleString()} AT</>
                          : <>Confirm &amp; Lock {match.betAmount} BNB</>}
                      </Button>
                      <Button variant="outline" onClick={() => { setDepositConfirm(null); setDepositStep("idle"); setCheckResults(null); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Initial deposit button (hidden once confirmed) ── */}
                {!isConfirmed && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={() => void handleDepositConfirm()}
                      disabled={isVerifying}
                      className="flex-1 font-display glow-green"
                    >
                      {isVerifying
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</>
                        : <><Lock className="mr-2 h-4 w-4" /> Run checks &amp; deposit</>}
                    </Button>
                    {!isVerifying && (
                      <Button variant="outline" onClick={() => { setDepositConfirm(null); setDepositStep("idle"); setCheckResults(null); }}>
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
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <GameLogo game={selectedPublicLobby.game} size={29} />
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.15em]">Lobby Details</p>
                      <h3 className="font-display text-lg font-bold truncate">{selectedPublicLobby.host}'s Match</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                        <span>{selectedPublicLobby.game}</span><span>•</span>
                        <Hash className="h-3 w-3 inline" /> {selectedPublicLobby.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-display text-xl font-bold text-arena-gold">Stakes: {formatMatchStakeShort(selectedPublicLobby)}</span>
                    <button onClick={() => setSelectedPublicLobbyId(null)}
                      className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors font-display">
                      Close
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {[
                    { label: "Team A", players: teamA, accent: "primary", border: "border-primary/20", bg: "bg-primary/5", text: "text-primary" },
                    { label: "Team B", players: teamB, accent: "arena-orange", border: "border-arena-orange/20", bg: "bg-arena-orange/5", text: "text-arena-orange" },
                  ].map(({ label, players, border, bg, text }) => (
                    <div key={label} className={`rounded-xl border ${border} ${bg} p-2.5`}>
                      <p className={`text-xs ${text} font-display uppercase tracking-wider mb-1.5 flex items-center gap-1`}>
                        <Shield className="h-3 w-3" /> {label} ({players.length}/{maxPerTeam})
                      </p>
                      <div className="space-y-0.5">
                        {players.map((p, i) => <PlayerRow key={`${p}-${i}`} name={p} isHost={label === "Team A"} index={i} onPlayerClick={(name, rect) => setPlayerPopover({ slotValue: name, rect })} />)}
                        {Array.from({ length: maxPerTeam - players.length }).map((_, i) => (
                          <p key={i} className="text-xs text-muted-foreground/30 italic pl-5">Empty slot</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border">
                  <p className="text-xs text-muted-foreground">{selectedPublicLobby.players.length}/{selectedPublicLobby.maxPlayers} players in lobby</p>
                  <Button
                    disabled={isInActiveRoom || selectedPublicLobby.status !== "waiting" || selectedPublicLobby.players.length >= selectedPublicLobby.maxPlayers || !(matchStakeCurrency(selectedPublicLobby) === "AT" ? canJoinAtStake : canPlayStaked)}
                    onClick={() => { setSelectedPublicLobbyId(null); handleJoinPublic(selectedPublicLobby.id, selectedPublicLobby.betAmount); }}
                    className="font-display"
                    title={matchStakeCurrency(selectedPublicLobby) === "AT" ? (!canPlay ? "Arena Client not connected" : undefined) : stakedActionTitle}
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
            <span className="text-arena-gold font-bold">Stakes: {formatMatchStakeShort(myActiveRoom)}</span>
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
                          {player ? (
                            <button
                              className="truncate text-left hover:text-primary transition-colors w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlayerPopover({ slotValue: player, rect: e.currentTarget.getBoundingClientRect() });
                              }}
                            >
                              {player}
                            </button>
                          ) : (
                            <button
                              className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors w-full"
                              onClick={(e) => { e.stopPropagation(); void handleOpenInviteModal(); }}
                              title="Invite a friend"
                            >
                              <UserPlus className="h-3 w-3 shrink-0" />
                              <span>{`Slot ${i + 1}`}</span>
                            </button>
                          )}
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
                          {player ? (
                            <button
                              className="truncate text-left hover:text-primary transition-colors w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlayerPopover({ slotValue: player, rect: e.currentTarget.getBoundingClientRect() });
                              }}
                            >
                              {player}
                            </button>
                          ) : (
                            <button
                              className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors w-full"
                              onClick={(e) => { e.stopPropagation(); void handleOpenInviteModal(); }}
                              title="Invite a friend"
                            >
                              <UserPlus className="h-3 w-3 shrink-0" />
                              <span>{`Slot ${i + 1}`}</span>
                            </button>
                          )}
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
          <div className="flex items-center gap-2 flex-wrap">
            {/* Leave Room — only for non-host players. Host uses Delete Room below. */}
            {myActiveRoom.hostId !== user?.id && (
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  "text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/70",
                  countdown !== null && countdown <= 3 && "animate-pulse"
                )}
                onClick={() => setLeaveConfirmOpen(true)}
              >
                <LogOut className="mr-1.5 h-3 w-3" />
                Leave Room
              </Button>
            )}

            {token && myActiveRoom.status === "waiting" && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-arena-purple/40 text-arena-purple hover:bg-arena-purple/10"
                onClick={() => void handleOpenInviteModal()}
              >
                <UserPlus className="mr-1.5 h-3 w-3" />
                Invite Friends
              </Button>
            )}

            {countdown !== null && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-arena-gold" />
                {countdown > 0
                  ? `${countdown}s left to leave — funds lock when timer hits 0`
                  : "Locking funds…"}
              </p>
            )}

            {myActiveRoom.hostId === user?.id && myActiveRoom.status === "waiting" && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-destructive/50 text-destructive hover:bg-destructive/10 ml-auto"
                onClick={() => setDeleteRoomConfirmOpen(true)}
              >
                <Trash2 className="mr-1.5 h-3 w-3" />
                Delete Room
              </Button>
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
                    className={`relative px-4 py-1.5 rounded-xl border font-display text-sm font-bold transition-all ${
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
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <Swords className="h-3.5 w-3.5 text-arena-purple" />
                <span className="font-display text-xs font-semibold uppercase tracking-wider">Available Matches</span>
              </div>
              <span className="text-xs text-muted-foreground">{filteredPublicMatches.length} lobbies</span>
            </div>
            <div className="divide-y divide-border/40">
              {filteredPublicMatches.map((match) => {
                const status = statusConfig[match.status] ?? {
                  label: "Unknown",
                  color: "bg-muted text-muted-foreground border-border",
                  icon: AlertCircle,
                };
                const StatusIcon = status.icon;
                const isLive = match.status === "in_progress";
                const canJoin = match.status === "waiting" && match.players.length < match.maxPlayers;
                const cfg = ALL_GAME_CONFIG[match.game];
                // Smart dimming: when a bet is selected, grey out non-matching matches
                const dimmed = selectedBet !== null && match.betAmount !== selectedBet;
                const glowing = selectedBet !== null && match.betAmount === selectedBet && canJoin;

                return (
                  <div key={match.id}
                    className={`relative flex items-center justify-between px-3 py-2.5 cursor-pointer transition-all ${
                      dimmed ? "opacity-35 grayscale pointer-events-none" : "hover:bg-secondary/30"
                    }`}
                    style={{
                      borderLeft: `2px solid ${cfg?.color ?? "#555"}`,
                      ...(glowing ? { boxShadow: `inset 0 0 30px ${cfg?.color ?? "#888"}08` } : {}),
                    }}
                    onClick={() => !dimmed && handleOpenPublicLobby(match.id)}>
                    {isLive && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-arena-cyan/50 to-transparent" />}
                    {dimmed && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <GameLogo game={match.game} size={26} />
                      <div className="min-w-0">
                        <p className="font-medium text-xs truncate">{match.host}'s Match</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
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
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={`${status.color} border text-xs gap-1`}>
                        <StatusIcon className="h-3 w-3" />{status.label}
                      </Badge>
                      <span className="font-display text-sm font-bold text-arena-gold">{formatMatchStakeShort(match)}</span>
                      {canJoin ? (
                        <Button size="sm" disabled={isInActiveRoom || depositConfirm !== null || !(matchStakeCurrency(match) === "AT" ? canJoinAtStake : canPlayStaked)}
                          onClick={(e) => { e.stopPropagation(); handleJoinPublic(match.id, match.betAmount); }}
                          className="font-display text-xs"
                          title={isInActiveRoom ? "Leave your current room first" : matchStakeCurrency(match) === "AT" ? (!canPlay ? "Arena Client not connected" : undefined) : stakedActionTitle}
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
                <div className="px-4 py-8 text-center space-y-3">
                  <Swords className="h-8 w-8 mx-auto text-muted-foreground/25" />
                  <p className="text-sm text-muted-foreground">
                    {selectedBet ? `No open lobbies for $${selectedBet}.` : "No public lobbies right now."}
                  </p>
                  <p className="text-xs text-muted-foreground/70 max-w-xs mx-auto leading-relaxed">
                    Create a room or check back soon. Staked play needs the{" "}
                    <Link to="/client" className="text-primary hover:underline">Arena Client</Link> running.
                  </p>
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
            {user && !connectedAddress && (
              <div className="rounded-xl border border-arena-gold/30 bg-arena-gold/5 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <Wallet className="h-4 w-4 text-arena-gold shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">Connect Wallet</span>
                    {" — "}
                    Link MetaMask on BNB Smart Chain Testnet to create or join staked matches.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="font-display shrink-0 gap-1.5"
                  disabled={walletLinkBusy || !token}
                  onClick={() => {
                    void (async () => {
                      setWalletLinkBusy(true);
                      try {
                        const r = await linkMetaMaskForMatch();
                        if (r.ok === false) {
                          useNotificationStore.getState().addNotification({
                            type: "system",
                            title: "Wallet",
                            message: r.error,
                          });
                        } else {
                          syncProfileWalletConnected();
                          useNotificationStore.getState().addNotification({
                            type: "system",
                            title: "Wallet connected",
                            message: "You can create or join staked matches.",
                          });
                        }
                      } finally {
                        setWalletLinkBusy(false);
                      }
                    })();
                  }}
                >
                  {walletLinkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                  Connect Wallet
                </Button>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider">Join by Game ID</label>
              <div className="flex gap-2">
                <Input placeholder="Enter match code (e.g. ARENA-7X2K)" value={customCode}
                  onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                  className="font-mono bg-secondary border-border placeholder:text-muted-foreground/40" />
                <Button disabled={isInActiveRoom || !customCode || !canPlay}
                  onClick={() => { const found = customMatches.find(m => m.code === customCode); if (found) handleJoinCustom(found.id, found.betAmount); }}
                  className="font-display shrink-0"
                  title={isInActiveRoom ? "Leave your current room first" : !canPlay ? "Arena Client not connected" : stakedActionTitle}>
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
              <button
                onClick={() => canPlay && !isInActiveRoom && setCreateMode(true)}
                disabled={!canPlay || isInActiveRoom}
                title={isInActiveRoom ? "Leave your current room before creating a new one" : !canPlay ? "Arena Client not connected" : !connectedAddress ? "Connect wallet for crypto stakes; AT-only rooms work without MetaMask once you pick Arena Tokens." : undefined}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border font-display text-sm font-semibold transition-colors ${
                  canPlay && !isInActiveRoom
                    ? "border-arena-purple/30 text-arena-purple hover:bg-arena-purple/10"
                    : "border-border/30 text-muted-foreground/40 cursor-not-allowed"
                }`}>
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
                {/* Stake currency + amount */}
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">Stake currency</label>
                  <div className="flex gap-2 flex-wrap mb-3">
                    <button
                      type="button"
                      onClick={() => { setCreateStakeCurrency("CRYPTO"); setNewMatchBet(null); }}
                      className={`px-4 py-1.5 rounded-xl border font-display text-xs font-bold transition-all ${
                        createStakeCurrency === "CRYPTO"
                          ? "border-arena-gold bg-arena-gold/15 text-arena-gold"
                          : "border-border bg-secondary/40 text-muted-foreground hover:border-arena-gold/40"
                      }`}
                    >
                      Crypto (BNB)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreateStakeCurrency("AT"); setNewMatchBet(null); }}
                      className={`px-4 py-1.5 rounded-xl border font-display text-xs font-bold transition-all ${
                        createStakeCurrency === "AT"
                          ? "border-arena-purple bg-arena-purple/15 text-arena-purple"
                          : "border-border bg-secondary/40 text-muted-foreground hover:border-arena-purple/40"
                      }`}
                    >
                      Arena Tokens (AT)
                    </button>
                  </div>
                  <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">Bet amount</label>
                  <div className="flex gap-2 flex-wrap">
                    {(createStakeCurrency === "AT" ? AT_BET_AMOUNTS : CREATE_BET_AMOUNTS).map((a) => (
                      <button key={a} onClick={() => setNewMatchBet(a)}
                        className={`px-4 py-1.5 rounded-xl border font-display text-sm font-bold transition-all ${
                          newMatchBet === a
                            ? "border-primary bg-primary/15 text-primary shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
                            : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}>
                        {createStakeCurrency === "AT" ? `${a.toLocaleString()} AT` : `$${a}`}
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
                    disabled={
                      !newMatchGame ||
                      !newMatchBet ||
                      !newMatchPassword ||
                      !newMatchMode ||
                      !canPlay ||
                      (createStakeCurrency === "CRYPTO" && !connectedAddress)
                    }
                    onClick={() => {
                      void (async () => {
                        if (!newMatchGame || !newMatchBet || !newMatchMode || !user) return;
                        if (createStakeCurrency === "CRYPTO" && !connectedAddress) return;
                        const teamSize = getTeamSize(newMatchMode);
                        let serverMatchId: string | undefined;
                        let stakeCurrencyResolved: StakeCurrency = createStakeCurrency;
                        const useServerApi =
                          !!token &&
                          (newMatchGame === "CS2" || newMatchGame === "Valorant");

                        if (useServerApi) {
                          if (createStakeCurrency === "CRYPTO") {
                            try {
                              await createMatchOnChain(teamSize, newMatchBet);
                            } catch (e: unknown) {
                              useNotificationStore.getState().addNotification({
                                type: "system",
                                title: "Could not create match on-chain",
                                message: friendlyChainErrorMessage(e),
                              });
                              return;
                            }
                          }

                          const apiRes = await apiCreateMatch(token, {
                            game: newMatchGame,
                            stake_amount: newMatchBet,
                            stake_currency: createStakeCurrency,
                          });
                          if (apiRes.ok === false) {
                            if (apiRes.status === 409) {
                              // 409 = user already has an active room — restore it
                              const active = await apiGetActiveMatch(token!);
                              if (active?.match?.match_id) setMyRoomMatchId(active.match.match_id);
                              useNotificationStore.getState().addNotification({
                                type: "system",
                                title: "Room restored",
                                message: apiRes.detail ?? "You already have an active match room.",
                              });
                            } else {
                              useNotificationStore.getState().addNotification({
                                type: "system",
                                title: "Could not create match",
                                message:
                                  apiRes.detail ??
                                  "Check your Steam / Riot ID on your account and try again.",
                              });
                            }
                            return;
                          }
                          serverMatchId = apiRes.data.match_id;
                          stakeCurrencyResolved = apiRes.data.stake_currency ?? createStakeCurrency;
                        }

                        const created = addMatch({
                          ...(serverMatchId ? { id: serverMatchId } : {}),
                          type: "custom",
                          host: user.username,
                          hostId: user.id,
                          game: newMatchGame as Game,
                          mode: newMatchMode,
                          betAmount: newMatchBet,
                          stakeCurrency: stakeCurrencyResolved,
                          players: [],
                          maxPlayers: getTotalPlayers(newMatchMode),
                          status: "waiting",
                          password: newMatchPassword,
                          teamA: [user.username],
                          teamB: [],
                          maxPerTeam: teamSize,
                          teamSize,
                          depositsReceived: 1,
                        });

                        if (useServerApi) {
                          const stakeLabel =
                            stakeCurrencyResolved === "AT"
                              ? `${newMatchBet.toLocaleString()} AT`
                              : `$${newMatchBet} BNB`;
                          useNotificationStore.getState().addNotification({
                            type: "system",
                            title: "⚔️ Match Created",
                            message: `Your ${newMatchGame} ${newMatchMode} (${stakeLabel}) is live! Code: ${created.code}`,
                          });
                        } else if (createStakeCurrency === "AT") {
                          useNotificationStore.getState().addNotification({
                            type: "match_invite",
                            title: "⚔️ Match Created",
                            message: `Your ${newMatchGame} ${newMatchMode} (${newMatchBet.toLocaleString()} AT) is live! Code: ${created.code}`,
                          });
                        } else {
                          const escrowTx = await lockEscrow(newMatchBet, created.id);
                          if (!escrowTx) {
                            const hint = consumeLastLockEscrowFailureMessage();
                            useNotificationStore.getState().addNotification({
                              type: "system",
                              title: "Escrow deposit failed",
                              message:
                                hint ??
                                "Match was created locally but the on-chain deposit did not finish. Check BNB, MetaMask, and contract settings.",
                            });
                            return;
                          }
                          useNotificationStore.getState().addNotification({
                            type: "match_invite",
                            title: "⚔️ Match Created",
                            message: `Your ${newMatchGame} ${newMatchMode} ($${newMatchBet}) is live! Code: ${created.code}`,
                          });
                        }

                        setMyRoomMatchId(created.id);
                        setRoomLocked(false);
                        setCreateMode(false);
                        setNewMatchPassword("");
                        setNewMatchGame("");
                        setNewMatchBet(null);
                        setNewMatchMode(null);
                        setCreateStakeCurrency("CRYPTO");
                      })();
                    }}
                    className="glow-green font-display">
                    <Swords className="mr-2 h-4 w-4" /> Create {newMatchMode ?? ""} Match
                  </Button>
                  <Button variant="outline" onClick={() => { setCreateMode(false); setNewMatchPassword(""); setNewMatchMode(null); setCreateStakeCurrency("CRYPTO"); setNewMatchBet(null); }}>Cancel</Button>
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
          <div className="space-y-2.5">
            {filteredCustom.map((match) => {
              const status = statusConfig[match.status] ?? {
                label: "Unknown",
                color: "bg-muted text-muted-foreground border-border",
                icon: AlertCircle,
              };
              const StatusIcon = status.icon;
              const isLive = match.status === "in_progress";
              const maxPerTeam = match.maxPerTeam ?? match.teamSize ?? getTeamSize(match.mode);
              const teamA = match.teamA ?? [];
              const teamB = match.teamB ?? [];
              const teamAFull = teamA.length >= maxPerTeam;
              const teamBFull = teamB.length >= maxPerTeam;
              const canJoin = match.status === "waiting" && (!teamAFull || !teamBFull);
              const cfg = ALL_GAME_CONFIG[match.game];

              return (
                <div key={match.id} className="rounded-2xl border border-border bg-card overflow-hidden"
                  style={{ borderLeftWidth: "2px", borderLeftColor: cfg?.color ?? "#555" }}>
                  {isLive && <div className="h-0.5 w-full bg-gradient-to-r from-arena-cyan via-primary to-arena-purple animate-pulse" />}
                  <div className="p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <GameLogo game={match.game} size={26} />
                        <div>
                          <p className="font-medium text-xs flex items-center gap-1.5">
                            <Crown className="h-3 w-3 text-arena-gold" />
                            {match.host}'s {match.mode}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                            <span>{match.game}</span><span>·</span>
                            <KeyRound className="h-3 w-3" /> Protected
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge className={`${status.color} border text-xs gap-1`}>
                          <StatusIcon className="h-3 w-3" />{status.label}
                        </Badge>
                        <button onClick={() => handleCopyCode(match.code)}
                          className="flex items-center gap-1 text-[11px] font-mono bg-secondary px-1.5 py-0.5 rounded-lg border border-border hover:border-primary/50 transition-colors">
                          <Copy className="h-3 w-3" />
                          {copiedCode === match.code ? "Copied!" : match.code}
                        </button>
                        <span className="font-display text-sm font-bold text-arena-gold">{formatMatchStakeShort(match)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        { label: "Team A", players: teamA, full: teamAFull, border: "border-primary/20", bg: "bg-primary/5", text: "text-primary", joinBorder: "border-primary/30", joinText: "text-primary", joinHover: "hover:bg-primary/10", isA: true },
                        { label: "Team B", players: teamB, full: teamBFull, border: "border-arena-orange/20", bg: "bg-arena-orange/5", text: "text-arena-orange", joinBorder: "border-arena-orange/30", joinText: "text-arena-orange", joinHover: "hover:bg-arena-orange/10", isA: false },
                      ].map(({ label, players, full, border, bg, text, joinBorder, joinText, joinHover, isA }) => (
                        <div key={label} className={`rounded-xl border ${border} ${bg} p-2.5`}>
                          <p className={`text-xs ${text} font-display uppercase tracking-wider mb-1.5 flex items-center gap-1`}>
                            <Shield className="h-3 w-3" /> {label} ({players.length}/{maxPerTeam})
                          </p>
                          <div className="space-y-0.5">
                            {players.map((p, i) => <PlayerRow key={i} name={p} isHost={isA} index={i} onPlayerClick={(name, rect) => setPlayerPopover({ slotValue: name, rect })} />)}
                            {Array.from({ length: maxPerTeam - players.length }).map((_, i) => (
                              <p key={i} className="text-xs text-muted-foreground/30 italic pl-5">Empty slot</p>
                            ))}
                          </div>
                          {canJoin && !full && !isInActiveRoom && (matchStakeCurrency(match) === "AT" ? canJoinAtStake : canPlayStaked) && (
                            <button onClick={() => handleJoinCustom(match.id, match.betAmount, isA ? "A" : "B")}
                              className={`mt-1.5 w-full flex items-center justify-center gap-1 py-1 rounded-lg border ${joinBorder} ${joinText} ${joinHover} transition-colors text-xs font-display`}>
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
              <div className="rounded-2xl border border-border bg-card/50 px-4 py-8 text-center space-y-2">
                <Hash className="h-7 w-7 mx-auto text-muted-foreground/25" />
                <p className="text-sm text-muted-foreground">
                  No custom matches found{selectedGame ? ` for ${selectedGame}` : ""}.
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Host one with a code, or{" "}
                  <Link to="/client" className="text-primary hover:underline">set up the Arena Client</Link>{" "}
                  before you lock a stake.
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Leave Room Confirmation — only non-host players ──────────── */}
      {leaveConfirmOpen && myActiveRoom && myActiveRoom.hostId !== user?.id && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-destructive/40 bg-card shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <LogOut className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold">Leave Room?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your <span className="text-arena-gold font-semibold">{formatMatchStakeShort(myActiveRoom)}</span> deposit will be fully refunded.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/70 bg-secondary/40 rounded-xl px-3 py-2">
              You can rejoin another room at any time. Funds are only locked after the 10-second countdown when the room fills.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1 font-display text-sm"
                onClick={() => { setLeaveConfirmOpen(false); handleLeaveRoom(); }}
              >
                <LogOut className="mr-2 h-4 w-4" /> Confirm Leave
              </Button>
              <Button variant="outline" className="border-border/50" onClick={() => setLeaveConfirmOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Room Confirmation ───────────────────────────────── */}
      {deleteRoomConfirmOpen && myActiveRoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-destructive/40 bg-card shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold">Delete Room?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {myActiveRoom.depositsReceived
                    ? `All ${myActiveRoom.depositsReceived} deposited players will be refunded.`
                    : "The room will be closed immediately."}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/70 bg-secondary/40 rounded-xl px-3 py-2">
              This calls <span className="font-mono text-primary">ArenaEscrow.cancelMatch()</span> on-chain. Only available while the room is still waiting for players.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1 font-display text-sm"
                onClick={handleDeleteRoom}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete Room
              </Button>
              <Button variant="outline" className="border-border/50" onClick={() => setDeleteRoomConfirmOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Player Card Popover ───────────────────────────────────────── */}
      <PlayerPopoverLayer
        open={!!playerPopover && !!user}
        slotValue={playerPopover?.slotValue ?? null}
        rect={playerPopover?.rect ?? null}
        onClose={() => setPlayerPopover(null)}
        onLeaveRoom={() => { setPlayerPopover(null); setLeaveConfirmOpen(true); }}
        enableLeaveRoom
      />

      {/* ── Invite Friends Modal ──────────────────────────────────────── */}
      {inviteModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={() => setInviteModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <UserPlus className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-display text-sm font-bold">Invite a Friend</h3>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setInviteModalOpen(false)}
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            {/* Friend list */}
            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {inviteFriendsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : inviteFriends.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No friends yet. Add friends from the Hub!
                </p>
              ) : (
                inviteFriends.map((friend) => {
                  const sent = invitedFriendIds.has(friend.user_id);
                  const loading = invitingFriendId === friend.user_id;
                  return (
                    <div
                      key={friend.user_id}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/30 border border-border/30"
                    >
                      {/* Avatar */}
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-[10px] font-bold text-primary overflow-hidden">
                        {friend.avatar ? (
                          <img src={friend.avatar} alt={friend.username} className="w-full h-full object-cover" />
                        ) : (
                          friend.username.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{friend.username}</p>
                        {friend.arena_id && (
                          <p className="text-[10px] text-muted-foreground truncate">{friend.arena_id}</p>
                        )}
                      </div>
                      {/* Invite button */}
                      <button
                        disabled={sent || loading}
                        onClick={() => void handleInviteFriend(friend.user_id)}
                        className={cn(
                          "shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all",
                          sent
                            ? "bg-green-500/10 border border-green-500/30 text-green-500 cursor-default"
                            : "bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20"
                        )}
                      >
                        {loading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : sent ? (
                          <><CheckCircle className="h-3 w-3" /> Sent</>
                        ) : (
                          <><UserPlus className="h-3 w-3" /> Invite</>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchLobby;
