import { useEffect, useRef, useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Swords, Wallet, Trophy, Zap, Download, Monitor,
  CheckCircle, ArrowRight, Lock, Eye, Cpu,
} from "lucide-react";
import { LANDING_GAMES } from "@/lib/arenaGamesCatalog";
import { cn } from "@/lib/utils";
import { LandingArenaWordmark } from "@/components/visual/LandingArenaWordmark";
import { LandingPublicNav } from "@/components/landing/LandingPublicNav";
import { LandingGuestFooter } from "@/components/landing/LandingGuestFooter";
import { useUserStore } from "@/stores/userStore";

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

    void Promise.resolve(v.play()).catch(() => {
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
      <div className="absolute inset-0 z-[2] bg-gradient-to-r from-black/82 via-black/42 to-black/48 pointer-events-none" />
      <div className="absolute inset-0 z-[2] bg-[radial-gradient(ellipse_100%_72%_at_72%_42%,transparent_0%,rgba(0,0,0,0.42)_100%)] pointer-events-none" />
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

/** Hero line under ARENA — cycles with typewriter (display only). */
const HERO_CYCLING_TAGLINES = [
  "PLAY FOR STAKES",
  "PROOF · NOT PROMISES",
  "ESCROW LOCKED ON-CHAIN",
  "VISION-VERIFIED RESULTS",
  "RANKED WAGERING · FAIR PAYOUTS",
  "HEAD-TO-HEAD · REAL STAKES",
] as const;

function HeroCyclingTagline() {
  const [text, setText] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const clearT = () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    if (reducedMotion) {
      clearT();
      setText(HERO_CYCLING_TAGLINES[0]);
      return clearT;
    }

    let stopped = false;
    const schedule = (fn: () => void, ms: number) => {
      clearT();
      timeoutRef.current = setTimeout(() => {
        if (!stopped) fn();
      }, ms);
    };

    const runPhrase = (phraseIndex: number) => {
      if (stopped) return;
      const phrase = HERO_CYCLING_TAGLINES[phraseIndex % HERO_CYCLING_TAGLINES.length];

      const typeStep = (idx: number) => {
        if (stopped) return;
        if (idx <= phrase.length) {
          setText(phrase.slice(0, idx));
          schedule(() => typeStep(idx + 1), idx === 0 ? 320 : 48);
        } else {
          schedule(() => deleteStep(phrase.length), 2300);
        }
      };

      const deleteStep = (len: number) => {
        if (stopped) return;
        if (len > 0) {
          setText(phrase.slice(0, len - 1));
          schedule(() => deleteStep(len - 1), 34);
        } else {
          schedule(() => runPhrase(phraseIndex + 1), 480);
        }
      };

      typeStep(0);
    };

    runPhrase(0);
    return () => {
      stopped = true;
      clearT();
    };
  }, [reducedMotion]);

  return (
    <span
      className="mt-3 block min-h-[1.45em] text-center font-hud text-[clamp(0.68rem,1.85vw,0.92rem)] font-medium uppercase tracking-[0.28em] text-arena-cyan/90 lg:text-left"
      aria-live="polite"
    >
      {text}
      {!reducedMotion && (
        <span className="landing-typewriter-cursor ml-1 inline-block h-[1em] w-[2px] align-[-0.12em] bg-arena-cyan/75" aria-hidden />
      )}
    </span>
  );
}

function LandingHeroHud() {
  const eqHeights = [0.2, 0.36, 0.58, 0.28, 0.72, 0.44, 0.24, 0.52, 0.66, 0.38];
  const clip = "polygon(0 10%, 10% 0, 100% 0, 100% 90%, 90% 100%, 0 100%)" as const;

  return (
    <div
      className="relative mx-auto w-full max-w-[min(100%,480px)] min-h-[min(64vw,400px)] sm:min-h-[380px] lg:max-w-[520px] lg:min-h-[420px] lg:-rotate-[0.6deg] pointer-events-none select-none"
      aria-hidden
    >
      {/* Glass + graded fade into video (right); blur samples the hero backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-xl backdrop-saturate-150"
        style={{
          clipPath: clip,
          WebkitBackdropFilter: "blur(20px) saturate(1.35)",
          boxShadow: `
            0 0 0 1px hsl(var(--arena-cyan) / 0.32),
            0 0 0 2px hsl(var(--primary) / 0.08),
            0 32px 100px -40px hsl(0 0% 0% / 0.55),
            0 0 80px -24px hsl(var(--arena-cyan) / 0.22),
            inset 0 1px 0 hsl(0 0% 100% / 0.06),
            inset 0 0 120px hsl(var(--arena-hud-blue) / 0.05)
          `,
          background: `
            linear-gradient(105deg, hsl(220 28% 7% / 0.9) 0%, hsl(220 26% 9% / 0.55) 42%, hsl(220 22% 14% / 0.22) 72%, hsl(220 20% 18% / 0.06) 100%),
            linear-gradient(155deg, hsl(var(--primary) / 0.1) 0%, transparent 38%),
            linear-gradient(210deg, hsl(var(--arena-cyan) / 0.14) 0%, transparent 52%)
          `,
        }}
      />
      {/* Tint layer: picks up warmth from the video without a flat “sticker” */}
      <div
        className="absolute inset-0 opacity-[0.55] mix-blend-soft-light motion-reduce:opacity-[0.35]"
        style={{
          clipPath: clip,
          background:
            "radial-gradient(ellipse 90% 70% at 85% 45%, hsl(var(--primary) / 0.35), transparent 55%), radial-gradient(ellipse 60% 50% at 20% 80%, hsl(var(--arena-cyan) / 0.25), transparent 50%)",
        }}
      />
      <div
        className="absolute inset-[1px] opacity-[0.04] mix-blend-overlay motion-reduce:opacity-0"
        style={{
          clipPath: clip,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Static range rings (no spin) */}
      <svg className="pointer-events-none absolute inset-[7%] z-[1] text-white/[0.07]" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="0.12" strokeDasharray="1 5" />
        <circle cx="50" cy="50" r="32" fill="none" stroke="hsl(var(--arena-cyan) / 0.12)" strokeWidth="0.1" strokeDasharray="0.5 4" />
      </svg>

      <div className="relative z-[2] flex h-full min-h-[inherit] flex-col px-6 pb-7 pt-9 sm:px-8 sm:pt-11">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-hud text-[9px] uppercase tracking-[0.48em] text-muted-foreground/55 sm:text-[10px]">SYS · READOUT</p>
            <p className="landing-hud-live mt-1 font-hud text-[clamp(1.35rem,4vw,1.85rem)] font-bold uppercase tracking-[0.52em] text-foreground/95">
              LIVE
            </p>
          </div>
          <div className="hidden flex-col items-end gap-0.5 font-hud text-[8px] uppercase tracking-[0.2em] text-muted-foreground/40 sm:flex">
            <span>SIG LOCK</span>
            <span className="text-arena-cyan/55">RTT 11MS</span>
          </div>
        </div>

        <div className="mt-5 flex h-14 items-end justify-center gap-[3px] sm:h-16 sm:gap-1">
          {eqHeights.map((d, i) => (
            <div key={i} className="flex h-full w-1 justify-center sm:w-1.5">
              <div
                className="w-full max-w-[4px] rounded-[1px] bg-gradient-to-t from-primary/15 via-primary/45 to-arena-cyan/70 motion-safe:landing-eq-bar"
                style={{
                  height: `${Math.max(16, Math.round(d * 100))}%`,
                  animationDelay: `${i * 0.09}s`,
                  animationDuration: "1.25s",
                }}
              />
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-2.5 font-hud">
          {[
            { k: "ESCROW", v: "ARMED", vc: "text-primary" },
            { k: "CHAIN", v: "MULTI", vc: "text-arena-cyan" },
            { k: "OCR", v: "READY", vc: "text-purple-300/90" },
          ].map((row) => (
            <div
              key={row.k}
              className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] pb-2 last:border-0"
            >
              <span className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground/45 sm:text-[10px]">{row.k}</span>
              <span className={cn("text-right text-[11px] font-semibold uppercase tracking-[0.22em] sm:text-xs", row.vc)}>
                {row.v}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-auto overflow-hidden border border-white/[0.08] bg-black/25 py-1.5 backdrop-blur-sm">
          <div
            className="landing-hud-ticker flex w-[200%] whitespace-nowrap font-hud text-[8px] uppercase tracking-[0.26em] text-muted-foreground/35 motion-reduce:w-full motion-reduce:animate-none motion-reduce:whitespace-normal motion-reduce:text-center motion-reduce:text-[9px]"
          >
            <span className="px-3">
              MATCH INTEGRITY · ON-CHAIN ATTEST · VISION PIPE HOT · SESSION NOTARIZED · ESCROW ARMED ·
            </span>
            <span className="px-3" aria-hidden>
              MATCH INTEGRITY · ON-CHAIN ATTEST · VISION PIPE HOT · SESSION NOTARIZED · ESCROW ARMED ·
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute left-4 top-4 h-7 w-7 border-l border-t border-arena-cyan/40 sm:left-6 sm:top-6" />
        <div className="pointer-events-none absolute bottom-4 right-4 h-7 w-7 border-r border-b border-primary/35 sm:bottom-6 sm:right-6" />
      </div>
    </div>
  );
}

function BentoFeatureCard({
  f,
  className,
  large,
  stagger = 0,
}: {
  f: (typeof FEATURES)[number];
  className?: string;
  large?: boolean;
  stagger?: number;
}) {
  const Icon = f.icon;
  const clip = large ? "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)" : "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)";
  return (
    <div
      className={cn("group relative overflow-hidden p-[1px] motion-safe:opacity-100", className)}
      style={{
        clipPath: clip,
        ["--landing-stagger" as string]: String(stagger * 0.35),
      }}
    >
      <div
        className="absolute inset-0 opacity-50 motion-safe:landing-hud-conic motion-reduce:opacity-30"
        style={{
          background:
            "conic-gradient(from 210deg, hsl(var(--primary) / 0.5), hsl(var(--arena-cyan) / 0.35), hsl(280 60% 50% / 0.4), hsl(var(--primary) / 0.5))",
          animationDelay: `calc(var(--landing-stagger, 0) * 1s)`,
        }}
      />
      <div
        className={cn(
          "relative h-full overflow-hidden bg-gradient-to-br from-[hsl(220_24%_8%/0.96)] via-[hsl(220_26%_5%/0.94)] to-[hsl(220_22%_4%/0.98)] backdrop-blur-md",
          "shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06),0_24px_48px_-28px_rgb(0_0_0/0.75)]",
          large ? "p-5 md:p-8" : "p-4 md:p-5",
        )}
        style={{ clipPath: clip }}
      >
        <div
          className={cn(
            "landing-bento-glow-orb pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full blur-3xl",
            f.title.includes("Vision") ? "bg-purple-500/25" : "bg-primary/18",
          )}
          style={{ animationDelay: `calc(var(--landing-stagger, 0) * 1s)` }}
        />
        <div className="landing-bento-shimmer pointer-events-none absolute inset-0 opacity-0 motion-safe:opacity-100" />
        {large && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-arena-cyan/35 to-transparent" />
        )}

        <div className={cn("relative mb-4 flex items-center gap-3", large && "md:mb-6")}>
          <div className="relative shrink-0">
            <div
              className={cn(
                "absolute inset-0 rounded-full opacity-70 blur-md motion-safe:animate-pulse motion-reduce:animate-none",
                f.title.includes("Vision") ? "bg-purple-400/35" : "bg-primary/30",
              )}
            />
            <div
              className={cn(
                "relative flex items-center justify-center rounded-full bg-gradient-to-br from-white/[0.08] to-transparent ring-1 ring-white/10 shadow-[0_0_24px_-6px_hsl(var(--primary)/0.35)]",
                large ? "h-14 w-14 md:h-16 md:w-16" : "h-11 w-11 md:h-12 md:w-12",
              )}
            >
              <Icon
                className={cn(
                  f.color,
                  "drop-shadow-[0_0_10px_hsl(var(--primary)/0.25)]",
                  large ? "h-7 w-7 md:h-8 md:w-8" : "h-5 w-5 md:h-6 md:w-6",
                )}
                strokeWidth={1.75}
              />
            </div>
          </div>
          {large && (
            <span className="font-mono text-[9px] uppercase tracking-[0.45em] text-arena-cyan/55">Core system</span>
          )}
        </div>
        <h3 className={cn("relative font-display font-bold tracking-wide text-foreground", large ? "text-lg md:text-xl" : "text-sm md:text-base")}>
          {f.title}
        </h3>
        <p className={cn("relative mt-2 text-muted-foreground leading-relaxed", large ? "text-sm md:max-w-md md:text-[0.95rem]" : "text-xs md:text-sm")}>
          {f.desc}
        </p>
        <div className="pointer-events-none absolute bottom-3 right-3 h-5 w-5 border-r border-b border-white/[0.07]" />
      </div>
    </div>
  );
}

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthed = useUserStore((s) => s.isAuthenticated);

  const [v, e, m, o, r, a] = BENTO_INDICES.map((i) => FEATURES[i]);
  const authOrDashboard = () => navigate(isAuthed ? "/dashboard" : "/auth");

  useEffect(() => {
    if (location.hash !== "#download") return;
    const id = window.setTimeout(() => {
      document.getElementById("download")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => window.clearTimeout(id);
  }, [location.pathname, location.hash]);

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(220_24%_3%)] text-foreground overflow-x-hidden relative">
      <div
        className="pointer-events-none fixed inset-0 z-[5] opacity-[0.045] motion-reduce:opacity-[0.015] mix-blend-multiply [background:repeating-linear-gradient(0deg,transparent,transparent_2px,hsl(0_0%_0%/0.42)_2px,hsl(0_0%_0%/0.42)_3px)]"
        aria-hidden
      />
      <LandingPublicNav active="home" />

      {/* HERO — split layout, not centered stack */}
      <section className="relative min-h-[min(100svh,920px)] flex flex-col justify-center pt-16 pb-16 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <HeroCinematicBackdrop />
        </div>
        <div className="absolute top-1/3 right-0 h-[min(80vw,500px)] w-[min(80vw,500px)] -translate-y-1/2 translate-x-1/4 rounded-full bg-primary/[0.06] blur-[120px] pointer-events-none z-[1]" />

        <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-6">
          <div className="space-y-6 text-center lg:col-span-6 lg:text-left">
            <div
              className="relative inline-flex items-center gap-2.5 border border-primary/30 bg-gradient-to-r from-primary/[0.09] via-black/25 to-arena-cyan/[0.06] px-3.5 py-2 font-hud text-[9px] uppercase tracking-[0.44em] text-primary/95 shadow-[0_0_28px_-8px_hsl(var(--primary)/0.35),inset_0_1px_0_hsl(0_0%_100%/0.05)] lg:mx-0 mx-auto sm:px-4 sm:text-[10px] sm:tracking-[0.4em]"
              style={{ clipPath: "polygon(0 6px, 6px 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)" }}
            >
              <span className="absolute left-2 top-2 h-2 w-2 border-l border-t border-arena-cyan/50 sm:left-2.5 sm:top-2.5" aria-hidden />
              <span className="relative flex h-2 w-2 shrink-0 items-center justify-center rounded-[1px] bg-primary shadow-[0_0_14px_hsl(var(--primary)/0.75)] motion-safe:animate-pulse" aria-hidden>
                <span className="h-1 w-1 rounded-[1px] bg-white/90" />
              </span>
              SKILL · P2P · ON-CHAIN
            </div>
            <h1 className="font-hero font-extrabold leading-[0.88] tracking-[0.04em]">
              <LandingArenaWordmark />
              <HeroCyclingTagline />
            </h1>
            <div className="mx-auto max-w-md space-y-2 lg:mx-0">
              <p className="font-hud text-[8px] uppercase tracking-[0.48em] text-muted-foreground/40 sm:text-[9px]">Mission brief</p>
              <p className="text-sm leading-relaxed text-muted-foreground/95 md:text-base md:leading-relaxed [text-shadow:0_1px_24px_hsl(0_0%_0%/0.35)]">
                Competitive gaming meets real stakes. Head-to-head matches, smart contract escrow, instant payouts.
              </p>
            </div>
            <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap lg:justify-start">
              <Button type="button" size="lg" onClick={authOrDashboard} className="glow-green font-display px-8 py-6 text-sm tracking-wider">
                <Swords className="mr-2 h-4 w-4" /> {isAuthed ? "Go to dashboard" : "Enter Arena"}
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
            <BentoFeatureCard f={v} large stagger={0} className="md:col-span-7 md:row-span-2" />
            <BentoFeatureCard f={e} stagger={1} className="md:col-span-5 md:col-start-8 md:row-start-1" />
            <BentoFeatureCard f={m} stagger={2} className="md:col-span-5 md:col-start-8 md:row-start-2" />
            <BentoFeatureCard f={o} stagger={3} className="md:col-span-4 md:row-start-3" />
            <BentoFeatureCard f={r} stagger={4} className="md:col-span-4 md:row-start-3" />
            <BentoFeatureCard f={a} stagger={5} className="md:col-span-4 md:row-start-3" />
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

      {/* HOW IT WORKS — premium timeline */}
      <section className="relative border-t border-white/[0.06] py-16 sm:py-24 overflow-hidden">
        <div className="pointer-events-none absolute right-0 top-1/4 h-72 w-72 rounded-full bg-primary/[0.04] blur-[100px]" />
        <div className="mx-auto max-w-4xl px-5 sm:px-8">
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.55em] text-arena-cyan/45">Pipeline</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-wide md:text-4xl lg:text-[2.75rem]">
              How it <span className="text-primary" style={{ textShadow: "0 0 28px hsl(var(--primary)/0.25)" }}>works</span>
            </h2>
          </div>
          <div className="relative mt-14 sm:mt-16">
            <div className="absolute left-[19px] top-2 bottom-2 w-[3px] overflow-hidden rounded-full bg-white/[0.04] sm:left-[23px]">
              <div className="landing-timeline-flow absolute inset-0 opacity-90" />
            </div>
            <div className="space-y-6 sm:space-y-8">
              {STEPS.map((s, idx) => (
                <div key={s.n} className="relative flex gap-5 sm:gap-8">
                  <div className="relative z-10 flex shrink-0 flex-col items-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/35 bg-gradient-to-br from-[hsl(220_24%_10%)] to-[hsl(220_28%_5%)] font-mono text-xs font-bold text-primary shadow-[0_0_28px_-6px_hsl(var(--primary)/0.5),inset_0_1px_0_hsl(0_0%_100%/0.06)] sm:h-12 sm:w-12 sm:text-sm">
                      {s.n}
                    </div>
                  </div>
                  <div
                    className="relative flex-1 overflow-hidden rounded-lg border border-white/[0.07] bg-gradient-to-br from-[hsl(220_22%_7%/0.85)] to-[hsl(220_24%_4%/0.92)] py-4 pl-5 pr-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04),0_20px_40px_-28px_rgb(0_0_0/0.65)] backdrop-blur-sm sm:py-5 sm:pl-6"
                  >
                    <div
                      className="landing-bento-shimmer pointer-events-none absolute inset-0 rounded-lg opacity-0 motion-safe:opacity-100"
                      style={{ ["--landing-stagger" as string]: String(idx * 0.55) }}
                    />
                    <h3 className="relative font-display text-lg font-semibold tracking-wide text-foreground sm:text-xl">{s.title}</h3>
                    <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* DOWNLOAD — product-grade split */}
      <section id="download" className="relative border-y border-white/[0.08] py-16 sm:py-24">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.05] via-transparent to-arena-cyan/[0.06]" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-px w-[min(90%,48rem)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
          <div
            className="relative space-y-5 border border-white/[0.1] bg-[hsl(220_22%_5%/0.92)] p-6 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05),0_32px_64px_-32px_rgb(0_0_0/0.75)] backdrop-blur-sm sm:p-8"
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

          <div className="relative flex min-h-[320px] items-center justify-center lg:min-h-[400px]">
            <div
              className="relative w-full max-w-lg overflow-hidden border border-arena-cyan/25 bg-gradient-to-b from-[hsl(220_24%_8%/0.95)] to-[hsl(220_28%_3%/0.98)] shadow-[0_0_80px_-24px_hsl(var(--arena-cyan)/0.45),inset_0_1px_0_hsl(0_0%_100%/0.05)]"
              style={{ clipPath: "polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)" }}
            >
              <div className="landing-scanline pointer-events-none absolute inset-x-0 top-9 z-20 h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent" />
              <div className="flex items-center gap-2 border-b border-white/[0.08] bg-black/35 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/90" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/90" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/90" />
                </div>
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/55">arena-client.exe</span>
                <span className="ml-auto font-mono text-[9px] text-arena-cyan/50">STABLE</span>
              </div>
              <div className="relative flex flex-col items-center gap-5 px-6 pb-8 pt-8 sm:px-10 sm:pb-10 sm:pt-10">
                <div className="absolute inset-0 opacity-[0.035] motion-reduce:opacity-0" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-[0_0_40px_-8px_hsl(var(--primary)/0.45)] sm:h-24 sm:w-24">
                  <Monitor className="h-10 w-10 text-primary sm:h-11 sm:w-11" strokeWidth={1.5} />
                </div>
                <div className="text-center">
                  <p className="font-display text-2xl font-black tracking-[0.38em] text-primary sm:text-3xl">ARENA</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground sm:text-sm">Desktop Client v1.0.0</p>
                </div>
                <div className="w-full space-y-1 rounded-md border border-white/[0.06] bg-black/30 px-4 py-3">
                    <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-primary/80 to-arena-cyan/70 motion-safe:animate-pulse" />
                  </div>
                  {["Scanning games…", "Reading result…", "Reporting on-chain…"].map((t, i) => (
                    <div key={t} className="flex items-center gap-2.5 py-1">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          i === 0 ? "bg-primary landing-client-line-active" : "bg-white/10",
                        )}
                      />
                      <span
                        className={cn(
                          "font-mono text-[11px] tracking-wide sm:text-xs",
                          i === 0 ? "text-primary" : "text-muted-foreground/40",
                        )}
                      >
                        {t}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex w-full justify-between border-t border-white/[0.06] pt-4 font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/40 sm:text-[10px]">
                  <span>Integrity OK</span>
                  <span className="text-arena-cyan/45">Session live</span>
                </div>
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
          <Button type="button" size="lg" onClick={authOrDashboard} className="glow-green font-display px-10 py-6 text-sm tracking-wider">
            <Swords className="mr-2 h-4 w-4" /> {isAuthed ? "Open dashboard" : "Get Started Free"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="font-mono text-[10px] text-muted-foreground/45">No fees to join · Withdraw anytime · 18+ only</p>
        </div>
      </section>

      <LandingGuestFooter />
    </div>
  );
};

export default Index;
