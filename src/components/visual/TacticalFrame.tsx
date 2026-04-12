import { cn } from "@/lib/utils";

/** Optional chamfered HUD wrapper — use around a single card block. */
export function TacticalFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("arena-tactical-frame", className)}>{children}</div>;
}
