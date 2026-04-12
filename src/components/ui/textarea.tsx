import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-arena-cyan/25 bg-[hsl(220_20%_5%)] px-3 py-2 text-sm text-foreground shadow-[inset_0_3px_14px_rgba(0,0,0,0.82),0_0_0_1px_rgba(0,0,0,0.45)] ring-offset-background placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:border-arena-cyan/55 focus-visible:ring-2 focus-visible:ring-arena-cyan/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
