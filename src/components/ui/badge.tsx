import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-[10px] font-display font-bold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-arena-cyan/40 focus:ring-offset-2 focus:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "border-primary/40 bg-primary/15 text-primary shadow-[0_0_12px_-4px_hsl(var(--primary)/0.4)] hover:bg-primary/25",
        secondary:
          "border-white/12 bg-secondary/80 text-secondary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)] hover:bg-secondary",
        destructive:
          "border-destructive/45 bg-destructive/15 text-destructive-foreground shadow-[0_0_12px_-4px_hsl(var(--destructive)/0.35)] hover:bg-destructive/25",
        outline: "border-arena-cyan/30 bg-[hsl(220_22%_8%/0.5)] text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
