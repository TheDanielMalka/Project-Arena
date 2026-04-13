import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="arena-hud-loading-screen relative flex min-h-screen items-center justify-center bg-background">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background:repeating-linear-gradient(0deg,transparent,transparent_2px,hsl(0_0%_0%/0.4)_2px,hsl(0_0%_0%/0.4)_3px)] mix-blend-multiply" aria-hidden />
      <div className="arena-hud-modal-surface relative z-[1] max-w-md px-10 py-12 text-center shadow-2xl">
        <p className="font-hud mb-2 text-[9px] uppercase tracking-[0.45em] text-arena-cyan/55">ERR_ROUTE</p>
        <h1 className="mb-3 font-display text-5xl font-black tracking-widest text-primary">404</h1>
        <p className="mb-6 font-hud text-xs uppercase tracking-[0.2em] text-muted-foreground">Sector not found · bad vector</p>
        <a
          href="/"
          className="arena-hud-btn-clip inline-flex items-center justify-center border border-primary/45 bg-primary/15 px-6 py-2.5 font-hud text-[10px] font-bold uppercase tracking-[0.22em] text-primary transition-[box-shadow,border-color] hover:border-primary/70 hover:shadow-[0_0_20px_-4px_hsl(var(--primary)/0.45)]"
        >
          Return home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
