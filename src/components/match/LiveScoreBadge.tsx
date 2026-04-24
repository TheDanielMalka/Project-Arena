/**
 * LiveScoreBadge — displays the live CS2 HUD round score.
 *
 * Shows "CT 4 – T 2" in the futuristic geometry style used across the
 * dashboard. CT is rendered in sky-blue, T in orange, matching the
 * CS2 in-game HUD convention.
 */

interface LiveScoreBadgeProps {
  ct: number;
  t: number;
  className?: string;
}

export function LiveScoreBadge({ ct, t, className = "" }: LiveScoreBadgeProps) {
  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-arena-cyan/30 bg-arena-cyan/5 font-mono text-xs font-bold tracking-tight ${className}`}
      title={`Live score — CT: ${ct}, T: ${t}`}
    >
      <span className="text-sky-400">CT</span>
      <span className="text-foreground/90 tabular-nums">{ct}</span>
      <span className="text-muted-foreground mx-0.5">–</span>
      <span className="text-foreground/90 tabular-nums">{t}</span>
      <span className="text-orange-400">T</span>
    </div>
  );
}
