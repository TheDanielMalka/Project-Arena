import { cn } from "@/lib/utils";

/* ── Geometric "A" mark ──────────────────────────────────────────────────────
   Chamfered-corner dark panel + neon red A shape + corner HUD ticks.
   Drawn as inline SVG — no external file dependency, renders crisp at any size.
─────────────────────────────────────────────────────────────────────────── */
function ArenaMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <defs>
        <filter id="a-glow-outer" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="a-glow-inner" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.8" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Chamfered dark bg */}
      <polygon points="10,0 54,0 64,10 64,54 54,64 10,64 0,54 0,10" fill="#080d14"/>
      {/* Border rim */}
      <polygon
        points="10,0 54,0 64,10 64,54 54,64 10,64 0,54 0,10"
        fill="none" stroke="#E42535" strokeWidth="1.5" strokeOpacity="0.4"
      />

      {/* A — soft outer bloom */}
      <g filter="url(#a-glow-outer)" opacity="0.45">
        <line x1="16" y1="51" x2="32" y2="13" stroke="#E42535" strokeWidth="7" strokeLinecap="square"/>
        <line x1="32" y1="13" x2="48" y2="51" stroke="#E42535" strokeWidth="7" strokeLinecap="square"/>
        <line x1="22" y1="37" x2="42" y2="37" stroke="#E42535" strokeWidth="6" strokeLinecap="square"/>
      </g>
      {/* A — crisp inner stroke */}
      <g filter="url(#a-glow-inner)">
        <line x1="16" y1="51" x2="32" y2="13" stroke="#E42535" strokeWidth="4.5" strokeLinecap="square"/>
        <line x1="32" y1="13" x2="48" y2="51" stroke="#E42535" strokeWidth="4.5" strokeLinecap="square"/>
        <line x1="22" y1="37" x2="42" y2="37" stroke="#ff7070" strokeWidth="3.5" strokeLinecap="square"/>
      </g>

      {/* Corner HUD ticks */}
      <g stroke="#E42535" strokeWidth="1.5" strokeOpacity="0.7" fill="none">
        <path d="M4,11 L4,4 L11,4"/>
        <path d="M53,4 L60,4 L60,11"/>
        <path d="M4,53 L4,60 L11,60"/>
        <path d="M53,60 L60,60 L60,53"/>
      </g>
    </svg>
  );
}

/* ── Public API ──────────────────────────────────────────────────────────── */

interface ArenaLogoProps {
  /**
   * mark    — icon only (collapsed sidebar, tight spaces)
   * compact — icon + "ARENA" on one line (nav bars, sidebar expanded)
   * full    — icon + "PROJECT" / "ARENA" stacked (footers, landing)
   */
  variant?: "mark" | "compact" | "full";
  markSize?: number;
  className?: string;
}

export function ArenaLogo({ variant = "compact", markSize, className }: ArenaLogoProps) {
  if (variant === "mark") {
    return <ArenaMark size={markSize ?? 28} className={className} />;
  }

  if (variant === "full") {
    return (
      <div className={cn("flex items-center gap-2.5 select-none", className)}>
        <ArenaMark size={markSize ?? 34} />
        <div className="flex flex-col leading-none gap-px">
          <span
            className="font-hud text-[8px] tracking-[0.42em] uppercase"
            style={{ color: "rgba(228,37,53,0.5)" }}
          >
            Project
          </span>
          <span
            className="font-display text-xl font-bold tracking-[0.12em]"
            style={{
              color: "#E42535",
              textShadow: "0 0 16px rgba(228,37,53,0.6), 0 0 36px rgba(228,37,53,0.2)",
            }}
          >
            ARENA
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 select-none", className)}>
      <ArenaMark size={markSize ?? 28} />
      <span
        className="font-display font-bold tracking-[0.18em]"
        style={{
          color: "#E42535",
          textShadow: "0 0 14px rgba(228,37,53,0.55), 0 0 28px rgba(228,37,53,0.2)",
        }}
      >
        ARENA
      </span>
    </div>
  );
}
