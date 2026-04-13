import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "arena-hud-btn-clip inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium font-hud tracking-[0.14em] uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 transition-all duration-200",
  {
    variants: {
      variant: {
        default:
          "border border-primary/50 bg-gradient-to-b from-[hsl(220_16%_14%)] to-[hsl(220_20%_7%)] text-primary-foreground shadow-[0_0_24px_-6px_hsl(var(--primary)/0.55),0_0_0_1px_hsl(var(--primary)/0.15)_inset,inset_0_1px_0_hsl(0_0%_100%/0.08)] hover:border-primary/75 hover:shadow-[0_0_32px_-4px_hsl(var(--primary)/0.6),0_0_40px_-12px_hsl(var(--arena-hud-magenta)/0.25)] active:scale-[0.99]",
        destructive:
          "border border-destructive/55 bg-gradient-to-b from-[hsl(0_30%_12%)] to-[hsl(0_35%_7%)] text-destructive-foreground shadow-[0_0_22px_-6px_hsl(var(--destructive)/0.5),inset_0_1px_0_hsl(0_0%_100%/0.06)] hover:border-destructive/80 hover:shadow-[0_0_30px_-4px_hsl(var(--destructive)/0.55)] active:scale-[0.99]",
        outline:
          "border border-arena-cyan/35 bg-[hsl(220_22%_6%/0.85)] text-foreground shadow-[inset_0_2px_14px_rgba(0,0,0,0.65),0_0_0_1px_hsl(var(--arena-cyan)/0.08)] hover:border-arena-cyan/55 hover:bg-[hsl(220_22%_9%/0.9)] hover:shadow-[0_0_20px_-8px_hsl(var(--arena-cyan)/0.35),inset_0_2px_14px_rgba(0,0,0,0.55)]",
        secondary:
          "border border-white/10 bg-secondary/90 text-secondary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)] hover:border-white/18 hover:bg-secondary",
        ghost: "border border-transparent hover:border-white/10 hover:bg-white/[0.04] hover:text-foreground",
        link: "[clip-path:none] rounded-none normal-case tracking-normal text-primary underline-offset-4 hover:underline shadow-none border-0 bg-transparent hover:bg-transparent hover:shadow-none",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "arena-hud-btn-clip-sm h-9 px-3 text-xs",
        lg: "h-11 px-8 text-sm",
        icon: "arena-hud-btn-clip-sm h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
