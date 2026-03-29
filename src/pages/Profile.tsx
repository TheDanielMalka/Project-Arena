import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  User, Shield, Gamepad2, Wallet, Link2, CheckCircle, XCircle,
  Copy, ExternalLink, Edit2, Save, Trophy, TrendingUp, Zap, Smartphone, Monitor, X,
  Camera, Lock, Upload, Star, Crown, Medal, Gem, Sparkles, Flame,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUserStore } from "@/stores/userStore";
import { cn } from "@/lib/utils";
import { useNotificationStore } from "@/stores/notificationStore";
import { useForgeStore } from "@/stores/forgeStore";
import { useToast } from "@/hooks/use-toast";
import { getXpInfo } from "@/lib/xp";
import {
  getAvatarBackground,
  getAvatarCircleStyle,
  avatarBackgroundsByTier,
} from "@/lib/avatarBgs";
import {
  FREE_AVATAR_PRESETS,
  FREE_AVATAR_IDS,
  EVENT_AVATAR_PRESETS,
  avatarPresetKey,
  getAvatarPresetImageUrl,
  getAvatarImageUrlFromStorage,
  getPresetId,
  isPresetAvatar,
} from "@/lib/avatarPresets";
import { SEED_ITEMS } from "@/stores/forgeStore";

type GameConnection = {
  name: string;
  platform: "pc" | "mobile";
  status: "connected" | "disconnected";
  accountId?: string;
};

// ── XP level icon map ──────────────────────────────────────────────────────────
const XP_ICON_MAP: Record<string, LucideIcon> = {
  Medal, Shield, Trophy, Gem, Sparkles, Crown,
};

const Profile = () => {
  const { user, updateProfile } = useUserStore();
  const navigate = useNavigate();
  const { toast } = useToast();
  const xpInfo = getXpInfo(user?.stats.xp ?? 0);
  const XpIcon = XP_ICON_MAP[xpInfo.iconName] ?? Medal;
  const [editMode, setEditMode] = useState(false);
  const [username, setUsername] = useState(user?.username ?? "ArenaPlayer_01");

  // Avatar picker state
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [pickerMode, setPickerMode]             = useState<"avatar" | "background">("avatar");
  const [selectedAvatar, setSelectedAvatar]     = useState<string>(user?.avatar ?? "initials");
  const [avatarTab, setAvatarTab]               = useState<"free" | "event" | "premium">("free");
  const [selectedBg, setSelectedBg]             = useState<string>(user?.avatarBg ?? "default");
  const [bgTab, setBgTab]                       = useState<"free" | "event" | "premium">("free");
  /** Draft inside picker — committed only via Apply */
  const [draftAvatar, setDraftAvatar]           = useState<string>(user?.avatar ?? "initials");
  const [draftBg, setDraftBg]                   = useState<string>(user?.avatarBg ?? "default");

  useEffect(() => {
    if (!user) return;
    setSelectedBg(user.avatarBg ?? "default");
    setSelectedAvatar(user.avatar ?? "initials");
  }, [user?.avatarBg, user?.avatar, user]);

  useEffect(() => {
    if (!showAvatarPicker) return;
    setDraftAvatar(selectedAvatar);
    setDraftBg(selectedBg);
  }, [showAvatarPicker]);

  const forgeAvatarIcons   = new Set(
    SEED_ITEMS.filter((i) => i.category === "avatar").map((i) => i.icon),
  );
  const forgeAvatarItems   = SEED_ITEMS.filter((i) => i.category === "avatar");
  const forgePurchases     = useForgeStore((s) => s.purchases);

  // DB-ready: unlock flags should come from API/event progress
  const EVENT_AVATARS = EVENT_AVATAR_PRESETS.map((p) => ({
    ...p,
    unlocked: p.id === "gearburst_ace", // sample unlocked for UI; replace with real event unlocks
  }));

  const renderAvatarContent = (avatar: string, size: "sm" | "lg" = "lg") => {
    const textSize  = size === "lg" ? "text-xl" : "text-sm";
    const emojiSize = size === "lg" ? "text-2xl" : "text-base";
    if (avatar === "initials") {
      return (
        <span
          className={`font-display ${textSize} font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]`}
        >
          {username.slice(0, 2).toUpperCase()}
        </span>
      );
    }
    if (avatar.startsWith("upload:")) return <img src={avatar.slice(7)} className="w-full h-full object-cover rounded-full" alt="avatar" />;
    const presetUrl = getAvatarImageUrlFromStorage(avatar);
    if (presetUrl) return <img src={presetUrl} className="w-full h-full object-cover rounded-full" alt="" />;
    return <span className={cn(emojiSize, "drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]")}>{avatar}</span>;
  };
  const [steamId, setSteamId] = useState(user?.steamId ?? "76561198XXXXXXXX");
  const [copiedWallet, setCopiedWallet] = useState(false);

  // Link dialog state
  const [linkDialog, setLinkDialog] = useState<{ name: string; type: "game" | "service"; platform?: "pc" | "mobile"; placeholder?: string } | null>(null);
  const [linkAccountId, setLinkAccountId] = useState("");

  // Local state for game connections (togglable)
  const [gameConnections, setGameConnections] = useState<GameConnection[]>([
    { name: "COD", platform: "pc", status: "disconnected" },
    { name: "League of Legends", platform: "pc", status: "disconnected" },
    { name: "PUBG", platform: "pc", status: "disconnected" },
    { name: "Overwatch 2", platform: "pc", status: "disconnected" },
    { name: "Team Fortress 2", platform: "pc", status: "disconnected" },
    { name: "Fortnite", platform: "pc", status: "connected", accountId: "EpicGamer99" },
    { name: "FIFA / EA FC", platform: "pc", status: "disconnected" },
    { name: "PES / eFootball", platform: "pc", status: "disconnected" },
    { name: "MLBB", platform: "mobile", status: "disconnected" },
    { name: "Wild Rift", platform: "mobile", status: "disconnected" },
    { name: "COD Mobile", platform: "mobile", status: "disconnected" },
    { name: "PUBG Mobile", platform: "mobile", status: "connected", accountId: "PUBGm_Player01" },
    { name: "Fortnite Mobile", platform: "mobile", status: "disconnected" },
  ]);

  // Connection states for services
  const [serviceConnections, setServiceConnections] = useState<Record<string, string | false>>({
    discord: false,
    faceit: false,
    // DB-ready: riot Riot account id / Riot ID from OAuth or profile API
    riot: false,
  });

  const walletAddress = user?.walletShort ?? "0x1a2B...9fE4";

  const gameConfig: Record<string, { abbr: string; color: string; bg: string; img?: string }> = {
    "CS2":              { abbr: "CS2",  color: "#F97316", bg: "rgba(249,115,22,0.12)",  img: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/capsule_sm_120.jpg" },
    "Valorant":         { abbr: "VLR",  color: "#FF4655", bg: "rgba(255,70,85,0.12)",   img: "https://cdn.cloudflare.steamstatic.com/steam/apps/2181130/capsule_sm_120.jpg" },
    "COD":              { abbr: "COD",  color: "#84CC16", bg: "rgba(132,204,22,0.12)",  img: "https://cdn.cloudflare.steamstatic.com/steam/apps/1938090/capsule_sm_120.jpg" },
    "League of Legends":{ abbr: "LoL",  color: "#EAB308", bg: "rgba(234,179,8,0.12)",   img: "https://cdn.cloudflare.steamstatic.com/steam/apps/2801460/capsule_sm_120.jpg" },
    "PUBG":             { abbr: "PUBG", color: "#F59E0B", bg: "rgba(245,158,11,0.12)",  img: "https://cdn.cloudflare.steamstatic.com/steam/apps/578080/capsule_sm_120.jpg" },
    "Overwatch 2":      { abbr: "OW2",  color: "#F97316", bg: "rgba(249,115,22,0.12)",  img: "https://cdn.cloudflare.steamstatic.com/steam/apps/2357570/capsule_sm_120.jpg" },
    "Team Fortress 2":  { abbr: "TF2",  color: "#EF4444", bg: "rgba(239,68,68,0.12)",   img: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/capsule_sm_120.jpg" },
    "Fortnite":         { abbr: "FN",   color: "#38BDF8", bg: "rgba(56,189,248,0.12)",  img: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120" },
    "FIFA / EA FC":     { abbr: "FC",   color: "#22C55E", bg: "rgba(34,197,94,0.12)",   img: "https://cdn.cloudflare.steamstatic.com/steam/apps/2195250/capsule_sm_120.jpg" },
    "PES / eFootball":  { abbr: "PES",  color: "#3B82F6", bg: "rgba(59,130,246,0.12)",  img: "https://cdn.cloudflare.steamstatic.com/steam/apps/1665460/capsule_sm_120.jpg" },
    "Arena of Valor":   { abbr: "AoV",  color: "#A855F7", bg: "rgba(168,85,247,0.12)", img: "https://play-lh.googleusercontent.com/3Qs6i05oAAUtjzwZCi0AJ9FpxT85w5BWCedIXCrsVKLTGOCcnP2B5yOVoheGSBZpj8z9=s120" },
    "MLBB":             { abbr: "ML",   color: "#EF4444", bg: "rgba(239,68,68,0.12)",  img: "https://play-lh.googleusercontent.com/Op7v9XdsyxjrKImMD5RLyiLRCAHs3DMQFANwfsuMTw1hq0lH4j8tOqD3Fd7zyr4ixmC0xoqqRkQDBjAd46NsFQ=s120" },
    "Wild Rift":        { abbr: "WR",   color: "#6366F1", bg: "rgba(99,102,241,0.12)", img: "https://play-lh.googleusercontent.com/7-kbcpgrCOE1mleJ9g0d61sJeoqKcQRIj4iFvJ8DjPlRIfocOWfOQsXzKWw2I5oHySVdbjR2fvzfCCz1FYQ-RQ=s120" },
    "COD Mobile":       { abbr: "COD",  color: "#84CC16", bg: "rgba(132,204,22,0.12)", img: "https://play-lh.googleusercontent.com/cfGSXkDwxa1jW3TlhhkDJBN16-1_KEtEDhnILPcs9rXcC25g14XY6MRGCtlXHFHs0g=s120" },
    "PUBG Mobile":      { abbr: "PUBG", color: "#F59E0B", bg: "rgba(245,158,11,0.12)", img: "https://play-lh.googleusercontent.com/zCSGnBtZk0Lmp1BAbyaZfLktDzHmC6oke67qzz3G1lBegAF2asyt5KzXOJ2PVdHDYkU=s120" },
    "Fortnite Mobile":  { abbr: "FN",   color: "#38BDF8", bg: "rgba(56,189,248,0.12)", img: "https://play-lh.googleusercontent.com/FxJDPDIDJKlG9C8lOxaS041X27A0SrHAa46SGDIpPusAd4IEJihZTyGf-8rTZ_GpF34aeLvULilVuO0cpCJxTg=s120" },
  };

  // Game stats per connected game (mock data — display only)
  const gameStats: Record<string, { matches: number; winRate: number; earnings: number; kd: number; rank: string; streak: number }> = {
    "CS2":         { matches: 89, winRate: 67.4, earnings: 1240, kd: 1.8,  rank: "Gold",     streak: 4 },
    "Valorant":    { matches: 58, winRate: 61.2, earnings: 1607, kd: 1.4,  rank: "Platinum", streak: 2 },
    "Fortnite":    { matches: 21, winRate: 47.6, earnings: 310,  kd: 1.1,  rank: "Bronze",   streak: 1 },
    "PUBG Mobile": { matches: 34, winRate: 52.9, earnings: 0,    kd: 2.1,  rank: "Crown",    streak: 0 },
    "MLBB":        { matches: 12, winRate: 58.3, earnings: 0,    kd: 1.6,  rank: "Epic",     streak: 3 },
  };

  // Game Stats tabs: CS2 & Valorant (Arena v1) — account linking is via Steam / Riot / FACEIT in Connections
  // DB-ready: tab list from backend (per-game stats when user has played / linked platforms)
  const gameStatsTabGames: string[] = ["CS2", "Valorant"];
  const [activeGameTab, setActiveGameTab] = useState<string>(gameStatsTabGames[0] ?? "CS2");

  const addNotification = useNotificationStore((s) => s.addNotification);

  const handleCopyWallet = () => {
    navigator.clipboard.writeText("0x1a2B3c4D5e6F7g8H9iJkLmNoPqRsT9fE4");
    setCopiedWallet(true);
    addNotification({ type: "system", title: "📋 Wallet Copied", message: "Your wallet address was copied to clipboard." });
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  const handleSaveProfile = () => {
    setEditMode(false);
    updateProfile({ username, avatar: selectedAvatar, avatarBg: selectedBg });
    addNotification({ type: "system", title: "✅ Profile Updated", message: `Username set to "${username}". Changes saved successfully.` });
  };

  /** Premium frames require Forge purchase; already-saved premium `committedBg` may still be applied. */
  const canUseBackgroundId = (bgId: string, committedBg: string) => {
    const b = getAvatarBackground(bgId);
    if (b.tier === "free") return true;
    if (b.tier === "event") return !b.locked;
    if (b.tier === "premium") {
      if (committedBg === bgId) return true;
      // DB-ready: replace with server-owned cosmetics lookup (users_cosmetics)
      const frameItem = SEED_ITEMS.find((i) => i.category === "frame" && i.icon === `bg:${bgId}`);
      return !!frameItem && forgePurchases.some((p) => p.itemId === frameItem.id);
    }
    return false;
  };

  const canCommitDraftAvatar = () => {
    if (draftAvatar === "initials" || draftAvatar.startsWith("upload:")) return true;
    if (isPresetAvatar(draftAvatar)) {
      const id = getPresetId(draftAvatar);
      if (id == null) return false;
      if (FREE_AVATAR_IDS.has(id)) return true;
      const evt = EVENT_AVATARS.find((e) => e.id === id);
      if (evt) return !!evt.unlocked;
      // Premium presets: allow if already equipped, or purchased in Forge
      if (selectedAvatar === draftAvatar) return true;
      const item = SEED_ITEMS.find((i) => i.category === "avatar" && i.icon === draftAvatar);
      return !!item && forgePurchases.some((p) => p.itemId === item.id);
    }
    if (forgeAvatarIcons.has(draftAvatar)) return false;
    return true;
  };

  const handleApplyPicker = () => {
    if (!canUseBackgroundId(draftBg, selectedBg)) {
      toast({
        title: "Background locked",
        description: "Premium frames are purchased in Forge with AT / USDT. Event frames unlock by completing the event.",
        variant: "destructive",
      });
      return;
    }
    if (!canCommitDraftAvatar()) {
      toast({
        title: "Avatar locked",
        description: "That icon is a Forge exclusive — buy it in the Shop tab first.",
        variant: "destructive",
      });
      return;
    }
    setSelectedAvatar(draftAvatar);
    setSelectedBg(draftBg);
    setShowAvatarPicker(false);
    toast({ title: "Look locked in", description: "Press Save on your profile to sync everywhere." });
  };

  const handleUnlinkGame = (gameName: string) => {
    setGameConnections((prev) =>
      prev.map((g) => {
        if (g.name !== gameName) return g;
        toast({ title: `${gameName} Disconnected`, description: `Your ${gameName} account has been unlinked.` });
        addNotification({ type: "system", title: `🔗 ${gameName} Unlinked`, message: `Your ${gameName} account has been disconnected.` });
        return { ...g, status: "disconnected", accountId: undefined };
      })
    );
  };

  const handleOpenLinkDialog = (name: string, type: "game" | "service", platform?: "pc" | "mobile", placeholder?: string) => {
    setLinkDialog({ name, type, platform, placeholder });
    setLinkAccountId("");
  };

  const handleConfirmLink = () => {
    if (!linkDialog || !linkAccountId.trim()) {
      toast({ title: "Missing ID", description: `Please enter your ${linkDialog?.name} account ID.`, variant: "destructive" });
      return;
    }
    const { name, type } = linkDialog;
    const accountId = linkAccountId.trim();

    if (type === "game") {
      setGameConnections((prev) =>
        prev.map((g) => g.name !== name ? g : { ...g, status: "connected", accountId })
      );
    } else {
      // service connection — map display name → store key (DB-ready: align keys with API)
      const serviceKeyMap: Record<string, "discord" | "faceit" | "riot"> = {
        discord: "discord",
        faceit: "faceit",
        "riot games": "riot",
      };
      const key = serviceKeyMap[name.toLowerCase()];
      if (key) setServiceConnections((prev) => ({ ...prev, [key]: accountId }));
    }

    toast({ title: `${name} Connected!`, description: `Linked as ${accountId}` });
    addNotification({ type: "system", title: `✅ ${name} Linked`, message: `Successfully connected your ${name} account (${accountId}).` });
    setLinkDialog(null);
    setLinkAccountId("");
  };

  const handleDisconnectService = (service: "discord" | "faceit" | "riot") => {
    const label = service === "discord" ? "Discord" : service === "faceit" ? "FACEIT" : "Riot Games";
    setServiceConnections((prev) => ({ ...prev, [service]: false }));
    toast({ title: `${label} Disconnected`, description: `Your ${label} account has been unlinked.` });
    addNotification({ type: "system", title: `🔗 ${label} Unlinked`, message: `Your ${label} account has been disconnected from Arena.` });
  };

  const connections = [
    {
      name: "Steam",
      icon: Gamepad2,
      img: "https://cdn.simpleicons.org/steam/ffffff",
      imgBg: "rgba(27,40,56,0.9)",
      status: "connected" as const,
      detail: steamId,
      color: "text-arena-cyan",
      borderColor: "border-arena-cyan/30",
      bgColor: "bg-arena-cyan/5",
    },
    {
      name: "Wallet",
      icon: Wallet,
      img: "https://cdn.simpleicons.org/ethereum/627EEA",
      imgBg: "rgba(98,126,234,0.12)",
      status: "connected" as const,
      detail: walletAddress,
      color: "text-primary",
      borderColor: "border-primary/30",
      bgColor: "bg-primary/5",
    },
    {
      name: "Discord",
      icon: Link2,
      img: "https://cdn.simpleicons.org/discord/5865F2",
      imgBg: "rgba(88,101,242,0.12)",
      status: serviceConnections.discord ? "connected" as const : "disconnected" as const,
      detail: serviceConnections.discord || "Not connected",
      color: "text-arena-purple",
      borderColor: "border-arena-purple/30",
      bgColor: "bg-arena-purple/5",
      onConnect: () => handleOpenLinkDialog("Discord", "service", undefined, "YourName#1234"),
      onDisconnect: () => handleDisconnectService("discord"),
    },
    {
      name: "FACEIT",
      icon: Shield,
      img: "https://cdn.simpleicons.org/faceit/FF5500",
      imgBg: "rgba(255,85,0,0.12)",
      status: serviceConnections.faceit ? "connected" as const : "disconnected" as const,
      detail: serviceConnections.faceit || "Not connected",
      color: "text-arena-orange",
      borderColor: "border-arena-orange/30",
      bgColor: "bg-arena-orange/5",
      onConnect: () => handleOpenLinkDialog("FACEIT", "service", undefined, "your_faceit_username"),
      onDisconnect: () => handleDisconnectService("faceit"),
    },
    {
      name: "Riot Games",
      icon: Gamepad2,
      img: "https://cdn.simpleicons.org/riotgames/D32936",
      imgBg: "rgba(211,41,54,0.12)",
      status: serviceConnections.riot ? "connected" as const : "disconnected" as const,
      detail: serviceConnections.riot || "Not connected",
      color: "text-red-400",
      borderColor: "border-red-500/30",
      bgColor: "bg-red-500/5",
      onConnect: () => handleOpenLinkDialog("Riot Games", "service", undefined, "Riot ID / gameName#TAG"),
      onDisconnect: () => handleDisconnectService("riot"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (editMode) handleSaveProfile();
            else setEditMode(true);
          }}
          className="font-display border-border"
        >
          {editMode ? <><Save className="mr-2 h-4 w-4" /> Save</> : <><Edit2 className="mr-2 h-4 w-4" /> Edit Profile</>}
        </Button>
      </div>

      {/* Player Info — Gaming Card */}
      <Card className="bg-card border-border overflow-hidden">
        {/* Red accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/60 to-transparent" />
        <CardContent className="p-6">
          <div className="flex items-center gap-5">
            {/* Avatar — only interactive in edit mode */}
            <div className="relative shrink-0">
              {editMode ? (
                <button
                  onClick={() => { setPickerMode("avatar"); setShowAvatarPicker(true); }}
                  className={cn(
                    "group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/15 transition-all",
                    getAvatarBackground(selectedBg).pulse && "motion-safe:animate-pulse",
                  )}
                  style={getAvatarCircleStyle(selectedBg)}
                >
                  <span className="pointer-events-none absolute inset-0 opacity-[0.14] bg-gradient-to-br from-white/45 to-transparent" />
                  <span className="relative z-[1] flex h-full w-full items-center justify-center">{renderAvatarContent(selectedAvatar)}</span>
                  <div className="absolute inset-0 z-[2] rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="h-5 w-5 text-white" />
                  </div>
                </button>
              ) : (
                <div
                  className={cn(
                    "relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/15",
                    getAvatarBackground(selectedBg).pulse && "motion-safe:animate-pulse",
                  )}
                  style={getAvatarCircleStyle(selectedBg)}
                >
                  <span className="pointer-events-none absolute inset-0 opacity-[0.14] bg-gradient-to-br from-white/45 to-transparent" />
                  <span className="relative z-[1] flex h-full w-full items-center justify-center">{renderAvatarContent(selectedAvatar)}</span>
                </div>
              )}
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary border-2 border-background flex items-center justify-center">
                <Shield className="h-2.5 w-2.5 text-white" />
              </div>
            </div>

            {/* Name + rank + info */}
            <div className="flex-1 min-w-0">
              {editMode ? (
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-secondary border-border font-display text-lg font-bold mb-1 h-8"
                />
              ) : (
                <h2 className="font-display text-xl font-bold tracking-wide truncate">{username}</h2>
              )}
              {/* Arena ID — immutable public identifier */}
              <p className="font-mono text-[10px] text-primary/70 mt-0.5 tracking-wider">
                {user?.arenaId ?? "ARENA-??????"}
              </p>
              {/* XP level badge + game badge */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-display text-xs font-bold"
                  style={{ background: `${xpInfo.color}18`, color: xpInfo.color, border: `1px solid ${xpInfo.color}35` }}>
                  <XpIcon className="h-3 w-3" />
                  {xpInfo.label}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Gamepad2 className="h-3 w-3" /> CS2
                </span>
              </div>
              {/* XP progress bar */}
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-display font-bold uppercase tracking-widest"
                    style={{ color: xpInfo.color }}>
                    {xpInfo.label}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                    {xpInfo.xp.toLocaleString()} XP
                    {xpInfo.nextXp !== null && <span className="text-muted-foreground/50"> / {xpInfo.nextXp.toLocaleString()}</span>}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden w-full max-w-xs">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.round(xpInfo.progress * 100)}%`, background: xpInfo.color, boxShadow: `0 0 6px ${xpInfo.color}60` }} />
                </div>
                {xpInfo.nextXp !== null && (
                  <p className="text-[9px] text-muted-foreground/50 mt-0.5">{xpInfo.remaining} XP to next level</p>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-xs text-muted-foreground font-mono">{steamId}</span>
                <span className="text-xs text-muted-foreground">Since March 2026</span>
              </div>
            </div>

            {/* Stats — right side */}
            <div className="flex items-center gap-4 shrink-0 border-l border-border/50 pl-5">
              <div className="text-center">
                <Trophy className="h-4 w-4 text-arena-gold mx-auto mb-0.5" />
                <p className="font-display text-lg font-bold leading-none">{user?.stats.matches ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Matches</p>
              </div>
              <div className="text-center">
                <TrendingUp className="h-4 w-4 text-primary mx-auto mb-0.5" />
                <p className="font-display text-lg font-bold leading-none">{user?.stats.winRate ?? 0}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">Win Rate</p>
              </div>
              <div className="text-center">
                <Zap className="h-4 w-4 text-arena-orange mx-auto mb-0.5" />
                <p className="font-display text-lg font-bold leading-none">${user?.stats.totalEarnings?.toLocaleString() ?? "0"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Earnings</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Game Stats */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="font-display text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
              <Trophy className="h-4 w-4" /> Game Stats
            </CardTitle>
            <button onClick={() => navigate(`/history?game=${encodeURIComponent(activeGameTab)}`)} className="text-[10px] font-display text-muted-foreground hover:text-primary transition-colors tracking-wider uppercase">
              Full Stats →
            </button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Game Tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {gameStatsTabGames.map((gameName) => {
              const cfg = gameConfig[gameName] ?? { abbr: gameName.slice(0,2).toUpperCase(), color: "#888", bg: "rgba(136,136,136,0.1)" };
              const isActive = activeGameTab === gameName;
              return (
                <button
                  key={gameName}
                  onClick={() => setActiveGameTab(gameName)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-display font-semibold transition-all"
                  style={{
                    background: isActive ? cfg.bg : "transparent",
                    border: `1px solid ${isActive ? cfg.color + "60" : "rgba(255,255,255,0.06)"}`,
                    color: isActive ? cfg.color : "var(--muted-foreground)",
                  }}
                >
                  <div className="w-4 h-4 rounded overflow-hidden flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg }}>
                    {cfg.img
                      ? <img src={cfg.img} alt={gameName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
                      : <span style={{ color: cfg.color, fontSize: "7px", fontWeight: 700 }}>{cfg.abbr.slice(0,2)}</span>
                    }
                  </div>
                  {cfg.abbr}
                </button>
              );
            })}
          </div>

          {/* Active Game Stats */}
          {(() => {
            const stats = gameStats[activeGameTab];
            const cfg = gameConfig[activeGameTab] ?? { abbr: activeGameTab?.slice(0,2) ?? "??", color: "#888", bg: "rgba(136,136,136,0.1)" };
            if (!stats) return (
              <div className="text-center py-4 text-muted-foreground text-xs font-display">No stats available for {activeGameTab}</div>
            );
            const winColor = stats.winRate >= 65 ? "#22C55E" : stats.winRate >= 55 ? "#F59E0B" : stats.winRate >= 45 ? "#F97316" : "#EF4444";
            const segments = 20;
            const filled = Math.round((stats.winRate / 100) * segments);
            return (
              <div className="space-y-3">
                {/* Win Rate + Bar */}
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-display uppercase tracking-widest text-muted-foreground mb-0.5">Win Rate</div>
                    <div className="font-display font-bold text-3xl leading-none" style={{ color: winColor }}>
                      {stats.winRate}%
                    </div>
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex gap-0.5">
                      {Array.from({ length: segments }).map((_, i) => (
                        <div key={i} className="flex-1 h-2 rounded-sm transition-all"
                          style={{ background: i < filled ? winColor : "rgba(255,255,255,0.06)" }} />
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono text-right">
                      {Math.round(stats.matches * stats.winRate / 100)}W – {Math.round(stats.matches * (1 - stats.winRate / 100))}L
                    </div>
                  </div>
                </div>
                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { label: "Matches", value: stats.matches,          icon: "⚔" },
                    { label: "K/D",     value: stats.kd.toFixed(1),    icon: "🎯" },
                    { label: "Rank",    value: stats.rank,             icon: "🏅" },
                    { label: "Streak",  value: stats.streak > 0 ? `${stats.streak}🔥` : "—", icon: "⚡" },
                  ].map(({ label, value, icon }) => (
                    <div key={label} className="rounded-md p-2 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="text-sm">{icon}</div>
                      <div className="font-display font-bold text-xs mt-0.5">{value}</div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
                    </div>
                  ))}
                </div>
                {/* Earnings */}
                {stats.earnings > 0 && (
                  <div className="flex items-center justify-between px-2 py-1.5 rounded-md" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
                    <span className="text-[10px] font-display uppercase tracking-widest text-muted-foreground">Earned in {activeGameTab}</span>
                    <span className="font-display font-bold text-sm text-green-400">${stats.earnings.toLocaleString()}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Connections */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Connections
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-5 gap-1 min-[380px]:gap-1.5 sm:gap-2">
            {connections.map((conn) => (
              <div
                key={conn.name}
                className="relative flex flex-col items-center justify-center gap-1 p-1.5 min-[380px]:p-2 sm:p-2.5 rounded-md sm:rounded-lg bg-secondary/40 border border-border/50 hover:border-primary/20 transition-all group min-w-0"
              >
                {/* Status dot */}
                <div className={`absolute top-1 right-1 sm:top-1.5 sm:right-1.5 w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full shrink-0 ${conn.status === "connected" ? "bg-primary" : "bg-muted-foreground/30"}`} />

                {conn.img ? (
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-md flex items-center justify-center overflow-hidden shrink-0" style={{ background: conn.imgBg }}>
                    <img
                      src={conn.img}
                      alt={conn.name}
                      className="w-4 h-4 sm:w-[18px] sm:h-[18px] object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement!.innerHTML = `<span class="${conn.status === "connected" ? conn.color : "text-muted-foreground/50"}">${conn.name.slice(0,2)}</span>`;
                      }}
                    />
                  </div>
                ) : (
                  <conn.icon className={`h-4 w-4 sm:h-[18px] sm:w-[18px] shrink-0 ${conn.status === "connected" ? conn.color : "text-muted-foreground/50"}`} />
                )}
                <span className="font-display text-[9px] sm:text-[10px] font-semibold tracking-wide text-center leading-tight line-clamp-2">{conn.name}</span>

                {conn.status === "connected" ? (
                  <div className="flex flex-col items-center gap-0.5 w-full min-w-0">
                    <span className="text-[8px] sm:text-[9px] text-muted-foreground font-mono truncate max-w-full px-0.5 text-center">{conn.detail}</span>
                    <div className="flex gap-0.5 w-full">
                      {conn.name === "Wallet" && (
                        <button onClick={handleCopyWallet} className="flex-1 text-[8px] sm:text-[10px] py-0.5 rounded bg-secondary hover:bg-secondary/80 text-muted-foreground transition-colors">
                          {copiedWallet ? "✓" : <Copy className="h-2 w-2 sm:h-2.5 sm:w-2.5 mx-auto" />}
                        </button>
                      )}
                      {"onDisconnect" in conn && conn.onDisconnect && (
                        <button onClick={conn.onDisconnect as () => void} className="flex-1 text-[8px] sm:text-[10px] py-0.5 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={"onConnect" in conn && conn.onConnect ? conn.onConnect as () => void : undefined}
                    className={`text-[8px] sm:text-[10px] font-display px-1.5 sm:px-2 py-0.5 rounded border ${conn.borderColor} ${conn.color} hover:opacity-80 transition-opacity`}
                  >
                    Connect
                  </button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Game Connections - PC */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
            <Monitor className="h-4 w-4" /> PC Games
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {/* DB-ready: isGameActive driven by games.enabled — Link/Unlink enabled only for active games */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {gameConnections.filter(g => g.platform === "pc").map((game) => {
              const cfg = gameConfig[game.name] ?? { abbr: game.name.slice(0,2).toUpperCase(), color: "#888", bg: "rgba(136,136,136,0.1)" };
              const active = false; // All PC games are Coming Soon in Arena v1
              // DB-ready: driven by games.enabled flag from API
              return (
                <div key={game.name} className={`relative flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                  active
                    ? "bg-secondary/40 border-border/50 hover:border-primary/20"
                    : "bg-secondary/20 border-border/30 opacity-60"
                }`}>
                  {/* status dot — hidden for coming-soon games */}
                  {active && (
                    <div className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${game.status === "connected" ? "bg-primary" : "bg-muted-foreground/30"}`} />
                  )}
                  {/* Coming Soon badge */}
                  {!active && (
                    <span className="absolute top-1.5 right-1.5 text-[8px] font-display font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground/50 tracking-wide">SOON</span>
                  )}
                  {/* game badge */}
                  <div className={`w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center font-display font-bold text-xs ${!active ? "grayscale" : ""}`} style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
                    {cfg.img
                      ? <img src={cfg.img} alt={game.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<span style="color:${cfg.color};font-size:10px;font-weight:700">${cfg.abbr}</span>`; }} />
                      : <span style={{ color: cfg.color }}>{cfg.abbr}</span>
                    }
                  </div>
                  <span className="font-display text-xs font-semibold text-center leading-tight">{game.name}</span>
                  {active && game.status === "connected" && (
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full px-1 text-center">{game.accountId}</span>
                  )}
                  {active ? (
                    game.status === "connected" ? (
                      <button onClick={() => handleUnlinkGame(game.name)} className="text-[10px] font-display px-2 py-0.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors">
                        Unlink
                      </button>
                    ) : (
                      <button onClick={() => handleOpenLinkDialog(game.name, "game", game.platform)} className="text-[10px] font-display px-2 py-0.5 rounded border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">
                        Link
                      </button>
                    )
                  ) : (
                    <span className="text-[10px] text-muted-foreground/40 font-display">Coming Soon</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Game Connections - Mobile */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Mobile Games
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {/* All mobile games are Coming Soon — Arena Client v1 is PC-only */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {gameConnections.filter(g => g.platform === "mobile").map((game) => {
              const cfg = gameConfig[game.name] ?? { abbr: game.name.slice(0,2).toUpperCase(), color: "#888", bg: "rgba(136,136,136,0.1)" };
              return (
                <div key={game.name} className="relative flex flex-col items-center gap-1.5 p-3 rounded-lg bg-secondary/20 border border-border/30 opacity-55 transition-all">
                  <span className="absolute top-1.5 right-1.5 text-[8px] font-display font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground/50 tracking-wide">SOON</span>
                  <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center font-display font-bold text-xs grayscale" style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
                    {cfg.img
                      ? <img src={cfg.img} alt={game.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<span style="color:${cfg.color};font-size:10px;font-weight:700">${cfg.abbr}</span>`; }} />
                      : <span style={{ color: cfg.color }}>{cfg.abbr}</span>
                    }
                  </div>
                  <span className="font-display text-xs font-semibold text-center leading-tight">{game.name}</span>
                  <span className="text-[10px] text-muted-foreground/40 font-display">Coming Soon</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Link Game Dialog */}
      <Dialog open={!!linkDialog} onOpenChange={(open) => { if (!open) setLinkDialog(null); }}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              {linkDialog?.platform === "pc" ? (
                <Gamepad2 className="h-5 w-5 text-arena-cyan" />
              ) : (
                <Smartphone className="h-5 w-5 text-arena-orange" />
              )}
              Link {linkDialog?.name}
            </DialogTitle>
            <DialogDescription>
              Enter your account ID or username to link your {linkDialog?.name} account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Account ID / Username</label>
              <Input
                placeholder={linkDialog?.placeholder ?? `Enter your ${linkDialog?.name ?? ""} ID...`}
                value={linkAccountId}
                onChange={(e) => setLinkAccountId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConfirmLink()}
                autoFocus
                className="bg-secondary border-border font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Make sure this matches your exact in-game name so opponents can verify your identity.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLinkDialog(null)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleConfirmLink} className="glow-green font-display" disabled={!linkAccountId.trim()}>
              <Link2 className="mr-2 h-4 w-4" /> Link Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Avatar Picker Dialog ── */}
      <Dialog open={showAvatarPicker} onOpenChange={setShowAvatarPicker}>
        <DialogContent className="bg-card border-border max-w-md flex flex-col max-h-[min(90vh,640px)]">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" /> Identity studio
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Pick a look, then <strong className="text-foreground">Apply</strong> to lock it in. Save profile to sync Arena-wide.
            </DialogDescription>
          </DialogHeader>

          {/* Preview (draft) */}
          <div className="flex flex-col items-center gap-1 mb-2 shrink-0">
            <div
              className={cn(
                "relative flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-full ring-2 ring-white/20 shadow-[0_0_32px_hsl(var(--primary)/0.25)]",
                getAvatarBackground(draftBg).pulse && "motion-safe:animate-pulse",
              )}
              style={getAvatarCircleStyle(draftBg)}
            >
              <span className="pointer-events-none absolute inset-0 opacity-[0.14] bg-gradient-to-br from-white/45 to-transparent" />
              <span className="pointer-events-none absolute inset-[3px] rounded-full border border-white/10" />
              <span className="relative z-[1] flex h-full w-full items-center justify-center">{renderAvatarContent(draftAvatar)}</span>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground">Preview · not saved until Apply</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 -mr-0.5 space-y-0">

          {/* Mode toggle: AVATAR | BACKGROUND */}
          <div className="flex gap-1 mb-3 bg-secondary/60 rounded-lg p-0.5">
            {(["avatar","background"] as const).map((mode) => (
              <button key={mode} onClick={() => setPickerMode(mode)}
                className={`flex-1 text-[10px] font-display uppercase tracking-widest py-1.5 rounded-md transition-all font-semibold ${
                  pickerMode === mode ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
                }`}>
                {mode === "avatar" ? "Avatar" : "Background"}
              </button>
            ))}
          </div>

          {/* ── AVATAR MODE sub-tabs ── */}
          {pickerMode === "avatar" && (
            <div className="flex gap-1 mb-3 bg-secondary/40 rounded-lg p-0.5">
              {(["free","event","premium"] as const).map((tab) => (
                <button key={tab} onClick={() => setAvatarTab(tab)}
                  className={`flex-1 text-[10px] font-display uppercase tracking-widest py-1.5 rounded-md transition-all ${
                    avatarTab === tab ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>
                  {tab === "free" ? "Free" : tab === "event" ? "Event" : "Premium"}
                </button>
              ))}
            </div>
          )}

          {/* ── BACKGROUND MODE sub-tabs ── */}
          {pickerMode === "background" && (
            <div className="flex gap-1 mb-3 bg-secondary/40 rounded-lg p-0.5">
              {(["free","event","premium"] as const).map((tab) => (
                <button key={tab} onClick={() => setBgTab(tab)}
                  className={`flex-1 text-[10px] font-display uppercase tracking-widest py-1.5 rounded-md transition-all ${
                    bgTab === tab ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>
                  {tab === "free" ? "Free" : tab === "event" ? "Event" : "Premium"}
                </button>
              ))}
            </div>
          )}

          {/* ══ AVATAR CONTENT ══ */}
          {/* FREE — illustrated roster (DiceBear); stores as preset:id */}
          {pickerMode === "avatar" && avatarTab === "free" && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => { setDraftAvatar("initials"); }}
                title="Initials"
                className={cn(
                  "group relative aspect-square rounded-lg overflow-hidden border transition-all",
                  "bg-gradient-to-br from-white/[0.08] to-black/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
                  draftAvatar === "initials"
                    ? "border-primary ring-2 ring-primary/40 scale-[1.02]"
                    : "border-border/70 hover:border-primary/45",
                )}
              >
                <span className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.5),transparent_55%)]" />
                <span className="relative z-[1] flex h-full w-full items-center justify-center font-display text-xs font-bold text-white drop-shadow-[0_0_6px_rgba(0,0,0,0.9)]">
                  {username.slice(0, 2).toUpperCase()}
                </span>
              </button>
              {FREE_AVATAR_PRESETS.map((p) => {
                const key = avatarPresetKey(p.id);
                const selected = draftAvatar === key;
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label}
                    onClick={() => { setDraftAvatar(key); }}
                    className={cn(
                      "group relative aspect-square rounded-lg overflow-hidden border transition-all",
                      "bg-gradient-to-br from-zinc-700/40 via-black/90 to-zinc-950",
                      "shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_12px_rgba(0,0,0,0.5)]",
                      selected
                        ? "border-primary ring-2 ring-primary/45 scale-[1.02]"
                        : "border-white/10 hover:border-primary/35",
                    )}
                  >
                    <span className="pointer-events-none absolute inset-0 opacity-45 bg-[conic-gradient(from_200deg_at_50%_115%,transparent,hsl(var(--primary)/0.2),transparent)]" />
                    <span className="pointer-events-none absolute inset-[2px] rounded-md border border-white/5" />
                    <span className="relative z-[1] flex h-full w-full flex-col items-center justify-end pb-1 pt-0.5 px-0.5">
                      <img
                        src={getAvatarPresetImageUrl(p.seed, p.collection ?? "pixel-art")}
                        alt=""
                        className="h-[62%] w-[62%] shrink-0 object-cover rounded-full ring-1 ring-black/40 shadow-[0_2px_12px_rgba(0,0,0,0.55)] transition-transform duration-200 group-hover:scale-105"
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="mt-0.5 w-full truncate text-center text-[7px] font-display font-bold uppercase tracking-tight text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                        {p.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* EVENT */}
          {pickerMode === "avatar" && avatarTab === "event" && (
            <div className="grid grid-cols-2 gap-2">
              {EVENT_AVATARS.map(({ id, label, seed, collection, unlocked }) => {
                const key = avatarPresetKey(id);
                const selected = draftAvatar === key;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setDraftAvatar(key); }}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-lg border p-2.5 transition-all text-left",
                      unlocked
                        ? "border-arena-gold/40 bg-arena-gold/5 hover:bg-arena-gold/10 cursor-pointer"
                        : "border-border bg-secondary/20 cursor-pointer opacity-70",
                      selected && unlocked && "ring-2 ring-arena-gold/50",
                    )}
                  >
                    <span
                      className={cn(
                        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/10 overflow-hidden",
                        unlocked
                          ? "bg-gradient-to-br from-arena-gold/30 to-black/80 border border-arena-gold/35"
                          : "bg-secondary/40 grayscale",
                      )}
                    >
                      <img
                        src={getAvatarPresetImageUrl(seed, collection ?? "pixel-art")}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                      {!unlocked && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                          <Lock className="h-4 w-4 text-white/85" />
                        </span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-display font-bold leading-tight">{label}</p>
                      {unlocked
                        ? <p className="text-[9px] text-arena-gold flex items-center gap-1 mt-0.5"><Star className="h-2.5 w-2.5 shrink-0" /> Unlocked</p>
                        : <p className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5"><Lock className="h-2.5 w-2.5 shrink-0" /> Event only</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* PREMIUM = Forge shop avatars (AT / USDT) — equip only after purchase (DB-ready) */}
          {pickerMode === "avatar" && avatarTab === "premium" && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground font-display uppercase tracking-[0.12em]">
                Forge portraits · not included in Free tab
              </p>
              <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto pr-0.5">
                {forgeAvatarItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex items-center gap-2.5 rounded-lg border border-arena-purple/35 bg-gradient-to-r from-arena-purple/10 to-transparent p-2 text-left hover:border-arena-purple/50 transition-colors"
                    onClick={() => {
                      navigate(`/forge?tab=shop&category=avatar&focus=${encodeURIComponent(item.id)}`);
                      setShowAvatarPicker(false);
                      toast({ title: "Forge", description: `Grab “${item.name}” in the Shop with AT or USDT.` });
                    }}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-black/50 text-lg ring-1 ring-white/10 border border-arena-purple/30 overflow-hidden">
                      {getAvatarImageUrlFromStorage(item.icon)
                        ? <img src={getAvatarImageUrlFromStorage(item.icon)!} className="w-full h-full object-cover" alt="" />
                        : item.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-display font-bold truncate">{item.name}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">
                        {item.priceAT != null && <span className="text-primary font-mono">{item.priceAT.toLocaleString()} AT</span>}
                        {item.priceAT != null && item.priceUSDT != null && " · "}
                        {item.priceUSDT != null && <span className="text-arena-gold font-mono">${item.priceUSDT.toFixed(2)} USDT</span>}
                      </p>
                    </div>
                    <Flame className="h-3.5 w-3.5 text-arena-purple shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Upload disabled — avatars are preset roster / Forge only */}

          {/* ══ BACKGROUND CONTENT ══ */}
          {/* BG FREE */}
          {pickerMode === "background" && bgTab === "free" && (
            <div className="grid grid-cols-7 sm:grid-cols-8 gap-0.5">
              {avatarBackgroundsByTier("free").map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  title={bg.label}
                  onClick={() => { setDraftBg(bg.id); }}
                  className={cn(
                    "relative h-5 w-5 sm:h-6 sm:w-6 rounded overflow-hidden border transition-all shrink-0 justify-self-center",
                    draftBg === bg.id
                      ? "border-primary ring-1 ring-primary/50 scale-110 z-[1]"
                      : "border-border/60 hover:border-primary/35",
                  )}
                >
                  <div
                    className="absolute inset-0"
                    style={{ background: bg.background, boxShadow: bg.shadowCss, border: bg.borderCss }}
                  />
                  <span className="sr-only">{bg.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* BG EVENT */}
          {pickerMode === "background" && bgTab === "event" && (
            <div className="grid grid-cols-7 sm:grid-cols-8 gap-0.5">
              {avatarBackgroundsByTier("event").map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  title={bg.locked ? `${bg.label} — ${bg.eventName}` : bg.label}
                  onClick={() => {
                    setDraftBg(bg.id); // allow preview even if locked; Apply will remain blocked
                    if (bg.locked) {
                      toast({ title: "Locked", description: `${bg.label} unlocks via ${bg.eventName ?? "event"}.` });
                    }
                  }}
                  className={cn(
                    "relative h-5 w-5 sm:h-6 sm:w-6 rounded overflow-hidden border transition-all shrink-0 justify-self-center",
                    bg.locked && "opacity-45 cursor-not-allowed",
                    !bg.locked && draftBg === bg.id && "ring-1 ring-arena-gold/50 border-arena-gold/40 scale-110 z-[1]",
                    !bg.locked && draftBg !== bg.id && "border-border/60 hover:border-arena-gold/35",
                  )}
                >
                  <div
                    className={cn("absolute inset-0", !bg.locked && bg.pulse && "motion-safe:animate-pulse")}
                    style={{ background: bg.background, boxShadow: bg.shadowCss, border: bg.borderCss }}
                  />
                  {bg.locked && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/55 z-[1]">
                      <Lock className="h-2 w-2 text-white/80" />
                    </span>
                  )}
                  <span className="sr-only">{bg.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* BG PREMIUM */}
          {pickerMode === "background" && bgTab === "premium" && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground font-display uppercase tracking-[0.12em]">
                Vault frames · purchase in Forge (AT / USDT)
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full h-8 text-[11px] font-display border-arena-purple/30 text-arena-purple hover:bg-arena-purple/10"
                onClick={() => {
                  navigate("/forge?tab=shop&category=frame");
                  setShowAvatarPicker(false);
                }}
              >
                Go to Forge · Frames
              </Button>
              <div className="grid grid-cols-7 sm:grid-cols-8 gap-0.5">
                {avatarBackgroundsByTier("premium").map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    title={`${bg.label} — ${bg.price ?? "Forge"}`}
                    className="relative h-5 w-5 sm:h-6 sm:w-6 rounded overflow-hidden border border-arena-purple/40 opacity-95 hover:opacity-100 transition-opacity ring-1 ring-arena-purple/20 justify-self-center shrink-0"
                    onClick={() => {
                      setDraftBg(bg.id); // allow preview even if not owned
                      if (!canUseBackgroundId(bg.id, selectedBg)) {
                        toast({ title: "Premium frame", description: `Preview only — buy “${bg.label}” in Forge to apply.` });
                      }
                    }}
                  >
                    <div
                      className="absolute inset-0 motion-safe:animate-pulse"
                      style={{ background: bg.background, boxShadow: bg.shadowCss, border: bg.borderCss }}
                    />
                    <span className="absolute bottom-0 inset-x-0 z-[1] flex items-center justify-center py-px bg-black/75 text-[6px] leading-none font-display font-bold text-arena-gold truncate px-0.5">
                      {bg.price}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 border-t border-border/40 pt-3 mt-1 shrink-0">
            <Button type="button" variant="outline" className="font-display w-full sm:w-auto" onClick={() => setShowAvatarPicker(false)}>
              Cancel
            </Button>
            <Button type="button" className="font-display w-full sm:w-auto glow-green gap-2" onClick={handleApplyPicker}>
              <Lock className="h-3.5 w-3.5" /> Apply look
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Profile;
