import { LandingGuestFooter } from "@/components/landing/LandingGuestFooter";
import { LandingPublicNav } from "@/components/landing/LandingPublicNav";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Lock, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/stores/userStore";

/**
 * Public marketing — guests + signed-in (same pages; CTAs respect session).
 */
export default function WhyArena() {
  const navigate = useNavigate();
  const isAuthed = useUserStore((s) => s.isAuthenticated);
  const authOrDashboard = () => navigate(isAuthed ? "/dashboard" : "/auth");

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[hsl(220_24%_3%)] text-foreground">
      <div
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.04] motion-reduce:opacity-[0.015] mix-blend-multiply [background:repeating-linear-gradient(0deg,transparent,transparent_2px,hsl(0_0%_0%/0.42)_2px,hsl(0_0%_0%/0.42)_3px)]"
        aria-hidden
      />
      <LandingPublicNav active="why" />

      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-24 sm:px-8 sm:pt-28">
        <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-arena-cyan/55">Orientation</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-wide md:text-4xl">
          Why <span className="text-primary">Arena</span> exists
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
          Arena is built for players who want <strong className="text-foreground/90">real stakes</strong> with{" "}
          <strong className="text-foreground/90">verifiable outcomes</strong>. You lock funds in escrow, play your match,
          and the desktop client + vision pipeline confirms the result — so payouts are fair and automatic.
        </p>

        <ul className="mt-10 space-y-4">
          {[
            {
              icon: Lock,
              title: "Escrow you can trust",
              body: "Both sides stake before the match. Funds stay locked until a verified result — no manual “send me the money” DMs.",
            },
            {
              icon: Shield,
              title: "Proof, not promises",
              body: "The Arena Client reads the end screen (OCR) and reports to the engine. The goal is dispute-resistant settlement tied to what actually happened in-game.",
            },
            {
              icon: Zap,
              title: "Built for competitive rhythm",
              body: "Queue in the lobby, run your match on your usual stack (FACEIT, ranked, scrims — see How to Play), then let Arena handle the outcome layer.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex gap-4 rounded-lg border border-white/[0.08] bg-[hsl(220_22%_6%/0.55)] p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-arena-cyan/25 bg-arena-cyan/10">
                <Icon className="h-5 w-5 text-arena-cyan" strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="font-display text-sm font-bold tracking-wide text-foreground">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-12 rounded-lg border border-primary/25 bg-primary/[0.06] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold tracking-wide text-foreground">Your path in four beats</h2>
          <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
            {[
              "Create an account and connect a wallet when you want crypto stakes (AT flows work with the product rules you see in-app).",
              "Install the Arena Client — it stays in the tray and talks to the engine when you play.",
              "Open Match Lobby, join or create a room, and lock stakes with your opponent.",
              "Finish the game; the client verifies the result and escrow releases to the winner.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button type="button" className="glow-green font-display tracking-wider" onClick={authOrDashboard}>
            {isAuthed ? "Open dashboard" : "Create account"}{" "}
            <ArrowRight className="ml-2 inline h-4 w-4 align-text-bottom" />
          </Button>
          <Button asChild variant="outline" className="border-arena-cyan/35 font-display tracking-wider">
            <Link to="/how-to-play">How to Play</Link>
          </Button>
          <Button asChild variant="ghost" className="font-display text-muted-foreground hover:text-foreground">
            <Link to={{ pathname: "/", hash: "#download" }}>Download client</Link>
          </Button>
        </div>
      </main>

      <LandingGuestFooter />
    </div>
  );
}
