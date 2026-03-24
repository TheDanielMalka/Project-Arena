import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  User, Shield, Gamepad2, Wallet, Link2, CheckCircle, XCircle,
  Copy, ExternalLink, Edit2, Save, Trophy, TrendingUp, Zap, Smartphone, Monitor, X
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

type GameConnection = {
  name: string;
  platform: "pc" | "mobile";
  status: "connected" | "disconnected";
  accountId?: string;
};

const Profile = () => {
  const { user } = useUserStore();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [username, setUsername] = useState(user?.username ?? "ArenaPlayer_01");
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
    { name: "Arena of Valor", platform: "mobile", status: "disconnected" },
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
    "Fortnite":         { abbr: "FN",   color: "#38BDF8", bg: "rgba(56,189,248,0.12)",  img: "https://cdn.cloudflare.steamstatic.com/steam/apps/1172620/capsule_sm_120.jpg" },
    "FIFA / EA FC":     { abbr: "FC",   color: "#22C55E", bg: "rgba(34,197,94,0.12)",   img: "https://cdn.cloudflare.steamstatic.com/steam/apps/2195250/capsule_sm_120.jpg" },
    "PES / eFootball":  { abbr: "PES",  color: "#3B82F6", bg: "rgba(59,130,246,0.12)",  img: "https://cdn.cloudflare.steamstatic.com/steam/apps/1665460/capsule_sm_120.jpg" },
    "Arena of Valor":   { abbr: "AoV",  color: "#A855F7", bg: "rgba(168,85,247,0.12)" },
    "MLBB":             { abbr: "ML",   color: "#EF4444", bg: "rgba(239,68,68,0.12)"  },
    "Wild Rift":        { abbr: "WR",   color: "#6366F1", bg: "rgba(99,102,241,0.12)" },
    "COD Mobile":       { abbr: "COD",  color: "#84CC16", bg: "rgba(132,204,22,0.12)" },
    "PUBG Mobile":      { abbr: "PUBG", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
    "Fortnite Mobile":  { abbr: "FN",   color: "#38BDF8", bg: "rgba(56,189,248,0.12)" },
  };

  const addNotification = useNotificationStore((s) => s.addNotification);

  const handleCopyWallet = () => {
    navigator.clipboard.writeText("0x1a2B3c4D5e6F7g8H9iJkLmNoPqRsT9fE4");
    setCopiedWallet(true);
    addNotification({ type: "system", title: "📋 Wallet Copied", message: "Your wallet address was copied to clipboard." });
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  const handleSaveProfile = () => {
    setEditMode(false);
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
      status: "connected" as const,
      detail: steamId,
      color: "text-arena-cyan",
      borderColor: "border-arena-cyan/30",
      bgColor: "bg-arena-cyan/5",
    },
    {
      name: "Wallet",
      icon: Wallet,
      status: "connected" as const,
      detail: walletAddress,
      color: "text-primary",
      borderColor: "border-primary/30",
      bgColor: "bg-primary/5",
    },
    {
      name: "Discord",
      icon: Link2,
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
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide">Profile</h1>
          <p className="text-muted-foreground mt-1">Manage your account & connections</p>
        </div>
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
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-full bg-secondary border-2 border-primary/50 flex items-center justify-center shadow-[0_0_16px_hsl(355_78%_52%/0.25)]">
                <span className="font-display text-xl font-bold text-primary">
                  {username.slice(0, 2).toUpperCase()}
                </span>
              </div>
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
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-arena-gold/15 text-arena-gold border border-arena-gold/30 font-display text-xs px-2">
                  <Trophy className="h-3 w-3 mr-1" /> Gold III
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Gamepad2 className="h-3 w-3" /> CS2
                </span>
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

                <conn.icon className={`h-5 w-5 ${conn.status === "connected" ? conn.color : "text-muted-foreground/50"}`} />
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
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-display font-bold text-xs" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
                    {cfg.abbr}
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

      {/* Wallet Details */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-display flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" /> Wallet
            </CardTitle>
            <Button size="sm" variant="outline" className="border-primary/30 text-primary hover:bg-primary/10 font-display text-xs" onClick={() => navigate("/wallet")}>
              Open Wallet →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Address</span>
            <span className="font-mono text-sm">{user?.walletShort ?? walletAddress}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Balance</span>
            <span className="font-display text-lg font-bold text-primary">
              ${user?.balance.available.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "0.00"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">In Escrow</span>
            <span className="font-display text-arena-gold">
              ${user?.balance.inEscrow.toFixed(2) ?? "0.00"}
            </span>
          </div>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1 glow-green font-display" size="sm" onClick={() => navigate("/wallet")}>
              Deposit
            </Button>
            <Button variant="outline" className="flex-1 font-display border-border" size="sm" onClick={() => navigate("/wallet")}>
              Withdraw
            </Button>
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
    </div>
  );
};

export default Profile;
