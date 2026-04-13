import { LandingGuestFooter } from "@/components/landing/LandingGuestFooter";
import { LandingPublicNav } from "@/components/landing/LandingPublicNav";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, MessageSquare, MonitorPlay, Users } from "lucide-react";
import { useUserStore } from "@/stores/userStore";

/**
 * Public marketing — play paths & real-world flow ideas (illustrative, not legal rules).
 */
export default function HowToPlay() {
  const navigate = useNavigate();
  const isAuthed = useUserStore((s) => s.isAuthenticated);
  const authOrDashboard = () => navigate(isAuthed ? "/dashboard" : "/auth");

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[hsl(220_24%_3%)] text-foreground">
      <div
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.04] motion-reduce:opacity-[0.015] mix-blend-multiply [background:repeating-linear-gradient(0deg,transparent,transparent_2px,hsl(0_0%_0%/0.42)_2px,hsl(0_0%_0%/0.42)_3px)]"
        aria-hidden
      />
      <LandingPublicNav active="how" />

      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-24 sm:px-8 sm:pt-28">
        <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-arena-cyan/55">Playbook</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-wide md:text-4xl">
          How to <span className="text-primary">play</span> with Arena
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
          Arena sits <strong className="text-foreground/90">on top of how you already queue</strong>. You still use FACEIT,
          CS2, and your normal party flow — Arena is where stakes, rooms, and verified results connect.
        </p>

        <section className="mt-12 space-y-4">
          <h2 className="font-display text-lg font-bold tracking-wide text-foreground">Path A — Lobby first, then FACEIT</h2>
          <div className="rounded-lg border border-white/[0.08] bg-[hsl(220_22%_6%/0.55)] p-4 text-sm leading-relaxed text-muted-foreground">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Both players agree on stakes and open an Arena room (or join the same code).</li>
              <li>Lock escrow in the lobby when the product prompts you.</li>
              <li>Move to FACEIT (or your usual queue) and run the match as you normally would.</li>
              <li>When the map ends, keep the Arena Client running so the result can be read and settled.</li>
            </ol>
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="font-display text-lg font-bold tracking-wide text-foreground">Path B — FACEIT first, then Arena</h2>
          <div className="rounded-lg border border-white/[0.08] bg-[hsl(220_22%_6%/0.55)] p-4 text-sm leading-relaxed text-muted-foreground">
            <ol className="list-decimal space-y-2 pl-5">
              <li>You are already in a party on FACEIT and want to add stakes.</li>
              <li>Open Arena, create/join a room, and align on the same stake terms.</li>
              <li>Start the CS2 match from FACEIT; use a pause or lobby moment if you need to confirm everyone is on the same Arena room (house rules).</li>
              <li>Finish the game — verification still flows through the client + engine.</li>
            </ol>
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-arena-cyan" />
            <h2 className="font-display text-lg font-bold tracking-wide text-foreground">In-game chat — quick agreement</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Before you hit go, it helps to sync in CS2 text chat. Below is a <strong className="text-foreground/90">fiction</strong>{" "}
            example — not a rule, just a rhythm players use.
          </p>
          <div
            className="space-y-2 rounded-lg border border-arena-cyan/20 bg-black/45 p-4 font-mono text-[11px] leading-relaxed sm:text-xs"
            aria-label="Example in-game chat"
          >
            <p>
              <span className="text-arena-cyan/90">nAtsFan_01:</span>{" "}
              <span className="text-foreground/90">ARENA</span>
            </p>
            <p>
              <span className="text-primary/90">duelist9:</span> HOW MUCH
            </p>
            <p>
              <span className="text-arena-cyan/90">nAtsFan_01:</span>{" "}
              <span className="text-foreground/90">10 EACH</span>
            </p>
            <p>
              <span className="text-primary/90">duelist9:</span> ok — i opened room CODE-X7 on Arena, join there then we go
            </p>
            <p className="pt-1 text-muted-foreground/70">…match runs on FACEIT; client watches the end screen…</p>
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold tracking-wide text-foreground">Path C — Scrims & external tools</h2>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Same idea: agree stakes in Discord or voice, lock them in Arena, then play wherever your team already scrims.
            The client is the bridge between <strong className="text-foreground/85">what the game shows</strong> and{" "}
            <strong className="text-foreground/85">what the contract releases</strong>.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-5 w-5 text-arena-gold" />
            <h2 className="font-display text-lg font-bold tracking-wide text-foreground">Client + pause moments</h2>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            If everyone needs ten seconds to confirm the Arena room ID, use a tactical pause or pre-game lobby — whatever
            your group allows. Arena does not replace CS2 or FACEIT; it <strong className="text-foreground/85">anchors the money layer</strong>.
          </p>
        </section>

        <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button type="button" className="glow-green font-display tracking-wider" onClick={authOrDashboard}>
            {isAuthed ? "Open dashboard" : "Sign up"}{" "}
            <ArrowRight className="ml-2 inline h-4 w-4 align-text-bottom" />
          </Button>
          <Button asChild variant="outline" className="border-arena-cyan/35 font-display tracking-wider">
            <Link to="/why-arena">Why Arena</Link>
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
