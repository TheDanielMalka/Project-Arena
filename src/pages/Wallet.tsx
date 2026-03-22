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
  Wallet,
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
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNotificationStore } from "@/stores/notificationStore";
import { useWalletStore } from "@/stores/walletStore";
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
};

// ─── Component ───────────────────────────────────────────────

const WalletPage = () => {
  const { toast } = useToast();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const {
    tokens, transactions, dailyLimit, dailyUsed, addresses, selectedNetwork,
    setNetwork, getTotalBalance, deposit, withdraw,
  } = useWalletStore();

  // State
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

  const TX_PER_PAGE = 5;

  // Computed
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

  // Handlers
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
    if (amount + dailyUsed > dailyLimit) {
      toast({ title: "Daily Limit Exceeded", description: `You can withdraw up to $${dailyLimit - dailyUsed} more today.`, variant: "destructive" });
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
      toast({ title: "Withdrawal Failed", description: "Insufficient balance or daily limit exceeded.", variant: "destructive" });
    }
    setWithdrawConfirmOpen(false);
    setWithdrawAmount("");
    setWithdrawAddress("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
            <Wallet className="h-8 w-8 text-primary" />
            Wallet
          </h1>
          <p className="text-muted-foreground mt-1">Manage your funds, deposits & withdrawals</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedNetwork} onValueChange={(v) => setNetwork(v as Network)}>
            <SelectTrigger className="w-48 bg-secondary border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bsc"><span className="flex items-center gap-2">🟡 BNB Smart Chain</span></SelectItem>
              <SelectItem value="solana"><span className="flex items-center gap-2">🟣 Solana</span></SelectItem>
              <SelectItem value="ethereum"><span className="flex items-center gap-2">💎 Ethereum</span></SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="border-border" onClick={() => toast({ title: "Refreshing...", description: "Balances updated." })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Balance Overview */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Total Balance Card */}
        <Card className="md:col-span-2 border-primary/20 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-arena-purple/5 pointer-events-none" />
          <CardContent className="p-6 relative">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground uppercase tracking-wider">Total Balance</p>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setBalanceVisible(!balanceVisible)}>
                {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
            <p className="font-display text-5xl font-bold tracking-tight mb-1">
              {balanceVisible ? `$${totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "••••••••"}
            </p>
            <p className="text-sm text-primary flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> +$142.30 (2.1%) today
            </p>

            <div className="flex flex-wrap gap-3 mt-6">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 glow-green" onClick={() => setDepositDialogOpen(true)}>
                <ArrowDownLeft className="mr-2 h-4 w-4" /> Deposit
              </Button>
              <Button variant="outline" className="border-arena-orange/30 text-arena-orange hover:bg-arena-orange/10" onClick={() => setWithdrawDialogOpen(true)}>
                <ArrowUpRight className="mr-2 h-4 w-4" /> Withdraw
              </Button>
              <Button variant="outline" className="border-arena-purple/30 text-arena-purple hover:bg-arena-purple/10">
                <ArrowLeftRight className="mr-2 h-4 w-4" /> Swap
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Daily Limits Card */}
        <Card className="border-border">
          <CardContent className="p-6 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">Daily Withdrawal</p>
              <div className="flex items-end justify-between mb-2">
                <span className="font-display text-2xl font-bold">${dailyUsed}</span>
                <span className="text-sm text-muted-foreground">/ ${dailyLimit}</span>
              </div>
              <Progress value={(dailyUsed / dailyLimit) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">${dailyLimit - dailyUsed} remaining today</p>
            </div>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Security Level</span>
                <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">Verified</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Account Tier</span>
                <Badge variant="outline" className="bg-arena-gold/20 text-arena-gold border-arena-gold/30">Gold</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Token Holdings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Holdings — {NETWORKS[selectedNetwork].name}</CardTitle>
            <Badge variant="outline" className="border-border font-mono text-xs">
              {networkTokens.length} tokens
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {networkTokens.map((token) => (
              <div
                key={token.symbol}
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border arena-hover"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{token.icon}</span>
                  <div>
                    <p className="font-semibold text-sm">{token.symbol}</p>
                    <p className="text-xs text-muted-foreground">{token.name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-sm">
                    {balanceVisible ? token.balance.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "••••"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {balanceVisible ? `$${token.usdValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "••••"}
                  </p>
                  <p className={`text-xs flex items-center justify-end gap-0.5 ${token.change24h >= 0 ? "text-primary" : "text-destructive"}`}>
                    {token.change24h >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {token.change24h > 0 ? "+" : ""}{token.change24h}%
                  </p>
                </div>
              </div>
            ))}
            {networkTokens.length === 0 && (
              <div className="col-span-full text-center py-8 text-muted-foreground">
                No tokens found on {NETWORKS[selectedNetwork].name}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transaction History + Security */}
      <Tabs defaultValue="history" className="space-y-4">
        <TabsList className="bg-secondary">
          <TabsTrigger value="history" className="data-[state=active]:bg-background">
            <Clock className="mr-2 h-4 w-4" /> Transactions
          </TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-background">
            <Shield className="mr-2 h-4 w-4" /> Security
          </TabsTrigger>
        </TabsList>

        {/* Transaction History */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-lg">Transaction History</CardTitle>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Select value={txFilter} onValueChange={(v) => { setTxFilter(v as TransactionType | "all"); setTxPage(1); }}>
                    <SelectTrigger className="w-full sm:w-40 bg-secondary border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="deposit">Deposits</SelectItem>
                      <SelectItem value="withdrawal">Withdrawals</SelectItem>
                      <SelectItem value="match_win">Match Wins</SelectItem>
                      <SelectItem value="match_loss">Match Losses</SelectItem>
                      <SelectItem value="fee">Fees</SelectItem>
                      <SelectItem value="refund">Refunds</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="relative w-full sm:w-48">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." className="pl-9 bg-secondary border-border" value={txSearch} onChange={(e) => setTxSearch(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" className="border-border" onClick={() => toast({ title: "Exported", description: "Transaction CSV downloaded." })}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">USD</TableHead>
                    <TableHead className="hidden md:table-cell">Note</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Time</TableHead>
                    <TableHead className="text-right">TX</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedTx.map((tx) => {
                    const config = txTypeConfig[tx.type];
                    return (
                      <TableRow key={tx.id} className="hover:bg-secondary/50">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{config.icon}</span>
                            <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className={`font-mono font-semibold ${tx.amount >= 0 ? "text-primary" : "text-destructive"}`}>
                          {tx.amount >= 0 ? "+" : ""}{tx.amount} {tx.token}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">${tx.usdValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[200px] truncate">{tx.note || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={txStatusConfig[tx.status].color}>{tx.status}</Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground font-mono">{tx.timestamp}</TableCell>
                        <TableCell className="text-right">
                          {tx.txHash ? (
                            <Button variant="ghost" size="sm" className="text-xs text-arena-cyan hover:text-arena-cyan/80 p-1 h-auto">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              <span className="font-mono">{tx.txHash.slice(0, 8)}...</span>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Internal</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {txPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">Page {txPage} of {txPages} ({filteredTx.length} transactions)</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={txPage <= 1} onClick={() => setTxPage((p) => p - 1)}>Prev</Button>
                    <Button size="sm" variant="outline" disabled={txPage >= txPages} onClick={() => setTxPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5 text-arena-cyan" /> Withdrawal Security</CardTitle>
                <CardDescription>Configure withdrawal protections</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="font-medium text-sm">Two-Factor Authentication</p>
                    <p className="text-xs text-muted-foreground">Require 2FA for all withdrawals</p>
                  </div>
                  <Switch checked={twoFactorEnabled} onCheckedChange={setTwoFactorEnabled} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="font-medium text-sm">Withdrawal Whitelist</p>
                    <p className="text-xs text-muted-foreground">Only allow withdrawals to approved addresses</p>
                  </div>
                  <Switch checked={withdrawWhitelist} onCheckedChange={setWithdrawWhitelist} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="font-medium text-sm">24h Withdrawal Lock</p>
                    <p className="text-xs text-muted-foreground">New addresses require 24h wait before withdrawal</p>
                  </div>
                  <Switch checked={true} disabled />
                </div>
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-2 text-primary text-sm font-medium mb-1">
                    <Shield className="h-4 w-4" /> Anti-Phishing Code
                  </div>
                  <p className="text-xs text-muted-foreground">Set a code that appears in all official emails to verify authenticity</p>
                  <Input placeholder="Enter anti-phishing code..." className="mt-2 bg-secondary border-border" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Smartphone className="h-5 w-5 text-arena-purple" /> Connected Devices</CardTitle>
                <CardDescription>Devices with access to your wallet</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { name: "Chrome — Windows 11", ip: "192.168.1.***", time: "Active now", current: true },
                  { name: "Safari — iPhone 15 Pro", ip: "10.0.0.***", time: "2h ago", current: false },
                  { name: "Firefox — macOS", ip: "172.16.0.***", time: "3 days ago", current: false },
                ].map((device, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                    <div>
                      <p className="font-medium text-sm flex items-center gap-2">
                        {device.name}
                        {device.current && <Badge variant="outline" className="text-[10px] bg-primary/20 text-primary border-primary/30">Current</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">{device.ip} · {device.time}</p>
                    </div>
                    {!device.current && (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs">
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" className="w-full mt-2 border-destructive/30 text-destructive hover:bg-destructive/10" size="sm">
                  Revoke All Other Sessions
                </Button>
              </CardContent>
            </Card>

            {/* Whitelisted Addresses */}
            <Card className="md:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Whitelisted Addresses</CardTitle>
                    <CardDescription>Pre-approved withdrawal addresses (24h lock for new entries)</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" className="border-primary/30 text-primary hover:bg-primary/10">
                    + Add Address
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: "My Binance", address: "0x9e2...bb07", network: "BSC", added: "2026-02-15", active: true },
                      { label: "Hardware Wallet", address: "0x3c4...d5e8", network: "Ethereum", added: "2026-01-20", active: true },
                      { label: "Phantom Wallet", address: "7Xf9...J6kL", network: "Solana", added: "2026-03-08", active: false },
                    ].map((addr, i) => (
                      <TableRow key={i} className="hover:bg-secondary/50">
                        <TableCell className="font-medium">{addr.label}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{addr.address}</TableCell>
                        <TableCell>{addr.network}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{addr.added}</TableCell>
                        <TableCell className="text-right">
                          {addr.active ? (
                            <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-arena-orange/20 text-arena-orange border-arena-orange/30">
                              <Clock className="h-3 w-3 mr-1" /> Pending 24h
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

      {/* ── Deposit Dialog ── */}
      <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ArrowDownLeft className="h-5 w-5 text-primary" /> Deposit Funds
            </DialogTitle>
            <DialogDescription>Send crypto to your Arena wallet address</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Network</label>
              <Select value={depositNetwork} onValueChange={(v) => setDepositNetwork(v as Network)}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bsc">🟡 BNB Smart Chain</SelectItem>
                  <SelectItem value="solana">🟣 Solana</SelectItem>
                  <SelectItem value="ethereum">💎 Ethereum</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* QR Placeholder */}
            <div className="flex flex-col items-center py-6 px-4 rounded-lg bg-secondary border border-border">
              <div className="w-40 h-40 bg-background rounded-lg border-2 border-dashed border-border flex items-center justify-center mb-4">
                <QrCode className="h-16 w-16 text-muted-foreground/30" />
              </div>
              <p className="text-xs text-muted-foreground text-center mb-3">Scan QR code or copy address below</p>
              <div className="flex items-center gap-2 w-full">
                <Input value={walletAddress} readOnly className="bg-background border-border font-mono text-xs" />
                <Button size="icon" variant="outline" className="shrink-0 border-border" onClick={copyAddress}>
                  {copiedAddress ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-arena-orange/10 border border-arena-orange/20 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-arena-orange shrink-0 mt-0.5" />
              <div className="text-xs text-arena-orange">
                <p className="font-semibold">Important:</p>
                <p>Only send <strong>{NETWORKS[depositNetwork].name}</strong> compatible tokens to this address. Sending tokens on the wrong network may result in permanent loss.</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Withdraw Dialog ── */}
      <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-arena-orange" /> Withdraw Funds
            </DialogTitle>
            <DialogDescription>Send crypto to an external wallet</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Token</label>
              <Select value={withdrawToken} onValueChange={setWithdrawToken}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {tokens.map((t) => (
                    <SelectItem key={t.symbol} value={t.symbol}>
                      <span className="flex items-center gap-2">{t.icon} {t.symbol} — {t.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Amount</label>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0.00"
                  className="bg-secondary border-border pr-16"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary h-7 px-2"
                  onClick={() => {
                    const token = tokens.find((t) => t.symbol === withdrawToken);
                    if (token) setWithdrawAmount(String(token.balance));
                  }}
                >
                  MAX
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Recipient Address</label>
              <Input
                placeholder="Enter wallet address..."
                className="bg-secondary border-border font-mono text-sm"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
              />
            </div>

            <div className="p-3 rounded-lg bg-secondary text-sm space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>Network Fee (est.)</span>
                <span className="font-mono">~$0.35</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Daily Limit Used</span>
                <span className="font-mono">${dailyUsed} / ${dailyLimit}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-medium text-foreground">
                <span>You Receive</span>
                <span className="font-mono text-primary">{withdrawAmount || "0.00"} {withdrawToken}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawDialogOpen(false)}>Cancel</Button>
            <Button className="bg-arena-orange text-primary-foreground hover:bg-arena-orange/90" onClick={handleWithdrawSubmit}>
              Review Withdrawal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Withdraw Confirmation ── */}
      <AlertDialog open={withdrawConfirmOpen} onOpenChange={setWithdrawConfirmOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-arena-orange">
              <AlertTriangle className="h-5 w-5" /> Confirm Withdrawal
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Please verify the following details carefully:</p>
                <div className="p-3 rounded-lg bg-secondary text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-mono font-bold text-foreground">{withdrawAmount} {withdrawToken}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To Address</span>
                    <span className="font-mono text-xs text-foreground">{withdrawAddress.slice(0, 12)}...{withdrawAddress.slice(-6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Network Fee</span>
                    <span className="font-mono text-foreground">~$0.35</span>
                  </div>
                </div>
                <p className="text-xs text-destructive">⚠️ This action cannot be reversed. Double-check the recipient address.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-arena-orange text-primary-foreground hover:bg-arena-orange/90" onClick={confirmWithdraw}>
              Confirm & Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WalletPage;
