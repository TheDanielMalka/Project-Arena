import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCcwDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUserStore } from "@/stores/userStore";
import { apiGetMatchRefundStatus } from "@/lib/engine-api";
import { claimRefundFromEscrow } from "@/lib/metamaskBsc";
import { friendlyChainErrorMessage } from "@/lib/friendlyChainError";
import { useNotificationStore } from "@/stores/notificationStore";

interface Props {
  matchId: string;
  /** Optional amount label to show in the modal (e.g. "0.1 BNB"). */
  amountLabel?: string;
}

type Phase =
  | "idle"          // button visible, not yet clicked
  | "loading"       // fetching refund-status
  | "confirming"    // modal open, waiting for user to click Confirm
  | "sending"       // MetaMask opened / tx broadcast
  | "polling"       // tx sent, waiting for on-chain confirmation
  | "success"       // tx confirmed
  | "error";        // something went wrong

/**
 * Orange gradient "Claim Refund" button for cancelled CRYPTO matches.
 * Gated by VITE_ENABLE_CLAIM_REFUND — renders nothing when false.
 *
 * Flow:
 *   1. Click → GET /match/:id/refund-status (verify eligibility)
 *   2. Modal opens with amount
 *   3. Confirm → MetaMask ArenaEscrow.claimRefund(onChainMatchId)
 *   4. Poll /refund-status until canRefund=false → success toast → button disappears
 */
export function ClaimRefundButton({ matchId, amountLabel }: Props) {
  const enabled = import.meta.env.VITE_ENABLE_CLAIM_REFUND === "true";
  const token = useUserStore((s) => s.token);

  const [phase, setPhase]       = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [amount, setAmount]     = useState(amountLabel ?? "");
  const [onChainId, setOnChainId] = useState<bigint | null>(null);
  const [claimed, setClaimed]   = useState(false);
  const [open, setOpen]         = useState(false);

  const addNotification = useNotificationStore((s) => s.addNotification);

  // Poll after tx send until the backend confirms refund_claimed=true
  useEffect(() => {
    if (phase !== "polling") return;
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 20 && !cancelled; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const status = await apiGetMatchRefundStatus(matchId, token);
        if (!status) continue;
        if (!status.canRefund) {
          if (!cancelled) {
            setPhase("success");
            setClaimed(true);
            setOpen(false);
            addNotification({
              type: "escrow",
              title: "Refund received",
              message: `Your stake of ${amount || status.amount + " BNB"} has been returned to your wallet.`,
            });
          }
          return;
        }
      }
      // Timeout — still show success optimistically (tx was sent)
      if (!cancelled) {
        setPhase("success");
        setClaimed(true);
        setOpen(false);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [phase]);

  const handleOpen = useCallback(async () => {
    if (!token) return;
    setPhase("loading");
    const status = await apiGetMatchRefundStatus(matchId, token);
    if (!status?.canRefund) {
      setPhase("idle");
      return;
    }
    const raw = status.onChainMatchId;
    if (raw == null) { setPhase("idle"); return; }
    setOnChainId(BigInt(String(raw)));
    if (!amountLabel && status.amount && status.amount !== "0") {
      setAmount(`${status.amount} BNB`);
    }
    setPhase("confirming");
    setOpen(true);
  }, [matchId, token, amountLabel]);

  const handleConfirm = useCallback(async () => {
    if (!onChainId) return;
    setPhase("sending");
    setErrorMsg(null);
    try {
      await claimRefundFromEscrow(onChainId);
      setPhase("polling");
    } catch (e) {
      setErrorMsg(friendlyChainErrorMessage(e));
      setPhase("error");
    }
  }, [onChainId]);

  const handleClose = () => {
    if (phase === "sending" || phase === "polling") return;
    setOpen(false);
    setPhase("idle");
    setErrorMsg(null);
  };

  // Feature flag off or already claimed — render nothing
  if (!enabled || claimed || phase === "success") return null;

  return (
    <>
      <Button
        onClick={handleOpen}
        disabled={phase === "loading"}
        className={[
          "h-8 px-3 text-xs font-display font-bold tracking-wide",
          "bg-gradient-to-r from-orange-500 to-amber-400",
          "hover:from-orange-400 hover:to-amber-300",
          "text-black border-0 shadow-[0_0_12px_rgba(251,146,60,0.4)]",
          "hover:shadow-[0_0_18px_rgba(251,146,60,0.6)]",
          "transition-all duration-200",
        ].join(" ")}
      >
        {phase === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
        ) : (
          <RefreshCcwDot className="h-3.5 w-3.5 mr-1" />
        )}
        Claim Refund
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Claim Refund</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              This match was cancelled. Your stake will be returned to your wallet.
            </DialogDescription>
          </DialogHeader>

          {amount && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Amount</p>
              <p className="font-display text-2xl font-bold text-primary">{amount}</p>
            </div>
          )}

          {phase === "error" && errorMsg && (
            <p className="text-sm text-destructive text-center rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              {errorMsg}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleClose}
              disabled={phase === "sending" || phase === "polling"}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={phase === "sending" || phase === "polling"}
              className={[
                "flex-1 font-display font-bold",
                "bg-gradient-to-r from-orange-500 to-amber-400",
                "hover:from-orange-400 hover:to-amber-300",
                "text-black border-0",
              ].join(" ")}
            >
              {phase === "sending" || phase === "polling" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {phase === "polling" ? "Confirming…" : "Sending…"}
                </>
              ) : (
                "Confirm in Wallet"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
