import { useNavigate } from "react-router-dom";
import { Swords } from "lucide-react";

const footerLinks = [
  {
    title: "Platform",
    links: [
      { label: "Dashboard", to: "/dashboard" },
      { label: "Match Lobby", to: "/lobby" },
      { label: "Match History", to: "/history" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Profile", to: "/profile" },
      { label: "Wallet", to: "/wallet" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", to: "#" },
      { label: "Privacy Policy", to: "#" },
      { label: "Responsible Gaming", to: "/responsible-gaming" },
    ],
  },
];

export function Footer() {
  const navigate = useNavigate();

  return (
    <footer className="border-t border-border bg-card/50 mt-auto">
      <div className="px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Swords className="h-5 w-5 text-primary" />
              <span className="font-display text-lg font-bold text-primary text-glow-green tracking-wider">ARENA</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Competitive gaming meets real stakes. Play, compete, and earn.
            </p>
          </div>

          {/* Link Groups */}
          {footerLinks.map((group) => (
            <div key={group.title}>
              <h4 className="font-display text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">
                {group.title}
              </h4>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <button
                      onClick={() => link.to !== "#" && navigate(link.to)}
                      className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border mt-6 pt-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground/50">
            © {new Date().getFullYear()} Arena. All rights reserved.
          </p>
          <p className="text-[10px] text-muted-foreground/50">
            18+ Only • Play Responsibly • Not Financial Advice
          </p>
        </div>
      </div>
    </footer>
  );
}
