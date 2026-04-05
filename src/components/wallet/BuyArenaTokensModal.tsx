import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Zap, Loader2, CheckCircle2, AlertTriangle, Wallet, ArrowRight, Info,
} from "lucide-react";
import { useWalletStore } from "@/stores/walletStore";
import { useUserStore } from "@/stores/userStore";
import { apiGetAtPackages, apiBuyAtPackage, type AtPackageRow } from "@/lib/engine-api";
import { cn } from "@/lib/utils";

type Step = "select" | "confirm" | "processing" | "success";

interface BuyArenaTokensModalProps {
  open: boolean;
  onClose: () => void;
}

export function BuyArenaTokensModal({ open, onClose }: BuyArenaTokensModalProps) {
  const { usdtBalance } = useWalletStore();
  const token = useUserStore((s) => s.token);
  const refreshProfileFromServer = useUserStore((s) => s.refreshProfileFromServer);

  const [step, setStep] = useState<Step>("select");
  const [packages, setPackages] = useState<AtPackageRow[]>([]);
  const [packagesStatus, setPackagesStatus] = useState<"idle" | "loading" | "ok" | "error" | "empty">("idle");
  const [selectedPkg, setSelectedPkg] = useState<AtPackageRow | null>(null);
  const [txHash, setTxHash] = useState("");
  const [txError, setTxError] = useState("");
  const [lastSuccess, setLastSuccess] = useState<{
    at_credited: number;
    usdt_spent: number;
    discount_pct: number;
  } | null>(null);
  useEffect(() => {
    if (!open) {
      const t = globalThis.setTimeout(() => {
        setStep("select");
        setPackages([]);
        setPackagesStatus("idle");
        setSelectedPkg(null);
        setTxHash("");
        setTxError("");
        setLastSuccess(null);
      }, 300);
      return () => globalThis.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPackagesStatus("loading");
    void (async () => {
      const res = await apiGetAtPackages();
      if (cancelled) return;
      if (res?.packages?.length) {
        // Deduplicate by at_amount — guard against duplicate DB rows
        const seen = new Set<number>();
        const deduped = res.packages.filter((p) => {
          if (seen.has(p.at_amount)) return false;
          seen.add(p.at_amount);
          return true;
        });
        setPackages(deduped);
        setSelectedPkg((prev) => {
          if (prev && deduped.some((p) => p.at_amount === prev.at_amount)) return prev;
          return deduped[0] ?? null;
        });
        setPackagesStatus("ok");
      } else {
        setPackages([]);
        setSelectedPkg(null);
        setPackagesStatus(res == null ? "error" : "empty");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleProceedToConfirm = () => {
    if (!selectedPkg) return;
    setStep("confirm");
    setTxHash("");
    setTxError("");
  };

  const handleSubmitPurchase = () => {
    if (!token) {
      setTxError("Sign in to buy Arena Tokens.");
      return;
    }
    if (!selectedPkg) return;
    const h = txHash.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(h)) {
      setTxError("Enter a valid BSC transaction hash (0x + 64 hex characters).");
      return;
    }
    setTxError("");
    setStep("processing");

    void (async () => {
      const result = await apiBuyAtPackage(token, { tx_hash: h, at_amount: selectedPkg.at_amount });
      if (result.ok === false) {
        setTxError(result.detail ?? "Purchase failed. Check the hash and try again.");
        setStep("confirm");
        return;
      }
      await refreshProfileFromServer();
      setLastSuccess({
        at_credited: result.at_credited,
        usdt_spent: result.usdt_spent,
        discount_pct: result.discount_pct,
      });
      setStep("success");
    })();
  };

  const handleClose = () => {
    if (step === "processing") return;
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

        {step === "select" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-secondary/40 border border-border/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" />
                <span>Your USDT balance (display)</span>
              </div>
              <span className="font-display font-bold text-sm text-foreground">
                ${usdtBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" />
              <span>
                Packages and prices come from the server. After you pay USDT on-chain, paste the tx hash on the next step.
              </span>
            </div>

            {packagesStatus === "loading" && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading packages…
              </div>
            )}

            {packagesStatus === "error" && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-[11px] text-destructive">
                  Could not load packages. Check that the engine is running and try again.
                </p>
              </div>
            )}

            {packagesStatus === "empty" && (
              <p className="text-sm text-muted-foreground text-center py-6">No AT packages available right now.</p>
            )}

            {packagesStatus === "ok" && packages.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {packages.map((p) => (
                    <button
                      key={p.at_amount}
                      type="button"
                      onClick={() => setSelectedPkg(p)}
                      className={cn(
                        "rounded-lg border px-2 py-3 text-left transition-all",
                        selectedPkg?.at_amount === p.at_amount
                          ? "border-arena-purple bg-arena-purple/15 text-arena-purple"
                          : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-arena-purple/40 hover:text-foreground"
                      )}
                    >
                      <p className="font-display font-bold text-sm">{p.at_amount.toLocaleString()} AT</p>
                      <p className="text-[10px] mt-0.5 opacity-80">
                        List ${p.usdt_price.toFixed(2)}
                        {p.discount_pct > 0 && (
                          <span className="text-arena-gold"> · {p.discount_pct}% off</span>
                        )}
                      </p>
                      <p className="text-[10px] font-mono mt-0.5 text-foreground">
                        Pay ${p.final_price.toFixed(2)} USDT
                      </p>
                    </button>
                  ))}
                </div>

                <Button
                  className="w-full font-display"
                  disabled={!selectedPkg || !token}
                  onClick={handleProceedToConfirm}
                >
                  Continue <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
                {!token && (
                  <p className="text-[11px] text-center text-muted-foreground">Sign in to purchase AT.</p>
                )}
              </>
            )}
          </div>
        )}

        {step === "confirm" && selectedPkg && (
          <div className="space-y-4">
            <div className="rounded-xl border border-arena-purple/30 bg-arena-purple/5 px-4 py-4 space-y-2">
              <p className="text-[10px] text-muted-foreground font-display uppercase tracking-wider">Package</p>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-display font-bold text-base text-arena-purple">
                    {selectedPkg.at_amount.toLocaleString()} AT
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    List ${selectedPkg.usdt_price.toFixed(2)}
                    {selectedPkg.discount_pct > 0 && ` · ${selectedPkg.discount_pct}% discount`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-sm">${selectedPkg.final_price.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">You pay (USDT)</p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Send the USDT amount above from your wallet, then paste the BSC transaction hash here.
              </p>
              <Input
                placeholder="0x…"
                value={txHash}
                onChange={(e) => { setTxHash(e.target.value); setTxError(""); }}
                className="font-mono text-sm"
                autoFocus
              />
              {txError && (
                <p className="text-[11px] text-destructive mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {txError}
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
                onClick={() => void handleSubmitPurchase()}
              >
                Submit &amp; credit AT
              </Button>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-arena-purple/10 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-arena-purple animate-spin" />
            </div>
            <p className="font-display font-semibold text-sm">Confirming with server…</p>
            <Badge className="bg-arena-purple/10 text-arena-purple border-arena-purple/20 text-[9px]">
              POST /wallet/buy-at-package
            </Badge>
          </div>
        )}

        {step === "success" && lastSuccess && (
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-display font-bold text-base text-primary">AT credited</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-display font-bold text-arena-purple text-base">
                  +{lastSuccess.at_credited.toLocaleString()} AT
                </span>
              </p>
            </div>

            <div className="w-full rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">USDT spent</span>
                <span className="font-mono">${lastSuccess.usdt_spent.toFixed(2)}</span>
              </div>
              {lastSuccess.discount_pct > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount applied</span>
                  <span>{lastSuccess.discount_pct}%</span>
                </div>
              )}
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
