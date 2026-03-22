import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const WINS = 94;
const LOSSES = 53;
const TOTAL = WINS + LOSSES;
const WIN_PCT = Math.round((WINS / TOTAL) * 100);
const LOSS_PCT = 100 - WIN_PCT;

export function WinLossChart() {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-lg tracking-widest uppercase text-muted-foreground">
          Win / Loss
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-1">

        {/* WINS row */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="font-display text-xs tracking-[0.2em] uppercase text-muted-foreground">
              Wins
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-foreground leading-none">
                {WINS}
              </span>
              <span className="font-display text-sm text-muted-foreground">
                {WIN_PCT}%
              </span>
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full animate-fill-wins"
              style={{
                background: "linear-gradient(90deg, hsl(355 78% 38%) 0%, hsl(355 78% 58%) 100%)",
                boxShadow: "0 0 10px hsl(355 78% 52% / 0.5)",
              }}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="font-display text-[10px] tracking-[0.3em] text-muted-foreground/50 uppercase">
            {TOTAL} matches
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* LOSSES row */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="font-display text-xs tracking-[0.2em] uppercase text-muted-foreground">
              Losses
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-foreground leading-none">
                {LOSSES}
              </span>
              <span className="font-display text-sm text-muted-foreground">
                {LOSS_PCT}%
              </span>
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full animate-fill-losses"
              style={{
                background: "linear-gradient(90deg, hsl(0 0% 22%) 0%, hsl(0 0% 38%) 100%)",
              }}
            />
          </div>
        </div>

        {/* Win rate badge */}
        <div className="flex justify-center pt-1">
          <div
            className="px-4 py-1.5 rounded-full border text-xs font-display tracking-[0.2em] uppercase"
            style={{
              borderColor: "hsl(355 78% 52% / 0.25)",
              background: "hsl(355 78% 52% / 0.06)",
              color: "hsl(355 78% 65%)",
            }}
          >
            {WIN_PCT}% Win Rate
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
