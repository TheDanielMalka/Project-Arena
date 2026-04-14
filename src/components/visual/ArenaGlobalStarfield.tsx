import { cn } from "@/lib/utils";

/** Twinkling star layer — pass `fixed` + `inset-0` via className for full-viewport routes; default fills positioned parent. */
export function ArenaGlobalStarfield({ className }: { className?: string }) {
  return (
    <div className={cn("arena-global-starfield pointer-events-none absolute inset-0 z-0", className)} aria-hidden />
  );
}
