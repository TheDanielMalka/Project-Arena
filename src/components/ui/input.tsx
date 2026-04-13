import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "arena-hud-field flex h-10 w-full border border-arena-cyan/30 bg-[hsl(220_20%_5%)] px-3 py-2 text-sm text-foreground shadow-[inset_0_3px_14px_rgba(0,0,0,0.82),0_0_0_1px_rgba(0,0,0,0.45)] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/75 focus-visible:outline-none focus-visible:border-arena-cyan/55 focus-visible:ring-2 focus-visible:ring-arena-cyan/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
