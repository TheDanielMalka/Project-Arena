import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Swords, Shield, Wallet, Trophy, Zap, Download, Monitor,
  CheckCircle, ArrowRight, Lock, Eye, Cpu, ChevronRight, Flame,
} from "lucide-react";

// ── Game logos (same CDN as rest of app) ──────────────────────────────────────
const GAMES = [
  { name: "CS2",              logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg" },
  { name: "Valorant",         logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg" },
  { name: "Fortnite",         logo: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120" },
  { name: "Apex Legends",     logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/capsule_sm_120.jpg" },
  { name: "COD",              logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/1938090/capsule_sm_120.jpg" },
  { name: "PUBG",             logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/578080/capsule_sm_120.jpg" },
  { name: "League of Legends",logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/2801460/capsule_sm_120.jpg" },
];

const STATS = [
  { value: "10K+",  label: "Matches" },
  { value: "$2.5M", label: "Paid Out" },
  { value: "5K+",   label: "Players" },
  { value: "99.8%", label: "Resolved" },
];

const FEATURES = [
  { icon: Swords,  color: "text-primary",      bg: "bg-primary/10 border-primary/20",      title: "1v1 & 5v5",        desc: "Solo duels or full team battles across all supported titles." },
  { icon: Lock,    color: "text-arena-cyan",    bg: "bg-arena-cyan/10 border-arena-cyan/20", title: "Smart Escrow",     desc: "Funds locked on-chain. No one touches them until the match resolves." },
  { icon: Wallet,  color: "text-arena-gold",    bg: "bg-arena-gold/10 border-arena-gold/20", title: "Multi-Chain",      desc: "Deposit & withdraw on BSC, Solana, and Ethereum — your keys, your funds." },
  { icon: Trophy,  color: "text-arena-orange",  bg: "bg-orange-500/10 border-orange-500/20", title: "Ranked System",    desc: "Climb Bronze → Master. Earn XP, unlock badges, prove your rank." },
  { icon: Eye,     color: "text-purple-400",    bg: "bg-purple-500/10 border-purple-500/20", title: "Vision Engine",    desc: "AI-powered OCR auto-reads results. No manual reporting, no disputes." },
  { icon: Cpu,     color: "text-rose-400",      bg: "bg-rose-500/10 border-rose-500/20",     title: "Anti-Cheat Link",  desc: "Integrated with VAC, Vanguard, EAC. Cheaters get banned and refunded." },
];

const STEPS = [
  { n: "01", title: "Sign Up",       desc: "Create account, connect your wallet, verify age." },
  { n: "02", title: "Find a Match",  desc: "Browse public lobbies or create private with a code." },
  { n: "03", title: "Lock Stakes",   desc: "Both players lock funds in escrow on-chain." },
  { n: "04", title: "Play & Win",    desc: "Winner takes pot. Funds released instantly." },
];

const CLIENT_FEATURES = [
  "Auto-detects CS2, Valorant, Fortnite & more",
  "OCR-powered result verification — zero manual input",
  "Runs in system tray — completely silent",
  "Lightweight & open source — under 50 MB",
];

// ── Component ─────────────────────────────────────────────────────────────────
const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-x-hidden">

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            <span className="font-display text-lg font-bold text-primary tracking-widest">ARENA</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/auth")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors font-display"
            >
              Login
            </button>
            <Button
              size="sm"
              onClick={() => navigate("/auth")}
              className="glow-green font-display tracking-wider text-xs px-4"
            >
              <Swords className="mr-1.5 h-3.5 w-3.5" /> Enter Arena
            </Button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center px-6 pt-24 pb-14 overflow-hidden">
        {/* Grid background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgba(0,255,136,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />

        <div className="relative z-10 text-center space-y-4 max-w-4xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-display tracking-widest uppercase animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Skill-Based · P2P · On-Chain Escrow
          </div>

          {/* Title */}
          <h1 className="font-display font-black tracking-widest leading-none">
            <span
              className="block text-[clamp(4rem,12vw,8rem)] text-primary"
              style={{ textShadow: "0 0 60px rgba(0,255,136,0.4), 0 0 120px rgba(0,255,136,0.15)" }}
            >
              ARENA
            </span>
            <span className="block text-[clamp(0.85rem,2.5vw,1.5rem)] text-muted-foreground mt-1 font-normal tracking-[0.3em] uppercase">
              Play for Stakes
            </span>
          </h1>

          <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed text-sm md:text-base">
            Competitive gaming meets real stakes. Head-to-head matches, smart contract escrow, instant payouts.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="glow-green font-display text-sm px-7 py-5 tracking-wider w-full sm:w-auto"
            >
              <Swords className="mr-2 h-4 w-4" /> Enter Arena
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => document.getElementById("download")?.scrollIntoView({ behavior: "smooth" })}
              className="font-display text-sm px-7 py-5 tracking-wider border-border hover:border-primary/40 w-full sm:w-auto"
            >
              <Download className="mr-2 h-4 w-4" /> Get Client
            </Button>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ────────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-card/40 backdrop-blur-sm py-5">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-display text-2xl md:text-3xl font-black text-primary tracking-wider"
                style={{ textShadow: "0 0 20px rgba(0,255,136,0.3)" }}>
                {s.value}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono uppercase tracking-widest">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="py-14 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-wide">
              Why <span className="text-primary">Arena</span>?
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Built for competitive players who take their game seriously.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group relative p-5 rounded-xl border border-border bg-card/60 hover:border-primary/20 hover:bg-card transition-all duration-200"
              >
                <div className={`w-10 h-10 rounded-lg border flex items-center justify-center mb-4 ${f.bg}`}>
                  <f.icon className={`h-5 w-5 ${f.color}`} />
                </div>
                <h3 className="font-display font-semibold text-sm mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SUPPORTED GAMES ──────────────────────────────────────────────── */}
      <section className="py-8 px-6 border-y border-border bg-card/20">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-xs font-mono text-muted-foreground/50 uppercase tracking-widest mb-5">
            Supported Titles
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {GAMES.map((g) => (
              <div
                key={g.name}
                className="flex items-center gap-2.5 px-4 py-2 rounded-lg border border-border bg-secondary/30 hover:border-primary/20 hover:bg-secondary/50 transition-all"
              >
                <img
                  src={g.logo}
                  alt={g.name}
                  className="w-6 h-6 rounded object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <span className="font-display text-xs tracking-wider text-muted-foreground">{g.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="py-14 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-wide">
              How It <span className="text-primary">Works</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-4 gap-6 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-7 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative text-center flex flex-col items-center">
                <div className="w-14 h-14 rounded-full border border-primary/30 bg-primary/5 flex items-center justify-center mb-4 relative z-10">
                  <span className="font-mono text-base font-bold text-primary">{s.n}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="hidden md:block absolute top-4 -right-3 h-4 w-4 text-primary/20 z-20" />
                )}
                <h3 className="font-display font-semibold text-sm mb-1">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DOWNLOAD CLIENT ──────────────────────────────────────────────── */}
      <section id="download" className="py-14 px-6 border-y border-border bg-card/30">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-display tracking-widest uppercase">
                <Monitor className="h-3.5 w-3.5" /> Desktop App
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-bold tracking-wide">
                Arena <span className="text-primary">Client</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Runs silently in the background. Detects your game, reads the result via OCR, and reports it on-chain automatically — no screenshots, no manual input.
              </p>
              <ul className="space-y-2">
                {CLIENT_FEATURES.map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="space-y-2">
                <Button
                  size="lg"
                  className="glow-green font-display tracking-wider"
                  onClick={() => alert("Coming soon! Build with: cd client && python build.py")}
                >
                  <Download className="mr-2 h-4 w-4" /> Download for Windows
                </Button>
                <p className="text-[11px] text-muted-foreground/40 font-mono">
                  Windows 10+ · v1.0.0 · Open Source
                </p>
              </div>
            </div>

            {/* Visual box */}
            <div className="relative flex items-center justify-center">
              <div className="w-64 h-64 rounded-2xl border border-primary/10 bg-card flex flex-col items-center justify-center gap-3 relative overflow-hidden">
                {/* Scan line animation */}
                <div
                  className="absolute inset-x-0 h-px bg-primary/20"
                  style={{ animation: "scanline 3s linear infinite", top: 0 }}
                />
                <div className="w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Monitor className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-display text-xl font-black text-primary tracking-widest">ARENA</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">Desktop Client v1.0.0</p>
                </div>
                <div className="flex flex-col gap-1.5 w-48">
                  {["Scanning games...", "Reading result...", "Reporting on-chain..."].map((t, i) => (
                    <div key={t} className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${i === 0 ? "bg-primary animate-pulse" : "bg-border"}`} />
                      <span className={`text-[10px] font-mono ${i === 0 ? "text-primary" : "text-muted-foreground/30"}`}>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Corner glows */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="py-16 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-2xl mx-auto text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <h2 className="font-display text-2xl md:text-4xl font-black tracking-wide">
            Ready to <span className="text-primary" style={{ textShadow: "0 0 30px rgba(0,255,136,0.4)" }}>Compete</span>?
          </h2>
          <p className="text-muted-foreground text-sm">
            Join thousands of players earning on Arena. Sign up in 30 seconds.
          </p>
          <Button
            size="lg"
            onClick={() => navigate("/auth")}
            className="glow-green font-display text-sm px-8 py-5 tracking-wider"
          >
            <Swords className="mr-2 h-4 w-4" /> Get Started Free
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="text-[11px] text-muted-foreground/40 font-mono">
            No fees to join · Withdraw anytime · 18+ only
          </p>
        </div>
      </section>

      {/* ── SITE MAP ─────────────────────────────────────────────────────── */}
      <div className="border-t border-border/40 bg-card/20 py-10 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" />
              <span className="font-display text-base font-bold text-primary tracking-widest">ARENA</span>
            </div>
            <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-[200px]">
              Compete. Earn. Rise. The premier skill-based wagering platform for competitive gamers.
            </p>
          </div>

          {/* PLATFORM */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Platform</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/dashboard" className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Dashboard</Link>
              <Link to="/lobby"     className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Match Lobby</Link>
              <Link to="/history"   className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Match History</Link>
              <Link to="/leaderboard" className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Leaderboard</Link>
              <Link to="/hub"       className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Community Hub</Link>
            </nav>
          </div>

          {/* ACCOUNT */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Account</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/profile"  className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Profile</Link>
              <Link to="/wallet"   className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Wallet</Link>
              <Link to="/forge"    className="flex items-center gap-1.5 text-sm text-amber-500/80 hover:text-amber-400 transition-colors font-medium">
                <Flame className="w-3.5 h-3.5" />Forge
              </Link>
              <Link to="/settings" className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Settings</Link>
            </nav>
          </div>

          {/* LEGAL */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Legal</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/legal/terms"              className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Terms of Service</Link>
              <Link to="/legal/privacy"            className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Privacy Policy</Link>
              <Link to="/legal/responsible-gaming" className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">Responsible Gaming</Link>
            </nav>
          </div>
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-5 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-bold text-primary tracking-widest">ARENA</span>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground/50">
            <Link to="/legal/terms" className="hover:text-muted-foreground transition-colors">
              Terms of Service
            </Link>
            <span>·</span>
            <Link to="/legal/privacy" className="hover:text-muted-foreground transition-colors">
              Privacy Policy
            </Link>
            <span>·</span>
            <Link to="/legal/responsible-gaming" className="hover:text-muted-foreground transition-colors">
              Responsible Gaming
            </Link>
          </div>

          <p className="text-[10px] text-muted-foreground/30 font-mono text-center">
            © {new Date().getFullYear()} Arena · 18+ Only · Play Responsibly
          </p>
        </div>
      </footer>

    </div>
  );
};

export default Index;
