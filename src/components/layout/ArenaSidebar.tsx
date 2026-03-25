import { LayoutDashboard, Swords, History, User, ShieldAlert, Wallet, Trophy, Settings2, Medal, Shield, Gem, Sparkles, Crown, type LucideIcon } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/stores/userStore";
import { getXpInfo } from "@/lib/xp";
import { getBgColor } from "@/lib/avatarBgs";
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

const XP_ICON_MAP: Record<string, LucideIcon> = {
  Medal, Shield, Trophy, Gem, Sparkles, Crown,
};

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
  const user = useUserStore((s) => s.user);
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const visibleItems = user?.role === "admin" ? items : items.filter((item) => item.url !== "/admin");

  const xpInfo = getXpInfo(user?.stats.xp ?? 0);
  const XpIcon = XP_ICON_MAP[xpInfo.iconName] ?? Medal;
  const avatarBgColor = getBgColor(user?.avatarBg);
  const initials = (user?.username ?? "??").slice(0, 2).toUpperCase();

  const renderSidebarAvatar = () => {
    const av = user?.avatar ?? "initials";
    if (av === "initials") return <span className="font-display text-xs font-bold text-white">{initials}</span>;
    if (av.startsWith("upload:")) return <img src={av.slice(7)} className="w-full h-full object-cover rounded-xl" alt="avatar" />;
    return <span className="text-sm">{av}</span>;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="flex flex-col h-full">
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
              {visibleItems.map((item) => (
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

        {/* ── Player avatar + XP card at bottom ── */}
        <div className="mt-auto p-3 border-t border-border/50">
          {collapsed ? (
            /* Collapsed: avatar only */
            <button
              onClick={() => navigate("/profile")}
              className="w-full flex justify-center"
              title={user?.username ?? "Profile"}
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
                style={{ background: `${avatarBgColor}25`, border: `1.5px solid ${avatarBgColor}50` }}>
                {renderSidebarAvatar()}
              </div>
            </button>
          ) : (
            /* Expanded: avatar + username + XP bar */
            <button
              onClick={() => navigate("/profile")}
              className="w-full flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-secondary/60 transition-colors group text-left"
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
                style={{
                  background: `${avatarBgColor}25`,
                  border: `1.5px solid ${avatarBgColor}50`,
                  boxShadow: `0 0 10px ${avatarBgColor}20`,
                }}>
                {renderSidebarAvatar()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <p className="font-display text-xs font-semibold truncate leading-tight">{user?.username ?? "Player"}</p>
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-display text-[9px] font-bold shrink-0"
                    style={{ background: `${xpInfo.color}18`, color: xpInfo.color, border: `1px solid ${xpInfo.color}35` }}>
                    <XpIcon className="h-2.5 w-2.5" />
                    {xpInfo.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.round(xpInfo.progress * 100)}%`, background: xpInfo.color }} />
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground/50 tabular-nums shrink-0">{xpInfo.xp} XP</span>
                </div>
              </div>
            </button>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
