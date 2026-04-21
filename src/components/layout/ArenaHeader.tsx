import { SidebarTrigger } from "@/components/ui/sidebar";
import { Wallet, LogOut, User, ChevronDown, Wifi, WifiOff, Loader2, MonitorPlay, Download, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { useEngineStatus } from "@/hooks/useEngineStatus";
import { useClientStore } from "@/stores/clientStore";
import { useNavigate, useLocation } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Status config — drives the indicator colours and tooltip text
const CLIENT_STATUS_CONFIG = {
  checking:     { icon: Loader2,     color: "text-muted-foreground", dot: "bg-muted-foreground",  label: "Checking…",        tip: "Checking Arena Client connection…" },
  disconnected: { icon: WifiOff,     color: "text-muted-foreground", dot: "bg-muted-foreground",  label: "Client Offline",   tip: "Arena Client not detected. Download and run the client to play matches." },
  connected:    { icon: Loader2,     color: "text-arena-gold",       dot: "bg-arena-gold",        label: "Starting…",        tip: "Arena Client is starting. Capture subsystem initialising…" },
  ready:        { icon: Wifi,        color: "text-primary",          dot: "bg-primary",           label: "Client Ready",     tip: "Arena Client connected and ready. You can join competitive matches." },
  in_match:     { icon: MonitorPlay, color: "text-arena-cyan",       dot: "bg-arena-cyan",        label: "In Match",         tip: "Arena Client is actively recording your match." },
} as const;

export function ArenaHeader() {
  const { toast } = useToast();
  const { user, isAuthenticated, walletConnected, connectWallet: connectUserWalletFlag, logout } = useUserStore();
  const chainConnectedAddress = useWalletStore((s) => s.connectedAddress);
  const connectMetaMaskWallet = useWalletStore((s) => s.connectWallet);
  // DB-ready: wagmi useBalance() — live on-chain USDT balance
  const totalBalance = useWalletStore((s) => s.usdtBalance);
  const clientStatus = useClientStore((s) => s.status);
  const clientVersion = useClientStore((s) => s.version);
  const bindUserId    = useClientStore((s) => s.bindUserId);
  const navigate = useNavigate();
  const location = useLocation();
  const onLobby = location.pathname === "/lobby";
  const lobbyCustom = onLobby && new URLSearchParams(location.search).get("tab") === "custom";

  // Keep the poller alive — syncs into clientStore automatically
  useEngineStatus();

  const handleSignOut = () => {
    logout();
    navigate("/auth", { replace: true });
  };

  // "Client Ready" only when the client is logged in as the same user as the website.
  // If client is running but bound to a different (or no) user → show "connected" state.
  const userMatched = (clientStatus === "ready" || clientStatus === "in_match") && bindUserId === user?.id;
  const effectiveStatus = (clientStatus === "ready" || clientStatus === "in_match") && !userMatched
    ? "connected"
    : clientStatus;

  const cfg = CLIENT_STATUS_CONFIG[effectiveStatus];
  const Icon = cfg.icon;
  const isAnimated = effectiveStatus === "checking" || effectiveStatus === "connected";

  return (
    <header className="relative z-20 h-14 flex items-center justify-between border-b border-primary/10 px-4 arena-glass-subtle bg-card/30">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <SidebarTrigger className="text-foreground/80 shrink-0" />
        <div className="hidden sm:flex items-center rounded-lg border border-border/60 bg-background/40 p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => navigate("/lobby")}
            className={`font-display text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-md transition-all ${
              onLobby && !lobbyCustom
                ? "bg-primary/20 text-primary shadow-[0_0_20px_-6px_hsl(var(--primary))]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Play for Stakes
          </button>
          <button
            type="button"
            onClick={() => navigate("/lobby?tab=custom")}
            className={`font-display text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-md transition-all ${
              lobbyCustom
                ? "bg-arena-purple/25 text-arena-purple shadow-[0_0_20px_-6px_hsl(var(--arena-purple)/0.5)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Custom Matches
          </button>
        </div>
        <button
          type="button"
          onClick={() => navigate("/lobby")}
          className="sm:hidden font-display text-xs text-muted-foreground tracking-wider uppercase hover:text-primary transition-colors truncate"
        >
          Lobby
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* ── Arena Client Status Indicator ── */}
        {isAuthenticated && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Clicking "disconnected" opens download page — others do nothing */}
                <button
                  onClick={effectiveStatus === "disconnected" ? () => window.open("https://arena-client-dist.s3.us-east-1.amazonaws.com/setup.zip", "_blank") : undefined}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                    effectiveStatus === "disconnected"
                      ? "cursor-pointer hover:bg-secondary/60"
                      : "cursor-default"
                  }`}
                >
                  {/* Animated dot */}
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot} ${
                    effectiveStatus === "ready" ? "animate-pulse" : ""
                  }`} />
                  <Icon className={`h-3.5 w-3.5 ${cfg.color} ${isAnimated ? "animate-spin" : ""}`} />
                  <span className={`text-xs font-mono hidden sm:inline ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  {/* Download hint when offline */}
                  {effectiveStatus === "disconnected" && (
                    <Download className="h-3 w-3 text-muted-foreground hidden sm:inline ml-0.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64">
                <p className="text-xs">{cfg.tip}</p>
                {clientVersion && <p className="text-[10px] text-muted-foreground mt-0.5">v{clientVersion}</p>}
                {clientStatus === "disconnected" && (
                  <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                    <Download className="h-2.5 w-2.5" /> Click to download client
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {isAuthenticated && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-arena-gold hover:text-arena-gold hover:bg-arena-gold/10"
                  aria-label="Help — submit a support ticket"
                  onClick={() => navigate("/settings?section=support&openTicket=1")}
                >
                  <Lightbulb className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">Help — open a support ticket</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Balance Quick View */}
        {isAuthenticated && !!chainConnectedAddress && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:flex items-center gap-2 text-primary font-mono text-xs hover:bg-primary/10"
            onClick={() => navigate("/wallet")}
          >
            <span className="font-display font-bold">
              ${totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </Button>
        )}

        <NotificationCenter />

        {/* Wallet / User Button */}
        {isAuthenticated && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10 gap-2">
                {chainConnectedAddress ? (
                  <><Wallet className="h-4 w-4" /><span className="hidden sm:inline font-mono text-xs">
                    {`${chainConnectedAddress.slice(0, 6)}...${chainConnectedAddress.slice(-4)}`}
                  </span></>
                ) : (
                  <><Wallet className="h-4 w-4" /><span className="hidden sm:inline">Connect Wallet</span></>
                )}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-card border-border">
              <div className="px-2 py-1.5">
                <p className="font-medium text-sm">{user.username}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              {!chainConnectedAddress && (
                <DropdownMenuItem
                  onClick={() => {
                    void (async () => {
                      const r = await connectMetaMaskWallet();
                      if (r.ok === false) {
                        toast({ variant: "destructive", title: "Wallet", description: r.error });
                        return;
                      }
                      connectUserWalletFlag();
                      toast({ title: "Wallet linked", description: "Your wallet is connected and saved to your profile." });
                    })();
                  }}
                  className="cursor-pointer"
                >
                  <Wallet className="mr-2 h-4 w-4" /> Connect Wallet
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate("/wallet")} className="cursor-pointer">
                <Wallet className="mr-2 h-4 w-4" /> Wallet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/profile")} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10" onClick={() => navigate("/auth")}>
            <Wallet className="mr-2 h-4 w-4" /> Connect Wallet
          </Button>
        )}
      </div>
    </header>
  );
}
