import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  AppWindow, Bot, Gamepad2, Link2, Monitor, Shield, Wallet, Zap,
} from "lucide-react";

const panel =
  "rounded-sm border border-arena-cyan/20 bg-gradient-to-br from-card/80 via-card/40 to-card/20 px-4 py-3 text-sm leading-relaxed text-muted-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)]";

/**
 * In-depth player checklist — site, client, chain, game — “bolt level” copy.
 * Shown on the season page; adjust dates/slug in CMS/API later, not here.
 */
export function TournamentPlayerGuideSections() {
  return (
    <div className="space-y-4">
      <h3 className="font-hud text-xs uppercase tracking-[0.35em] text-arena-cyan/80">
        Player field manual · read before you queue
      </h3>
      <Accordion type="single" collapsible className="w-full space-y-2">
        <AccordionItem
          value="a1"
          className="border border-border/50 bg-black/20 px-1 rounded-sm"
        >
          <AccordionTrigger className="px-3 py-3 font-hud text-[11px] uppercase tracking-wider text-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <AppWindow className="h-4 w-4 text-arena-cyan" />
              Arena website + account
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={cn(panel, "space-y-2 pb-2")}>
              <p>
                <strong className="text-foreground">Create your Arena account</strong> and verify you can sign in. Your{" "}
                <strong>Steam / SteamID64</strong> must be linked in{" "}
                <strong>Settings</strong> — the tournament server checks the same value you used when you registered. No
                Steam on profile → no check-in.
              </p>
              <p>
                <strong className="text-foreground">MetaMask (or any WalletConnect wallet)</strong> is required on{" "}
                <strong>testnet</strong> for escrow drills: you can use a fresh address with 0 USDT; we may grant{" "}
                <span className="text-arena-cyan">demo / test credits</span> to prove deposits & payouts. Connect once
                from the Wallet page and keep the network the operator announces (e.g. BSC testnet).
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="a2"
          className="border border-border/50 bg-black/20 px-1 rounded-sm"
        >
          <AccordionTrigger className="px-3 py-3 font-hud text-[11px] uppercase tracking-wider text-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              Arena desktop client (capture + liveness)
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={cn(panel, "space-y-2 pb-2")}>
              <p>
                Install the <strong className="text-foreground">ProjectArena desktop client</strong> and keep it{" "}
                <strong>online</strong> while you&apos;re in scheduled matches. It sends the{" "}
                <code className="text-xs text-arena-cyan/90">/client/heartbeat</code> stream the engine uses to know you
                didn&apos;t ghost — it is <strong>not</strong> the same as the browser lobby “breath” ping.
              </p>
              <p>
                <strong className="text-foreground">CS2 only</strong> in this test season: the vision pipeline and HUD
                templates target Counter-Strike 2. Make sure the client sees the right process and resolution.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="a3"
          className="border border-border/50 bg-black/20 px-1 rounded-sm"
        >
          <AccordionTrigger className="px-3 py-3 font-hud text-[11px] uppercase tracking-wider text-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-emerald-400" />
              CS2 on Steam
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={cn(panel, "space-y-2 pb-2")}>
              <p>
                You <strong>must</strong> own and launch <strong>Counter-Strike 2</strong> via the same Steam account
                you linked. Tournament matches are played on the official build — no private cracks or offline builds.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="a4"
          className="border border-border/50 bg-black/20 px-1 rounded-sm"
        >
          <AccordionTrigger className="px-3 py-3 font-hud text-[11px] uppercase tracking-wider text-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              Format: warm-up, brackets, map picks
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={cn(panel, "space-y-2 pb-2")}>
              <p>
                <strong className="text-foreground">30-minute warm-up block</strong> — everyone is expected online for
                tech checks, roster fixes, and Discord/in-game lobby formation.
              </p>
              <p>
                <strong className="text-foreground">5v5 main bracket</strong> — 16 team slots, single elimination
                (knockout), <strong>BO3</strong> every round, <strong>BO5</strong> grand final (mirrors the pro CS2
                book). Map veto/pick flow follows admin instructions in match chat.
              </p>
              <p>
                <strong className="text-foreground">2v2 / 1v1</strong> — follow the per-division blurb. Defaults are
                still competitive CS2 rules, BO3 for most series unless admins broadcast otherwise.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="a5"
          className="border border-border/50 bg-black/20 px-1 rounded-sm"
        >
          <AccordionTrigger className="px-3 py-3 font-hud text-[11px] uppercase tracking-wider text-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-sky-400" />
                Marketing & comms
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={cn(panel, "space-y-2 pb-2")}>
              <p>
                Share the official forum post + Discord/Steam groups using the same HUD screenshots as this page. Tag
                teams honestly — smurfing or faking Steam IDs is a forfeit. Help us <strong>stress the stack</strong>:
                the more real traffic we get, the faster the production schedule moves.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="a6"
          className="border border-border/50 bg-black/20 px-1 rounded-sm"
        >
          <AccordionTrigger className="px-3 py-3 font-hud text-[11px] uppercase tracking-wider text-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-violet-400" />
              Contract / testnet
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className={cn(panel, "space-y-2 pb-2")}>
              <p>
                Prize figures are quoted in <strong>ILS</strong> for marketing clarity; the actual on-chain or payout
                rail is whatever the operator runs against the <strong>deployed testnet / production escrow</strong> after
                the contract is redeployed. Nothing moves until an admin attests a verifiable on-chain or treasury
                transfer.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export function TournamentTrustBadges() {
  return (
    <ul className="grid gap-2 sm:grid-cols-3 text-[11px] font-hud uppercase tracking-wider text-muted-foreground/90">
      <li className="flex items-center gap-2 border border-arena-cyan/15 bg-black/30 px-3 py-2 rounded-sm">
        <Shield className="h-3.5 w-3.5 text-arena-cyan shrink-0" />
        Testnet = real stack rehearsal
      </li>
      <li className="flex items-center gap-2 border border-arena-cyan/15 bg-black/30 px-3 py-2 rounded-sm">
        <Bot className="h-3.5 w-3.5 text-arena-cyan shrink-0" />
        Automation-first ops
      </li>
      <li className="flex items-center gap-2 border border-arena-cyan/15 bg-black/30 px-3 py-2 rounded-sm">
        <Monitor className="h-3.5 w-3.5 text-arena-cyan shrink-0" />
        Client + site dual verified
      </li>
    </ul>
  );
}
