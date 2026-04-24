import { formatEther } from "viem";
import { AlertTriangle, Loader2 } from "lucide-react";
import { usePendingWithdrawals } from "@/hooks/usePendingWithdrawals";
import { useUserStore } from "@/stores/userStore";

export function PendingWithdrawalBanner() {
  const isAuthenticated = useUserStore((s) => s.isAuthenticated);
  const { hasPending, pendingWei, withdrawing, error, withdraw } = usePendingWithdrawals();

  if (!isAuthenticated || !hasPending) return null;

  const bnbDisplay = parseFloat(formatEther(pendingWei)).toFixed(6);

  return (
    <div className="relative z-50 flex items-center gap-3 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-sm">
      <AlertTriangle className="shrink-0 h-4 w-4 text-amber-400" />
      <div className="flex-1 min-w-0">
        <span className="text-amber-300 font-semibold">Unclaimed Funds: </span>
        <span className="text-amber-200">
          {bnbDisplay} tBNB is pending in the escrow contract.
          This happens when a direct payout failed — click Withdraw to claim.
        </span>
        {error && (
          <span className="ml-2 text-red-400 text-xs">{error}</span>
        )}
      </div>
      <button
        onClick={() => void withdraw()}
        disabled={withdrawing}
        className="shrink-0 flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 hover:text-amber-200 rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {withdrawing ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Withdrawing…
          </>
        ) : (
          "Withdraw"
        )}
      </button>
    </div>
  );
}
