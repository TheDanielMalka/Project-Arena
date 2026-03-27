import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  User, Shield, Gamepad2, Wallet, Link2, CheckCircle, XCircle,
  Copy, ExternalLink, Edit2, Save, Trophy, TrendingUp, Zap, Smartphone, Monitor, X,
  Camera, Lock, Upload, Star, Crown, Medal, Gem, Sparkles,
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
import { useNotificationStore } from "@/stores/notificationStore";
import { useToast } from "@/hooks/use-toast";
import { getXpInfo } from "@/lib/xp";

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
  const [avatarTab, setAvatarTab]               = useState<"free" | "event" | "premium" | "upload">("free");
  const [uploadedAvatar, setUploadedAvatar]     = useState<string | null>(user?.avatar?.startsWith("upload:") ? user.avatar.slice(7) : null);
  const [selectedBg, setSelectedBg]             = useState<string>(user?.avatarBg ?? "default");
  const [bgTab, setBgTab]                       = useState<"free" | "event" | "premium">("free");

  // ── Avatar options ──
  const FREE_AVATARS   = ["🎮","💀","🔥","⚡","🎯","👾","🐺","🦁","🐉","🤖"];
  const EVENT_AVATARS  = [
    { emoji: "🌟", label: "Season 1 Champion", unlocked: false },
    { emoji: "🎃", label: "Halloween 2025",    unlocked: false },
    { emoji: "❄️", label: "Winter Cup 2025",   unlocked: false },
    { emoji: "🏆", label: "Tournament Winner", unlocked: true  },
  ];
  const PREMIUM_AVATARS = [
    { emoji: "👑", label: "King",    price: "$2.99" },
    { emoji: "💎", label: "Diamond", price: "$1.99" },
    { emoji: "🦅", label: "Eagle",   price: "$1.99" },
    { emoji: "🏹", label: "Hunter",  price: "$2.99" },
  ];

  // ── Background options ──
  type BgDef = { id: string; label: string; border: string; shadow: string; preview: string; pulse?: boolean; locked?: boolean; eventName?: string; price?: string };
  const BG_FREE: BgDef[] = [
    { id: "default",  label: "Default", border: "border-primary/50",      shadow: "shadow-[0_0_16px_hsl(355_78%_52%/0.25)]",  preview: "#EF4444" },
    { id: "blue",     label: "Blue",    border: "border-blue-500/60",      shadow: "shadow-[0_0_16px_rgba(59,130,246,0.35)]",   preview: "#3B82F6" },
    { id: "purple",   label: "Purple",  border: "border-purple-500/60",    shadow: "shadow-[0_0_16px_rgba(168,85,247,0.35)]",   preview: "#A855F7" },
    { id: "cyan",     label: "Cyan",    border: "border-cyan-400/60",      shadow: "shadow-[0_0_16px_rgba(34,211,238,0.35)]",   preview: "#22D3EE" },
    { id: "green",    label: "Green",   border: "border-green-500/60",     shadow: "shadow-[0_0_16px_rgba(34,197,94,0.35)]",    preview: "#22C55E" },
    { id: "orange",   label: "Orange",  border: "border-orange-500/60",    shadow: "shadow-[0_0_16px_rgba(249,115,22,0.35)]",   preview: "#F97316" },
  ];
  const BG_EVENT: BgDef[] = [
    { id: "fire",     label: "🔥 Fire",     border: "border-orange-500/90", shadow: "shadow-[0_0_24px_rgba(249,115,22,0.7)]",  preview: "#F97316", pulse: true,  locked: true,  eventName: "Summer Blaze 2025" },
    { id: "ice",      label: "❄️ Ice",      border: "border-cyan-300/90",   shadow: "shadow-[0_0_24px_rgba(125,211,252,0.7)]", preview: "#7DD3FC", pulse: true,  locked: false, eventName: "Winter Cup 2025" },
    { id: "electric", label: "⚡ Electric", border: "border-yellow-400/90", shadow: "shadow-[0_0_24px_rgba(250,204,21,0.7)]",  preview: "#FACC15", pulse: true,  locked: true,  eventName: "Arena Open S2" },
    { id: "void",     label: "🌑 Void",     border: "border-violet-600/90", shadow: "shadow-[0_0_24px_rgba(124,58,237,0.7)]",  preview: "#7C3AED", pulse: true,  locked: true,  eventName: "Dark Tournament" },
  ];
  const BG_PREMIUM: BgDef[] = [
    { id: "gold",    label: "👑 Gold",    border: "border-yellow-400/90", shadow: "shadow-[0_0_28px_rgba(234,179,8,0.8)]",    preview: "#EAB308", pulse: true, price: "$1.99" },
    { id: "rainbow", label: "🌈 Rainbow", border: "border-pink-500/80",   shadow: "shadow-[0_0_24px_rgba(236,72,153,0.6)]",   preview: "#EC4899", pulse: true, price: "$2.99" },
    { id: "aurora",  label: "🌌 Aurora",  border: "border-emerald-400/80",shadow: "shadow-[0_0_24px_rgba(52,211,153,0.6)]",   preview: "#34D399", pulse: true, price: "$2.99" },
    { id: "lava",    label: "🌋 Lava",    border: "border-red-600/90",    shadow: "shadow-[0_0_28px_rgba(220,38,38,0.8)]",    preview: "#DC2626", pulse: true, price: "$1.99" },
  ];

  const allBgs = [...BG_FREE, ...BG_EVENT, ...BG_PREMIUM];
  const getBg = (id: string): BgDef => allBgs.find(b => b.id === id) ?? BG_FREE[0];

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setUploadedAvatar(result);
      setSelectedAvatar("upload:" + result);
      setShowAvatarPicker(false);
    };
    reader.readAsDataURL(file);
  };

  const renderAvatarContent = (avatar: string, size: "sm" | "lg" = "lg") => {
    const textSize  = size === "lg" ? "text-xl" : "text-sm";
    const emojiSize = size === "lg" ? "text-2xl" : "text-base";
    if (avatar === "initials") return <span className={`font-display ${textSize} font-bold text-primary`}>{username.slice(0,2).toUpperCase()}</span>;
    if (avatar.startsWith("upload:")) return <img src={avatar.slice(7)} className="w-full h-full object-cover rounded-full" alt="avatar" />;
    return <span className={emojiSize}>{avatar}</span>;
  };
  const [steamId, setSteamId] = useState(user?.steamId ?? "76561198XXXXXXXX");
  const [copiedWallet, setCopiedWallet] = useState(false);

  // Link dialog state
  const [linkDialog, setLinkDialog] = useState<{ name: string; type: "game" | "service"; platform?: "pc" | "mobile"; placeholder?: string } | null>(null);
  const [linkAccountId, setLinkAccountId] = useState("");

  // Local state for game connections (togglable)
  const [gameConnections, setGameConnections] = useState<GameConnection[]>([
    { name: "CS2", platform: "pc", status: "connected", accountId: "76561198XXXXXXXX" },
    { name: "Valorant", platform: "pc", status: "connected", accountId: "Player#TAG1" },
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

  const connectedGames = gameConnections.filter(g => g.status === "connected");
  const [activeGameTab, setActiveGameTab] = useState<string>(connectedGames[0]?.name ?? "CS2");

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
      // service connection
      const key = name.toLowerCase() as "discord" | "faceit";
      setServiceConnections((prev) => ({ ...prev, [key]: accountId }));
    }

    toast({ title: `${name} Connected!`, description: `Linked as ${accountId}` });
    addNotification({ type: "system", title: `✅ ${name} Linked`, message: `Successfully connected your ${name} account (${accountId}).` });
    setLinkDialog(null);
    setLinkAccountId("");
  };

  const handleDisconnectService = (service: "discord" | "faceit") => {
    const label = service === "discord" ? "Discord" : "FACEIT";
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
                  className={`group w-16 h-16 rounded-full bg-secondary border-2 ${getBg(selectedBg).border} ${getBg(selectedBg).shadow} ${getBg(selectedBg).pulse ? "animate-pulse" : ""} flex items-center justify-center overflow-hidden relative transition-all`}
                >
                  {renderAvatarContent(selectedAvatar)}
                  <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="h-5 w-5 text-white" />
                  </div>
                </button>
              ) : (
                <div
                  className={`w-16 h-16 rounded-full bg-secondary border-2 ${getBg(selectedBg).border} ${getBg(selectedBg).shadow} ${getBg(selectedBg).pulse ? "animate-pulse" : ""} flex items-center justify-center overflow-hidden relative`}
                >
                  {renderAvatarContent(selectedAvatar)}
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
            {connectedGames.map((game) => {
              const cfg = gameConfig[game.name] ?? { abbr: game.name.slice(0,2).toUpperCase(), color: "#888", bg: "rgba(136,136,136,0.1)" };
              const isActive = activeGameTab === game.name;
              return (
                <button
                  key={game.name}
                  onClick={() => setActiveGameTab(game.name)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-display font-semibold transition-all"
                  style={{
                    background: isActive ? cfg.bg : "transparent",
                    border: `1px solid ${isActive ? cfg.color + "60" : "rgba(255,255,255,0.06)"}`,
                    color: isActive ? cfg.color : "var(--muted-foreground)",
                  }}
                >
                  <div className="w-4 h-4 rounded overflow-hidden flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg }}>
                    {cfg.img
                      ? <img src={cfg.img} alt={game.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {connections.map((conn) => (
              <div
                key={conn.name}
                className="relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg bg-secondary/40 border border-border/50 hover:border-primary/20 transition-all group"
              >
                {/* Status dot */}
                <div className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${conn.status === "connected" ? "bg-primary" : "bg-muted-foreground/30"}`} />

                {conn.img ? (
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: conn.imgBg }}>
                    <img
                      src={conn.img}
                      alt={conn.name}
                      className="w-5 h-5 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement!.innerHTML = `<span class="${conn.status === "connected" ? conn.color : "text-muted-foreground/50"}">${conn.name.slice(0,2)}</span>`;
                      }}
                    />
                  </div>
                ) : (
                  <conn.icon className={`h-5 w-5 ${conn.status === "connected" ? conn.color : "text-muted-foreground/50"}`} />
                )}
                <span className="font-display text-xs font-semibold tracking-wide">{conn.name}</span>

                {conn.status === "connected" ? (
                  <div className="flex flex-col items-center gap-1 w-full">
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full px-1 text-center">{conn.detail}</span>
                    <div className="flex gap-1 w-full">
                      {conn.name === "Wallet" && (
                        <button onClick={handleCopyWallet} className="flex-1 text-[10px] py-0.5 rounded bg-secondary hover:bg-secondary/80 text-muted-foreground transition-colors">
                          {copiedWallet ? "✓" : <Copy className="h-2.5 w-2.5 mx-auto" />}
                        </button>
                      )}
                      {"onDisconnect" in conn && conn.onDisconnect && (
                        <button onClick={conn.onDisconnect as () => void} className="flex-1 text-[10px] py-0.5 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={"onConnect" in conn && conn.onConnect ? conn.onConnect as () => void : undefined}
                    className={`text-[10px] font-display px-3 py-0.5 rounded border ${conn.borderColor} ${conn.color} hover:opacity-80 transition-opacity`}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {gameConnections.filter(g => g.platform === "pc").map((game) => {
              const cfg = gameConfig[game.name] ?? { abbr: game.name.slice(0,2).toUpperCase(), color: "#888", bg: "rgba(136,136,136,0.1)" };
              return (
                <div key={game.name} className="relative flex flex-col items-center gap-1.5 p-3 rounded-lg bg-secondary/40 border border-border/50 hover:border-primary/20 transition-all">
                  {/* status dot */}
                  <div className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${game.status === "connected" ? "bg-primary" : "bg-muted-foreground/30"}`} />
                  {/* game badge */}
                  <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center font-display font-bold text-xs" style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
                    {cfg.img
                      ? <img src={cfg.img} alt={game.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<span style="color:${cfg.color};font-size:10px;font-weight:700">${cfg.abbr}</span>`; }} />
                      : <span style={{ color: cfg.color }}>{cfg.abbr}</span>
                    }
                  </div>
                  <span className="font-display text-xs font-semibold text-center leading-tight">{game.name}</span>
                  {game.status === "connected" && (
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full px-1 text-center">{game.accountId}</span>
                  )}
                  {game.status === "connected" ? (
                    <button onClick={() => handleUnlinkGame(game.name)} className="text-[10px] font-display px-2 py-0.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors">
                      Unlink
                    </button>
                  ) : (
                    <button onClick={() => handleOpenLinkDialog(game.name, "game", game.platform)} className="text-[10px] font-display px-2 py-0.5 rounded border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">
                      Link
                    </button>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {gameConnections.filter(g => g.platform === "mobile").map((game) => {
              const cfg = gameConfig[game.name] ?? { abbr: game.name.slice(0,2).toUpperCase(), color: "#888", bg: "rgba(136,136,136,0.1)" };
              return (
                <div key={game.name} className="relative flex flex-col items-center gap-1.5 p-3 rounded-lg bg-secondary/40 border border-border/50 hover:border-primary/20 transition-all">
                  <div className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${game.status === "connected" ? "bg-primary" : "bg-muted-foreground/30"}`} />
                  <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center font-display font-bold text-xs" style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
                    {cfg.img
                      ? <img src={cfg.img} alt={game.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<span style="color:${cfg.color};font-size:10px;font-weight:700">${cfg.abbr}</span>`; }} />
                      : <span style={{ color: cfg.color }}>{cfg.abbr}</span>
                    }
                  </div>
                  <span className="font-display text-xs font-semibold text-center leading-tight">{game.name}</span>
                  {game.status === "connected" && (
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full px-1 text-center">{game.accountId}</span>
                  )}
                  {game.status === "connected" ? (
                    <button onClick={() => handleUnlinkGame(game.name)} className="text-[10px] font-display px-2 py-0.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors">
                      Unlink
                    </button>
                  ) : (
                    <button onClick={() => handleOpenLinkDialog(game.name, "game", game.platform)} className="text-[10px] font-display px-2 py-0.5 rounded border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">
                      Link
                    </button>
                  )}
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
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" /> Choose Avatar
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Select an avatar, unlock event rewards, or upload your own.
            </DialogDescription>
          </DialogHeader>

          {/* Preview */}
          <div className="flex justify-center mb-3">
            <div className={`w-16 h-16 rounded-full bg-secondary border-2 ${getBg(selectedBg).border} ${getBg(selectedBg).shadow} ${getBg(selectedBg).pulse ? "animate-pulse" : ""} flex items-center justify-center overflow-hidden`}>
              {renderAvatarContent(selectedAvatar)}
            </div>
          </div>

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
              {(["free","event","premium","upload"] as const).map((tab) => (
                <button key={tab} onClick={() => setAvatarTab(tab)}
                  className={`flex-1 text-[10px] font-display uppercase tracking-widest py-1.5 rounded-md transition-all ${
                    avatarTab === tab ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>
                  {tab === "free" ? "Free" : tab === "event" ? "Event" : tab === "premium" ? "Premium" : "Upload"}
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
          {/* FREE */}
          {pickerMode === "avatar" && avatarTab === "free" && (
            <div className="grid grid-cols-5 gap-2">
              {/* Initials option */}
              <button
                onClick={() => { setSelectedAvatar("initials"); setShowAvatarPicker(false); }}
                className={`h-12 rounded-lg border text-[10px] font-display font-bold transition-all ${
                  selectedAvatar === "initials" ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"
                }`}
              >
                {username.slice(0,2).toUpperCase()}
              </button>
              {FREE_AVATARS.map((emoji) => (
                <button key={emoji}
                  onClick={() => { setSelectedAvatar(emoji); setShowAvatarPicker(false); }}
                  className={`h-12 rounded-lg border text-2xl transition-all flex items-center justify-center ${
                    selectedAvatar === emoji ? "border-primary bg-primary/10" : "border-border hover:border-primary/40 bg-secondary/30"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* EVENT */}
          {pickerMode === "avatar" && avatarTab === "event" && (
            <div className="grid grid-cols-2 gap-2">
              {EVENT_AVATARS.map(({ emoji, label, unlocked }) => (
                <button key={label}
                  onClick={() => { if (unlocked) { setSelectedAvatar(emoji); setShowAvatarPicker(false); } }}
                  className={`relative flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    unlocked ? "border-arena-gold/40 bg-arena-gold/5 hover:bg-arena-gold/10 cursor-pointer" : "border-border bg-secondary/20 cursor-not-allowed opacity-60"
                  }`}
                >
                  <span className="text-2xl">{emoji}</span>
                  <div className="text-left">
                    <p className="text-xs font-display font-semibold">{label}</p>
                    {unlocked
                      ? <p className="text-[10px] text-arena-gold flex items-center gap-1"><Star className="h-2.5 w-2.5" /> Unlocked</p>
                      : <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Lock className="h-2.5 w-2.5" /> Complete event</p>
                    }
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* PREMIUM */}
          {pickerMode === "avatar" && avatarTab === "premium" && (
            <div className="grid grid-cols-2 gap-2">
              {PREMIUM_AVATARS.map(({ emoji, label, price }) => (
                <button key={label}
                  className="relative flex items-center gap-3 p-3 rounded-lg border border-arena-purple/30 bg-arena-purple/5 hover:bg-arena-purple/10 transition-all cursor-pointer"
                  onClick={() => toast({ title: "Coming Soon", description: "Premium avatars will be available in the shop.", variant: "default" })}
                >
                  <span className="text-2xl">{emoji}</span>
                  <div className="text-left">
                    <p className="text-xs font-display font-semibold">{label}</p>
                    <p className="text-[10px] text-arena-purple flex items-center gap-1">
                      <Crown className="h-2.5 w-2.5" /> {price}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* UPLOAD */}
          {pickerMode === "avatar" && avatarTab === "upload" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-14 h-14 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                <Upload className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground text-center">JPG, PNG or GIF · Max 2MB</p>
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/40 text-primary text-xs font-display hover:bg-primary/10 transition-colors">
                  <Upload className="h-3.5 w-3.5" /> Browse File
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </label>
              {uploadedAvatar && (
                <button onClick={() => { setSelectedAvatar("upload:" + uploadedAvatar); setShowAvatarPicker(false); }}
                  className="text-[10px] font-display text-primary hover:underline">
                  Use last uploaded image
                </button>
              )}
            </div>
          )}

          {/* ══ BACKGROUND CONTENT ══ */}
          {/* BG FREE */}
          {pickerMode === "background" && bgTab === "free" && (
            <div className="grid grid-cols-3 gap-2">
              {BG_FREE.map((bg) => (
                <button key={bg.id} onClick={() => { setSelectedBg(bg.id); }}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all ${
                    selectedBg === bg.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/30 bg-secondary/20"
                  }`}
                >
                  <div className="w-6 h-6 rounded-full border-2 shrink-0" style={{ borderColor: bg.preview, boxShadow: `0 0 8px ${bg.preview}60` }} />
                  <span className="text-[11px] font-display font-semibold">{bg.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* BG EVENT */}
          {pickerMode === "background" && bgTab === "event" && (
            <div className="grid grid-cols-2 gap-2">
              {BG_EVENT.map((bg) => (
                <button key={bg.id}
                  onClick={() => { if (!bg.locked) setSelectedBg(bg.id); }}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    bg.locked
                      ? "border-border bg-secondary/20 cursor-not-allowed opacity-60"
                      : selectedBg === bg.id
                        ? "border-primary bg-primary/10 cursor-pointer"
                        : "border-arena-gold/30 bg-arena-gold/5 hover:bg-arena-gold/10 cursor-pointer"
                  }`}
                >
                  <div className={`w-7 h-7 rounded-full border-2 shrink-0 ${bg.pulse ? "animate-pulse" : ""}`}
                    style={{ borderColor: bg.preview, boxShadow: `0 0 12px ${bg.preview}80` }} />
                  <div className="text-left min-w-0">
                    <p className="text-[11px] font-display font-semibold truncate">{bg.label}</p>
                    {bg.locked
                      ? <p className="text-[9px] text-muted-foreground flex items-center gap-1"><Lock className="h-2.5 w-2.5" /> {bg.eventName}</p>
                      : <p className="text-[9px] text-arena-gold flex items-center gap-1"><Star className="h-2.5 w-2.5" /> {bg.eventName}</p>
                    }
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* BG PREMIUM */}
          {pickerMode === "background" && bgTab === "premium" && (
            <div className="grid grid-cols-2 gap-2">
              {BG_PREMIUM.map((bg) => (
                <button key={bg.id}
                  onClick={() => toast({ title: "Coming Soon", description: "Premium backgrounds will be available in the shop." })}
                  className="flex items-center gap-3 p-3 rounded-lg border border-arena-purple/30 bg-arena-purple/5 hover:bg-arena-purple/10 transition-all cursor-pointer"
                >
                  <div className={`w-7 h-7 rounded-full border-2 shrink-0 animate-pulse`}
                    style={{ borderColor: bg.preview, boxShadow: `0 0 14px ${bg.preview}90` }} />
                  <div className="text-left">
                    <p className="text-[11px] font-display font-semibold">{bg.label}</p>
                    <p className="text-[9px] text-arena-purple flex items-center gap-1">
                      <Crown className="h-2.5 w-2.5" /> {bg.price}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Profile;
