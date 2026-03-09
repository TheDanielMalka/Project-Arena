import { Card } from "@/components/ui/card";
import { Megaphone } from "lucide-react";

interface AdBannerProps {
  placement: string;
  className?: string;
}

export function AdBanner({ placement, className = "" }: AdBannerProps) {
  return (
    <Card className={`bg-secondary/30 border-border border-dashed overflow-hidden ${className}`}>
      <div className="flex items-center justify-center gap-2 py-3 px-4 text-muted-foreground/40">
        <Megaphone className="h-4 w-4" />
        <span className="text-xs font-display uppercase tracking-widest">
          Ad Space — {placement}
        </span>
      </div>
    </Card>
  );
}
