import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Clock3, Wallet, Ban, PhoneCall, AlertTriangle } from "lucide-react";

const ResponsibleGaming = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-primary" />
          Responsible Gaming
        </h1>
        <p className="text-muted-foreground mt-1">
          Arena supports safer play standards used by licensed betting and poker operators.
        </p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">Core Principles</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-secondary/30 p-4">
            <p className="font-medium mb-1">Play for entertainment</p>
            <p className="text-sm text-muted-foreground">
              Never treat staking as guaranteed income. Only play with money you can afford to lose.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/30 p-4">
            <p className="font-medium mb-1">Set limits before you start</p>
            <p className="text-sm text-muted-foreground">
              Decide your budget and session duration in advance, then stop when limits are reached.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5 text-arena-gold" />
              Money Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Use deposit, loss, and wagering limits to control spend.</p>
            <p>Track your net position regularly (deposits, withdrawals, wins, losses).</p>
            <p>Do not chase losses with larger stakes.</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-arena-cyan" />
              Time Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Use session timers and reality checks during long play periods.</p>
            <p>Take frequent breaks and avoid playing when tired, stressed, or upset.</p>
            <p>Keep gaming separate from work, sleep, and essential routines.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Cooling-Off and Self-Exclusion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            If you need a break, use short cooling-off periods (for example 24 hours to several weeks) or longer
            self-exclusion (several months or more).
          </p>
          <p>
            For UK users, national services such as GAMSTOP can block access across multiple licensed operators.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-destructive/30">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Warning Signs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>If gaming affects your finances, relationships, or mental health, stop and seek support.</p>
          <p>Common signs include chasing losses, hiding activity, borrowing to play, and loss of control.</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-primary/30">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-primary" />
            Support Resources
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">National Gambling Helpline (UK): 0808 8020 133</Badge>
            <Badge variant="outline">BeGambleAware.org</Badge>
            <Badge variant="outline">GamCare</Badge>
          </div>
          <p>If you feel out of control, contact a support service immediately.</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">Source Standards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This page is aligned with common safer gambling frameworks used by licensed operators and regulators:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>UK Gambling Commission safer gambling guidance</li>
            <li>BetMGM responsible gambling and player protection tools</li>
            <li>PokerStars responsible gaming controls and self-exclusion practices</li>
            <li>GambleAware support and harm-reduction resources</li>
          </ul>
          <p className="pt-2">
            Note: This page is informational and should be reviewed by legal/compliance counsel before production use
            in any licensed jurisdiction.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResponsibleGaming;
