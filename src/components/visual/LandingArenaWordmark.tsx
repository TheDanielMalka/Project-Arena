import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Landing-only hero wordmark. Display chrome only (no API / game coupling).
 */
export function LandingArenaWordmark() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 980);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const hash = useMemo(() => ((tick * 1_103_515_245 + 12_345) >>> 0).toString(16).toUpperCase().slice(0, 6), [tick]);

  const letterClass =
    "font-hero font-black uppercase leading-[0.82] tracking-[0.08em] text-[clamp(3.15rem,11.2vw,7.35rem)]";

  return (
    <div
      className={cn(
        "landing-arena-wordmark-root relative mx-auto max-w-[min(100%,620px)] lg:mx-0",
        reducedMotion && "landing-arena-motion-off",
      )}
    >
      {/* Soft rim glow — no “plate”; stays behind copy */}
      <div
        className="pointer-events-none absolute -inset-6 -z-10 opacity-[0.42] motion-reduce:opacity-25 sm:-inset-8 sm:opacity-[0.38]"
        aria-hidden
      >
        <div className="landing-arena-wordmark-orbit absolute inset-0" />
        <div className="landing-arena-wordmark-orbit-inner absolute inset-[4px] opacity-50 motion-reduce:animate-none" />
      </div>

      <div className="pointer-events-none absolute -left-1 -top-2 h-10 w-10 sm:h-11 sm:w-11" aria-hidden>
        <span className="absolute left-0 top-0 h-full w-px bg-gradient-to-b from-arena-cyan via-arena-cyan/40 to-transparent landing-arena-bracket-v" />
        <span className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-arena-cyan via-arena-cyan/50 to-transparent landing-arena-bracket-h" />
      </div>
      <div className="pointer-events-none absolute -bottom-1 -right-1 h-9 w-16 sm:right-0" aria-hidden>
        <span className="absolute bottom-0 right-0 h-full w-px bg-gradient-to-t from-primary via-primary/45 to-transparent landing-arena-bracket-v" style={{ animationDelay: "0.15s" }} />
        <span className="absolute bottom-0 right-0 h-px w-full bg-gradient-to-l from-primary via-primary/50 to-transparent landing-arena-bracket-h" style={{ animationDelay: "0.15s" }} />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-hud text-[7px] uppercase tracking-[0.52em] text-muted-foreground/45 sm:mb-2.5 sm:text-[8px] sm:tracking-[0.42em]">
        <span className="flex items-center gap-2">
          <span className="h-px w-10 bg-gradient-to-r from-arena-cyan to-transparent sm:w-12" aria-hidden />
          <span className="whitespace-nowrap">Uplink · Primary</span>
        </span>
        <span className="font-mono text-[8px] tracking-[0.18em] text-arena-cyan/70 sm:text-[9px]">ARENA.HERO</span>
        <span className="hidden items-center gap-1.5 sm:flex" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="landing-arena-sig-bar w-[3px] rounded-[0.5px] bg-arena-cyan/35 motion-reduce:opacity-60"
              style={{ animationDelay: `${i * 0.12}s`, height: `${10 + i * 4}px` }}
            />
          ))}
        </span>
        <span className="ml-auto hidden font-mono text-[8px] tracking-[0.14em] text-muted-foreground/50 md:inline">
          0x{hash}
        </span>
      </div>

      <div className="landing-arena-wordmark-glow-wrap relative">
        <div className="landing-arena-wordmark-stack landing-arena-glitch-target relative bg-transparent px-0 py-0 sm:px-0.5">
        <div className="relative w-min max-w-full">
          {/* Depth plate */}
          <span className={cn(letterClass, "pointer-events-none absolute inset-0 translate-y-[5px] text-black/70 blur-[0.5px]")} aria-hidden>
            ARENA
          </span>
          <span
            className={cn(
              letterClass,
              "pointer-events-none absolute inset-0 text-[hsl(188_70%_48%_/0.14)] mix-blend-screen motion-reduce:opacity-25",
              !reducedMotion && "landing-arena-chroma-c",
            )}
            aria-hidden
          >
            ARENA
          </span>
          <span
            className={cn(
              letterClass,
              "pointer-events-none absolute inset-0 text-[hsl(var(--primary)_/_0.12)] mix-blend-screen motion-reduce:opacity-20",
              !reducedMotion && "landing-arena-chroma-r",
            )}
            aria-hidden
          >
            ARENA
          </span>

          <span className={cn(letterClass, "relative z-[1] block landing-arena-wordmark-gradient")}>ARENA</span>
          {!reducedMotion && (
            <span className="landing-arena-sheen-layer pointer-events-none absolute inset-0 z-[2] overflow-hidden" aria-hidden />
          )}
          <div className="landing-arena-wordmark-scan motion-reduce:hidden" aria-hidden />
          <div className="landing-arena-wordmark-noise motion-reduce:opacity-0" aria-hidden />
          <div className="landing-arena-wordmark-grid motion-reduce:opacity-0" aria-hidden />
        </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 font-hud text-[7px] uppercase tracking-[0.38em] text-muted-foreground/35 sm:text-[8px]">
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5 items-center justify-center">
            <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-primary/40 motion-reduce:opacity-0" />
            <span className="relative h-1 w-1 rounded-[1px] bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.9)]" />
          </span>
          Live composite
        </span>
        <span className="font-mono text-arena-cyan/40">ESCROW</span>
      </div>

      <div
        className="mt-3 flex h-[4px] gap-px overflow-hidden border border-white/[0.06] bg-transparent shadow-[0_0_20px_-6px_hsl(var(--arena-cyan)/0.12)] sm:mt-3.5"
        style={{ clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 100%, 12px 100%, 0 calc(100% - 5px))" }}
        aria-hidden
      >
        <div className="h-full w-[10%] bg-gradient-to-r from-arena-cyan/35 to-transparent" />
        <div className="flex h-full flex-1 gap-px">
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="landing-arena-seg flex-1 bg-gradient-to-t from-transparent via-arena-cyan/25 to-arena-cyan/40 motion-reduce:opacity-80"
              style={{ animationDelay: `${i * 0.07}s` }}
            />
          ))}
        </div>
        <div className="h-full w-[12%] bg-gradient-to-l from-primary/35 to-transparent" />
      </div>
    </div>
  );
}
