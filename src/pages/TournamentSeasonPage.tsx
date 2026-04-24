import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchTournamentSeason, registerTournament } from "@/lib/tournament-api";
import type { TournamentSeason, TournamentDivision } from "@/types";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { TournamentPlayerGuideSections, TournamentTrustBadges } from "@/components/tournament/TournamentPlayerGuideSections";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Crown, Sparkles, Wallet, ShieldAlert } from "lucide-react";

const STATIC_FALLBACK: TournamentSeason = {
  id: "local",
  slug: "cs2-arena-open-2026",
  title: "Arena CS2 Open — System Test (Testnet)",
  titleHe: "תחרות CS2 — בדיקת מערכת (טסט נט)",
  subtitle: "5v5 · 2v2 · 1v1",
  game: "CS2",
  networkPhase: "testnet",
  state: "registration_open",
  warmUpMinutes: 30,
  registrationOpensAt: null,
  registrationClosesAt: null,
  mainStartsAt: null,
  testDisclaimerMd:
    "**Test event.** Stacked registration for automation + real sync checks. Prizes in **ILS**; payouts follow operator treasury / escrow when the testnet contract is live.",
  futureRewardsMd:
    "Early participants may be eligible for future in-app rewards if Arena ships — not tied to final placement in this test.",
  marketingBlurbMd:
    "**Run the client. Run the chain. Run the book.**",
  divisions: [
    {
      id: "div-5v5",
      mode: "5v5",
      title: "5v5 grand bracket",
      titleHe: "5v5",
      position: 0,
      prize1Ils: 5000,
      prize2Ils: 3000,
      prize3Ils: 2000,
      formatMarkdown:
        "**16 team slots** · single elimination · every round **BO3** — **Grand final BO5** (pro CS2). 30m warm-up.",
      maxSlots: 16,
      isTeamMode: true,
      registeredCount: 0,
    },
    {
      id: "div-2v2",
      mode: "2v2",
      title: "2v2 bracket",
      titleHe: "2v2",
      position: 1,
      prize1Ils: 1500,
      prize2Ils: 750,
      prize3Ils: 250,
      formatMarkdown: "Knockout — **BO3** series unless admins publish otherwise.",
      maxSlots: 32,
      isTeamMode: true,
      registeredCount: 0,
    },
    {
      id: "div-1v1",
      mode: "1v1",
      title: "1v1 duels",
      titleHe: "1v1",
      position: 2,
      prize1Ils: 1500,
      prize2Ils: 750,
      prize3Ils: 250,
      formatMarkdown: "Duel bracket — **BO3**; final can go **BO5**.",
      maxSlots: 32,
      isTeamMode: false,
      registeredCount: 0,
    },
  ],
};

function PrizeBlock({ d }: { d: TournamentDivision }) {
  return (
    <Card
      className={cn(
        "border-arena-cyan/25 bg-gradient-to-b from-card/80 via-card/30 to-card/5",
        "shadow-[0_0_32px_-16px_hsl(var(--arena-cyan)/0.25),inset_0_1px_0_hsl(0_0%_100%/0.04)]",
        "transition-shadow hover:shadow-[0_0_40px_-12px_hsl(var(--arena-cyan)/0.2)]",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-hud text-[11px] uppercase tracking-wider text-arena-cyan/90">
            {d.mode} · {d.title}
          </h3>
          <Crown className="h-4 w-4 text-amber-400/80" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <ul className="space-y-0.5 font-mono text-xs text-foreground/90">
          <li>1st — {d.prize1Ils.toLocaleString("he-IL")} ₪</li>
          <li>2nd — {d.prize2Ils.toLocaleString("he-IL")} ₪</li>
          <li>3rd — {d.prize3Ils.toLocaleString("he-IL")} ₪</li>
        </ul>
        <div className="text-[10px] leading-relaxed text-muted-foreground line-clamp-4 [&_p]:m-0">
          {d.formatMarkdown ? <ReactMarkdown>{d.formatMarkdown}</ReactMarkdown> : "—"}
        </div>
        <p className="text-[9px] font-hud uppercase tracking-wider text-muted-foreground/70">
          {d.registeredCount ?? 0} / {d.maxSlots} registered
        </p>
      </CardContent>
    </Card>
  );
}

export default function TournamentSeasonPage() {
  const { slug } = useParams<{ slug: string }>();
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user);
  const wConnected = useWalletStore((s) => s.connectedAddress !== null);
  const [season, setSeason] = useState<TournamentSeason | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackClient, setAckClient] = useState(false);
  const [ackTest, setAckTest] = useState(false);
  const [ackCs2, setAckCs2] = useState(false);
  const [wantsDemo, setWantsDemo] = useState(false);
  const [teamLabel, setTeamLabel] = useState("");

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    const s = await fetchTournamentSeason(slug);
    setSeason(s ?? { ...STATIC_FALLBACK, slug });
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRegister = async (division: TournamentDivision) => {
    if (!token) {
      toast.error("Log in to register");
      return;
    }
    if (!user?.steamId?.trim()) {
      toast.error("Add Steam (SteamID64) in Settings first");
      return;
    }
    const r = await registerTournament(token, season!.slug, {
      divisionId: division.id,
      teamLabel: division.isTeamMode ? teamLabel || undefined : undefined,
      ackArenaClient: ackClient,
      ackTestnet: ackTest,
      ackCs2: ackCs2,
      wantsDemoAt: wantsDemo,
      metWalletConnected: wConnected,
    });
    if (r.ok) toast.success(r.status === "waitlist" ? "Waitlisted" : "Registered");
    else toast.error(r.error ?? "Failed");
  };

  if (loading || !season) {
    return (
      <div className="py-20 text-center font-hud text-xs uppercase tracking-widest text-muted-foreground">
        <Sparkles className="mx-auto mb-3 h-5 w-5 text-arena-cyan motion-safe:animate-pulse" />
        Loading event…
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-2 border-b border-arena-cyan/15 pb-6">
        <p className="font-hud text-[10px] uppercase tracking-[0.45em] text-arena-cyan/70">CS2 · Open season</p>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          {season.title}
        </h1>
        {season.titleHe && <p className="text-sm text-arena-cyan/80 md:text-base">{season.titleHe}</p>}
        <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{season.subtitle}</p>
        <TournamentTrustBadges />
        <div className="pt-2 flex flex-wrap gap-2 font-hud text-[9px] uppercase tracking-wider text-muted-foreground/90">
          <span className="border border-arena-cyan/20 px-2 py-0.5">{season.networkPhase}</span>
          <span className="border border-arena-cyan/20 px-2 py-0.5">state: {season.state}</span>
          {season.warmUpMinutes ? (
            <span className="border border-arena-cyan/20 px-2 py-0.5">warm-up {season.warmUpMinutes}m</span>
          ) : null}
        </div>
      </header>

      {season.testDisclaimerMd && (
        <section className="prose prose-invert prose-sm max-w-none rounded-sm border border-amber-500/20 bg-amber-500/[0.04] p-4 text-amber-100/90">
          <div className="mb-1 flex items-center gap-2 font-hud text-[10px] uppercase tracking-[0.25em] text-amber-400/90">
            <ShieldAlert className="h-3.5 w-3.5" /> Operator notice
          </div>
          <ReactMarkdown>{season.testDisclaimerMd}</ReactMarkdown>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-hud text-xs uppercase tracking-[0.35em] text-foreground/90">Prize outline (ILS)</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {season.divisions.map((d) => (
            <PrizeBlock key={d.id} d={d} />
          ))}
        </div>
      </section>

      {season.futureRewardsMd && (
        <section className="prose prose-invert prose-sm max-w-none text-muted-foreground">
          <h2 className="!mt-0 mb-2 font-hud text-xs uppercase tracking-[0.3em] text-arena-cyan/80">Future rewards</h2>
          <ReactMarkdown>{season.futureRewardsMd}</ReactMarkdown>
        </section>
      )}

      {season.marketingBlurbMd && (
        <section className="prose prose-invert prose-sm max-w-none text-muted-foreground">
          <ReactMarkdown>{season.marketingBlurbMd}</ReactMarkdown>
        </section>
      )}

      <TournamentPlayerGuideSections />

      <section className="space-y-4 border-t border-arena-cyan/10 pt-6">
        <h2 className="font-hud text-xs uppercase tracking-[0.35em] text-arena-cyan/80">On-site registration</h2>
        <p className="text-sm text-muted-foreground">
          Confirm every checkbox — they mirror what ops check before you hold a match slot. Need an account, Steam on profile, and (for testnet drills) a connected wallet.
        </p>
        <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.04] to-transparent">
        <CardContent className="space-y-2 p-4 sm:p-5">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox checked={ackClient} onCheckedChange={(v) => setAckClient(!!v)} />
            <span>I will run the Arena desktop client and keep heartbeats during matches</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox checked={ackTest} onCheckedChange={(v) => setAckTest(!!v)} />
            <span>This is a testnet / system test — rules & schedules can change</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox checked={ackCs2} onCheckedChange={(v) => setAckCs2(!!v)} />
            <span>I own CS2 on the Steam account linked in Arena</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox checked={wantsDemo} onCheckedChange={(v) => setWantsDemo(!!v)} />
            <span>Request test/demo USDT/AT (operator grants manually)</span>
          </label>
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> Wallet connected in UI:{" "}
            {wConnected ? <span className="text-arena-cyan">yes</span> : <span className="text-amber-400/90">not yet</span>}
            <Link to="/wallet" className="ml-1 text-arena-cyan underline-offset-2 hover:underline">
              /wallet
            </Link>
          </div>
        </CardContent>
        </Card>
        <div className="space-y-1">
          <Label className="font-hud text-[9px] uppercase text-muted-foreground">Team / roster label (2v2 / 5v5 — optional)</Label>
          <Input
            value={teamLabel}
            onChange={(e) => setTeamLabel(e.target.value)}
            maxLength={64}
            className="max-w-md"
            placeholder="Squad name for brackets"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {!user?.steamId && (
            <p className="w-full text-xs text-amber-400/90">Link Steam in Settings to unlock registration</p>
          )}
          {season.divisions.map((d) => (
            <Button
              key={d.id}
              variant="outline"
              className="font-hud text-[9px] uppercase tracking-widest"
              disabled={!token}
              onClick={() => void onRegister(d)}
            >
              Register · {d.mode}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/80">
          API path: <code className="text-arena-cyan/80">POST /tournaments/seasons/:slug/register</code> — ensure the
          engine exposes this route in your deployment.
        </p>
      </section>
    </div>
  );
}
