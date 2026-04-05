import { useState } from "react";
import { useUserStore } from "@/stores/userStore";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Copy, CheckCircle2, Eye, EyeOff, ExternalLink,
  TrendingUp, TrendingDown, Clock, RefreshCw,
  Search, Landmark, Flame, Wallet, ShieldCheck,
  ChevronLeft, ChevronRight, Swords, WifiOff, Zap, Unplug,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWalletStore } from "@/stores/walletStore";
import { useForgeStore } from "@/stores/forgeStore";
import type { TransactionType, TransactionStatus } from "@/types";
import { cn } from "@/lib/utils";
import { BuyArenaTokensModal }  from "@/components/wallet/BuyArenaTokensModal";
import { WithdrawATModal }       from "@/components/wallet/WithdrawATModal";

// ─── Helpers ──────────────────────────────────────────────────────────────

const NETWORKS = {
  bsc:      { name: "BNB Smart Chain", color: "text-arena-gold",   explorer: "https://bscscan.com/tx/",   short: "BSC"  },
  solana:   { name: "Solana",          color: "text-arena-purple", explorer: "https://solscan.io/tx/",    short: "SOL"  },
  ethereum: { name: "Ethereum",        color: "text-arena-cyan",   explorer: "https://etherscan.io/tx/",  short: "ETH"  },
} as const;

// Non-custodial transaction types — no deposit/withdrawal
const txTypeConfig: Record<TransactionType, { label: string; color: string; sign: string; icon: string }> = {
  match_win:      { label: "Match Win",       color: "text-arena-green",   sign: "+", icon: "🏆" },
  match_loss:     { label: "Match Loss",      color: "text-destructive",   sign: "−", icon: "💀" },
  fee:            { label: "Platform Fee",    color: "text-muted-foreground", sign: "−", icon: "%" },
  refund:         { label: "Refund",          color: "text-arena-cyan",    sign: "+", icon: "↩" },
  escrow_lock:    { label: "Escrow Locked",   color: "text-arena-gold",    sign: "−", icon: "🔒" },
  escrow_release: { label: "Escrow Released", color: "text-arena-green",   sign: "+", icon: "🔓" },
  at_purchase:    { label: "AT Purchased",    color: "text-arena-purple",  sign: "−", icon: "⚡" },
  at_spend:       { label: "AT Spent",        color: "text-arena-orange",  sign: "−", icon: "🛒" },
  at_withdrawal:  { label: "AT Withdrawal",   color: "text-arena-cyan",    sign: "−", icon: "🔥" },
};

const txStatusConfig: Record<TransactionStatus, { label: string; color: string }> = {
  completed: { label: "Confirmed", color: "bg-primary/20 text-primary border-primary/30" },
  pending:   { label: "Pending",   color: "bg-arena-orange/20 text-arena-orange border-arena-orange/30" },
  failed:    { label: "Failed",    color: "bg-destructive/20 text-destructive border-destructive/30" },
  cancelled: { label: "Cancelled", color: "bg-muted/40 text-muted-foreground border-border/40" },
};

const TX_PER_PAGE = 8;

// ─── Component ────────────────────────────────────────────────────────────

const WalletPage = () => {
  const { toast } = useToast();
  const { user, connectWallet: syncProfileWalletConnected } = useUserStore();
  const {
    connectedAddress, selectedNetwork,
    usdtBalance, atBalance,
    dailyBettingLimit, dailyBettingUsed, platformBettingMax,
    transactions, setDailyBettingLimit, connectWallet: linkMetaMaskWallet,
    disconnectWallet: unlinkMetaMaskWallet,
  } = useWalletStore();
  const { arenaTokens: forgeAT } = useForgeStore();

  const [balanceVisible, setBalanceVisible] = useState(true);
  const [copiedAddress, setCopiedAddress]   = useState(false);
  const [txFilter, setTxFilter]             = useState<TransactionType | "all">("all");
  const [txSearch, setTxSearch]             = useState("");
  const [txPage, setTxPage]                 = useState(1);
  const [buyATOpen, setBuyATOpen]           = useState(false);
  const [withdrawATOpen, setWithdrawATOpen] = useState(false);
  const [walletLinkBusy, setWalletLinkBusy] = useState(false);
  const [walletUnlinkBusy, setWalletUnlinkBusy] = useState(false);

  // Derived
  const networkCfg      = NETWORKS[selectedNetwork];
  const shortAddr       = connectedAddress
    ? `${connectedAddress.slice(0, 8)}...${connectedAddress.slice(-6)}`
    : null;

  const filteredTx = transactions.filter((tx) => {
    const okType = txFilter === "all" || tx.type === txFilter;
    const q = txSearch.toLowerCase();
    const okSearch = !q ||
      tx.id.toLowerCase().includes(q) ||
      tx.note?.toLowerCase().includes(q) ||
      tx.token.toLowerCase().includes(q);
    return okType && okSearch;
  });

  const txPages  = Math.max(1, Math.ceil(filteredTx.length / TX_PER_PAGE));
  const pagedTx  = filteredTx.slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE);

  const matchWins   = transactions.filter((t) => t.type === "match_win").length;
  const matchLosses = transactions.filter((t) => t.type === "match_loss").length;
  const totalWon    = transactions.filter((t) => t.type === "match_win").reduce((s, t) => s + t.usdValue, 0);
  const totalLost   = transactions.filter((t) => t.type === "match_loss").reduce((s, t) => s + t.usdValue, 0);

  const copyAddress = () => {
    if (!connectedAddress) return;
    navigator.clipboard.writeText(connectedAddress);
    setCopiedAddress(true);
    toast({ title: "Address Copied", description: "Wallet address copied to clipboard." });
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <Landmark className="h-6 w-6 text-primary shrink-0" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">Non-Custodial</p>
          <h1 className="font-display text-2xl font-bold tracking-wide">Wallet</h1>
        </div>
      </div>

      {/* ── Architecture note (dev-visible) ── */}
      {/* DB-ready: wagmi useAccount() provides connectedAddress + network */}
      {/* DB-ready: wagmi useBalance({ address, token: USDT_CONTRACT }) provides usdtBalance */}

      {/* ── Not connected banner ── */}
      {!connectedAddress && (
        <div className="rounded-xl border border-arena-gold/30 bg-arena-gold/5 px-4 py-3 flex items-center gap-3">
          <WifiOff className="h-4 w-4 text-arena-gold shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-arena-gold">No wallet connected</p>
            <p className="text-xs text-muted-foreground">Connect MetaMask or WalletConnect to join matches</p>
          </div>
          <Button
            size="sm"
            className="font-display text-xs shrink-0"
            disabled={walletLinkBusy || !user}
            onClick={() => {
              void (async () => {
                setWalletLinkBusy(true);
                try {
                  const r = await linkMetaMaskWallet();
                  if (r.ok === false) {
                    toast({ variant: "destructive", title: "Wallet", description: r.error });
                  } else {
                    syncProfileWalletConnected();
                    toast({
                      title: "Wallet linked",
                      description: "MetaMask on BSC Testnet — address saved to your profile.",
                    });
                  }
                } finally {
                  setWalletLinkBusy(false);
                }
              })();
            }}
          >
            <Wallet className="mr-1.5 h-3.5 w-3.5" />
            {walletLinkBusy ? "Connecting…" : "Connect Wallet"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left col: balances + wallet info ── */}
        <div className="lg:col-span-1 space-y-4">

          {/* Connected Wallet Card */}
          <Card className="border-border/60 bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                  Connected Wallet
                </CardTitle>
                <button onClick={() => setBalanceVisible((v) => !v)} className="text-muted-foreground hover:text-foreground">
                  {balanceVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {/* Address */}
              {connectedAddress ? (
                <>
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground font-display uppercase tracking-wider mb-0.5">
                      {networkCfg.name}
                    </p>
                    <code className="font-mono text-xs text-foreground truncate block">{shortAddr}</code>
                  </div>
                  <button onClick={copyAddress} className="text-muted-foreground hover:text-foreground shrink-0">
                    {copiedAddress
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-arena-green" />
                      : <Copy className="h-3.5 w-3.5" />
                    }
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs font-display"
                    disabled={walletUnlinkBusy || !user}
                    onClick={() => {
                      void (async () => {
                        setWalletUnlinkBusy(true);
                        try {
                          const r = await unlinkMetaMaskWallet();
                          if (r.ok === false) {
                            toast({ variant: "destructive", title: "Wallet", description: r.error });
                            return;
                          }
                          toast({
                            title: "Wallet disconnected",
                            description: "Profile updated — this wallet is no longer linked.",
                          });
                        } finally {
                          setWalletUnlinkBusy(false);
                        }
                      })();
                    }}
                  >
                    <Unplug className="mr-1.5 h-3.5 w-3.5" />
                    {walletUnlinkBusy ? "…" : "Disconnect"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs font-display"
                    disabled={walletUnlinkBusy || !user}
                    onClick={() => {
                      void (async () => {
                        setWalletUnlinkBusy(true);
                        try {
                          const d = await unlinkMetaMaskWallet();
                          if (d.ok === false) {
                            toast({ variant: "destructive", title: "Wallet", description: d.error });
                            return;
                          }
                          const r = await linkMetaMaskWallet();
                          if (r.ok === false) {
                            toast({ variant: "destructive", title: "Wallet", description: r.error });
                            return;
                          }
                          syncProfileWalletConnected();
                          toast({
                            title: "Wallet switched",
                            description: "New address saved to your profile.",
                          });
                        } finally {
                          setWalletUnlinkBusy(false);
                        }
                      })();
                    }}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Switch wallet
                  </Button>
                </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border/60 bg-secondary/20 px-3 py-3 text-center">
                  <p className="text-xs text-muted-foreground">No wallet connected</p>
                </div>
              )}

              {/* USDT Balance */}
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 font-display">
                  USDT Balance — On-chain
                  {/* DB-ready: wagmi useBalance({ address, token: USDT_BSC_ADDRESS }) */}
                </p>
                <div className="flex items-end gap-1.5">
                  <span className="font-display text-3xl font-bold text-foreground">
                    {balanceVisible ? `$${usdtBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "••••••"}
                  </span>
                  <span className="text-xs text-muted-foreground mb-1">USDT</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Live balance from {networkCfg.name}
                </p>
              </div>

              {/* Escrow info */}
              <div className="rounded-lg border border-arena-gold/20 bg-arena-gold/5 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-display mb-1">How funds work</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  When you join a match, USDT goes directly from your wallet to <span className="text-arena-gold font-medium">ArenaEscrow</span>. Winners receive funds automatically from the contract.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Arena Tokens Card */}
          <Card className="border-border/60 bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                Arena Tokens (AT)
                {/* DB-ready: GET /api/users/me/at-balance — live balance synced after every purchase / Forge spend */}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="flex items-end gap-1.5">
                <span className="font-display text-3xl font-bold text-arena-purple">
                  {balanceVisible ? (forgeAT ?? atBalance).toLocaleString() : "••••"}
                </span>
                <span className="text-xs text-muted-foreground mb-1">AT</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Platform-only currency. Used in the Forge store for cosmetics, challenges and events.
              </p>
              {/* Buy AT — primary CTA */}
              <Button
                size="sm"
                className="w-full text-xs font-display bg-arena-purple hover:bg-arena-purple/90 text-white"
                onClick={() => setBuyATOpen(true)}
              >
                <Zap className="mr-1.5 h-3.5 w-3.5" /> Buy Arena Tokens
              </Button>
              {/* Withdraw AT → BNB */}
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs font-display border-arena-cyan/30 text-arena-cyan hover:bg-arena-cyan/10"
                disabled={!connectedAddress}
                title={!connectedAddress ? "Connect wallet to withdraw" : undefined}
                onClick={() => setWithdrawATOpen(true)}
              >
                <Flame className="mr-1.5 h-3.5 w-3.5" /> Withdraw (AT → BNB)
              </Button>
              {/* Secondary — open store */}
              <Link to="/forge">
                <Button size="sm" variant="outline" className="w-full text-xs font-display border-arena-purple/30 text-arena-purple hover:bg-arena-purple/10">
                  <Flame className="mr-1.5 h-3.5 w-3.5" /> Open Forge Store
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Daily Betting Limit */}
          <Card className="border-border/60 bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="font-display text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-arena-orange" /> Daily Betting Limit
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Used today</span>
                <span className="font-medium font-mono">${dailyBettingUsed} / ${dailyBettingLimit}</span>
              </div>
              <Progress value={(dailyBettingUsed / dailyBettingLimit) * 100} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground">
                Platform max: ${platformBettingMax}. Adjust in{" "}
                <Link to="/settings" className="text-primary hover:underline">Settings → Betting</Link>.
                {/* DB-ready: PATCH /api/wallet/daily-limit */}
              </p>
            </CardContent>
          </Card>

          {/* Match Stats Summary */}
          <Card className="border-border/60 bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                Match Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingUp className="h-3 w-3 text-primary" />
                    <span className="text-[10px] text-muted-foreground font-display uppercase">Wins</span>
                  </div>
                  <p className="font-display text-lg font-bold text-primary">{matchWins}</p>
                  <p className="text-[10px] text-arena-green">+${totalWon.toFixed(0)} USDT</p>
                </div>
                <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingDown className="h-3 w-3 text-destructive" />
                    <span className="text-[10px] text-muted-foreground font-display uppercase">Losses</span>
                  </div>
                  <p className="font-display text-lg font-bold text-destructive">{matchLosses}</p>
                  <p className="text-[10px] text-destructive">−${totalLost.toFixed(0)} USDT</p>
                </div>
              </div>
              <Link to="/history">
                <Button size="sm" variant="outline" className="w-full text-xs font-display border-border/60 mt-1">
                  <Swords className="mr-1.5 h-3.5 w-3.5" /> Full Match History
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* ── Right col: Transaction History ── */}
        <div className="lg:col-span-2">
          <Card className="border-border/60 bg-card h-full">
            <CardHeader className="pb-3 pt-4 px-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                  On-Chain Activity
                  {/* DB-ready: GET /api/wallet/transactions — includes escrow events, contract payouts, AT activity */}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 mr-1" /> Sync
                    {/* DB-ready: re-fetches wagmi events + DB log */}
                  </Button>
                </div>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search transactions…"
                    value={txSearch}
                    onChange={(e) => { setTxSearch(e.target.value); setTxPage(1); }}
                    className="pl-7 h-7 text-xs bg-secondary/60 border-border"
                  />
                </div>
                <div className="flex gap-1 flex-wrap">
                  {(["all", "escrow_lock", "match_win", "match_loss", "refund", "at_purchase", "at_spend", "at_withdrawal"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => { setTxFilter(f); setTxPage(1); }}
                      className={cn(
                        "px-2 py-0.5 rounded-md text-[10px] font-display font-semibold border transition-all",
                        txFilter === f
                          ? "bg-primary/20 text-primary border-primary/40"
                          : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                      )}
                    >
                      {f === "all" ? "All" : txTypeConfig[f]?.label ?? f}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent className="px-4 pb-4">
              {pagedTx.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Landmark className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No transactions found</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {pagedTx.map((tx) => {
                    const cfg    = txTypeConfig[tx.type];
                    const status = txStatusConfig[tx.status];
                    const isPos  = tx.amount > 0;
                    const netCfg = NETWORKS[selectedNetwork];

                    return (
                      <div key={tx.id}
                        className="flex items-center gap-3 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2.5 hover:bg-secondary/40 transition-colors">

                        {/* Icon */}
                        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0 text-base">
                          {cfg.icon}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn("text-xs font-medium font-display", cfg.color)}>{cfg.label}</span>
                            <Badge className={cn("text-[9px] px-1 py-0 border", status.color)}>{status.label}</Badge>
                            {tx.matchId && (
                              <span className="text-[10px] text-muted-foreground font-mono">{tx.matchId}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{tx.note ?? "—"}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" /> {tx.timestamp}
                            {tx.txHash && (
                              <a
                                href={`${netCfg.explorer}${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1 hover:text-primary transition-colors"
                              >
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                          </p>
                        </div>

                        {/* Amount */}
                        <div className="text-right shrink-0">
                          <p className={cn(
                            "font-display font-bold text-sm",
                            isPos ? "text-arena-green" : "text-destructive"
                          )}>
                            {isPos ? "+" : "−"}${Math.abs(tx.usdValue).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {Math.abs(tx.amount)} {tx.token}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {txPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                  <Button size="sm" variant="ghost" disabled={txPage === 1}
                    onClick={() => setTxPage((p) => p - 1)}
                    className="h-7 text-xs font-display">
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
                  </Button>
                  <span className="text-xs text-muted-foreground font-mono">
                    {txPage} / {txPages}
                  </span>
                  <Button size="sm" variant="ghost" disabled={txPage === txPages}
                    onClick={() => setTxPage((p) => p + 1)}
                    className="h-7 text-xs font-display">
                    Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Buy Arena Tokens Modal ── */}
      <BuyArenaTokensModal open={buyATOpen} onClose={() => setBuyATOpen(false)} />

      {/* ── Withdraw AT Modal ── */}
      <WithdrawATModal open={withdrawATOpen} onClose={() => setWithdrawATOpen(false)} />
    </div>
  );
};

export default WalletPage;
