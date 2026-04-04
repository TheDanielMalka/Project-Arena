import { useState, useMemo, useEffect, createContext, useContext } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
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
  CalendarDays, TrendingUp, Eye, EyeOff, AlertTriangle, Coins, Radio,
} from "lucide-react";
import { useForgeStore } from "@/stores/forgeStore";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { cn } from "@/lib/utils";
import { ForgeLookPreview, renderForgeShopIcon } from "@/lib/forgeItemIcon";
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
  /** When set, checkout shows “on your profile” preview for cosmetics */
  itemCategory?: ForgeCategory;
  onConfirm: () =>
    | { success: boolean; error?: string }
    | Promise<{ success: boolean; error?: string }>;
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
  const user = useUserStore((s) => s.user);
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
    void (async () => {
      await new Promise((r) => setTimeout(r, 400));
      try {
        const result = await Promise.resolve(pending!.onConfirm());
        if (result.success) {
          pending!.onSuccess?.();
          onClose();
        } else {
          setError(result.error ?? "Purchase failed. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    })();
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
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl border shrink-0 overflow-hidden", borderCl, bgCl)}>
            {renderForgeShopIcon(pending?.icon)}
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

          {pending?.itemCategory &&
            ["avatar", "frame", "badge"].includes(pending.itemCategory) &&
            pending.icon && (
            <div className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-3 flex flex-col sm:flex-row items-center gap-3">
              <ForgeLookPreview
                username={user?.username ?? "Arena"}
                baseAvatar={user?.avatar}
                baseBgId={user?.avatarBg}
                tryOnIcon={pending.icon}
                tryCategory={pending.itemCategory}
                size="md"
              />
              <p className="text-[10px] text-muted-foreground leading-snug flex-1 text-center sm:text-left">
                Final look after purchase — your password confirms escrow-style checkout.
                {/* DB-ready: server validates owned cosmetics vs users.avatar / users.avatar_bg */}
              </p>
            </div>
          )}

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
  { value: "all",    label: "All",     icon: <Sparkles className="w-3 h-3" /> },
  { value: "avatar", label: "Avatars", icon: <Star      className="w-3 h-3" /> },
  { value: "frame",  label: "Frames",  icon: <Shield    className="w-3 h-3" /> },
  { value: "badge",  label: "Badges",  icon: <Award     className="w-3 h-3" /> },
  { value: "boost",  label: "Boosts",  icon: <Zap       className="w-3 h-3" /> },
  { value: "vip",    label: "VIP",     icon: <Crown     className="w-3 h-3" /> },
  { value: "bundle", label: "Bundles", icon: <Package   className="w-3 h-3" /> },
];

const TABS = [
  { value: "shop",       label: "Shop",       icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { value: "challenges", label: "Challenges", icon: <Target      className="w-3.5 h-3.5" /> },
  { value: "events",     label: "Events",     icon: <Trophy      className="w-3.5 h-3.5" /> },
  { value: "drops",      label: "Hot Drops",  icon: <Flame       className="w-3.5 h-3.5" /> },
];

/** Display-only; production: GET /api/forge/exchange-rate (see ForgeExchangeRateQuote). */
const DISPLAY_USDT_TO_AT_RATE = 100;

function ForgeTreasuryStrip() {
  const arenaTokens = useForgeStore((s) => s.arenaTokens);
  const usdtBalance  = useWalletStore((s) => s.usdtBalance);
  const estAt        = Math.floor(usdtBalance * DISPLAY_USDT_TO_AT_RATE);

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-card via-card/95 to-primary/[0.08] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-primary/18 blur-3xl" />
      <div className="pointer-events-none absolute -left-6 bottom-0 h-28 w-28 rounded-full bg-arena-purple/12 blur-2xl" />
      <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-stretch gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/35 bg-primary/10">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground font-display">Arena balance</p>
              <p className="font-display text-base font-bold text-foreground tabular-nums leading-tight">
                {arenaTokens.toLocaleString()} <span className="text-xs font-semibold text-primary">AT</span>
              </p>
            </div>
          </div>
          <div className="hidden sm:block w-px self-stretch min-h-[2rem] bg-border/50" aria-hidden />
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-arena-gold/35 bg-arena-gold/10">
              <Coins className="h-4 w-4 text-arena-gold" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground font-display">Wallet USDT</p>
              <p className="font-display text-sm font-bold text-foreground tabular-nums leading-tight">
                ${usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 lg:items-end lg:text-right min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/25 bg-green-500/10 px-2 py-0.5 text-green-400 font-semibold">
              <Radio className="w-2.5 h-2.5 animate-pulse" /> Live counter
            </span>
            <span className="inline-flex items-center gap-1">
              <Shield className="w-3 h-3 text-primary shrink-0" />
              Non-custodial USDT · AT for Forge only
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Display quote <span className="font-mono text-foreground/90">1 USDT ≈ {DISPLAY_USDT_TO_AT_RATE} AT</span>
            {" · "}
            <span className="text-foreground/80">~{estAt.toLocaleString()} AT</span> spend preview from wallet
          </p>
          <Link
            to="/wallet"
            className="inline-flex items-center gap-0.5 text-[11px] font-display font-bold text-primary hover:underline decoration-primary/40 underline-offset-2"
          >
            Wallet & top-up <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

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

function ForgeEntitlementTimer({ expiresAt }: { expiresAt: string }) {
  const left = useCountdown(expiresAt);
  return <span className="font-mono text-amber-400 tabular-nums">{left ?? "—"}</span>;
}

/** DB-ready: mirrors users.vip_expires_at + shop_entitlements — per-user countdown after password checkout */
function ForgeActiveEntitlementsStrip() {
  const user = useUserStore((s) => s.user);
  const prune = useUserStore((s) => s.pruneExpiredShopEntitlements);
  useEffect(() => {
    prune();
  }, [prune]);
  const vipIso = user?.vipExpiresAt;
  const vipLive = vipIso ? new Date(vipIso).getTime() > Date.now() : false;
  const boosts = (user?.shopEntitlements ?? []).filter((e) => new Date(e.expiresAt).getTime() > Date.now());
  if (!vipLive && boosts.length === 0) return null;
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-2 space-y-1.5">
      <p className="text-[10px] font-display font-bold uppercase tracking-wider text-muted-foreground">
        Active on your account (DB: vip_expires_at · shop_entitlements)
      </p>
      <div className="flex flex-wrap gap-2">
        {vipLive && vipIso && (
          <div className="flex items-center gap-2 rounded-md border border-arena-gold/40 bg-arena-gold/10 px-2.5 py-1 text-[11px]">
            <Crown className="h-3.5 w-3.5 text-arena-gold shrink-0" />
            <span className="font-display font-semibold text-foreground">VIP</span>
            <ForgeEntitlementTimer expiresAt={vipIso} />
          </div>
        )}
        {boosts.map((e, i) => (
          <div
            key={`${e.itemId}-${e.expiresAt}-${i}`}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2.5 py-1 text-[11px]"
          >
            <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-display font-semibold truncate max-w-[160px]">{e.label}</span>
            <ForgeEntitlementTimer expiresAt={e.expiresAt} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

interface ItemCardProps {
  item: ReturnType<typeof useForgeStore.getState>["items"][number];
  onBuy: (itemId: string, currency: "AT" | "USDT") => void;
  success: boolean;
  error: string | null;
  arenaTokens: number;
  focused?: boolean;
  onTryOn?: () => void;
}

function ItemCard({ item, onBuy, success, error, arenaTokens, focused, onTryOn }: ItemCardProps) {
  const rc = RARITY_CONFIG[item.rarity];
  const countdown = useCountdown(item.expiresAt);
  const isDeluxeCosmetic =
    item.category === "avatar" ||
    item.category === "badge" ||
    item.category === "frame" ||
    item.category === "boost" ||
    item.category === "vip" ||
    item.category === "bundle";
  const isBadgeCard = item.category === "badge";

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-lg border p-2 transition-all duration-200 hover:scale-[1.015] hover:shadow-lg cursor-default overflow-hidden",
        isDeluxeCosmetic && "ring-1 ring-white/[0.07]",
        focused && "ring-2 ring-primary/60 border-primary/50",
      )}
      id={`forge-item-${item.id}`}
      style={{
        background: rc.bg,
        borderColor: rc.border,
        boxShadow: success
          ? `0 0 14px ${rc.color}35`
          : isDeluxeCosmetic
            ? `0 0 0 1px ${rc.color}33, 0 10px 40px ${rc.color}18, inset 0 1px 0 ${rc.color}25`
            : undefined,
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
          className={cn(
            "flex flex-shrink-0 items-center justify-center overflow-hidden",
            isBadgeCard && "relative h-9 w-9 rounded-lg text-base",
            isDeluxeCosmetic && !isBadgeCard && "relative h-11 w-11 rounded-xl text-xl shadow-lg",
            !isDeluxeCosmetic && "h-9 w-9 rounded-md text-lg",
          )}
          style={
            isBadgeCard
              ? {
                  background: `linear-gradient(145deg, ${rc.color}35 0%, rgba(0,0,0,0.9) 55%, ${rc.color}22 100%)`,
                  border: `1px solid ${rc.color}66`,
                  boxShadow: `0 0 12px ${rc.color}28, inset 0 1px 0 rgba(255,255,255,0.12)`,
                }
              : isDeluxeCosmetic
                ? {
                    background: `linear-gradient(145deg, ${rc.color}60 0%, rgba(0,0,0,0.82) 50%, ${rc.color}38 100%)`,
                    border: `1px solid ${rc.color}aa`,
                    boxShadow: `0 0 26px ${rc.color}45, inset 0 1px 0 rgba(255,255,255,0.22)`,
                  }
                : { background: `${rc.color}18`, border: `1px solid ${rc.color}44` }
          }
        >
          {isDeluxeCosmetic && (
            <>
              <span
                className="pointer-events-none absolute inset-0 opacity-35"
                style={{ background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.5) 0%, transparent 45%)` }}
              />
              <span
                className="pointer-events-none absolute inset-0 opacity-25 bg-gradient-to-br from-transparent via-transparent to-black/80"
              />
              {item.category === "badge" && (
                <Award className="absolute -right-0.5 -top-0.5 h-3 w-3 text-arena-gold/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] z-[2] pointer-events-none" />
              )}
            </>
          )}
          <span className={cn("relative z-[1] h-full w-full flex items-center justify-center", isDeluxeCosmetic && "drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)]")}>
            {renderForgeShopIcon(item.icon)}
          </span>
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

      {onTryOn && (
        <button
          type="button"
          onClick={onTryOn}
          className="relative mb-1.5 flex items-center justify-center gap-1 rounded-md border border-primary/35 bg-primary/10 py-1 text-[10px] font-display font-bold text-primary hover:bg-primary/15 transition-colors"
        >
          <Eye className="h-3 w-3" /> Preview on you
        </button>
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
  const { items, arenaTokens, purchaseItem, getFeaturedItem } = useForgeStore();
  const { openConfirm, openAtTopUp } = useForgeConfirm();
  const user = useUserStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const featured = getFeaturedItem();
  const [category, setCategory] = useState<ForgeCategory | "all">("all");
  const [successItems, setSuccessItems] = useState<Set<string>>(new Set());
  const [errorItem, setErrorItem] = useState<{ id: string; msg: string } | null>(null);
  const [catalogPreview, setCatalogPreview] = useState<{ icon: string; category: ForgeCategory } | null>(null);
  const featuredCountdown = useCountdown(featured?.expiresAt);
  const focusId = searchParams.get("focus");

  useEffect(() => {
    const qp = searchParams.get("category");
    const allowed: Array<ForgeCategory | "all"> = ["all", "avatar", "frame", "badge", "boost", "vip", "bundle"];
    if (qp && (allowed as string[]).includes(qp)) {
      setCategory(qp as ForgeCategory | "all");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`forge-item-${focusId}`);
    if (!el) return;
    // Defer until after layout
    const t = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    return () => clearTimeout(t);
  }, [focusId, category]);

  const filteredItems = useMemo(() => {
    const byCategory =
      category === "all" ? items : items.filter((i) => i.category === category);
    return byCategory.filter((i) => !i.featured && !(i.category === "badge" && i.freeBadge));
  }, [category, items]);

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
      itemCategory: item.category,
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
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground tracking-tight">Forge Shop</h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
          Cosmetics, boosts & VIP — instant with AT or secured USDT checkout. Limited runs move fast.
        </p>
      </div>

      {catalogPreview && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-primary/25 bg-card/40 p-3">
          <ForgeLookPreview
            username={user?.username ?? "Arena"}
            baseAvatar={user?.avatar}
            baseBgId={user?.avatarBg}
            tryOnIcon={catalogPreview.icon}
            tryCategory={catalogPreview.category}
            size="md"
          />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-[11px] font-display font-bold text-foreground uppercase tracking-wider">Live preview</p>
            <p className="text-[10px] text-muted-foreground leading-snug">
              How this cosmetic reads on your Arena ring — use Preview on portrait, frame, or badge cards.
            </p>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-[10px] font-display"
              onClick={() => setCatalogPreview(null)}>
              Clear preview
            </Button>
          </div>
        </div>
      )}

      {/* Featured hero */}
      {featured && (
        <div
          className="relative overflow-hidden rounded-xl p-3.5 border ring-1 ring-inset ring-white/[0.06]"
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
          <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5">
            <span
              className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full animate-pulse"
              style={{ background: `${featuredRc.color}30`, color: featuredRc.color, border: `1px solid ${featuredRc.color}50` }}
            >
              ★ Featured
            </span>
          </div>

          <div className="relative z-10 flex items-center gap-3 flex-wrap">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{
                background: `${featuredRc.color}18`,
                border: `2px solid ${featuredRc.color}55`,
                boxShadow: `0 0 14px ${featuredRc.color}35`,
              }}
            >
              {renderForgeShopIcon(featured.icon)}
            </div>
            <div className="flex-1 min-w-0 pr-24 sm:pr-40">
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
              <h3 className="font-display text-base font-bold text-foreground">{featured.name}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-md line-clamp-2">{featured.description}</p>

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

            <div className="flex flex-col gap-1.5 flex-shrink-0 w-full sm:w-auto">
              {errorItem?.id === featured.id && (
                <p className="text-[10px] text-destructive font-medium">{errorItem.msg}</p>
              )}
              {["avatar", "frame", "badge"].includes(featured.category) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[11px] font-display border-primary/35"
                  onClick={() => setCatalogPreview({ icon: featured.icon, category: featured.category })}
                >
                  <Eye className="w-3.5 h-3.5 mr-1.5" /> Preview on you
                </Button>
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
      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORY_PILLS.map((pill) => (
          <button
            key={pill.value}
            onClick={() => setCategory(pill.value)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all",
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {filteredItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onBuy={handleBuy}
              success={successItems.has(item.id)}
              error={errorItem?.id === item.id ? errorItem.msg : null}
              arenaTokens={arenaTokens}
              focused={focusId === item.id}
              onTryOn={
                ["avatar", "frame", "badge"].includes(item.category)
                  ? () => setCatalogPreview({ icon: item.icon, category: item.category })
                  : undefined
              }
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
  const profileXp = useUserStore((s) => s.user?.stats.xp ?? 0);
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
          "relative flex items-center gap-2 rounded-lg border p-2 transition-all",
          isClaimed
            ? "bg-card/20 border-border/20 opacity-60"
            : "bg-card/30 border-border/40 hover:border-primary/25"
        )}
      >
        {/* Icon */}
        <div
          className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center text-base flex-shrink-0 border",
            isClaimed ? "bg-muted/20 border-border/20" : "bg-primary/10 border-primary/20"
          )}
        >
          {challenge.icon}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <p className={cn("font-semibold text-xs", isClaimed && "line-through text-muted-foreground")}>
              {challenge.title}
            </p>
            {isClaimable && !isClaimed && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">
                Ready
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mb-1.5 line-clamp-2">{challenge.description}</p>

          {/* Progress bar */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1 rounded-full bg-border/40 overflow-hidden">
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
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-0.5 text-[11px] font-bold text-primary tabular-nums">
            <Zap className="w-3 h-3" />{challenge.rewardAT} AT
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">+{challenge.rewardXP} XP</div>
          {isClaimed ? (
            <div className="flex items-center gap-1 text-xs text-green-400 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />Claimed
            </div>
          ) : isClaimable ? (
            <Button
              size="sm"
              className={cn(
                "h-6 px-2.5 text-[11px] font-bold transition-all",
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
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground tracking-tight">Challenges</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Stack free AT & XP — claim streaks before reset. Balance:{" "}
          <span className="text-primary font-semibold tabular-nums">{arenaTokens.toLocaleString()} AT</span>
          {" · "}
          Profile XP (DB <span className="font-mono text-[10px]">user_stats.xp</span>):{" "}
          <span className="text-arena-cyan font-semibold tabular-nums">{profileXp.toLocaleString()}</span>
        </p>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {[
          { label: "Daily Active",    value: daily.filter(c => c.status === "active").length,    icon: <Target className="w-3 h-3" />,       color: "text-primary" },
          { label: "Ready to Claim",  value: [...daily, ...weekly].filter(c => c.status === "claimable").length, icon: <Gift className="w-3 h-3" />, color: "text-green-400" },
          { label: "Weekly Active",   value: weekly.filter(c => c.status === "active").length,   icon: <TrendingUp className="w-3 h-3" />,   color: "text-amber-400" },
          { label: "Completed Today", value: daily.filter(c => c.status === "claimed").length,   icon: <CheckCircle2 className="w-3 h-3" />, color: "text-muted-foreground" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card/30 border border-border/40 rounded-lg py-1.5 px-1 text-center">
            <div className={cn("flex justify-center mb-0.5", stat.color)}>{stat.icon}</div>
            <div className={cn("text-base font-bold font-display tabular-nums", stat.color)}>{stat.value}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight px-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Daily challenges */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays className="w-3.5 h-3.5 text-primary" />
          <h3 className="font-display font-semibold text-xs text-foreground">Daily Challenges</h3>
          <span className="text-[11px] text-muted-foreground">— Resets in <span className="text-amber-400 font-mono">{formatCountdown(daily[0]?.expiresAt ?? "")}</span></span>
        </div>
        <div className="space-y-1.5">
          {daily.map((c) => <ChallengeRow key={c.id} challenge={c} />)}
        </div>
      </div>

      {/* Weekly challenges */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
          <h3 className="font-display font-semibold text-xs text-foreground">Weekly Challenges</h3>
          <span className="text-[11px] text-muted-foreground">— Resets in <span className="text-amber-400 font-mono">{formatCountdown(weekly[0]?.expiresAt ?? "")}</span></span>
        </div>
        <div className="space-y-1.5">
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

  async function handleJoin(eventId: string) {
    const allEvents = [...getActiveEvents(), ...getUpcomingEvents()];
    const event = allEvents.find((e) => e.id === eventId);
    if (!event) return;
    // Free events — join directly, no confirm
    if (!event.entryFee) {
      const result = await joinEvent(eventId);
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
      onConfirm: async () => {
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
          "relative overflow-hidden rounded-lg border p-2.5 transition-all hover:border-primary/20",
          isActive ? "bg-card/30 border-border/40" : "bg-card/20 border-border/30"
        )}
      >
        {/* Live badge */}
        {isActive && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Live</span>
          </div>
        )}
        {isUpcoming && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
            <CalendarDays className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Soon</span>
          </div>
        )}

        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-lg flex-shrink-0">
            {event.icon}
          </div>
          <div className="flex-1 min-w-0 pr-14">
            <div className="flex items-center gap-1 mb-0.5 flex-wrap">
              <h4 className="font-display font-bold text-xs text-foreground">{event.name}</h4>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-card/50 border border-border/30 text-muted-foreground">
                {event.game}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-card/50 border border-border/30 text-muted-foreground capitalize">
                {event.type}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug mb-2 line-clamp-2">{event.description}</p>

            {/* Reward/prize row */}
            <div className="flex items-center gap-3 flex-wrap text-[11px] mb-2">
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
            <div className="flex items-center gap-2 mb-2">
              <Users2 className="w-3 h-3 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">
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
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
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
        <div className="mt-2.5 flex justify-end">
          {event.joined || joinedNow.has(event.id) ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 border border-green-500/30">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs font-semibold text-green-400">Joined</span>
            </div>
          ) : (
            <Button
              size="sm"
              className="h-8 px-4 text-xs font-bold font-display"
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
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground tracking-tight">Events</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          High-stakes brackets — entry via USDT where noted. Prize pools update live.
        </p>
      </div>

      {/* Active events */}
      {activeEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h3 className="font-display font-semibold text-xs text-foreground">Live Now</h3>
            <span className="text-[11px] text-muted-foreground">({activeEvents.length} active)</span>
          </div>
          <div className="space-y-2">
            {activeEvents.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      )}

      {/* Upcoming events */}
      {upcomingEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-display font-semibold text-xs text-foreground">Coming Up</h3>
          </div>
          <div className="space-y-2">
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
          "relative overflow-hidden rounded-xl border transition-all hover:scale-[1.005]",
          hero ? "p-3.5" : "p-2.5",
          isFlash
            ? "bg-gradient-to-br from-purple-900/20 to-card/30 border-purple-500/30"
            : "bg-card/30 border-border/40"
        )}
        style={hero ? { boxShadow: "0 0 28px rgba(34,197,94,0.12)" } : undefined}
      >
        {/* Tag badge */}
        {drop.tag && (
          <div
            className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{ background: `${tagColor}22`, color: tagColor, border: `1px solid ${tagColor}44` }}
          >
            {drop.tag}
          </div>
        )}

        {/* Discount badge */}
        {drop.discountPercent && (
          <div className="absolute top-9 right-2.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
            <Percent className="w-3 h-3" />{drop.discountPercent}% OFF
          </div>
        )}

        <div className={cn("flex gap-2.5", hero ? "items-center" : "items-start")}>
          <div
            className={cn(
              "rounded-lg flex items-center justify-center flex-shrink-0",
              hero ? "w-11 h-11 text-2xl" : "w-9 h-9 text-lg",
              isFlash ? "bg-purple-500/15 border border-purple-500/30" : "bg-primary/10 border border-primary/20"
            )}
          >
            {drop.icon}
          </div>

          <div className="flex-1 min-w-0 pr-14">
            <h4 className={cn("font-display font-bold text-foreground", hero ? "text-lg mb-0.5" : "text-sm mb-0.5")}>
              {drop.name}
            </h4>
            <p className="text-[11px] text-muted-foreground leading-snug mb-2 line-clamp-2">{drop.description}</p>

            {/* Highlights */}
            <ul className="space-y-0.5 mb-2.5">
              {drop.highlights.map((h, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  {h}
                </li>
              ))}
            </ul>

            {/* Pricing */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {drop.originalPriceUSDT && (
                <span className="text-xs text-muted-foreground line-through">
                  ${drop.originalPriceUSDT.toFixed(2)}
                </span>
              )}
              {drop.salePriceUSDT && (
                <span className={cn("font-bold text-foreground tabular-nums", hero ? "text-lg" : "text-base")}>
                  ${drop.salePriceUSDT.toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground ml-1">USDT</span>
                </span>
              )}
              {isFlash && (
                <span className="text-sm font-semibold text-purple-400">Auto-applied</span>
              )}
            </div>

            {/* Stock + countdown */}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2 flex-wrap">
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
                  "font-bold transition-all font-display",
                  hero ? "h-8 px-4 text-[11px]" : "h-7 px-3 text-[11px]",
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
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground tracking-tight">Hot Drops</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Scarcity-priced bundles — USDT checkout locks price; flash perks apply instantly.
        </p>
      </div>

      {/* Flash deals banner */}
      {flashDeals.length > 0 && (
        <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-900/20 via-card/20 to-card/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <h3 className="font-display font-semibold text-xs text-foreground">Flash Bonuses</h3>
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse ml-1" />
          </div>
          <div className="space-y-2">
            {flashDeals.map((d) => <DropCard key={d.id} drop={d} />)}
          </div>
        </div>
      )}

      {/* Season pass hero */}
      {seasonPass && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            <h3 className="font-display font-semibold text-xs text-foreground">Season Pass</h3>
          </div>
          <DropCard drop={seasonPass} hero />
        </div>
      )}

      {/* Limited bundles */}
      {bundles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-display font-semibold text-xs text-foreground">Limited Bundles</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
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

  function setTab(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next);
  }
  const openConfirm = (p: PendingPurchase) => setPending(p);
  const openAtTopUp = () => setAtTopUpOpen(true);

  return (
    <ForgeConfirmContext.Provider value={{ openConfirm, openAtTopUp }}>
    <PurchaseConfirmDialog pending={pending} onClose={() => setPending(null)} />
    <ArenaTokensTopUpDialog open={atTopUpOpen} onClose={() => setAtTopUpOpen(false)} />
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        {/* Page header */}
        <div className="relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-card/90 via-background to-primary/[0.06] p-3.5 sm:p-4">
          <div className="pointer-events-none absolute right-0 top-0 h-24 w-40 bg-primary/10 blur-3xl rounded-full" />
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 shadow-[0_0_20px_hsl(var(--primary)/0.25)]">
                <Flame className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground tracking-tight">Forge</h1>
                  <span className="text-[10px] font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-arena-gold/35 bg-arena-gold/10 text-arena-gold">
                    Premium store
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">
                  The Arena treasury — cosmetics, passes, and streak rewards. Same escrow discipline as matchplay.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground sm:justify-end">
              <span className="rounded-md border border-border/50 bg-card/40 px-2 py-1">Instant AT</span>
              <span className="rounded-md border border-border/50 bg-card/40 px-2 py-1">USDT secure</span>
              <span className="rounded-md border border-border/50 bg-card/40 px-2 py-1">Limited runs</span>
            </div>
          </div>
        </div>

        <ForgeTreasuryStrip />

        <ForgeActiveEntitlementsStrip />

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 p-0.5 bg-card/35 border border-border/45 rounded-lg w-full max-w-full overflow-x-auto [scrollbar-width:thin]">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              type="button"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-display font-semibold whitespace-nowrap shrink-0 transition-all",
                tab === t.value
                  ? "bg-primary text-primary-foreground shadow-[0_0_14px_hsl(var(--primary)/0.35)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[40vh]">
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
