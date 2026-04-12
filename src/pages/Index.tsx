import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Swords, Shield, Wallet, Trophy, Zap, Download, Monitor,
  CheckCircle, ArrowRight, Lock, Eye, Cpu, Flame,
} from "lucide-react";
import { LANDING_GAMES } from "@/lib/arenaGamesCatalog";
import { cn } from "@/lib/utils";

/**
 * Hero video: `/landing/hero.mp4` first (bundled stock that evokes tactical FPS — not real CS/VAL),
 * then Mixkit fallbacks, then a Google sample. Override with VITE_LANDING_HERO_VIDEO=/your.mp4
 */
const ORDERED_HERO_VIDEO_SOURCES = [
  "/landing/hero.mp4",
  "https://assets.mixkit.co/videos/41790/41790-720.mp4",
  "https://assets.mixkit.co/videos/42703/42703-720.mp4",
  "https://assets.mixkit.co/videos/download/mixkit-gamer-playing-on-a-desktop-computer-4328-medium.mp4",
  "https://assets.mixkit.co/videos/download/mixkit-man-playing-videogames-on-a-computer-4243-medium.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
] as const;

const HERO_FADE_IN_SEC = 3;
const HERO_FADE_OUT_SEC = 3;
const HERO_VIDEO_PEAK_OPACITY = 0.78;

function StaticHeroBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[#030508]" />
      <div className="absolute inset-0 bg-gradient-to-br from-red-950/40 via-[#05080c] via-40% to-cyan-950/35" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_0%_0%,hsl(var(--primary)/0.18),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_100%_100%,hsl(var(--arena-cyan)/0.12),transparent_50%)]" />
      <div
        className="absolute inset-0 opacity-[0.07] motion-reduce:opacity-0"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--arena-cyan)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--arena-cyan)) 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 40%, black, transparent)",
        }}
      />
    </>
  );
}

function HeroCinematicBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoOpacity, setVideoOpacity] = useState(HERO_VIDEO_PEAK_OPACITY * 0.35);
  const [videoBroken, setVideoBroken] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const envSrc = (import.meta.env.VITE_LANDING_HERO_VIDEO as string | undefined)?.trim();
  const [sourceIndex, setSourceIndex] = useState(0);
  const videoSrc = envSrc || ORDERED_HERO_VIDEO_SOURCES[sourceIndex] || "";

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const applyFadeOpacity = (v: HTMLVideoElement) => {
    const d = v.duration;
    if (!d || !Number.isFinite(d)) return;
    const t = v.currentTime;
    const fi = Math.min(HERO_FADE_IN_SEC, d * 0.12);
    const fo = Math.min(HERO_FADE_OUT_SEC, d * 0.12);
    let op = HERO_VIDEO_PEAK_OPACITY;
    if (t < fi) op = HERO_VIDEO_PEAK_OPACITY * (t / fi);
    else if (t > d - fo) op = HERO_VIDEO_PEAK_OPACITY * Math.max(0, (d - t) / fo);
    setVideoOpacity(op);
  };

  useEffect(() => {
    if (reducedMotion || videoBroken || !videoSrc) return;
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => applyFadeOpacity(v);
    const onMeta = () => applyFadeOpacity(v);
    const onPlaying = () => {
      applyFadeOpacity(v);
      setVideoOpacity((o) => Math.max(o, HERO_VIDEO_PEAK_OPACITY * 0.5));
    };

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("playing", onPlaying);

    void v.play().catch(() => {
      if (!envSrc && sourceIndex + 1 < ORDERED_HERO_VIDEO_SOURCES.length) {
        setSourceIndex((i) => i + 1);
      }
    });

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("playing", onPlaying);
    };
  }, [reducedMotion, videoBroken, videoSrc, envSrc, sourceIndex]);

  const showVideo = !reducedMotion && !videoBroken && !!videoSrc;

  const handleVideoError = () => {
    if (envSrc) {
      setVideoBroken(true);
      return;
    }
    if (sourceIndex + 1 < ORDERED_HERO_VIDEO_SOURCES.length) {
      setSourceIndex((i) => i + 1);
      return;
    }
    setVideoBroken(true);
  };

  return (
    <>
      <StaticHeroBackdrop />
      {showVideo && (
        <video
          key={videoSrc}
          ref={videoRef}
          className="absolute inset-0 z-[1] h-full w-full scale-105 object-cover pointer-events-none"
          style={{ opacity: videoOpacity }}
          src={videoSrc}
          muted
          playsInline
          loop
          autoPlay
          preload="auto"
          onError={handleVideoError}
        />
      )}
      <div className="absolute inset-0 z-[2] bg-gradient-to-r from-black/80 via-black/45 to-black/65 pointer-events-none" />
      <div className="absolute inset-0 z-[2] bg-[radial-gradient(ellipse_100%_80%_at_70%_50%,transparent_0%,rgba(0,0,0,0.5)_100%)] pointer-events-none" />
    </>
  );
}

const FEATURES = [
  { icon: Swords, color: "text-primary", bg: "bg-primary/10 border-primary/25", title: "1v1 & 5v5", desc: "Solo duels or full team battles across all supported titles." },
  { icon: Lock, color: "text-arena-cyan", bg: "bg-arena-cyan/10 border-arena-cyan/25", title: "Smart Escrow", desc: "Funds locked on-chain. No one touches them until the match resolves." },
  { icon: Wallet, color: "text-arena-gold", bg: "bg-arena-gold/10 border-arena-gold/25", title: "Multi-Chain", desc: "Deposit & withdraw on BSC, Solana, and Ethereum — your keys, your funds." },
  { icon: Trophy, color: "text-arena-orange", bg: "bg-orange-500/10 border-orange-500/25", title: "Ranked System", desc: "Climb Bronze → Master. Earn XP, unlock badges, prove your rank." },
  { icon: Eye, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/25", title: "Vision Engine", desc: "AI-powered OCR auto-reads results. No manual reporting, no disputes." },
  { icon: Cpu, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/25", title: "Anti-Cheat Link", desc: "Integrated with VAC, Vanguard, EAC. Cheaters get banned and refunded." },
] as const;

/** Bento order: Vision hero cell + asymmetric grid (same 6 features). */
const BENTO_INDICES = [4, 1, 2, 0, 3, 5] as const;

const STEPS = [
  { n: "01", title: "Sign Up", desc: "Create account, connect your wallet, verify age." },
  { n: "02", title: "Find a Match", desc: "Browse public lobbies or create private with a code." },
  { n: "03", title: "Lock Stakes", desc: "Both players lock funds in escrow on-chain." },
  { n: "04", title: "Play & Win", desc: "Winner takes pot. Funds released instantly." },
] as const;

const CLIENT_FEATURES = [
  "Auto-detects CS2 & Valorant — more games coming soon",
  "OCR-powered result verification — zero manual input",
  "Runs in system tray — completely silent",
  "Lightweight & open source — under 50 MB",
] as const;

function LandingHeroHud() {
  return (
    <div
      className="relative mx-auto aspect-square max-w-[min(100%,420px)] pointer-events-none select-none"
      aria-hidden
    >
      <div
        className="absolute inset-0 rounded-sm opacity-90"
        style={{
          clipPath: "polygon(0 12%, 12% 0, 100% 0, 100% 88%, 88% 100%, 0 100%)",
          boxShadow: "inset 0 0 0 1px hsl(var(--arena-cyan) / 0.35), 0 0 60px -20px hsl(var(--arena-hud-blue) / 0.45)",
          background: "linear-gradient(165deg, hsl(220 25% 8% / 0.92) 0%, hsl(220 30% 4% / 0.85) 100%)",
        }}
      />
      <svg className="absolute inset-[8%] text-arena-cyan/25 motion-safe:animate-[spin_120s_linear_infinite]" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.35" strokeDasharray="3 9" />
        <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="0.25" strokeDasharray="1 5" className="text-primary/20 motion-safe:animate-[spin_80s_linear_infinite_reverse]" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.5em] text-arena-cyan/70">Tactical overlay</p>
        <p className="font-display text-lg font-bold tracking-[0.35em] text-foreground/90 mt-2">LIVE</p>
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-left font-mono text-[10px]">
          <span className="text-muted-foreground/60">ESCROW</span>
          <span className="text-primary tabular-nums">ARMED</span>
          <span className="text-muted-foreground/60">CHAIN</span>
          <span className="text-arena-cyan tabular-nums">MULTI</span>
          <span className="text-muted-foreground/60">OCR</span>
          <span className="text-purple-300/90 tabular-nums">READY</span>
        </div>
      </div>
      <div className="absolute bottom-[10%] left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      <div className="absolute top-4 left-4 h-6 w-6 border-l-2 border-t-2 border-arena-cyan/50" />
      <div className="absolute bottom-4 right-4 h-6 w-6 border-r-2 border-b-2 border-primary/45" />
    </div>
  );
}

function BentoFeatureCard({
  f,
  className,
  large,
}: {
  f: (typeof FEATURES)[number];
  className?: string;
  large?: boolean;
}) {
  const Icon = f.icon;
  return (
    <div
      className={cn(
        "group relative overflow-hidden border border-white/[0.08] bg-gradient-to-br from-card/80 via-[hsl(220_22%_6%/0.7)] to-transparent p-4 md:p-5 transition-shadow duration-300",
        "hover:border-arena-cyan/25 hover:shadow-[0_0_40px_-12px_hsl(var(--arena-cyan)/0.25)]",
        large && "md:p-7",
        className,
      )}
      style={{ clipPath: large ? "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)" : undefined }}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full blur-2xl opacity-40 transition-opacity group-hover:opacity-70",
          f.title.includes("Vision") ? "bg-purple-500/30" : "bg-primary/20",
        )}
      />
      <div className={cn("mb-3 flex items-center gap-3", large && "md:mb-5")}>
        <div className={cn("flex shrink-0 items-center justify-center border", large ? "h-14 w-14 rounded-lg md:h-16 md:w-16" : "h-11 w-11 rounded-md", f.bg)}>
          <Icon className={cn(f.color, large ? "h-7 w-7 md:h-8 md:w-8" : "h-5 w-5")} />
        </div>
        {large && (
          <span className="font-mono text-[9px] uppercase tracking-[0.4em] text-arena-cyan/50">Core system</span>
        )}
      </div>
      <h3 className={cn("font-display font-bold tracking-wide text-foreground", large ? "text-base md:text-lg" : "text-sm")}>{f.title}</h3>
      <p className={cn("mt-2 text-muted-foreground leading-relaxed", large ? "text-sm md:max-w-md" : "text-xs")}>{f.desc}</p>
    </div>
  );
}

const Index = () => {
  const navigate = useNavigate();

  const [v, e, m, o, r, a] = BENTO_INDICES.map((i) => FEATURES[i]);

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(220_24%_3%)] text-foreground overflow-x-hidden">
      {/* NAV — HUD bar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-arena-cyan/15 bg-[hsl(220_22%_4%/0.85)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded border border-primary/35 bg-primary/10">
              <Swords className="h-4 w-4 text-primary" />
            </div>
            <span className="font-display text-base font-bold text-primary tracking-[0.25em]">ARENA</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => navigate("/auth")}
              className="px-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors font-display tracking-wide"
            >
              Login
            </button>
            <Button type="button" size="sm" onClick={() => navigate("/auth")} className="glow-green font-display tracking-wider text-[10px] sm:text-xs px-3 sm:px-4">
              <Swords className="mr-1.5 h-3 w-3 sm:h-3.5 sm:w-3.5" /> Enter Arena
            </Button>
          </div>
        </div>
      </nav>

      {/* HERO — split layout, not centered stack */}
      <section className="relative min-h-[min(100svh,920px)] flex flex-col justify-center pt-16 pb-16 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <HeroCinematicBackdrop />
        </div>
        <div className="absolute top-1/3 right-0 h-[min(80vw,500px)] w-[min(80vw,500px)] -translate-y-1/2 translate-x-1/4 rounded-full bg-primary/[0.06] blur-[120px] pointer-events-none z-[1]" />

        <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-6">
          <div className="space-y-6 text-center lg:col-span-6 lg:text-left">
            <div className="inline-flex items-center gap-2 rounded border border-primary/30 bg-primary/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.35em] text-primary motion-safe:animate-pulse lg:mx-0 mx-auto">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
              Skill · P2P · On-chain
            </div>
            <h1 className="font-display font-black leading-[0.92] tracking-tight">
              <span
                className="block text-[clamp(3rem,11vw,6.5rem)] text-primary"
                style={{ textShadow: "0 0 50px hsl(var(--primary)/0.35), 0 0 100px hsl(var(--arena-cyan)/0.12)" }}
              >
                ARENA
              </span>
              <span className="mt-2 block text-[clamp(0.75rem,2.2vw,1.15rem)] font-normal tracking-[0.45em] text-muted-foreground">
                PLAY FOR STAKES
              </span>
            </h1>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground lg:mx-0 md:text-base">
              Competitive gaming meets real stakes. Head-to-head matches, smart contract escrow, instant payouts.
            </p>
            <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap lg:justify-start">
              <Button type="button" size="lg" onClick={() => navigate("/auth")} className="glow-green font-display px-8 py-6 text-sm tracking-wider">
                <Swords className="mr-2 h-4 w-4" /> Enter Arena
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => document.getElementById("download")?.scrollIntoView({ behavior: "smooth" })}
                className="border-arena-cyan/35 bg-black/30 py-6 font-display text-sm tracking-wider shadow-[inset_0_2px_12px_rgba(0,0,0,0.5)]"
              >
                <Download className="mr-2 h-4 w-4" /> Get Client
              </Button>
            </div>
          </div>

          <div className="flex justify-center lg:col-span-6 lg:justify-end">
            <LandingHeroHud />
          </div>
        </div>
      </section>

      {/* FEATURES — bento, not uniform grid */}
      <section className="relative border-y border-white/[0.06] bg-[hsl(220_22%_4%/0.5)] py-16 sm:py-20">
        <div className="pointer-events-none absolute left-[5%] top-0 h-32 w-px bg-gradient-to-b from-arena-cyan/40 to-transparent" />
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mb-10 max-w-xl lg:mb-14">
            <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-arena-cyan/50">Capabilities</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-wide md:text-4xl">
              Why <span className="text-primary">Arena</span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">Built for players who want proof, not promises.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:gap-4">
            <BentoFeatureCard f={v} large className="md:col-span-7 md:row-span-2" />
            <BentoFeatureCard f={e} className="md:col-span-5 md:col-start-8 md:row-start-1" />
            <BentoFeatureCard f={m} className="md:col-span-5 md:col-start-8 md:row-start-2" />
            <BentoFeatureCard f={o} className="md:col-span-4 md:row-start-3" />
            <BentoFeatureCard f={r} className="md:col-span-4 md:row-start-3" />
            <BentoFeatureCard f={a} className="md:col-span-4 md:row-start-3" />
          </div>
        </div>
      </section>

      {/* GAMES — curved rail */}
      <section className="relative py-14 overflow-hidden">
        <div className="absolute inset-x-0 top-1/2 h-24 -translate-y-1/2 border-y border-dashed border-arena-cyan/10 bg-gradient-to-r from-transparent via-arena-cyan/[0.04] to-transparent" />
        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.55em] text-muted-foreground/45">Supported titles</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:gap-4 [perspective:800px]">
            {LANDING_GAMES.map((g, i) => {
              const rot = i % 2 === 0 ? "-rotate-1" : "rotate-1";
              return (
                <div
                  key={g.name}
                  className={cn(
                    "flex items-center gap-2.5 border px-4 py-2.5 transition-all duration-300 md:px-5",
                    rot,
                    g.comingSoon
                      ? "border-border/25 bg-secondary/10 opacity-45 grayscale"
                      : "border-arena-cyan/20 bg-[hsl(220_22%_8%/0.85)] shadow-[0_0_24px_-8px_hsl(var(--arena-cyan)/0.2)] hover:border-primary/30 hover:shadow-[0_0_32px_-6px_hsl(var(--primary)/0.25)]",
                  )}
                  style={{ clipPath: "polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)" }}
                >
                  <img
                    src={g.logo}
                    alt=""
                    className="h-7 w-7 rounded object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <span className="font-display text-xs tracking-wider text-foreground/90">{g.name}</span>
                  {g.comingSoon && <span className="font-mono text-[8px] text-muted-foreground/50">SOON</span>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — vertical circuit */}
      <section className="border-t border-white/[0.06] py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <h2 className="text-center font-display text-3xl font-bold tracking-wide md:text-4xl">
            How it <span className="text-primary">works</span>
          </h2>
          <div className="relative mt-12 space-y-0 pl-2 sm:pl-4">
            <div className="absolute left-[15px] top-3 bottom-3 w-px bg-gradient-to-b from-primary/50 via-arena-cyan/30 to-primary/50 sm:left-[19px]" />
            {STEPS.map((s) => (
              <div key={s.n} className="relative flex gap-6 pb-10 last:pb-0">
                <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded border border-primary/40 bg-[hsl(220_22%_6%)] font-mono text-xs font-bold text-primary shadow-[0_0_20px_-4px_hsl(var(--primary)/0.4)]">
                  {s.n}
                </div>
                <div className="pt-1">
                  <h3 className="font-display text-base font-semibold tracking-wide">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DOWNLOAD — skewed panel */}
      <section id="download" className="relative border-y border-white/[0.08] py-16 sm:py-20">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-arena-cyan/[0.05]" />
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
          <div
            className="space-y-5 border border-white/[0.08] bg-[hsl(220_22%_5%/0.9)] p-6 sm:p-8 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)]"
            style={{ clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)" }}
          >
            <div className="inline-flex items-center gap-2 rounded border border-primary/25 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.35em] text-primary">
              <Monitor className="h-3 w-3" /> Desktop
            </div>
            <h2 className="font-display text-2xl font-bold tracking-wide sm:text-3xl">
              Arena <span className="text-primary">Client</span>
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Runs silently in the background. Detects your game, reads the result via OCR, and reports it on-chain automatically — no screenshots, no manual input.
            </p>
            <ul className="space-y-2.5">
              {CLIENT_FEATURES.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <div>
              <a href="https://arena-client-dist.s3.us-east-1.amazonaws.com/setup.zip" target="_blank" rel="noopener noreferrer" className="inline-block">
                <Button type="button" size="lg" className="glow-green font-display tracking-wider">
                  <Download className="mr-2 h-4 w-4" /> Arena Client setup
                </Button>
              </a>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground/50">Windows 10+ · v1.0.0 · Open Source</p>
            </div>
          </div>

          <div className="relative flex min-h-[280px] items-center justify-center">
            <div
              className="relative flex w-full max-w-sm flex-col items-center gap-4 border border-arena-cyan/20 bg-black/40 p-8 shadow-[0_0_60px_-20px_hsl(var(--arena-cyan)/0.35)]"
              style={{ clipPath: "polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)" }}
            >
              <div className="landing-scanline pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                <Monitor className="h-8 w-8 text-primary" />
              </div>
              <p className="font-display text-xl font-black tracking-[0.3em] text-primary">ARENA</p>
              <p className="font-mono text-[11px] text-muted-foreground">Desktop Client v1.0.0</p>
              <div className="w-full space-y-2 border-t border-white/10 pt-4">
                {["Scanning games…", "Reading result…", "Reporting on-chain…"].map((t, i) => (
                  <div key={t} className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-1.5 rounded-full", i === 0 ? "bg-primary motion-safe:animate-pulse" : "bg-border")} />
                    <span className={cn("font-mono text-[10px]", i === 0 ? "text-primary" : "text-muted-foreground/35")}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden py-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,hsl(var(--primary)/0.08),transparent_70%)]" />
        <div className="relative z-10 mx-auto max-w-2xl space-y-5 px-6 text-center">
          <Zap className="mx-auto h-6 w-6 text-primary" />
          <h2 className="font-display text-3xl font-black tracking-wide md:text-4xl">
            Ready to <span className="text-primary" style={{ textShadow: "0 0 28px hsl(var(--primary)/0.4)" }}>compete</span>?
          </h2>
          <p className="text-sm text-muted-foreground">Sign up in seconds — compete when you are ready.</p>
          <Button type="button" size="lg" onClick={() => navigate("/auth")} className="glow-green font-display px-10 py-6 text-sm tracking-wider">
            <Swords className="mr-2 h-4 w-4" /> Get Started Free
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="font-mono text-[10px] text-muted-foreground/45">No fees to join · Withdraw anytime · 18+ only</p>
        </div>
      </section>

      {/* SITEMAP — staggered columns */}
      <div className="border-t border-white/[0.06] bg-[hsl(220_22%_4%/0.6)] py-12 px-5 sm:px-8">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 md:grid-cols-4 md:gap-8">
          <div className="col-span-2 flex flex-col gap-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" />
              <span className="font-display text-sm font-bold tracking-[0.2em] text-primary">ARENA</span>
            </div>
            <p className="max-w-[220px] text-xs leading-relaxed text-muted-foreground/65">Compete. Earn. Rise. Skill-based wagering for competitive gamers.</p>
          </div>
          <div className="flex flex-col gap-3 md:mt-6">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground/45">Platform</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/dashboard" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Dashboard</Link>
              <Link to="/lobby" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Match Lobby</Link>
              <Link to="/history" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Match History</Link>
              <Link to="/leaderboard" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Leaderboard</Link>
              <Link to="/hub" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Community Hub</Link>
            </nav>
          </div>
          <div className="flex flex-col gap-3">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground/45">Account</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/profile" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Profile</Link>
              <Link to="/wallet" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Wallet</Link>
              <Link to="/forge" className="flex items-center gap-1.5 text-sm font-medium text-amber-500/85 hover:text-amber-400 transition-colors">
                <Flame className="h-3.5 w-3.5" /> Forge
              </Link>
              <Link to="/settings" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Settings</Link>
            </nav>
          </div>
          <div className="col-span-2 flex flex-col gap-3 md:col-span-1 md:mt-4">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground/45">Legal</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/legal/terms" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Terms of Service</Link>
              <Link to="/legal/privacy" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Privacy Policy</Link>
              <Link to="/legal/responsible-gaming" className="text-sm text-muted-foreground/75 hover:text-foreground transition-colors">Responsible Gaming</Link>
            </nav>
          </div>
        </div>
      </div>

      <footer className="border-t border-border/50 py-5 px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-bold tracking-[0.2em] text-primary">ARENA</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground/55">
            <Link to="/legal/terms" className="hover:text-muted-foreground transition-colors">Terms</Link>
            <span>·</span>
            <Link to="/legal/privacy" className="hover:text-muted-foreground transition-colors">Privacy</Link>
            <span>·</span>
            <Link to="/legal/responsible-gaming" className="hover:text-muted-foreground transition-colors">Responsible Gaming</Link>
          </div>
          <p className="text-center font-mono text-[10px] text-muted-foreground/35">© {new Date().getFullYear()} Arena · 18+</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
