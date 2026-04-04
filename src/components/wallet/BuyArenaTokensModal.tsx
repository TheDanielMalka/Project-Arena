import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Zap, Lock, Eye, EyeOff, CheckCircle2, Loader2,
  AlertTriangle, Wallet, ArrowRight, Info,
} from "lucide-react";
import { useWalletStore } from "@/stores/walletStore";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

/** 1 USDT = 100 AT (DB-ready: GET /api/forge/exchange-rate) */
const AT_PER_USDT = 100;

/** Estimated BNB gas fee for USDT transfer to platform wallet */
const GAS_FEE_USDT = 0.50;

const PRESETS = [
  { at: 500,    label: "500 AT" },
  { at: 1_000,  label: "1,000 AT" },
  { at: 2_500,  label: "2,500 AT" },
  { at: 5_000,  label: "5,000 AT" },
  { at: 10_000, label: "10,000 AT" },
];

type Step = "select" | "confirm" | "processing" | "success";

// ─── Component ────────────────────────────────────────────────────────────────

interface BuyArenaTokensModalProps {
  open: boolean;
  onClose: () => void;
}

export function BuyArenaTokensModal({ open, onClose }: BuyArenaTokensModalProps) {
  const { usdtBalance, buyArenaTokens } = useWalletStore();

  const [step, setStep]           = useState<Step>("select");
  const [selectedAt, setSelectedAt] = useState<number>(1_000);
  const [customAt, setCustomAt]   = useState("");
  const [isCustom, setIsCustom]   = useState(false);
  const [pw, setPw]               = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [pwError, setPwError]     = useState("");
  const [purchasedAt, setPurchasedAt] = useState(0);
  const processingTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  // Reset state when modal opens/closes (clear timeout on unmount / reopen so Vitest teardown never hits setState)
  useEffect(() => {
    if (!open) {
      const t = globalThis.setTimeout(() => {
        setStep("select");
        setSelectedAt(1_000);
        setCustomAt("");
        setIsCustom(false);
        setPw("");
        setShowPw(false);
        setPwError("");
        setPurchasedAt(0);
      }, 300);
      return () => globalThis.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (processingTimerRef.current != null) {
        globalThis.clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    };
  }, []);

  // Derived values
  const atAmount     = isCustom ? (parseInt(customAt) || 0) : selectedAt;
  const tokenCost    = parseFloat((atAmount / AT_PER_USDT).toFixed(2));
  const totalCost    = parseFloat((tokenCost + GAS_FEE_USDT).toFixed(2));
  const hasBalance   = usdtBalance >= totalCost;
  const canProceed   = atAmount >= 100 && hasBalance;

  const handleSelectPreset = (at: number) => {
    setSelectedAt(at);
    setIsCustom(false);
    setCustomAt("");
  };

  const handleCustomChange = (val: string) => {
    // Only allow positive integers
    const clean = val.replace(/\D/g, "");
    setCustomAt(clean);
    setIsCustom(true);
  };

  const handleProceedToConfirm = () => {
    if (!canProceed) return;
    setStep("confirm");
  };

  const handleConfirmPurchase = () => {
    if (!pw) { setPwError("Enter your password to confirm."); return; }
    setPwError("");
    setStep("processing");

    // DB-ready: POST /api/auth/verify-password { password: pw }
    //           → POST /api/wallet/buy-at { atAmount, usdtCost: totalCost }
    //           → server: wagmi USDT.transfer(PLATFORM_WALLET, totalCost)
    //           → then refreshProfileFromServer() when POST /wallet/buy-at exists
    processingTimerRef.current = globalThis.setTimeout(() => {
      processingTimerRef.current = null;
      const tx = buyArenaTokens(atAmount, totalCost);
      if (tx) {
        setPurchasedAt(atAmount);
        setStep("success");
      } else {
        setPwError("Purchase failed — insufficient USDT balance.");
        setStep("confirm");
      }
    }, 1500);
  };

  const handleClose = () => {
    if (step === "processing") return; // prevent close while processing
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card border-border/60">
        <DialogHeader>
          <DialogTitle className="font-display text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-arena-purple" />
            Buy Arena Tokens (AT)
          </DialogTitle>
        </DialogHeader>

        {/* ── Step: Select amount ── */}
        {step === "select" && (
          <div className="space-y-4">

            {/* Balance row */}
            <div className="flex items-center justify-between rounded-lg bg-secondary/40 border border-border/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" />
                <span>Your USDT balance</span>
              </div>
              <span className="font-display font-bold text-sm text-foreground">
                ${usdtBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
              </span>
            </div>

            {/* Exchange rate note */}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" />
              <span>Rate: <strong className="text-foreground">1 USDT = {AT_PER_USDT} AT</strong> · Gas fee ~${GAS_FEE_USDT.toFixed(2)} USDT (BNB)</span>
            </div>

            {/* Preset buttons */}
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.at}
                  onClick={() => handleSelectPreset(p.at)}
                  className={cn(
                    "rounded-lg border px-2 py-3 text-center transition-all",
                    !isCustom && selectedAt === p.at
                      ? "border-arena-purple bg-arena-purple/15 text-arena-purple"
                      : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-arena-purple/40 hover:text-foreground"
                  )}
                >
                  <p className="font-display font-bold text-sm">{p.label}</p>
                  <p className="text-[10px] mt-0.5 opacity-70">
                    ${(p.at / AT_PER_USDT).toFixed(2)} USDT
                  </p>
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-display uppercase tracking-wider">
                Or enter custom amount (min 100 AT)
              </p>
              <div className="relative">
                <Zap className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-arena-purple" />
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 3000"
                  value={customAt}
                  onChange={(e) => handleCustomChange(e.target.value)}
                  onFocus={() => setIsCustom(true)}
                  className={cn(
                    "pl-8 text-sm",
                    isCustom && customAt ? "border-arena-purple/50" : ""
                  )}
                />
                {isCustom && customAt && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono">
                    AT
                  </span>
                )}
              </div>
            </div>

            {/* Cost summary */}
            {atAmount >= 100 && (
              <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Tokens</span>
                  <span className="font-mono">${tokenCost.toFixed(2)} USDT</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Estimated gas fee</span>
                  <span className="font-mono">~${GAS_FEE_USDT.toFixed(2)} USDT</span>
                </div>
                <div className="border-t border-border/40 pt-1.5 flex justify-between text-sm font-bold">
                  <span>Total</span>
                  <span className={hasBalance ? "text-foreground" : "text-destructive"}>
                    ${totalCost.toFixed(2)} USDT
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">You receive</span>
                  <span className="font-display font-bold text-arena-purple">
                    +{atAmount.toLocaleString()} AT
                  </span>
                </div>
              </div>
            )}

            {/* Insufficient balance warning */}
            {atAmount >= 100 && !hasBalance && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-[11px] text-destructive">
                  Insufficient USDT. You need ${totalCost.toFixed(2)} but have ${usdtBalance.toFixed(2)}.
                  Top up your wallet to continue.
                </p>
              </div>
            )}

            <Button
              className="w-full font-display"
              disabled={!canProceed}
              onClick={handleProceedToConfirm}
            >
              Continue <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* ── Step: Confirm with password ── */}
        {step === "confirm" && (
          <div className="space-y-4">

            {/* Summary */}
            <div className="rounded-xl border border-arena-purple/30 bg-arena-purple/5 px-4 py-4 space-y-2">
              <p className="text-[10px] text-muted-foreground font-display uppercase tracking-wider">Purchase Summary</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-arena-purple/20 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-arena-purple" />
                  </div>
                  <div>
                    <p className="font-display font-bold text-base text-arena-purple">
                      +{atAmount.toLocaleString()} AT
                    </p>
                    <p className="text-[10px] text-muted-foreground">Arena Tokens</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-sm">${totalCost.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">USDT deducted</p>
                </div>
              </div>
              <div className="border-t border-arena-purple/20 pt-2 flex gap-2 text-[10px] text-muted-foreground">
                <span>Tokens: ${tokenCost.toFixed(2)}</span>
                <span>·</span>
                <span>Gas: ~${GAS_FEE_USDT.toFixed(2)}</span>
                <span>·</span>
                <span>Rate: 1 USDT = {AT_PER_USDT} AT</span>
              </div>
            </div>

            {/* Password field */}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Enter your password to confirm
                {/* DB-ready: POST /api/auth/verify-password before executing USDT transfer */}
              </p>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type={showPw ? "text" : "password"}
                  placeholder="Your account password"
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); setPwError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirmPurchase(); }}
                  className="pl-9 pr-9 text-sm"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {pwError && (
                <p className="text-[11px] text-destructive mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {pwError}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 font-display text-sm border-border/60"
                onClick={() => setStep("select")}
              >
                Back
              </Button>
              <Button
                className="flex-1 font-display text-sm bg-arena-purple hover:bg-arena-purple/90"
                onClick={handleConfirmPurchase}
                disabled={!pw}
              >
                Confirm Purchase
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
              USDT will be sent from your wallet to the Arena platform wallet. AT is credited instantly after confirmation.
            </p>
          </div>
        )}

        {/* ── Step: Processing ── */}
        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-arena-purple/10 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-arena-purple animate-spin" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-display font-semibold text-sm">Processing Transaction</p>
              <p className="text-[11px] text-muted-foreground">Transferring USDT to platform wallet…</p>
            </div>
            <div className="flex gap-2 text-[10px] text-muted-foreground">
              <Badge className="bg-arena-purple/10 text-arena-purple border-arena-purple/20 text-[9px]">
                BNB Smart Chain
              </Badge>
              <Badge className="bg-secondary/60 text-muted-foreground border-border/40 text-[9px]">
                Awaiting Confirmation
              </Badge>
            </div>
          </div>
        )}

        {/* ── Step: Success ── */}
        {step === "success" && (
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-display font-bold text-base text-primary">Purchase Successful!</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-display font-bold text-arena-purple text-base">
                  +{purchasedAt.toLocaleString()} AT
                </span>{" "}
                added to your balance
              </p>
            </div>

            <div className="w-full rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">USDT spent</span>
                <span className="font-mono text-destructive">−${totalCost.toFixed(2)} USDT</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">AT credited</span>
                <span className="font-display font-bold text-arena-purple">+{purchasedAt.toLocaleString()} AT</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Status</span>
                <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px]">Confirmed</Badge>
              </div>
            </div>

            <Button className="w-full font-display" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
