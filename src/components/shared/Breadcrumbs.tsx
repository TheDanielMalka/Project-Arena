import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  lobby: "Match Lobby",
  history: "Match History",
  profile: "Profile",
  wallet: "Wallet",
  admin: "Admin Panel",
  "privacy-policy": "Privacy Policy",
  "responsible-gaming": "Responsible Gaming",
};

export function Breadcrumbs() {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4">
      <button
        onClick={() => navigate("/dashboard")}
        className="flex items-center gap-1 hover:text-primary transition-colors"
      >
        <Home className="h-3 w-3" />
        <span>Home</span>
      </button>
      {segments.map((segment, i) => (
        <span key={segment} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 opacity-40" />
          {i === segments.length - 1 ? (
            <span className="text-foreground font-medium">{routeLabels[segment] ?? segment}</span>
          ) : (
            <button
              onClick={() => navigate(`/${segments.slice(0, i + 1).join("/")}`)}
              className="hover:text-primary transition-colors"
            >
              {routeLabels[segment] ?? segment}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}
