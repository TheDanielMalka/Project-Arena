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

      {/* Player Info */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <User className="h-5 w-5 text-primary" /> Player Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Username</span>
            {editMode ? (
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="max-w-[200px] bg-secondary border-border text-right"
              />
            ) : (
              <span className="font-medium">{username}</span>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Steam ID</span>
            {editMode ? (
              <Input
                value={steamId}
                onChange={(e) => setSteamId(e.target.value)}
                className="max-w-[200px] bg-secondary border-border font-mono text-sm text-right"
              />
            ) : (
              <span className="font-mono text-sm">{steamId}</span>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Rank</span>
            <Badge className="bg-arena-gold/20 text-arena-gold border-arena-gold/30">Gold III</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Verification</span>
            <Badge variant="default" className="flex items-center gap-1">
              <Shield className="h-3 w-3" /> Verified
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Preferred Game</span>
            <span className="flex items-center gap-1">
              <Gamepad2 className="h-4 w-4 text-arena-cyan" /> CS2
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Member Since</span>
            <span className="text-sm">March 2026</span>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <Trophy className="h-5 w-5 text-arena-gold mx-auto mb-1" />
            <p className="font-display text-xl font-bold">{user?.stats.matches ?? 0}</p>
            <p className="text-xs text-muted-foreground">Matches</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="font-display text-xl font-bold">{user?.stats.winRate ?? 0}%</p>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <Zap className="h-5 w-5 text-arena-orange mx-auto mb-1" />
            <p className="font-display text-xl font-bold">${user?.stats.totalEarnings?.toLocaleString() ?? "0"}</p>
            <p className="text-xs text-muted-foreground">Earnings</p>
          </CardContent>
        </Card>
      </div>

      {/* Connections */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Link2 className="h-5 w-5 text-arena-purple" /> Connections
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {connections.map((conn) => (
            <div
              key={conn.name}
              className={`flex items-center justify-between p-3 rounded-lg border ${conn.borderColor} ${conn.bgColor}`}
            >
              <div className="flex items-center gap-3">
                <conn.icon className={`h-5 w-5 ${conn.color}`} />
                <div>
                  <p className="font-medium text-sm">{conn.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    {conn.status === "connected" ? (
                      <>
                        <CheckCircle className="h-3 w-3 text-primary" />
                        <span className="font-mono">{conn.detail}</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 text-muted-foreground" />
                        {conn.detail}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {conn.status === "connected" && conn.name === "Wallet" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCopyWallet}
                    className="h-8 px-2 text-xs"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    {copiedWallet ? "Copied!" : "Copy"}
                  </Button>
                )}
                {conn.status === "connected" ? (
                  "onDisconnect" in conn && conn.onDisconnect ? (
                    <Button size="sm" variant="outline" onClick={conn.onDisconnect as () => void} className="font-display text-xs border-destructive/30 text-destructive hover:bg-destructive/10">
                      Disconnect
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                      Connected
                    </Badge>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className={`font-display text-xs ${conn.borderColor} ${conn.color}`}
                    onClick={"onConnect" in conn && conn.onConnect ? conn.onConnect as () => void : undefined}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" /> Connect
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Game Connections - PC */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Monitor className="h-5 w-5 text-arena-cyan" /> PC Games
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {gameConnections.filter(g => g.platform === "pc").map((game) => (
              <div
                key={game.name}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Gamepad2 className="h-4 w-4 text-arena-cyan" />
                  <div>
                    <p className="font-medium text-sm">{game.name}</p>
                    {game.status === "connected" && (
                      <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-primary" /> {game.accountId}
                      </p>
                    )}
                  </div>
                </div>
                {game.status === "connected" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUnlinkGame(game.name)}
                    className="font-display text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                  >
                    Unlink
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenLinkDialog(game.name, "game", game.platform)}
                    className="font-display text-xs border-border hover:border-primary/50"
                  >
                    <Link2 className="h-3 w-3 mr-1" /> Link
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Game Connections - Mobile */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-arena-orange" /> Mobile Games
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {gameConnections.filter(g => g.platform === "mobile").map((game) => (
              <div
                key={game.name}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-arena-orange" />
                  <div>
                    <p className="font-medium text-sm">{game.name}</p>
                    {game.status === "connected" && (
                      <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-primary" /> {game.accountId}
                      </p>
                    )}
                  </div>
                </div>
                {game.status === "connected" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUnlinkGame(game.name)}
                    className="font-display text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                  >
                    Unlink
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenLinkDialog(game.name, "game", game.platform)}
                    className="font-display text-xs border-border hover:border-primary/50"
                  >
                    <Link2 className="h-3 w-3 mr-1" /> Link
                  </Button>
                )}
              </div>
            ))}
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
