import { useState } from "react";
import {
  LayoutDashboard, Swords, History, User, ShieldAlert, Wallet, Trophy,
  Settings2, Medal, Shield, Gem, Sparkles, Crown, Users2,
  LogOut, Mail, ChevronUp, Flame, type LucideIcon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useUserStore }    from "@/stores/userStore";
import { useInboxStore }   from "@/stores/inboxStore";
import { useMessageStore } from "@/stores/messageStore";
import { getXpInfo }       from "@/lib/xp";
import { getAvatarSidebarStyle } from "@/lib/avatarBgs";
import { renderUserAvatarDiscContent } from "@/lib/userAvatarRing";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const XP_ICON_MAP: Record<string, LucideIcon> = {
  Medal, Shield, Trophy, Gem, Sparkles, Crown,
};

const NAV_ITEMS = [
  { title: "Dashboard",     url: "/dashboard",  icon: LayoutDashboard },
  { title: "Match Lobby",   url: "/lobby",       icon: Swords          },
  { title: "Match History", url: "/history",     icon: History         },
  { title: "Profile",       url: "/profile",     icon: User            },
  { title: "Leaderboard",   url: "/leaderboard", icon: Trophy          },
  { title: "Hub",           url: "/hub",         icon: Users2          },
  { title: "Wallet",        url: "/wallet",      icon: Wallet          },
  { title: "Forge",         url: "/forge",       icon: Flame           },
  { title: "Settings",      url: "/settings",    icon: Settings2       },
  { title: "Admin",         url: "/admin",       icon: ShieldAlert     },
];

const QUICK_LINKS = [
  { label: "Profile",   url: "/profile",          icon: User      },
  { label: "Hub",       url: "/hub",               icon: Users2    },
  { label: "Messages",  url: "/hub?tab=messages",  icon: Mail      },
  { label: "Settings",  url: "/settings",          icon: Settings2 },
];

export function ArenaSidebar() {
  const user    = useUserStore((s) => s.user);
  const logout  = useUserStore((s) => s.logout);
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate  = useNavigate();
  const [open, setOpen] = useState(false);

  const inboxUnread   = useInboxStore((s) => s.getTotalUnread)();
  const chatUnread    = useMessageStore((s) => s.getTotalUnread)();
  const totalUnread   = inboxUnread + chatUnread;

  const xpInfo        = getXpInfo(user?.stats.xp ?? 0);
  const XpIcon        = XP_ICON_MAP[xpInfo.iconName] ?? Medal;
  const initialsSource =
    user?.avatar === "initials" && user.avatarInitials?.trim()
      ? user.avatarInitials.trim()
      : (user?.username ?? "??");

  const visibleItems = user?.role === "admin"
    ? NAV_ITEMS
    : NAV_ITEMS.filter((i) => i.url !== "/admin");

  const renderAvatar = (size = 28) => {
    const frame = getAvatarSidebarStyle(user?.avatarBg);
    return (
      <div
        className="relative shrink-0 overflow-hidden ring-1 ring-white/10"
        style={{
          width: size,
          height: size,
          ...frame,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.5) 0%, transparent 45%, transparent 100%)",
          }}
        />
        {renderUserAvatarDiscContent({
          avatar: user?.avatar,
          initialsSource,
          sizePx: size,
          mediaRoundedClass: "rounded-md",
        })}
      </div>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="flex flex-col h-full bg-card/30">

        {/* ── Logo ─────────────────────────────────────────────── */}
        <div className={cn(
          "shrink-0 flex items-center border-b border-border/30",
          collapsed ? "px-3 py-4 justify-center" : "px-5 py-4"
        )}>
          <button
            onClick={() => navigate("/dashboard")}
            className="focus:outline-none group flex items-center gap-2"
          >
            {/* Glow dot */}
            <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_2px_hsl(var(--primary)/0.6)] shrink-0" />
            {!collapsed && (
              <h1 className="font-display text-xl font-bold text-primary tracking-[0.18em] group-hover:opacity-80 transition-opacity select-none">
                ARENA
              </h1>
            )}
          </button>
        </div>

        {/* ── Navigation ───────────────────────────────────────── */}
        <SidebarGroup className="flex-1 min-h-0 py-3">
          {!collapsed && (
            <SidebarGroupLabel className="text-muted-foreground/40 uppercase tracking-[0.15em] text-[9px] px-5 mb-1">
              Menu
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={collapsed ? item.title : undefined}>
                    <NavLink
                      to={item.url} end
                      className={cn(
                        "relative flex items-center rounded-lg px-2.5 py-2 transition-all duration-150",
                        "text-muted-foreground/70 hover:text-foreground hover:bg-secondary/50",
                        collapsed && "justify-center px-2"
                      )}
                      activeClassName="!text-primary bg-primary/10 hover:bg-primary/15 font-medium shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
                    >
                      <item.icon className={cn("h-[15px] w-[15px] shrink-0 transition-colors", !collapsed && "mr-2.5")} />
                      {!collapsed && <span className="text-[13px] leading-none">{item.title}</span>}

                      {/* Unread badge on Hub */}
                      {item.url === "/hub" && totalUnread > 0 && (
                        <span className={cn(
                          "absolute flex items-center justify-center text-[8px] font-bold rounded-full bg-primary text-primary-foreground leading-none",
                          collapsed
                            ? "top-0.5 right-0.5 w-3.5 h-3.5"
                            : "right-2.5 w-4 h-4"
                        )}>
                          {totalUnread > 9 ? "9+" : totalUnread}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── User widget ──────────────────────────────────────── */}
        <div className="shrink-0 border-t border-border/30 p-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button className={cn(
                "w-full flex items-center gap-2.5 rounded-lg transition-all duration-150 group",
                "hover:bg-secondary/60",
                open && "bg-secondary/60",
                collapsed ? "justify-center p-2" : "px-2.5 py-2"
              )}>
                {renderAvatar(collapsed ? 24 : 28)}

                {!collapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-[12px] font-semibold truncate leading-tight tracking-wide">{user?.username ?? "Player"}</p>
                    <p className="font-mono text-[9px] text-primary/60 truncate mt-px">{user?.arenaId ?? "ARENA-??????"}</p>
                  </div>
                )}

                {!collapsed && (
                  <div className="shrink-0 flex items-center gap-1.5">
                    {totalUnread > 0 && (
                      <span className="text-[8px] font-bold bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center leading-none">
                        {totalUnread > 9 ? "9+" : totalUnread}
                      </span>
                    )}
                    <ChevronUp className={cn(
                      "h-3 w-3 text-muted-foreground/30 transition-transform duration-200",
                      open ? "rotate-180" : "rotate-0"
                    )} />
                  </div>
                )}
              </button>
            </PopoverTrigger>

            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-56 p-0 bg-card/98 backdrop-blur-md border border-border/60 shadow-2xl rounded-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-3.5 py-3 bg-secondary/20 border-b border-border/30">
                {renderAvatar(34)}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate leading-tight">{user?.username ?? "Player"}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="font-mono text-[9px] text-primary/80 truncate">{user?.arenaId ?? "—"}</p>
                    <span
                      className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[8px] font-bold shrink-0"
                      style={{ background: `${xpInfo.color}18`, color: xpInfo.color, border: `1px solid ${xpInfo.color}35` }}
                    >
                      <XpIcon className="h-2 w-2" />
                      {xpInfo.label}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick links */}
              <div className="p-1.5 space-y-px">
                {QUICK_LINKS.map(({ label, url, icon: Icon }) => {
                  const badge = url === "/hub?tab=messages" && totalUnread > 0 ? totalUnread : 0;
                  return (
                    <button
                      key={url}
                      onClick={() => { navigate(url); setOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-secondary/60 transition-colors group"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0" />
                      <span className="text-[12px] font-medium flex-1 text-foreground/80 group-hover:text-foreground transition-colors">{label}</span>
                      {badge > 0 && (
                        <span className="text-[8px] font-bold bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center leading-none">
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Logout */}
              <div className="border-t border-border/30 p-1.5">
                <button
                  onClick={() => { logout(); navigate("/"); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-destructive/10 transition-colors group"
                >
                  <LogOut className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-destructive transition-colors shrink-0" />
                  <span className="text-[12px] font-medium text-muted-foreground group-hover:text-destructive transition-colors">Log Out</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

      </SidebarContent>
    </Sidebar>
  );
}
