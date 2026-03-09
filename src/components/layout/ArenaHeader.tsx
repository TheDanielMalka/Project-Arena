import { SidebarTrigger } from "@/components/ui/sidebar";
import { Wallet, LogOut, User, ChevronDown, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { useEngineStatus } from "@/hooks/useEngineStatus";
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

export function ArenaHeader() {
  const { user, isAuthenticated, walletConnected, connectWallet, logout } = useUserStore();
  const totalBalance = useWalletStore((s) => s.getTotalBalance());
  const { online } = useEngineStatus();
  const navigate = useNavigate();

  const handleSignOut = () => {
    logout();
    navigate("/");
  };

  const handleConnectWallet = () => {
    connectWallet();
  };

  return (
    <header className="h-14 flex items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <button
          onClick={() => navigate("/dashboard")}
          className="font-display text-sm text-muted-foreground tracking-wider uppercase hover:text-primary transition-colors"
        >
          Play for Stakes
        </button>
      </div>
      <div className="flex items-center gap-2">
        {/* Engine Status Indicator */}
        {isAuthenticated && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-default">
                  {online === null ? (
                    <div className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
                  ) : online ? (
                    <Wifi className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className={`text-xs font-mono hidden sm:inline ${
                    online ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {online === null ? "..." : online ? "LIVE" : "OFFLINE"}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{online ? "Engine connected — Desktop client can send results" : "Engine offline — Running in demo mode"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
        }

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
                  <>
                    <Wallet className="h-4 w-4" />
                    <span className="hidden sm:inline font-mono text-xs">{user.walletShort}</span>
                  </>
                ) : (
                  <>
                    <Wallet className="h-4 w-4" />
                    <span className="hidden sm:inline">Connect Wallet</span>
                  </>
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
                <DropdownMenuItem onClick={handleConnectWallet} className="cursor-pointer">
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
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => navigate("/auth")}
          >
            <Wallet className="mr-2 h-4 w-4" />
            Connect Wallet
          </Button>
        )}
      </div>
    </header>
  );
}
