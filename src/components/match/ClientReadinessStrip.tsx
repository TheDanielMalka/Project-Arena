import { useCallback, useState } from "react";
import {
  WifiOff,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useClientStore } from "@/stores/clientStore";
import { useUserStore } from "@/stores/userStore";
import { getClientStatus } from "@/lib/engine-api";

function StepRow({
  ok,
  pending,
  label,
  hint,
}: {
  ok: boolean;
  pending: boolean;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 text-arena-cyan animate-spin mt-0.5" />
      ) : ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-arena-gold mt-0.5" />
      )}
      <div>
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground mt-0.5 leading-snug">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Lobby helper: explains client/engine readiness, manual refresh (GET /client/status),
 * and why the desktop client exists.
 *
 * Phase 4: recheck() uses the canonical GET /client/status endpoint (via getClientStatus)
 * so the strip stays in sync with the same source of truth as canPlay().
 */
export function ClientReadinessStrip() {
  const clientStatus      = useClientStore((s) => s.status);
  const version           = useClientStore((s) => s.version);
  const websiteUserId     = useUserStore((s) => s.user?.id);
  const token             = useUserStore((s) => s.token);
  const bindUserId        = useClientStore((s) => s.bindUserId);
  const canPlay           = useClientStore((s) => s.canPlayForUser(websiteUserId));
  const statusLabelFn     = useClientStore((s) => s.statusLabel);
  const syncFromClientStatus = useClientStore((s) => s.syncFromClientStatus);
  const walletAddress     = useUserStore((s) => s.user?.walletAddress);
  const [busy, setBusy]   = useState(false);
  // Tracks whether the engine API responded at all (non-null = API is up)
  const [engineApiUp, setEngineApiUp] = useState<boolean | null>(null);

  const recheck = useCallback(async () => {
    setBusy(true);
    try {
      const data = token
        ? await getClientStatus(undefined, token)
        : await getClientStatus(walletAddress);
      setEngineApiUp(data !== null);
      syncFromClientStatus(data);
    } finally {
      setBusy(false);
    }
  }, [syncFromClientStatus, token, walletAddress]);

  const isChecking    = clientStatus === "checking";
  const isDisconnected = clientStatus === "disconnected";
  // Engine API is reachable if we got any response (even online=false) or status moved past checking/disconnected
  const engineReachable = engineApiUp === true || (clientStatus !== "disconnected" && clientStatus !== "checking");
  const captureReady  = clientStatus === "ready" || clientStatus === "in_match";
  const boundToWebsiteUser = !!websiteUserId && !!bindUserId && bindUserId === websiteUserId;

  const showSuccessSlim = canPlay && !isChecking;

  if (showSuccessSlim) {
    return (
      <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-display text-primary truncate">
            Arena Client · {statusLabelFn()}
            {version ? (
              <span className="text-muted-foreground font-mono font-normal">
                {" "}
                · v{version}
              </span>
            ) : null}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] font-display shrink-0"
          disabled={busy}
          onClick={() => void recheck()}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${busy ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-arena-gold/30 bg-arena-gold/5 px-4 py-3 space-y-3">
      <div className="flex items-start gap-3">
        <WifiOff className="h-4 w-4 text-arena-gold shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-display font-semibold text-arena-gold">
            {isChecking
              ? "Checking Arena Client…"
              : isDisconnected
                ? "Arena Client Required"
                : captureReady && !boundToWebsiteUser
                  ? "Sign in to Arena Client"
                  : "Finish setup to play"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isDisconnected
              ? "Run the Arena desktop client on this machine while the engine is up (Docker or local). Join stays blocked until the client looks healthy."
              : captureReady && !boundToWebsiteUser
                ? "Your desktop client is running, but it is not linked to the same Arena user as this website session. Sign in inside the client to bind your session."
                : "Your client is starting or not fully ready. When capture turns ready, Join unlocks automatically — use Refresh if you just started the client."}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0 items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs font-display border-arena-gold/40"
            disabled={busy}
            onClick={() => void recheck()}
          >
            <RefreshCw className={`h-3 w-3 mr-1.5 ${busy ? "animate-spin" : ""}`} />
            Recheck
          </Button>
          {isDisconnected && (
            <a
              href="https://arena-client-dist.s3.us-east-1.amazonaws.com/setup.zip"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-arena-gold/15 border border-arena-gold/30 text-arena-gold text-xs font-display hover:bg-arena-gold/25 transition-colors"
            >
              <Download className="h-3 w-3" /> Download
            </a>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-card/40 p-3 space-y-2.5">
        <StepRow
          pending={isChecking}
          ok={engineReachable}
          label="Engine API reachable"
          hint={
            engineReachable
              ? "Health check responded — engine container or local API is up."
              : "Start the engine (e.g. docker compose) or check dev proxy / VITE_ENGINE_API_URL."
          }
        />
        <StepRow
          pending={isChecking || clientStatus === "connected"}
          ok={captureReady}
          label="Capture pipeline ready"
          hint={
            captureReady
              ? "Client reports ready or in-match."
              : "Open Arena Client and wait until it finishes starting (tray icon)."
          }
        />
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground [&[data-state=open]_svg]:rotate-180">
          <ChevronDown className="h-3 w-3 transition-transform" />
          Why Arena Client?
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 text-xs text-muted-foreground space-y-1.5">
          <p>
            Staked matches need verified capture on your PC. The desktop client talks to the engine so
            screenshots and results stay tied to your session.
          </p>
          <p className="text-[10px]">
            DB-ready: this flow will align with{" "}
            <span className="font-mono">client_sessions</span> when auth + DB are fully wired.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
