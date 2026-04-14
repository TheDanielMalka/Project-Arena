import { cn } from "@/lib/utils";
import type { ArenaPageVariant } from "./types";
import { ArenaPageDecor } from "./ArenaPageDecor";

export interface ArenaPageShellProps {
  variant: ArenaPageVariant;
  children: React.ReactNode;
  /** Outer section classes (layout, height). */
  className?: string;
  /** Inner stack spacing — default space-y-6. */
  contentClassName?: string;
}

/**
 * Presentational route shell: tactical frame + per-page HUD decor.
 * Does not wrap event targets — children keep all handlers.
 */
export function ArenaPageShell({ variant, children, className, contentClassName }: ArenaPageShellProps) {
  return (
    <section
      className={cn(
        "arena-page-shell arena-hud-page-shell relative isolate min-w-0 overflow-hidden",
        className,
      )}
      data-arena-page={variant}
    >
      <ArenaPageDecor variant={variant} />
      <div className={cn("relative z-[2]", contentClassName ?? "space-y-6")}>{children}</div>
    </section>
  );
}
