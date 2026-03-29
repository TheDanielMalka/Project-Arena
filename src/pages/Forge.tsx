import { useState, useMemo, useEffect, createContext, useContext } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Flame, Zap, Trophy, Package, Crown, Shield, Target, Gift,
  Clock, CheckCircle2, Lock, Ticket, Sparkles, ShoppingBag,
  ChevronRight, Users2, Timer, Award, Star, Tag, Percent,
  CalendarDays, TrendingUp, Eye, EyeOff, AlertTriangle,
} from "lucide-react";
import { useForgeStore } from "@/stores/forgeStore";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { cn } from "@/lib/utils";
import type { ForgeCategory } from "@/types";

// ─── Purchase Confirm Context ─────────────────────────────────────────────────
// Centralises the confirm dialog so every tab (Shop, Drops, Events) can open it
// without prop drilling. Challenges (claim reward) don't require a confirm.

interface PendingPurchase {
  icon:     string;
  name:     string;
  price:    number;
  currency: "AT" | "USDT";
  label?:   string;         // e.g. "Event Entry", "Hot Drop", "Item"
  onConfirm: () => { success: boolean; error?: string };
  onSuccess?: () => void;
}

interface ForgeConfirmCtx {
  openConfirm: (purchase: PendingPurchase) => void;
  openAtTopUp: () => void;
}

const ForgeConfirmContext = createContext<ForgeConfirmCtx>({
  openConfirm: () => {},
  openAtTopUp: () => {},
});
const useForgeConfirm = () => useContext(ForgeConfirmContext);

// ─── Purchase Confirm Dialog ──────────────────────────────────────────────────
function PurchaseConfirmDialog({
  pending, onClose,
}: {
  pending: PendingPurchase | null;
  onClose: () => void;
}) {
  const [pw, setPw]           = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  // Reset when dialog opens/closes
  useEffect(() => { if (!pending) { setPw(""); setError(""); setLoading(false); } }, [pending]);

  const handleConfirm = () => {
    if (!pw) { setError("Please enter your password to confirm."); return; }
    // DB-ready: POST /api/auth/verify-password { password: pw }
    //           server verifies bcrypt hash before allowing purchase
    setLoading(true);
    setError("");
    // Simulate async verify (replace with real API call)
    setTimeout(() => {
      const result = pending!.onConfirm();
      setLoading(false);
      if (result.success) {
        pending!.onSuccess?.();
        onClose();
      } else {
        setError(result.error ?? "Purchase failed. Please try again.");
      }
    }, 400);
  };

  const isUSDT   = pending?.currency === "USDT";
  const accentCl = isUSDT ? "text-destructive" : "text-arena-purple";
  const borderCl = isUSDT ? "border-destructive/35" : "border-arena-purple/30";
  const bgCl     = isUSDT ? "bg-destructive/8" : "bg-arena-purple/5";

  return (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn("max-w-sm p-0 overflow-hidden border bg-card", borderCl)}>
        <DialogDescription className="sr-only">Confirm purchase</DialogDescription>

        {/* Header */}
        <div className={cn("flex items-center gap-3 px-5 py-4 border-b border-border/60", bgCl)}>
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl border text-xl shrink-0", borderCl, bgCl)}>
            {pending?.icon}
          </div>
          <div className="min-w-0">
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide truncate">
                {pending?.name}
              </DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {pending?.label ?? "Forge Purchase"}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Price summary */}
          <div className="rounded-lg border border-border/60 bg-secondary/40 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-display">Total Cost</p>
              <p className={cn("font-display text-2xl font-bold mt-0.5", accentCl)}>
                {pending?.price} <span className="text-sm font-semibold">{pending?.currency}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-display">Method</p>
              <p className="text-xs font-medium mt-0.5">
                {isUSDT ? "🔒 Smart Contract" : "⚡ Arena Tokens"}
              </p>
            </div>
          </div>

          {/* USDT warning */}
          {isUSDT && (
            <div className="flex items-start gap-2 rounded-lg border border-arena-gold/20 bg-arena-gold/5 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-arena-gold shrink-0 mt-0.5" />
              <p className="text-[11px] text-arena-gold/80 leading-relaxed">
                This will deduct <strong>{pending?.price} USDT</strong> from your connected wallet via smart contract. This action cannot be undone.
              </p>
            </div>
          )}

          {/* Password field */}
          <div>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              Enter your password to confirm
              {/* DB-ready: POST /api/auth/verify-password before executing purchase */}
            </p>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type={showPw ? "text" : "password"}
                placeholder="Your account password"
                value={pw}
                onChange={(e) => { setPw(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
                className="pl-9 pr-9 h-9 text-sm bg-secondary/60 border-border"
                autoFocus
              />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {error && <p className="text-[11px] text-destructive mt-1">{error}</p>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="flex-1 text-xs font-display border border-border/60"
            onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button size="sm" disabled={!pw || loading}
            onClick={handleConfirm}
            className={cn(
              "flex-1 text-xs font-display font-bold",
              isUSDT
                ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                : "bg-arena-purple hover:bg-arena-purple/80 text-white"
            )}>
            {loading
              ? <><span className="animate-spin mr-1.5">⟳</span> Verifying…</>
              : <><ShoppingBag className="mr-1.5 h-3.5 w-3.5" /> Confirm Purchase</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Shown when user taps an AT purchase but balance is too low — no password step. */
function ArenaTokensTopUpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm border border-primary/25 bg-card">
        <DialogDescription className="sr-only">Top up Arena Tokens</DialogDescription>
        <DialogHeader>
          <DialogTitle className="font-display text-base font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" /> Need more Arena Tokens
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Your balance is not enough for this purchase. Top up Arena Tokens in your wallet, then come back to complete the buy.
        </p>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1 text-xs font-display font-bold"
            onClick={() => {
              onClose();
              navigate("/wallet");
            }}
          >
            Go to Wallet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rarity config ────────────────────────────────────────────

const RARITY_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  common:    { color: "#6B7280", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.35)", label: "Common"    },
  rare:      { color: "#3B82F6", bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.35)",  label: "Rare"      },
  epic:      { color: "#A855F7", bg: "rgba(168,85,247,0.08)",  border: "rgba(168,85,247,0.35)",  label: "Epic"      },
  legendary: { color: "#F59E0B", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.35)",  label: "Legendary" },
};

const CATEGORY_PILLS: Array<{ value: ForgeCategory | "all"; label: string; icon: React.ReactNode }> = [
  { value: "all",    label: "All",     icon: <Sparkles className="w-3.5 h-3.5" /> },
  { value: "avatar", label: "Avatars", icon: <Star      className="w-3.5 h-3.5" /> },
  { value: "badge",  label: "Badges",  icon: <Award     className="w-3.5 h-3.5" /> },
  { value: "boost",  label: "Boosts",  icon: <Zap       className="w-3.5 h-3.5" /> },
  { value: "vip",    label: "VIP",     icon: <Crown     className="w-3.5 h-3.5" /> },
  { value: "bundle", label: "Bundles", icon: <Package   className="w-3.5 h-3.5" /> },
];

const TABS = [
  { value: "shop",       label: "Shop",       icon: <ShoppingBag className="w-4 h-4" /> },
  { value: "challenges", label: "Challenges", icon: <Target      className="w-4 h-4" /> },
  { value: "events",     label: "Events",     icon: <Trophy      className="w-4 h-4" /> },
  { value: "drops",      label: "Hot Drops",  icon: <Flame       className="w-4 h-4" /> },
];

// ─── Helpers ─────────────────────────────────────────────────

function formatCountdown(isoDate: string): string {
  const diff = Math.max(0, new Date(isoDate).getTime() - Date.now());
  if (diff === 0) return "Expired";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m`;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function useCountdown(isoDate?: string) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isoDate) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isoDate]);
  return isoDate ? formatCountdown(isoDate) : null;
}

// ─── Sub-components ───────────────────────────────────────────

interface ItemCardProps {
  item: ReturnType<typeof useForgeStore.getState>["items"][number];
  onBuy: (itemId: string, currency: "AT" | "USDT") => void;
  success: boolean;
  error: string | null;
  arenaTokens: number;
}

function ItemCard({ item, onBuy, success, error, arenaTokens }: ItemCardProps) {
  const rc = RARITY_CONFIG[item.rarity];
  const countdown = useCountdown(item.expiresAt);

  return (
    <div
      className="relative flex flex-col rounded-lg border p-2.5 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg cursor-default"
      style={{
        background: rc.bg,
        borderColor: rc.border,
        boxShadow: success ? `0 0 14px ${rc.color}35` : undefined,
      }}
    >
      {/* Rarity glow overlay */}
      <div
        className="pointer-events-none absolute inset-0 rounded-lg opacity-20"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${rc.color}33 0%, transparent 70%)` }}
      />

      {/* Badges row */}
      <div className="relative flex items-center gap-1 mb-2 flex-wrap">
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
          style={{ background: `${rc.color}22`, color: rc.color, border: `1px solid ${rc.color}44` }}
        >
          {rc.label}
        </span>
        {item.limited && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive border border-destructive/30">
            Limited
          </span>
        )}
        {item.featured && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
            Featured
          </span>
        )}
      </div>

      {/* Icon + name */}
      <div className="relative flex items-center gap-2 mb-1.5">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: `${rc.color}18`, border: `1px solid ${rc.color}44` }}
        >
          {item.icon}
        </div>
        <div className="min-w-0">
          <p className="font-display font-semibold text-xs text-foreground leading-tight truncate">{item.name}</p>
          {item.ownedBy !== undefined && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              <Users2 className="w-2.5 h-2.5 inline mr-0.5" />{item.ownedBy.toLocaleString()} own this
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="relative text-[11px] text-muted-foreground leading-snug mb-2 line-clamp-2 flex-1">
        {item.description}
      </p>

      {/* Stock / countdown */}
      {(item.stock !== undefined || countdown) && (
        <div className="relative flex items-center gap-2 mb-2 text-[10px] text-muted-foreground">
          {item.stock !== undefined && (
            <span className="flex items-center gap-1">
              <Tag className="w-3 h-3" />{item.stock} left
            </span>
          )}
          {countdown && (
            <span className="flex items-center gap-1 text-amber-400">
              <Clock className="w-3 h-3" />{countdown}
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="relative text-[10px] text-destructive mb-1.5 font-medium">{error}</p>
      )}

      {/* Buy buttons */}
      <div className="relative flex flex-col gap-1 mt-auto">
        {item.priceAT && (
          <Button
            size="sm"
            variant={success ? "default" : "outline"}
            className={cn(
              "h-7 text-[11px] font-semibold w-full transition-all",
              success && "bg-primary/20 text-primary border-primary/30",
              !success && arenaTokens < item.priceAT && "border-amber-500/40 text-amber-600 dark:text-amber-400"
            )}
            onClick={() => onBuy(item.id, "AT")}
            disabled={success}
          >
            {success ? (
              <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Purchased!</>
            ) : (
              <><Zap className="w-3.5 h-3.5 mr-1.5" />{item.priceAT.toLocaleString()} AT</>
            )}
          </Button>
        )}
        {item.priceUSDT && (
          <Button
            size="sm"
            className={cn(
              "h-7 text-[11px] font-semibold w-full",
              success && "bg-green-500/20 text-green-400 border-green-500/30",
              !success && "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            )}
            onClick={() => onBuy(item.id, "USDT")}
            disabled={success}
          >
            {success ? (
              <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Purchased!</>
            ) : (
              <>${item.priceUSDT.toFixed(2)} USDT</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Shop Tab ────────────────────────────────────────────────

function ShopTab() {
  const { items, arenaTokens, purchaseItem, getFeaturedItem, getItemsByCategory } = useForgeStore();
  const { openConfirm, openAtTopUp } = useForgeConfirm();
  const featured = getFeaturedItem();
  const [category, setCategory] = useState<ForgeCategory | "all">("all");
  const [successItems, setSuccessItems] = useState<Set<string>>(new Set());
  const [errorItem, setErrorItem] = useState<{ id: string; msg: string } | null>(null);
  const featuredCountdown = useCountdown(featured?.expiresAt);

  const filteredItems = useMemo(
    () => getItemsByCategory(category).filter((i) => !i.featured),
    [category, items]
  );

  function handleBuy(itemId: string, currency: "AT" | "USDT") {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if (currency === "AT" && item.priceAT != null && arenaTokens < item.priceAT) {
      openAtTopUp();
      return;
    }
    const price = currency === "AT" ? item.priceAT! : item.priceUSDT!;
    openConfirm({
      icon: item.icon ?? "🛒",
      name: item.name,
      price,
      currency,
      label: `Forge Shop · ${item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1)}`,
      onConfirm: () => {
        setErrorItem(null);
        return purchaseItem(itemId, currency);
      },
      onSuccess: () => {
        setSuccessItems((prev) => new Set(prev).add(itemId));
        setTimeout(() => setSuccessItems((prev) => { const n = new Set(prev); n.delete(itemId); return n; }), 2000);
      },
    });
  }

  const featuredRc = featured ? RARITY_CONFIG[featured.rarity] : RARITY_CONFIG.legendary;

  return (
    <div className="space-y-6">
      {/* AT Balance pill */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">Forge Shop</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Spend Arena Tokens or USDT on exclusive items</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
          <Zap className="w-4 h-4 text-primary" />
          <span className="font-bold text-primary">{arenaTokens.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">AT</span>
        </div>
      </div>

      {/* Featured hero */}
      {featured && (
        <div
          className="relative overflow-hidden rounded-xl p-4 border"
          style={{
            background: `linear-gradient(135deg, ${featuredRc.color}18 0%, rgba(0,0,0,0.4) 60%, ${featuredRc.color}10 100%)`,
            borderColor: featuredRc.border,
            boxShadow: `0 0 28px ${featuredRc.color}28, inset 0 1px 0 ${featuredRc.color}18`,
          }}
        >
          {/* Background glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at 80% 50%, ${featuredRc.color}20 0%, transparent 60%)`,
            }}
          />
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span
              className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full animate-pulse"
              style={{ background: `${featuredRc.color}30`, color: featuredRc.color, border: `1px solid ${featuredRc.color}50` }}
            >
              ★ Featured
            </span>
          </div>

          <div className="relative flex items-center gap-4 flex-wrap">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
              style={{
                background: `${featuredRc.color}18`,
                border: `2px solid ${featuredRc.color}55`,
                boxShadow: `0 0 14px ${featuredRc.color}35`,
              }}
            >
              {featured.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ background: `${featuredRc.color}22`, color: featuredRc.color }}
                >
                  {RARITY_CONFIG[featured.rarity].label}
                </span>
                {featured.limited && (
                  <Badge variant="destructive" className="text-[10px] font-bold px-1.5 py-0">Limited Edition</Badge>
                )}
              </div>
              <h3 className="font-display text-lg font-bold text-foreground">{featured.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md line-clamp-2">{featured.description}</p>

              <div className="flex items-center gap-3 mt-2 flex-wrap text-xs">
                {featured.stock !== undefined && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Tag className="w-3.5 h-3.5" />
                    <span><strong className="text-foreground">{featured.stock}</strong> remaining</span>
                  </span>
                )}
                {featuredCountdown && (
                  <span className="flex items-center gap-1.5 font-mono font-semibold" style={{ color: featuredRc.color }}>
                    <Timer className="w-3.5 h-3.5" />{featuredCountdown}
                  </span>
                )}
                {featured.ownedBy !== undefined && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Users2 className="w-3.5 h-3.5" />{featured.ownedBy} owners
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 flex-shrink-0">
              {errorItem?.id === featured.id && (
                <p className="text-[10px] text-destructive font-medium">{errorItem.msg}</p>
              )}
              {featured.priceAT && (
                <Button
                  className={cn(
                    "h-8 px-4 text-xs font-bold",
                    !successItems.has(featured.id) &&
                      arenaTokens < featured.priceAT &&
                      "border-amber-500/50 text-amber-600 dark:text-amber-400"
                  )}
                  variant={successItems.has(featured.id) ? "default" : "outline"}
                  style={
                    !successItems.has(featured.id) && arenaTokens >= featured.priceAT
                      ? { borderColor: featuredRc.color, color: featuredRc.color }
                      : undefined
                  }
                  onClick={() => handleBuy(featured.id, "AT")}
                  disabled={successItems.has(featured.id)}
                >
                  {successItems.has(featured.id) ? (
                    <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Purchased!</>
                  ) : (
                    <><Zap className="w-3.5 h-3.5 mr-1.5" />{featured.priceAT.toLocaleString()} AT</>
                  )}
                </Button>
              )}
              {featured.priceUSDT && (
                <Button
                  className="h-8 px-4 text-xs font-bold bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={() => handleBuy(featured.id, "USDT")}
                  disabled={successItems.has(featured.id)}
                >
                  ${featured.priceUSDT.toFixed(2)} USDT
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORY_PILLS.map((pill) => (
          <button
            key={pill.value}
            onClick={() => setCategory(pill.value)}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all",
              category === pill.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card/30 border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {pill.icon}
            {pill.label}
          </button>
        ))}
      </div>

      {/* Item grid */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No items in this category</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {filteredItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onBuy={handleBuy}
              success={successItems.has(item.id)}
              error={errorItem?.id === item.id ? errorItem.msg : null}
              arenaTokens={arenaTokens}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Challenges Tab ───────────────────────────────────────────

function ChallengesTab() {
  const { arenaTokens, getDailyChallenges, getWeeklyChallenges, claimChallenge } = useForgeStore();
  const daily  = getDailyChallenges();
  const weekly = getWeeklyChallenges();
  const [justClaimed, setJustClaimed] = useState<Set<string>>(new Set());

  function handleClaim(id: string) {
    const result = claimChallenge(id);
    if (result.success) {
      setJustClaimed((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setJustClaimed((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2000);
    }
  }

  function ChallengeRow({ challenge }: { challenge: ReturnType<typeof getDailyChallenges>[number] }) {
    const progressPct = Math.min(100, (challenge.progress / challenge.target) * 100);
    const isClaimed   = challenge.status === "claimed";
    const isClaimable = challenge.status === "claimable";
    const wasJustClaimed = justClaimed.has(challenge.id);

    return (
      <div
        className={cn(
          "relative flex items-center gap-3 rounded-lg border p-2.5 transition-all",
          isClaimed
            ? "bg-card/20 border-border/20 opacity-60"
            : "bg-card/30 border-border/40 hover:border-border/70"
        )}
      >
        {/* Icon */}
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 border",
            isClaimed ? "bg-muted/20 border-border/20" : "bg-primary/10 border-primary/20"
          )}
        >
          {challenge.icon}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className={cn("font-semibold text-sm", isClaimed && "line-through text-muted-foreground")}>
              {challenge.title}
            </p>
            {isClaimable && !isClaimed && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">
                Ready
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-2">{challenge.description}</p>

          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  background: isClaimed
                    ? "var(--muted)"
                    : isClaimable
                    ? "#22c55e"
                    : "var(--primary)",
                }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
              {challenge.progress}/{challenge.target}
            </span>
          </div>
        </div>

        {/* Reward + claim */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1 text-xs font-bold text-primary">
            <Zap className="w-3 h-3" />{challenge.rewardAT} AT
          </div>
          <div className="text-[11px] text-muted-foreground">+{challenge.rewardXP} XP</div>
          {isClaimed ? (
            <div className="flex items-center gap-1 text-xs text-green-400 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />Claimed
            </div>
          ) : isClaimable ? (
            <Button
              size="sm"
              className={cn(
                "h-7 px-3 text-xs font-bold transition-all",
                wasJustClaimed
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : "bg-green-500 hover:bg-green-600 text-white"
              )}
              onClick={() => handleClaim(challenge.id)}
            >
              {wasJustClaimed ? <><CheckCircle2 className="w-3 h-3 mr-1" />Done!</> : "Claim"}
            </Button>
          ) : (
            <Lock className="w-3.5 h-3.5 text-muted-foreground/50" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* AT Balance */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">Challenges</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Complete tasks to earn Arena Tokens and XP</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
          <Zap className="w-4 h-4 text-primary" />
          <span className="font-bold text-primary">{arenaTokens.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">AT Balance</span>
        </div>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Daily Active",    value: daily.filter(c => c.status === "active").length,    icon: <Target className="w-3.5 h-3.5" />,       color: "text-primary" },
          { label: "Ready to Claim",  value: [...daily, ...weekly].filter(c => c.status === "claimable").length, icon: <Gift className="w-3.5 h-3.5" />, color: "text-green-400" },
          { label: "Weekly Active",   value: weekly.filter(c => c.status === "active").length,   icon: <TrendingUp className="w-3.5 h-3.5" />,   color: "text-amber-400" },
          { label: "Completed Today", value: daily.filter(c => c.status === "claimed").length,   icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-muted-foreground" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card/30 border border-border/40 rounded-lg p-2 text-center">
            <div className={cn("flex justify-center mb-0.5", stat.color)}>{stat.icon}</div>
            <div className={cn("text-lg font-bold font-display", stat.color)}>{stat.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Daily challenges */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-sm text-foreground">Daily Challenges</h3>
          <span className="text-[11px] text-muted-foreground">— Resets in <span className="text-amber-400 font-mono">{formatCountdown(daily[0]?.expiresAt ?? "")}</span></span>
        </div>
        <div className="space-y-2">
          {daily.map((c) => <ChallengeRow key={c.id} challenge={c} />)}
        </div>
      </div>

      {/* Weekly challenges */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-amber-400" />
          <h3 className="font-display font-semibold text-sm text-foreground">Weekly Challenges</h3>
          <span className="text-[11px] text-muted-foreground">— Resets in <span className="text-amber-400 font-mono">{formatCountdown(weekly[0]?.expiresAt ?? "")}</span></span>
        </div>
        <div className="space-y-2">
          {weekly.map((c) => <ChallengeRow key={c.id} challenge={c} />)}
        </div>
      </div>
    </div>
  );
}

// ─── Events Tab ───────────────────────────────────────────────

function EventsTab() {
  const { getActiveEvents, getUpcomingEvents, joinEvent } = useForgeStore();
  const { openConfirm } = useForgeConfirm();
  const activeEvents   = getActiveEvents();
  const upcomingEvents = getUpcomingEvents();
  const [joinedNow, setJoinedNow]   = useState<Set<string>>(new Set());
  const [joinError, setJoinError]   = useState<{ id: string; msg: string } | null>(null);

  function handleJoin(eventId: string) {
    const allEvents = [...getActiveEvents(), ...getUpcomingEvents()];
    const event = allEvents.find((e) => e.id === eventId);
    if (!event) return;
    // Free events — join directly, no confirm
    if (!event.entryFee) {
      const result = joinEvent(eventId);
      if (result.success) setJoinedNow((prev) => new Set(prev).add(eventId));
      else { setJoinError({ id: eventId, msg: result.error ?? "Could not join" }); setTimeout(() => setJoinError(null), 3000); }
      return;
    }
    openConfirm({
      icon: "🏆",
      name: event.name,
      price: event.entryFee,
      currency: "USDT",
      label: "Event Entry Fee",
      onConfirm: () => {
        setJoinError(null);
        return joinEvent(eventId);
      },
      onSuccess: () => setJoinedNow((prev) => new Set(prev).add(eventId)),
    });
  }

  function EventCard({ event }: { event: ReturnType<typeof getActiveEvents>[number] }) {
    const isActive   = event.status === "active";
    const isUpcoming = event.status === "upcoming";
    const endCountdown   = useCountdown(event.endAt);
    const startCountdown = useCountdown(event.startAt);
    const fillPct = event.maxParticipants
      ? Math.min(100, (event.participants / event.maxParticipants) * 100)
      : null;

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border p-3.5 transition-all hover:border-border/70",
          isActive ? "bg-card/30 border-border/40" : "bg-card/20 border-border/30"
        )}
      >
        {/* Live badge */}
        {isActive && (
          <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 border border-red-500/40">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">Live</span>
          </div>
        )}
        {isUpcoming && (
          <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
            <CalendarDays className="w-3 h-3 text-primary" />
            <span className="text-[11px] font-bold text-primary uppercase tracking-wider">Soon</span>
          </div>
        )}

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-xl flex-shrink-0">
            {event.icon}
          </div>
          <div className="flex-1 min-w-0 pr-16">
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <h4 className="font-display font-bold text-sm text-foreground">{event.name}</h4>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-card/50 border border-border/30 text-muted-foreground">
                {event.game}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-card/50 border border-border/30 text-muted-foreground capitalize">
                {event.type}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">{event.description}</p>

            {/* Reward/prize row */}
            <div className="flex items-center gap-4 flex-wrap text-xs mb-3">
              {event.prizePool && (
                <span className="flex items-center gap-1 font-semibold text-amber-400">
                  <Trophy className="w-3.5 h-3.5" />${event.prizePool.toLocaleString()} prize pool
                </span>
              )}
              {event.rewardAT && (
                <span className="flex items-center gap-1 font-semibold text-primary">
                  <Zap className="w-3.5 h-3.5" />{event.rewardAT.toLocaleString()} AT reward
                </span>
              )}
              {event.entryFee ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Ticket className="w-3.5 h-3.5" />${event.entryFee} entry
                </span>
              ) : (
                <span className="flex items-center gap-1 text-green-400 font-medium">
                  <Gift className="w-3.5 h-3.5" />Free entry
                </span>
              )}
            </div>

            {/* Participants + fill bar */}
            <div className="flex items-center gap-2 mb-3">
              <Users2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {event.participants.toLocaleString()}
                {event.maxParticipants ? ` / ${event.maxParticipants}` : ""} participants
              </span>
              {fillPct !== null && (
                <div className="flex-1 h-1.5 rounded-full bg-border/30 overflow-hidden max-w-[120px]">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              )}
            </div>

            {/* Countdown */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {isActive ? (
                <span>Ends in <span className="font-mono font-semibold text-amber-400">{endCountdown}</span></span>
              ) : (
                <span>Starts in <span className="font-mono font-semibold text-primary">{startCountdown}</span></span>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {joinError?.id === event.id && (
          <p className="text-xs text-destructive mt-3 font-medium">{joinError.msg}</p>
        )}

        {/* Join button */}
        <div className="mt-4 flex justify-end">
          {event.joined || joinedNow.has(event.id) ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/15 border border-green-500/30">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-sm font-semibold text-green-400">Joined</span>
            </div>
          ) : (
            <Button
              size="sm"
              className="h-9 px-5 font-bold"
              onClick={() => handleJoin(event.id)}
            >
              {event.entryFee ? `Join — $${event.entryFee}` : "Join Free"}
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Events</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Tournaments, special events, and more</p>
      </div>

      {/* Active events */}
      {activeEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h3 className="font-display font-semibold text-sm text-foreground">Live Now</h3>
            <span className="text-[11px] text-muted-foreground">({activeEvents.length} active)</span>
          </div>
          <div className="space-y-3">
            {activeEvents.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      )}

      {/* Upcoming events */}
      {upcomingEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold text-sm text-foreground">Coming Up</h3>
          </div>
          <div className="space-y-3">
            {upcomingEvents.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      )}

      {activeEvents.length === 0 && upcomingEvents.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No events scheduled right now.</p>
        </div>
      )}
    </div>
  );
}

// ─── Drops Tab ────────────────────────────────────────────────

function DropsTab() {
  const { drops, purchaseDrop } = useForgeStore();
  const { openConfirm } = useForgeConfirm();
  const [successDrops, setSuccessDrops] = useState<Set<string>>(new Set());
  const [dropError, setDropError]       = useState<{ id: string; msg: string } | null>(null);

  function handleBuy(dropId: string) {
    const drop = drops.find((d) => d.id === dropId);
    if (!drop) return;
    // Flash drops are free — no confirm needed
    if (drop.type === "flash") {
      purchaseDrop(dropId);
      setSuccessDrops((prev) => new Set(prev).add(dropId));
      return;
    }
    const price = drop.salePriceUSDT ?? drop.originalPriceUSDT ?? 0;
    openConfirm({
      icon: drop.icon ?? "📦",
      name: drop.name,
      price,
      currency: "USDT",
      label: `Hot Drop · ${drop.type === "season_pass" ? "Season Pass" : drop.type === "bundle" ? "Bundle" : "Limited"}`,
      onConfirm: () => {
        setDropError(null);
        return purchaseDrop(dropId);
      },
      onSuccess: () => {
        setSuccessDrops((prev) => new Set(prev).add(dropId));
        setTimeout(() => setSuccessDrops((prev) => { const n = new Set(prev); n.delete(dropId); return n; }), 2500);
      },
    });
  }

  const seasonPass  = drops.find((d) => d.type === "season_pass");
  const bundles     = drops.filter((d) => d.type === "bundle");
  const flashDeals  = drops.filter((d) => d.type === "flash");

  function DropCard({ drop, hero = false }: { drop: typeof drops[number]; hero?: boolean }) {
    const countdown = useCountdown(drop.expiresAt);
    const isFlash   = drop.type === "flash";
    const isBought  = successDrops.has(drop.id);

    const tagColors: Record<string, string> = {
      "BEST VALUE":  "#22c55e",
      "40% OFF":     "#F59E0B",
      "LAST CHANCE": "#ef4444",
      "ACTIVE NOW":  "#A855F7",
    };
    const tagColor = drop.tag ? (tagColors[drop.tag] ?? "#6B7280") : "#6B7280";

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border transition-all hover:scale-[1.01]",
          hero ? "p-4" : "p-3.5",
          isFlash
            ? "bg-gradient-to-br from-purple-900/20 to-card/30 border-purple-500/30"
            : "bg-card/30 border-border/40"
        )}
        style={hero ? { boxShadow: "0 0 28px rgba(34,197,94,0.12)" } : undefined}
      >
        {/* Tag badge */}
        {drop.tag && (
          <div
            className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
            style={{ background: `${tagColor}22`, color: tagColor, border: `1px solid ${tagColor}44` }}
          >
            {drop.tag}
          </div>
        )}

        {/* Discount badge */}
        {drop.discountPercent && (
          <div className="absolute top-10 right-4 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold">
            <Percent className="w-3 h-3" />{drop.discountPercent}% OFF
          </div>
        )}

        <div className={cn("flex gap-3", hero ? "items-center" : "items-start")}>
          <div
            className={cn(
              "rounded-xl flex items-center justify-center flex-shrink-0",
              hero ? "w-12 h-12 text-3xl" : "w-10 h-10 text-xl",
              isFlash ? "bg-purple-500/15 border border-purple-500/30" : "bg-primary/10 border border-primary/20"
            )}
          >
            {drop.icon}
          </div>

          <div className="flex-1 min-w-0 pr-16">
            <h4 className={cn("font-display font-bold text-foreground", hero ? "text-xl mb-1" : "text-base mb-0.5")}>
              {drop.name}
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">{drop.description}</p>

            {/* Highlights */}
            <ul className="space-y-1 mb-4">
              {drop.highlights.map((h, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  {h}
                </li>
              ))}
            </ul>

            {/* Pricing */}
            <div className="flex items-center gap-3 flex-wrap mb-3">
              {drop.originalPriceUSDT && (
                <span className="text-sm text-muted-foreground line-through">
                  ${drop.originalPriceUSDT.toFixed(2)}
                </span>
              )}
              {drop.salePriceUSDT && (
                <span className={cn("font-bold text-foreground", hero ? "text-xl" : "text-lg")}>
                  ${drop.salePriceUSDT.toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground ml-1">USDT</span>
                </span>
              )}
              {isFlash && (
                <span className="text-sm font-semibold text-purple-400">Auto-applied</span>
              )}
            </div>

            {/* Stock + countdown */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4 flex-wrap">
              {drop.stock !== undefined && (
                <span className="flex items-center gap-1">
                  <Tag className="w-3 h-3" />{drop.stock} left
                </span>
              )}
              {countdown && (
                <span className="flex items-center gap-1 font-mono font-semibold text-amber-400">
                  <Timer className="w-3 h-3" />{countdown}
                </span>
              )}
            </div>

            {/* Error */}
            {dropError?.id === drop.id && (
              <p className="text-xs text-destructive mb-2 font-medium">{dropError.msg}</p>
            )}

            {/* CTA */}
            {isFlash ? (
              <div className="flex items-center gap-2 text-purple-400">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-semibold">Bonus active this weekend!</span>
              </div>
            ) : (
              <Button
                className={cn(
                  "font-bold transition-all",
                  hero ? "h-9 px-5 text-xs" : "h-8 px-4 text-[11px]",
                  isBought && "bg-green-500/20 text-green-400 border-green-500/30",
                  !isBought && drop.salePriceUSDT && "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                )}
                onClick={() => handleBuy(drop.id)}
                disabled={isBought}
              >
                {isBought ? (
                  <><CheckCircle2 className="w-4 h-4 mr-2" />Purchased!</>
                ) : drop.salePriceUSDT ? (
                  <>Get for ${drop.salePriceUSDT.toFixed(2)} USDT<ChevronRight className="w-4 h-4 ml-1" /></>
                ) : (
                  <>Get Now<ChevronRight className="w-4 h-4 ml-1" /></>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Hot Drops</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Limited-time deals, season passes, and flash bonuses</p>
      </div>

      {/* Flash deals banner */}
      {flashDeals.length > 0 && (
        <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-900/20 via-card/20 to-card/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="font-display font-semibold text-sm text-foreground">Flash Bonuses</h3>
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse ml-1" />
          </div>
          <div className="space-y-3">
            {flashDeals.map((d) => <DropCard key={d.id} drop={d} />)}
          </div>
        </div>
      )}

      {/* Season pass hero */}
      {seasonPass && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Star className="w-4 h-4 text-amber-400" />
            <h3 className="font-display font-semibold text-sm text-foreground">Season Pass</h3>
          </div>
          <DropCard drop={seasonPass} hero />
        </div>
      )}

      {/* Limited bundles */}
      {bundles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold text-sm text-foreground">Limited Bundles</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {bundles.map((d) => <DropCard key={d.id} drop={d} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Forge Page ─────────────────────────────────────────

export default function Forge() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") ?? "shop") as "shop" | "challenges" | "events" | "drops";
  const [pending, setPending] = useState<PendingPurchase | null>(null);
  const [atTopUpOpen, setAtTopUpOpen] = useState(false);

  function setTab(value: string) { setSearchParams({ tab: value }); }
  const openConfirm = (p: PendingPurchase) => setPending(p);
  const openAtTopUp = () => setAtTopUpOpen(true);

  return (
    <ForgeConfirmContext.Provider value={{ openConfirm, openAtTopUp }}>
    <PurchaseConfirmDialog pending={pending} onClose={() => setPending(null)} />
    <ArenaTokensTopUpDialog open={atTopUpOpen} onClose={() => setAtTopUpOpen(false)} />
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
            <Flame className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">Forge</h1>
            <p className="text-sm text-muted-foreground">Your premium Arena marketplace</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 p-1 bg-card/30 border border-border/40 rounded-xl w-fit">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                tab === t.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/50"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {tab === "shop"       && <ShopTab />}
          {tab === "challenges" && <ChallengesTab />}
          {tab === "events"     && <EventsTab />}
          {tab === "drops"      && <DropsTab />}
        </div>
      </div>
    </div>
    </ForgeConfirmContext.Provider>
  );
}
