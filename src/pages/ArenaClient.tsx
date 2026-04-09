import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Download, Monitor, ShieldCheck, Radio, ArrowRight, RefreshCw,
} from "lucide-react";
import { useClientStore } from "@/stores/clientStore";
import { useUserStore } from "@/stores/userStore";
import { getClientStatus } from "@/lib/engine-api";
import { useCallback, useState } from "react";

/**
 * Explains why the desktop client exists and how it ties to the engine.
 * No new API — uses clientStore + optional manual health ping.
 */
const ArenaClientPage = () => {
  const statusLabel          = useClientStore((s) => s.statusLabel);
  const version              = useClientStore((s) => s.version);
  const websiteUserId        = useUserStore((s) => s.user?.id);
  const canPlay              = useClientStore((s) => s.canPlayForUser(websiteUserId));
  const syncFromClientStatus = useClientStore((s) => s.syncFromClientStatus);
  const walletAddress        = useUserStore((s) => s.user?.walletAddress);
  const [busy, setBusy]      = useState(false);

  // Phase 4: manual recheck uses canonical GET /client/status, not GET /health.
  const recheck = useCallback(async () => {
    setBusy(true);
    try {
      const data = await getClientStatus(walletAddress);
      syncFromClientStatus(data);
    } finally {
      setBusy(false);
    }
  }, [syncFromClientStatus, walletAddress]);

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mb-1">Arena</p>
        <h1 className="font-display text-3xl font-bold tracking-wide">Arena Client</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          The desktop app verifies match results on your PC and talks to the engine. Staked play stays fair because
          outcomes are tied to your session—not a browser tab alone.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <span className="font-display text-sm font-semibold">Status on this device</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono ${canPlay ? "text-primary" : "text-muted-foreground"}`}>
              {statusLabel()}
              {version ? ` · v${version}` : ""}
            </span>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void recheck()}>
              <RefreshCw className={`h-3 w-3 mr-1 ${busy ? "animate-spin" : ""}`} />
              Check now
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          If you use Docker for the engine, keep the stack running and point the site at the same API URL as in dev
          (<span className="font-mono text-[10px]">VITE_ENGINE_API_URL</span>). The client must reach that engine too.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 space-y-2">
          <ShieldCheck className="h-5 w-5 text-arena-cyan" />
          <h2 className="font-display text-sm font-bold">Why it&apos;s required</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Screenshots and capture run locally. The lobby stays read-only until we see a healthy client—so everyone in a
            staked match is on the same verification path.
          </p>
        </div>
        <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 space-y-2">
          <Radio className="h-5 w-5 text-arena-gold" />
          <h2 className="font-display text-sm font-bold">What happens next</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            After install, leave the client running in the tray. Open the Match Lobby and use Recheck if status was slow
            to update. When the badge shows ready, Join unlocks.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href="https://arena-client-dist.s3.us-east-1.amazonaws.com/setup.zip"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex"
        >
          <Button className="font-display glow-green">
            <Download className="h-4 w-4 mr-2" />
            Download client
          </Button>
        </a>
        <Button variant="outline" asChild className="font-display">
          <Link to="/lobby">
            Go to Match Lobby
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        DB-ready: login to the client and <span className="font-mono">client_sessions</span> will mirror this status server-side.
      </p>
    </div>
  );
};

export default ArenaClientPage;
