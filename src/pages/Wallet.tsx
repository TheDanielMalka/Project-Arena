import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  CheckCircle2,
  Shield,
  Eye,
  EyeOff,
  RefreshCw,
  QrCode,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  Lock,
  Smartphone,
  ArrowLeftRight,
  Search,
  Download,
  Landmark,
  Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNotificationStore } from "@/stores/notificationStore";
import { useWalletStore } from "@/stores/walletStore";
import { useUserStore } from "@/stores/userStore";
import type { TransactionType, TransactionStatus, Network } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────

const NETWORKS: Record<Network, { name: string; color: string; explorer: string }> = {
  bsc: { name: "BNB Smart Chain", color: "text-arena-gold", explorer: "https://bscscan.com/tx/" },
  solana: { name: "Solana", color: "text-arena-purple", explorer: "https://solscan.io/tx/" },
  ethereum: { name: "Ethereum", color: "text-arena-cyan", explorer: "https://etherscan.io/tx/" },
};

const txTypeConfig: Record<TransactionType, { label: string; color: string; icon: string }> = {
  deposit: { label: "Deposit", color: "text-primary", icon: "↓" },
  withdrawal: { label: "Withdrawal", color: "text-arena-orange", icon: "↑" },
  match_win: { label: "Match Win", color: "text-primary", icon: "🏆" },
  match_loss: { label: "Match Loss", color: "text-destructive", icon: "💀" },
  fee: { label: "Platform Fee", color: "text-muted-foreground", icon: "%" },
  refund: { label: "Refund", color: "text-arena-cyan", icon: "↩" },
  escrow_lock: { label: "Escrow Lock", color: "text-arena-gold", icon: "🔒" },
  escrow_release: { label: "Escrow Release", color: "text-primary", icon: "🔓" },
};

const txStatusConfig: Record<TransactionStatus, { color: string }> = {
  completed: { color: "bg-primary/20 text-primary border-primary/30" },
  pending: { color: "bg-arena-orange/20 text-arena-orange border-arena-orange/30" },
  failed: { color: "bg-destructive/20 text-destructive border-destructive/30" },
  cancelled: { color: "bg-muted/40 text-muted-foreground border-border/40" },
};

// ─── Component ───────────────────────────────────────────────

const WalletPage = () => {
  const { toast } = useToast();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const { user } = useUserStore();
  const {
    tokens, transactions, dailyBettingLimit, dailyBettingUsed, addresses, selectedNetwork,
    setNetwork, getTotalBalance, withdraw,
  } = useWalletStore();

  const [balanceVisible, setBalanceVisible] = useState(true);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawToken, setWithdrawToken] = useState("USDT");
  const [depositNetwork, setDepositNetwork] = useState<Network>("bsc");
  const [txFilter, setTxFilter] = useState<TransactionType | "all">("all");
  const [txSearch, setTxSearch] = useState("");
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [withdrawWhitelist, setWithdrawWhitelist] = useState(true);
  const [txPage, setTxPage] = useState(1);

  const TX_PER_PAGE = 7;

  const totalBalance = getTotalBalance();
  const networkTokens = tokens.filter((t) => t.network === selectedNetwork);
  const walletAddress = addresses[depositNetwork];

  const filteredTx = transactions.filter((tx) => {
    const matchType = txFilter === "all" || tx.type === txFilter;
    const matchSearch = tx.id.toLowerCase().includes(txSearch.toLowerCase()) ||
      tx.note?.toLowerCase().includes(txSearch.toLowerCase()) ||
      tx.token.toLowerCase().includes(txSearch.toLowerCase());
    return matchType && matchSearch;
  });

  const txPages = Math.max(1, Math.ceil(filteredTx.length / TX_PER_PAGE));
  const pagedTx = filteredTx.slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE);

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    setCopiedAddress(true);
    toast({ title: "Address Copied", description: "Wallet address copied to clipboard." });
    addNotification({ type: "system", title: "📋 Address Copied", message: `Your ${NETWORKS[depositNetwork].name} deposit address was copied to clipboard.` });
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleWithdrawSubmit = () => {
    if (!withdrawAmount || !withdrawAddress) {
      toast({ title: "Missing Fields", description: "Please fill in amount and address.", variant: "destructive" });
      return;
    }
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid Amount", description: "Please enter a valid amount.", variant: "destructive" });
      return;
    }
    setWithdrawDialogOpen(false);
    setWithdrawConfirmOpen(true);
  };

  const confirmWithdraw = () => {
    const amount = parseFloat(withdrawAmount);
    const result = withdraw(amount, withdrawToken, withdrawAddress);
    if (result) {
      toast({ title: "Withdrawal Submitted", description: `${withdrawAmount} ${withdrawToken} sent to ${withdrawAddress.slice(0, 8)}...` });
      addNotification({ type: "payout", title: "💸 Withdrawal Submitted", message: `${withdrawAmount} ${withdrawToken} withdrawal to ${withdrawAddress.slice(0, 12)}... is being processed.` });
    } else {
      toast({ title: "Withdrawal Failed", description: "Insufficient balance.", variant: "destructive" });
    }
    setWithdrawConfirmOpen(false);
    setWithdrawAmount("");
    setWithdrawAddress("");
  };

  return (
    <div className="space-y-4">
      {/* ── Header (compact, same rhythm as Dashboard sections) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Landmark className="h-6 w-6 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">Treasury</p>
            <h1 className="font-display text-2xl font-bold tracking-wide truncate">Wallet</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={selectedNetwork} onValueChange={(v) => setNetwork(v as Network)}>
            <SelectTrigger className="h-8 w-[11rem] bg-secondary/80 border-border text-xs font-display">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bsc"><span className="flex items-center gap-2 text-xs">🟡 BNB Smart Chain</span></SelectItem>
              <SelectItem value="solana"><span className="flex items-center gap-2 text-xs">🟣 Solana</span></SelectItem>
              <SelectItem value="ethereum"><span className="flex items-center gap-2 text-xs">💎 Ethereum</span></SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-8 w-8 border-border" onClick={() => toast({ title: "Refreshing...", description: "Balances updated." })}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Hero vault strip (Command Center–style, tighter) ── */}
      <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="absolute top-0 right-0 w-40 h-24 bg-primary/5 blur-3xl pointer-events-none" />

        <div className="relative p-4 sm:p-5 flex flex-col lg:flex-row gap-4 lg:items-center">
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Portfolio (all chains)</p>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="font-display text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">
                    {balanceVisible ? `$${totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "••••••"}
                  </p>
                  <span className="text-[10px] font-mono text-primary/90 flex items-center gap-0.5">
                    <TrendingUp className="h-3 w-3" /> +$142.30 (2.1%) 24h
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setBalanceVisible(!balanceVisible)}>
                {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm" className="h-8 px-3 text-xs font-display bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25" onClick={() => setDepositDialogOpen(true)}>
                <ArrowDownLeft className="mr-1.5 h-3.5 w-3.5" /> Deposit
              </Button>
              <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-display border-arena-orange/35 text-arena-orange hover:bg-arena-orange/10" onClick={() => setWithdrawDialogOpen(true)}>
                <ArrowUpRight className="mr-1.5 h-3.5 w-3.5" /> Withdraw
              </Button>
              <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-display border-border text-muted-foreground hover:text-foreground" disabled>
                <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" /> Swap
              </Button>
            </div>
          </div>

          <div className="lg:w-px lg:self-stretch lg:bg-border shrink-0 hidden lg:block" />

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2 lg:min-w-[280px] xl:min-w-[420px]">
            <div className="rounded-xl border border-border/80 bg-secondary/30 px-3 py-2">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Daily bets</p>
              <p className="font-display text-sm font-bold tabular-nums">${dailyBettingUsed}<span className="text-muted-foreground font-normal"> / ${dailyBettingLimit}</span></p>
              <Progress value={(dailyBettingUsed / dailyBettingLimit) * 100} className="h-1 mt-1.5" />
            </div>
            {user && (
              <>
                <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Arena available</p>
                  <p className="font-display text-sm font-bold text-primary tabular-nums">${user.balance.available.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-arena-gold/25 bg-arena-gold/5 px-3 py-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">In escrow</p>
                  <p className="font-display text-sm font-bold text-arena-gold tabular-nums">${user.balance.inEscrow.toLocaleString()}</p>
                </div>
              </>
            )}
            <div className="rounded-xl border border-border/80 bg-secondary/30 px-3 py-2 flex flex-col justify-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Security</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Badge variant="outline" className="text-[9px] h-5 px-1.5 bg-primary/15 text-primary border-primary/30">Verified</Badge>
                <Badge variant="outline" className="text-[9px] h-5 px-1.5 bg-arena-gold/15 text-arena-gold border-arena-gold/30">Gold</Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Holdings: compact token tiles ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Holdings</span>
          <span className={`text-[10px] font-mono ${NETWORKS[selectedNetwork].color}`}>· {NETWORKS[selectedNetwork].name}</span>
          <div className="flex-1 h-px bg-border" />
          <Badge variant="outline" className="text-[9px] h-5 px-2 border-border font-mono">{networkTokens.length} assets</Badge>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
          {networkTokens.map((token) => (
            <div
              key={token.symbol}
              className="rounded-xl border border-border bg-card/80 px-3 py-2.5 flex items-center justify-between gap-2 transition-smooth hover:border-primary/25 hover:shadow-[0_0_20px_hsl(355_78%_52%/0.08)]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg leading-none shrink-0">{token.icon}</span>
                <div className="min-w-0">
                  <p className="font-display font-bold text-xs truncate">{token.symbol}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{token.name}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-xs font-semibold tabular-nums">
                  {balanceVisible ? token.balance.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "••••"}
                </p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {balanceVisible ? `$${token.usdValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "••••"}
                </p>
                <p className={`text-[10px] flex items-center justify-end gap-0.5 ${token.change24h >= 0 ? "text-primary" : "text-destructive"}`}>
                  {token.change24h >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                  {token.change24h > 0 ? "+" : ""}{token.change24h}%
                </p>
              </div>
            </div>
          ))}
          {networkTokens.length === 0 && (
            <div className="col-span-full text-center py-6 text-xs text-muted-foreground rounded-xl border border-dashed border-border">
              No assets on this network · pick another chain above
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="history" className="space-y-3">
        <TabsList className="bg-secondary border border-border h-8 p-0.5">
          <TabsTrigger value="history" className="font-display text-xs h-7 px-3 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            <Clock className="mr-1.5 h-3 w-3" /> Ledger
          </TabsTrigger>
          <TabsTrigger value="security" className="font-display text-xs h-7 px-3 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            <Shield className="mr-1.5 h-3 w-3" /> Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-0">
          <Card className="border-border bg-card overflow-hidden">
            <CardHeader className="py-3 px-4 space-y-0 border-b border-border/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="font-display text-sm font-bold tracking-wide">Movement log</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={txFilter} onValueChange={(v) => { setTxFilter(v as TransactionType | "all"); setTxPage(1); }}>
                    <SelectTrigger className="h-8 w-[8.5rem] bg-secondary/80 border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="deposit">Deposits</SelectItem>
                      <SelectItem value="withdrawal">Withdrawals</SelectItem>
                      <SelectItem value="match_win">Match wins</SelectItem>
                      <SelectItem value="match_loss">Match losses</SelectItem>
                      <SelectItem value="fee">Fees</SelectItem>
                      <SelectItem value="refund">Refunds</SelectItem>
                      <SelectItem value="escrow_lock">Escrow Lock</SelectItem>
                      <SelectItem value="escrow_release">Escrow Release</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="relative flex-1 min-w-[140px] sm:max-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search…" className="h-8 pl-8 text-xs bg-secondary/80 border-border" value={txSearch} onChange={(e) => setTxSearch(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" className="h-8 text-xs border-border" onClick={() => toast({ title: "Exported", description: "Transaction CSV downloaded." })}>
                    <Download className="h-3.5 w-3.5 mr-1" /> CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/60">
                {pagedTx.map((tx) => {
                  const config = txTypeConfig[tx.type];
                  return (
                    <div
                      key={tx.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 text-xs hover:bg-secondary/25 transition-colors border-b border-border/40 last:border-0"
                    >
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span className="text-sm w-6 text-center shrink-0">{config.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className={`font-display font-semibold truncate ${config.color}`}>{config.label}</p>
                          <p className="text-[10px] text-muted-foreground truncate font-mono">{tx.note || "—"}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 sm:gap-3 pl-8 sm:pl-0">
                        <div className={`font-mono font-bold tabular-nums ${tx.amount >= 0 ? "text-primary" : "text-destructive"}`}>
                          {tx.amount >= 0 ? "+" : ""}{tx.amount} {tx.token}
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:inline">${tx.usdValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                        <Badge variant="outline" className={`text-[9px] h-5 px-1.5 ${txStatusConfig[tx.status].color}`}>{tx.status}</Badge>
                        <span className="text-[10px] text-muted-foreground font-mono tabular-nums hidden md:inline">{tx.timestamp}</span>
                        {tx.txHash ? (
                          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] text-arena-cyan hover:text-arena-cyan/80">
                            <ExternalLink className="h-3 w-3 mr-0.5" />
                            <span className="font-mono">{tx.txHash.slice(0, 6)}…</span>
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground hidden sm:inline">Internal</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {pagedTx.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-8">No transactions match your filters</p>
              )}
              {txPages > 1 && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 bg-secondary/20">
                  <p className="text-[10px] text-muted-foreground font-mono">Page {txPage} of {txPages} · {filteredTx.length} entries</p>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2" disabled={txPage <= 1} onClick={() => setTxPage((p) => p - 1)}>Prev</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2" disabled={txPage >= txPages} onClick={() => setTxPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-0">
          <div className="grid md:grid-cols-2 gap-3">
            <Card className="border-border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-display flex items-center gap-2"><Lock className="h-4 w-4 text-arena-cyan" /> Withdrawal security</CardTitle>
                <CardDescription className="text-xs">Protections before you withdraw</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 border border-border/60">
                  <div>
                    <p className="font-medium text-xs">Two-factor authentication</p>
                    <p className="text-[10px] text-muted-foreground">Required for every withdrawal</p>
                  </div>
                  <Switch checked={twoFactorEnabled} onCheckedChange={setTwoFactorEnabled} className="scale-90" />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 border border-border/60">
                  <div>
                    <p className="font-medium text-xs">Withdrawal whitelist</p>
                    <p className="text-[10px] text-muted-foreground">Only addresses you approve</p>
                  </div>
                  <Switch checked={withdrawWhitelist} onCheckedChange={setWithdrawWhitelist} className="scale-90" />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 border border-border/60 opacity-80">
                  <div>
                    <p className="font-medium text-xs">24h withdrawal lock</p>
                    <p className="text-[10px] text-muted-foreground">New addresses wait before first withdrawal</p>
                  </div>
                  <Switch checked disabled className="scale-90" />
                </div>
                <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-1.5 text-primary text-xs font-display font-semibold mb-1">
                    <Shield className="h-3.5 w-3.5" /> Anti-phishing code
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1.5">Shown in official emails only</p>
                  <Input placeholder="Enter code…" className="h-8 text-xs bg-secondary border-border" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-display flex items-center gap-2"><Smartphone className="h-4 w-4 text-arena-purple" /> Devices</CardTitle>
                <CardDescription className="text-xs">Sessions with wallet access</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                {[
                  { name: "Chrome — Windows 11", ip: "192.168.1.***", time: "Active now", current: true },
                  { name: "Safari — iPhone 15 Pro", ip: "10.0.0.***", time: "2h ago", current: false },
                  { name: "Firefox — macOS", ip: "172.16.0.***", time: "3d ago", current: false },
                ].map((device, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 border border-border/60">
                    <div className="min-w-0">
                      <p className="font-medium text-xs flex items-center gap-1.5 truncate">
                        {device.name}
                        {device.current && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-primary/15 text-primary border-primary/30 shrink-0">Current</Badge>}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{device.ip} · {device.time}</p>
                    </div>
                    {!device.current && (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-[10px] h-7 px-2 shrink-0">
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" className="w-full h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10">
                  Revoke all other sessions
                </Button>
              </CardContent>
            </Card>

            <Card className="md:col-span-2 border-border">
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-display">Whitelisted addresses</CardTitle>
                    <CardDescription className="text-xs">Withdraw only to approved destinations</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 text-xs border-primary/30 text-primary hover:bg-primary/10">
                    + Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border/60">
                      <TableHead className="text-[10px] uppercase h-8">Label</TableHead>
                      <TableHead className="text-[10px] uppercase h-8">Address</TableHead>
                      <TableHead className="text-[10px] uppercase h-8">Network</TableHead>
                      <TableHead className="text-[10px] uppercase h-8">Added</TableHead>
                      <TableHead className="text-[10px] uppercase h-8 text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: "My Binance", address: "0x9e2...bb07", network: "BSC", added: "2026-02-15", active: true },
                      { label: "Hardware Wallet", address: "0x3c4...d5e8", network: "Ethereum", added: "2026-01-20", active: true },
                      { label: "Phantom Wallet", address: "7Xf9...J6kL", network: "Solana", added: "2026-03-08", active: false },
                    ].map((addr, i) => (
                      <TableRow key={i} className="border-border/40 h-9">
                        <TableCell className="text-xs font-medium py-1.5">{addr.label}</TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground py-1.5">{addr.address}</TableCell>
                        <TableCell className="text-xs py-1.5">{addr.network}</TableCell>
                        <TableCell className="text-[10px] text-muted-foreground py-1.5">{addr.added}</TableCell>
                        <TableCell className="text-right py-1.5">
                          {addr.active ? (
                            <Badge variant="outline" className="text-[9px] h-5 bg-primary/15 text-primary border-primary/30">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] h-5 bg-arena-orange/15 text-arena-orange border-arena-orange/30">
                              <Clock className="h-2.5 w-2.5 mr-0.5" /> 24h
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-base flex items-center gap-2">
              <ArrowDownLeft className="h-4 w-4 text-primary" /> Deposit
            </DialogTitle>
            <DialogDescription className="text-xs">Send crypto to your Arena wallet address</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Network</label>
              <Select value={depositNetwork} onValueChange={(v) => setDepositNetwork(v as Network)}>
                <SelectTrigger className="h-9 bg-secondary border-border text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bsc">🟡 BNB Smart Chain</SelectItem>
                  <SelectItem value="solana">🟣 Solana</SelectItem>
                  <SelectItem value="ethereum">💎 Ethereum</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col items-center py-4 px-3 rounded-xl bg-secondary/50 border border-border">
              <div className="w-32 h-32 bg-background rounded-lg border-2 border-dashed border-border flex items-center justify-center mb-3">
                <QrCode className="h-12 w-12 text-muted-foreground/30" />
              </div>
              <p className="text-[10px] text-muted-foreground text-center mb-2">Scan or copy below</p>
              <div className="flex items-center gap-2 w-full">
                <Input value={walletAddress} readOnly className="bg-background border-border font-mono text-[10px] h-9" />
                <Button size="icon" variant="outline" className="shrink-0 h-9 w-9 border-border" onClick={copyAddress}>
                  {copiedAddress ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-arena-orange/10 border border-arena-orange/20 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-arena-orange shrink-0 mt-0.5" />
              <p className="text-[10px] text-arena-orange leading-snug">
                Only send <strong>{NETWORKS[depositNetwork].name}</strong>-compatible tokens. Wrong network can mean permanent loss.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-base flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-arena-orange" /> Withdraw
            </DialogTitle>
            <DialogDescription className="text-xs">Send to an external wallet</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Token</label>
              <Select value={withdrawToken} onValueChange={setWithdrawToken}>
                <SelectTrigger className="h-9 bg-secondary border-border text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {tokens.map((t) => (
                    <SelectItem key={t.symbol} value={t.symbol}>
                      <span className="flex items-center gap-2 text-sm">{t.icon} {t.symbol} — {t.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Amount</label>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0.00"
                  className="bg-secondary border-border pr-14 h-9 text-sm"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-primary h-7 px-2"
                  onClick={() => {
                    const token = tokens.find((t) => t.symbol === withdrawToken);
                    if (token) setWithdrawAmount(String(token.balance));
                  }}
                >
                  MAX
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Recipient address</label>
              <Input
                placeholder="Wallet address…"
                className="bg-secondary border-border font-mono text-xs h-9"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
              />
            </div>

            <div className="p-2.5 rounded-lg bg-secondary/50 text-xs space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>Est. network fee</span>
                <span className="font-mono">~$0.35</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Daily bet limit</span>
                <span className="font-mono">${dailyBettingUsed} / ${dailyBettingLimit}</span>
              </div>
              <Separator className="my-1.5" />
              <div className="flex justify-between font-medium text-foreground">
                <span>You receive</span>
                <span className="font-mono text-primary">{withdrawAmount || "0.00"} {withdrawToken}</span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" className="h-9" onClick={() => setWithdrawDialogOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-9 bg-arena-orange text-primary-foreground hover:bg-arena-orange/90" onClick={handleWithdrawSubmit}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={withdrawConfirmOpen} onOpenChange={setWithdrawConfirmOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-arena-orange text-base">
              <AlertTriangle className="h-4 w-4" /> Confirm withdrawal
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Verify before you confirm:</p>
                <div className="p-2.5 rounded-lg bg-secondary/50 text-xs space-y-1.5 text-foreground">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-mono font-bold">{withdrawAmount} {withdrawToken}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">To</span>
                    <span className="font-mono text-[10px] break-all text-right">{withdrawAddress.slice(0, 12)}…{withdrawAddress.slice(-6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee</span>
                    <span className="font-mono">~$0.35</span>
                  </div>
                </div>
                <p className="text-[10px] text-destructive">Cannot undo after send. Double-check the address.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-9 bg-arena-orange text-primary-foreground hover:bg-arena-orange/90" onClick={confirmWithdraw}>
              Confirm & send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WalletPage;
