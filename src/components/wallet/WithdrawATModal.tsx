/**
 * WithdrawATModal — burn Arena Tokens and receive BNB equivalent to linked wallet.
 *
 * Rate: 1050 AT = $10 USDT  (AT_PER_USDT_WITHDRAW = 105 AT per $1)
 * Amounts must be multiples of 1050 (1050, 2100, 3150…).
 * Daily limit: 10,000 AT.
 * CONTRACT-ready: platform wallet sends BNB on-chain after this call.
 */
import { useState } from "react";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { useUserStore }   from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { apiWithdrawAT } from "@/lib/engine-api";
import { Flame, Wallet, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constants (mirror engine/src/config.py) ────────────────────────────────
const AT_RATE_PER_DOLLAR = 105;   // AT per $1 USDT  (1050 AT = $10)
const AT_UNIT            = 1050;  // smallest withdrawal chunk
const AT_DAILY_LIMIT     = 10_000;

// ── Props ──────────────────────────────────────────────────────────────────
interface WithdrawATModalProps {
  open:    boolean;
  onClose: () => void;
  /** Called with new AT balance after successful withdrawal */
  onSuccess?: (newBalance: number) => void;
}

// ── Component ──────────────────────────────────────────────────────────────
export function WithdrawATModal({ open, onClose, onSuccess }: WithdrawATModalProps) {
  const { token } = useUserStore();
  const { connectedAddress, atBalance } = useWalletStore();

  const [atInput, setAtInput] = useState("");
  const [busy, setBusy]       = useState(false);

  if (!open) return null;

  const atParsed  = parseInt(atInput, 10) || 0;
  const usdtValue = atParsed > 0 && atParsed % AT_UNIT === 0 ? atParsed / AT_RATE_PER_DOLLAR : null;

  const validAmount = atParsed >= AT_UNIT && atParsed % AT_UNIT === 0 && atParsed <= AT_DAILY_LIMIT;
  const hasBalance  = atParsed <= (atBalance ?? 0);
  const canSubmit   = validAmount && hasBalance && !!connectedAddress && !!token && !busy;

  const shortAddr = connectedAddress
    ? `${connectedAddress.slice(0, 8)}...${connectedAddress.slice(-6)}`
    : null;

  const handleWithdraw = async () => {
    if (!canSubmit || !token) return;
    setBusy(true);
    try {
      const res = await apiWithdrawAT(token, { at_amount: atParsed });
      if (res.ok === false) {
        useNotificationStore.getState().addNotification({
          type: "system",
          title: "Withdrawal failed",
          message: res.detail ?? "Could not process withdrawal. Try again.",
        });
        return;
      }
      useNotificationStore.getState().addNotification({
        type: "system",
        title: "Withdrawal submitted",
        message: `${res.at_burned.toLocaleString()} AT burned — $${res.usdt_value.toFixed(2)} USDT in BNB will arrive at your wallet shortly.`,
      });
      onSuccess?.(res.at_balance);
      setAtInput("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-arena-purple/10 flex items-center justify-center shrink-0">
            <Flame className="h-5 w-5 text-arena-purple" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold">Withdraw Arena Tokens</h3>
            <p className="text-xs text-muted-foreground">Burn AT → receive BNB to your wallet</p>
          </div>
        </div>

        {/* Amount input */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-display">
            AT Amount <span className="text-muted-foreground/60">(multiples of {AT_UNIT})</span>
          </p>
          <div className="flex gap-2">
            <Input
              type="number"
              min={AT_UNIT}
              step={AT_UNIT}
              max={AT_DAILY_LIMIT}
              placeholder={`${AT_UNIT}, ${AT_UNIT * 2}, ${AT_UNIT * 3}…`}
              value={atInput}
              onChange={(e) => setAtInput(e.target.value)}
              className="font-mono bg-secondary border-border"
            />
            <button
              onClick={() => {
                const max = Math.min(atBalance ?? 0, AT_DAILY_LIMIT);
                const snapped = Math.floor(max / AT_UNIT) * AT_UNIT;
                setAtInput(String(snapped > 0 ? snapped : ""));
              }}
              className="text-xs text-arena-purple hover:underline whitespace-nowrap"
            >
              Max
            </button>
          </div>

          {/* Preview */}
          {atParsed > 0 && (
            <div className={cn(
              "rounded-lg border px-3 py-2 flex items-center justify-between",
              validAmount && hasBalance
                ? "border-arena-green/30 bg-arena-green/5"
                : "border-destructive/30 bg-destructive/5"
            )}>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-bold text-foreground">
                  {atParsed.toLocaleString()} AT
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-display font-bold text-arena-green">
                  {usdtValue !== null ? `$${usdtValue.toFixed(2)} USDT` : "invalid amount"}
                </span>
              </div>
              {!hasBalance && (
                <span className="text-[10px] text-destructive">Insufficient AT</span>
              )}
              {atParsed > AT_DAILY_LIMIT && (
                <span className="text-[10px] text-destructive">Exceeds daily limit</span>
              )}
            </div>
          )}
        </div>

        {/* Wallet destination */}
        <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 flex items-center gap-2">
          <Wallet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground font-display uppercase tracking-wider">Destination</p>
            <p className="text-xs font-mono text-foreground truncate">
              {shortAddr ?? <span className="text-destructive">No wallet connected</span>}
            </p>
          </div>
        </div>

        {/* Daily limit info */}
        <p className="text-[10px] text-muted-foreground">
          Daily limit: {AT_DAILY_LIMIT.toLocaleString()} AT max · Balance: {(atBalance ?? 0).toLocaleString()} AT
        </p>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1 font-display" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="flex-1 font-display bg-arena-purple hover:bg-arena-purple/90 text-white"
            disabled={!canSubmit}
            onClick={() => void handleWithdraw()}
          >
            {busy
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>
              : <><Flame className="mr-2 h-4 w-4" /> Withdraw</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}
