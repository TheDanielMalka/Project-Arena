import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUserStore } from "@/stores/userStore";

export function WinLossChart() {
  const user = useUserStore((s) => s.user);
  const wins = user?.stats.wins ?? 0;
  const losses = user?.stats.losses ?? 0;
  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const lossPct = total > 0 ? 100 - winPct : 0;
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-1 pt-3 px-3">
        <CardTitle className="font-display text-xs tracking-widest uppercase text-muted-foreground">
          Win / Loss
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0 px-3 pb-3">

        <div className="space-y-1">
          <div className="flex justify-between items-baseline gap-2">
            <span className="font-display text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
              Wins
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-xl font-bold text-foreground leading-none">
                {wins}
              </span>
              <span className="font-display text-xs text-muted-foreground">
                {winPct}%
              </span>
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full animate-fill-wins"
              style={{
                width: `${winPct}%`,
                background: "linear-gradient(90deg, hsl(355 78% 38%) 0%, hsl(355 78% 58%) 100%)",
                boxShadow: "0 0 8px hsl(355 78% 52% / 0.45)",
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-border" />
          <span className="font-display text-[9px] tracking-[0.2em] text-muted-foreground/50 uppercase">
            {total} matches
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between items-baseline gap-2">
            <span className="font-display text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
              Losses
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-xl font-bold text-foreground leading-none">
                {losses}
              </span>
              <span className="font-display text-xs text-muted-foreground">
                {lossPct}%
              </span>
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full animate-fill-losses"
              style={{
                width: `${lossPct}%`,
                background: "linear-gradient(90deg, hsl(0 0% 22%) 0%, hsl(0 0% 38%) 100%)",
              }}
            />
          </div>
        </div>

        <div className="flex justify-center pt-0.5">
          <div
            className="px-3 py-1 rounded-full border text-[10px] font-display tracking-[0.15em] uppercase"
            style={{
              borderColor: "hsl(355 78% 52% / 0.25)",
              background: "hsl(355 78% 52% / 0.06)",
              color: "hsl(355 78% 65%)",
            }}
          >
            {winPct}% Win Rate
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
