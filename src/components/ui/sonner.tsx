import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast arena-hud-toast-surface group-[.toaster]:border-arena-cyan/22 group-[.toaster]:bg-[hsl(220_22%_6%/0.94)] group-[.toaster]:text-foreground group-[.toaster]:shadow-[0_0_40px_-12px_hsl(var(--primary)/0.35)] group-[.toaster]:backdrop-blur-md",
          description: "group-[.toast]:font-hud group-[.toast]:text-[11px] group-[.toast]:uppercase group-[.toast]:tracking-[0.08em] group-[.toast]:text-muted-foreground/85",
          actionButton:
            "group-[.toast]:arena-hud-btn-clip-sm group-[.toast]:rounded-none group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-hud group-[.toast]:text-[10px] group-[.toast]:uppercase group-[.toast]:tracking-[0.14em]",
          cancelButton:
            "group-[.toast]:arena-hud-btn-clip-sm group-[.toast]:rounded-none group-[.toast]:border group-[.toast]:border-arena-cyan/35 group-[.toast]:bg-black/40 group-[.toast]:text-muted-foreground group-[.toast]:font-hud group-[.toast]:text-[10px] group-[.toast]:uppercase",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
