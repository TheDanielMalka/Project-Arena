import { Swords, Shield, Wallet, Trophy, Zap, Users, ArrowRight, CheckCircle, Download, Monitor } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Swords,
    title: "1v1 & 5v5 Matches",
    description: "Solo duels or full team battles. Choose your game, set the stakes, and compete.",
    color: "text-primary",
  },
  {
    icon: Shield,
    title: "Escrow Protection",
    description: "Funds are locked in escrow until the match resolves. Fair play guaranteed.",
    color: "text-arena-cyan",
  },
  {
    icon: Wallet,
    title: "Multi-Chain Wallet",
    description: "Deposit & withdraw on BSC, Solana, and Ethereum. Your funds, your control.",
    color: "text-arena-gold",
  },
  {
    icon: Trophy,
    title: "Ranked Leaderboards",
    description: "Climb the ranks, earn achievements, and prove you're the best.",
    color: "text-arena-orange",
  },
];

const howItWorks = [
  { step: "01", title: "Create Account", description: "Sign up and connect your wallet in seconds." },
  { step: "02", title: "Find a Match", description: "Browse public lobbies or create a private match with a code." },
  { step: "03", title: "Lock Stakes", description: "Both players lock funds in escrow before the match begins." },
  { step: "04", title: "Play & Win", description: "Winner takes the pot. Funds released instantly to your wallet." },
];

const stats = [
  { value: "10K+", label: "Matches Played" },
  { value: "$2.5M", label: "Total Payouts" },
  { value: "5K+", label: "Active Players" },
  { value: "99.8%", label: "Dispute Resolution" },
];

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-4 py-24 md:py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="text-center space-y-6 max-w-3xl relative z-10">
          <h1 className="font-display text-6xl md:text-8xl font-bold tracking-wider text-glow-green">
            <span className="text-primary">ARENA</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground font-display tracking-wide uppercase">
            Play for Stakes
          </p>
          <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Competitive gaming meets real stakes. Connect your wallet, join matches, and prove your skills against the best players.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="glow-green font-display text-lg px-8 py-6 tracking-wider"
            >
              <Swords className="mr-2 h-5 w-5" />
              Enter Arena
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="font-display text-lg px-8 py-6 tracking-wider border-border hover:border-primary/50"
            >
              Learn More
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Social Proof Stats */}
      <section className="border-y border-border bg-card/50 py-10">
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-display text-3xl md:text-4xl font-bold text-primary">{s.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide">
              Why <span className="text-primary">Arena</span>?
            </h2>
            <p className="text-muted-foreground mt-3 max-w-md mx-auto">
              Everything you need for competitive stakes gaming in one platform.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {features.map((f) => (
              <Card key={f.title} className="bg-card border-border hover:border-primary/20 transition-colors">
                <CardContent className="p-6 flex items-start gap-4">
                  <div className={`p-3 rounded-lg bg-secondary/50 ${f.color}`}>
                    <f.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-semibold mb-1">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 bg-card/30 border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide">
              How It <span className="text-primary">Works</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {howItWorks.map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4">
                  <span className="font-display text-lg font-bold text-primary">{item.step}</span>
                </div>
                <h3 className="font-display font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Games */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide mb-3">
            Supported <span className="text-primary">Games</span>
          </h2>
          <p className="text-muted-foreground mb-10">Compete in the most popular competitive titles.</p>
          <div className="flex flex-wrap justify-center gap-4">
            {["CS2", "Valorant", "Fortnite", "Apex Legends", "COD", "PUBG", "League of Legends"].map((game) => (
              <div
                key={game}
                className="px-6 py-3 rounded-lg border border-border bg-secondary/30 hover:border-primary/30 transition-colors font-display text-sm tracking-wider"
              >
                {game}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Download Client */}
      <section className="py-20 px-4 bg-card/30 border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-10">
            <div className="flex-1 space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-display tracking-wider uppercase">
                <Monitor className="h-3.5 w-3.5" />
                Desktop App
              </div>
              <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide">
                Download <span className="text-primary">Arena Client</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                The Arena Desktop Client runs silently in the background, automatically detecting your matches, capturing results via OCR, and reporting them instantly — no manual input needed.
              </p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {[
                  "Auto-detects CS2, Valorant, Fortnite & more",
                  "OCR-powered result verification",
                  "Runs in system tray — zero interruptions",
                  "Lightweight & secure — under 50 MB",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  size="lg"
                  className="glow-green font-display text-lg px-8 py-6 tracking-wider"
                  onClick={() => {
                    // TODO: Replace with your actual GitHub releases URL after running: cd client && python build.py
                    // Then upload ArenaClient.exe to GitHub Releases
                    // Example: https://github.com/YOUR-USERNAME/YOUR-REPO/releases/latest/download/ArenaClient.exe
                    alert("Coming soon! Build the client with: cd client && python build.py, then upload to GitHub Releases.");
                  }}
                >
                  <Download className="mr-2 h-5 w-5" />
                  Download for Windows
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/50">
                Windows 10+ required • v1.0.0 • Open source
              </p>
            </div>
            <div className="flex-shrink-0 w-64 h-64 rounded-2xl bg-secondary/30 border border-border flex flex-col items-center justify-center gap-3">
              <div className="w-20 h-20 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Monitor className="h-10 w-10 text-primary" />
              </div>
              <span className="font-display text-lg font-bold text-primary tracking-wider">ARENA</span>
              <span className="text-xs text-muted-foreground">Desktop Client v1.0.0</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 bg-gradient-to-b from-transparent via-primary/5 to-transparent">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <Zap className="h-10 w-10 text-primary mx-auto" />
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide">
            Ready to <span className="text-primary">Compete</span>?
          </h2>
          <p className="text-muted-foreground">
            Join thousands of players already earning on Arena. Sign up takes 30 seconds.
          </p>
          <Button
            size="lg"
            onClick={() => navigate("/auth")}
            className="glow-green font-display text-lg px-10 py-6 tracking-wider"
          >
            <Swords className="mr-2 h-5 w-5" />
            Get Started Free
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-bold text-primary tracking-wider">ARENA</span>
          </div>
          <p className="text-[10px] text-muted-foreground/50">
            © {new Date().getFullYear()} Arena. All rights reserved. 18+ Only • Play Responsibly
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
