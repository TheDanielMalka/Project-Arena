import { SidebarTrigger } from "@/components/ui/sidebar";
import { Wallet, LogOut, User, ChevronDown, Wifi, WifiOff, Loader2, MonitorPlay, Download, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { useEngineStatus } from "@/hooks/useEngineStatus";
import { useClientStore } from "@/stores/clientStore";
import { useNavigate } from "react-router-dom";
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
  const { user, isAuthenticated, walletConnected, connectWallet, logout } = useUserStore();
  // DB-ready: wagmi useBalance() — live on-chain USDT balance
  const totalBalance = useWalletStore((s) => s.usdtBalance);
  const clientStatus = useClientStore((s) => s.status);
  const clientVersion = useClientStore((s) => s.version);
  const navigate = useNavigate();

  // Keep the poller alive — syncs into clientStore automatically
  useEngineStatus();

  const handleSignOut = () => { logout(); navigate("/"); };

  const cfg = CLIENT_STATUS_CONFIG[clientStatus];
  const Icon = cfg.icon;
  const isAnimated = clientStatus === "checking" || clientStatus === "connected";

  return (
    <header className="h-14 flex items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <button
          onClick={() => navigate("/lobby")}
          className="font-display text-sm text-muted-foreground tracking-wider uppercase hover:text-primary transition-colors"
        >
          Play for Stakes
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
                  onClick={clientStatus === "disconnected" ? () => window.open("https://arena-client-dist.s3.us-east-1.amazonaws.com/ArenaClient.exe", "_blank") : undefined}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                    clientStatus === "disconnected"
                      ? "cursor-pointer hover:bg-secondary/60"
                      : "cursor-default"
                  }`}
                >
                  {/* Animated dot */}
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot} ${
                    clientStatus === "ready" ? "animate-pulse" : ""
                  }`} />
                  <Icon className={`h-3.5 w-3.5 ${cfg.color} ${isAnimated ? "animate-spin" : ""}`} />
                  <span className={`text-xs font-mono hidden sm:inline ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  {/* Download hint when offline */}
                  {clientStatus === "disconnected" && (
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
        {isAuthenticated && walletConnected && (
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
                {walletConnected ? (
                  <><Wallet className="h-4 w-4" /><span className="hidden sm:inline font-mono text-xs">{user.walletShort}</span></>
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
              {!walletConnected && (
                <DropdownMenuItem onClick={() => connectWallet()} className="cursor-pointer">
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
