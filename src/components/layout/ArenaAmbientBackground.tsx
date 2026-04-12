/**
 * Full-viewport decorative layer — no pointer events, no data fetching.
 * Sits behind authenticated shell content for a cohesive “arena / HUD” feel.
 */
export function ArenaAmbientBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      {/* Soft vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, hsl(var(--primary) / 0.12), transparent 55%), radial-gradient(ellipse 90% 60% at 100% 50%, hsl(var(--arena-cyan) / 0.06), transparent 50%), radial-gradient(ellipse 70% 50% at 0% 80%, hsl(var(--primary) / 0.05), transparent 45%)",
        }}
      />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />
      {/* Slow drift orbs */}
      <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-arena-cyan/10 blur-[100px] animate-pulse" />
      <div
        className="absolute -right-24 bottom-1/4 h-80 w-80 rounded-full bg-primary/15 blur-[90px] opacity-70"
        style={{ animation: "arena-float 18s ease-in-out infinite" }}
      />
    </div>
  );
}
