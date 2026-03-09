import { LayoutDashboard, Swords, History, User, ShieldAlert, Wallet, Trophy, Settings2 } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Match Lobby", url: "/lobby", icon: Swords },
  { title: "Match History", url: "/history", icon: History },
  { title: "Profile", url: "/profile", icon: User },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Wallet", url: "/wallet", icon: Wallet },
  { title: "Settings", url: "/settings", icon: Settings2 },
  { title: "Admin", url: "/admin", icon: ShieldAlert },
];

export function ArenaSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="p-4">
          <button onClick={() => navigate("/dashboard")} className="focus:outline-none">
            {!collapsed ? (
              <h1 className="font-display text-2xl font-bold text-primary text-glow-green tracking-wider hover:opacity-80 transition-opacity">
                ARENA
              </h1>
            ) : (
              <span className="font-display text-xl font-bold text-primary hover:opacity-80 transition-opacity">A</span>
            )}
          </button>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground/60 uppercase tracking-widest text-xs">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-secondary"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
