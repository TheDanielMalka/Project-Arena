import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Bell, Shield, Globe, Trash2, Save, Lock, Volume2,
  AlertCircle, ChevronRight, Wallet, Gamepad2, User,
  Eye, EyeOff, CheckCircle2, SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { cn } from "@/lib/utils";

// ─── Nav sections ──────────────────────────────────────────────
const SECTIONS = [
  { id: "account",       icon: User,             label: "Account",       color: "text-arena-cyan"   },
  { id: "notifications", icon: Bell,             label: "Notifications", color: "text-arena-purple" },
  { id: "security",      icon: Shield,           label: "Security",      color: "text-arena-orange" },
  { id: "betting",       icon: Wallet,           label: "Betting",       color: "text-arena-gold"   },
  { id: "game",          icon: Gamepad2,         label: "Game",          color: "text-primary"      },
  { id: "display",       icon: Globe,            label: "Display",       color: "text-arena-purple" },
  { id: "danger",        icon: Trash2,           label: "Danger Zone",   color: "text-destructive"  },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

// ─── Row helpers ───────────────────────────────────────────────
const SettingRow = ({
  label, desc, children, last = false,
}: { label: string; desc?: string; children: React.ReactNode; last?: boolean }) => (
  <div className={cn("flex items-center justify-between py-3 gap-4", !last && "border-b border-border/50")}>
    <div className="min-w-0">
      <p className="text-sm font-medium leading-tight">{label}</p>
      {desc && <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{desc}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const SectionTitle = ({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) => (
  <div className="flex items-center gap-2 mb-4">
    <Icon className={cn("h-4 w-4", color)} />
    <h2 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">{label}</h2>
  </div>
);

// ─── Main component ────────────────────────────────────────────
const SettingsPage = () => {
  const { toast } = useToast();
  const { user } = useUserStore();
  const { platformBettingMax, dailyBettingLimit, dailyBettingUsed, setDailyBettingLimit } = useWalletStore();

  const [active, setActive] = useState<SectionId>("account");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [saved, setSaved] = useState(false);

  const [notifications, setNotifications] = useState({
    matchResults: true, payouts: true, systemAlerts: true, promotions: false, sounds: true,
  });
  const [security, setSecurity] = useState({
    twoFactor: false, loginAlerts: true, withdrawWhitelist: false,
  });
  const [preferences, setPreferences] = useState({
    language: "en", theme: "dark",
  });
  const [bettingLimit, setBettingLimitLocal] = useState(dailyBettingLimit);
  const [betting, setBetting] = useState({
    autoEscrow: true,
    confirmBets: true,
  });
  const [game, setGame] = useState({
    defaultGame: "CS2",
    showRegion: true,
    autoReady: false,
  });

  const handleSave = () => {
    setDailyBettingLimit(bettingLimit);
    setSaved(true);
    toast({ title: "Saved", description: "Your settings have been updated." });
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex gap-0 max-w-4xl min-h-[600px]">

      {/* ── Left nav ── */}
      <nav className="w-[56px] md:w-[180px] shrink-0 border-r border-border/60 pr-0 mr-0 flex flex-col gap-0.5 pt-1">
        {SECTIONS.map(({ id, icon: Icon, label, color }) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all w-full group",
              active === id
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              id === "danger" && active === id && "bg-destructive/10 text-destructive",
              id === "danger" && active !== id && "hover:text-destructive hover:bg-destructive/5",
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", active === id ? color : "")} />
            <span className="hidden md:block font-display text-xs font-medium">{label}</span>
            {active === id && <ChevronRight className="hidden md:block h-3 w-3 ml-auto opacity-50" />}
          </button>
        ))}
      </nav>

      {/* ── Right panel ── */}
      <div className="flex-1 pl-6 flex flex-col">
        <div className="flex-1">

          {/* ── ACCOUNT ── */}
          {active === "account" && (
            <div>
              <SectionTitle icon={User} label="Account" color="text-arena-cyan" />
              <div className="space-y-1">
                <SettingRow label="Username & Avatar" desc="Edit your display name and avatar in your Profile page">
                  <Link to="/profile" className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 font-display">
                    Go to Profile →
                  </Link>
                </SettingRow>
                <SettingRow label="Email" desc="Used for login & alerts">
                  <Input
                    defaultValue={user?.email ?? ""}
                    className="h-8 w-44 bg-secondary/60 border-border text-xs font-mono"
                    type="email"
                  />
                </SettingRow>
                <SettingRow label="Region" desc="Affects matchmaking pool" last>
                  <Select defaultValue="eu-west">
                    <SelectTrigger className="h-8 w-36 bg-secondary/60 border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eu-west">EU West</SelectItem>
                      <SelectItem value="us-east">US East</SelectItem>
                      <SelectItem value="us-west">US West</SelectItem>
                      <SelectItem value="asia">Asia</SelectItem>
                      <SelectItem value="me">Middle East</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </div>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {active === "notifications" && (
            <div>
              <SectionTitle icon={Bell} label="Notifications" color="text-arena-purple" />
              <div className="space-y-1">
                {([
                  { key: "matchResults", label: "Match Results",   desc: "Notify when matches end"          },
                  { key: "payouts",      label: "Payouts",         desc: "Deposits & withdrawals"           },
                  { key: "systemAlerts", label: "System Alerts",   desc: "Important platform updates"       },
                  { key: "promotions",   label: "Promotions",      desc: "Special offers and events"        },
                  { key: "sounds",       label: "Sound Effects",   desc: "Play sounds for notifications",   },
                ] as const).map((item, i, arr) => (
                  <SettingRow key={item.key} label={item.label} desc={item.desc} last={i === arr.length - 1}>
                    <Switch
                      checked={notifications[item.key]}
                      onCheckedChange={(v) => setNotifications((p) => ({ ...p, [item.key]: v }))}
                    />
                  </SettingRow>
                ))}
              </div>
            </div>
          )}

          {/* ── SECURITY ── */}
          {active === "security" && (
            <div>
              <SectionTitle icon={Shield} label="Security" color="text-arena-orange" />
              <div className="space-y-1">
                {([
                  { key: "twoFactor",        label: "Two-Factor Auth",       desc: "Extra layer of protection"             },
                  { key: "loginAlerts",       label: "Login Alerts",          desc: "Notify on new logins"                  },
                  { key: "withdrawWhitelist", label: "Withdrawal Whitelist",  desc: "Only allow saved addresses"            },
                ] as const).map((item) => (
                  <SettingRow key={item.key} label={item.label} desc={item.desc}>
                    <Switch
                      checked={security[item.key]}
                      onCheckedChange={(v) => setSecurity((p) => ({ ...p, [item.key]: v }))}
                    />
                  </SettingRow>
                ))}

                <div className="pt-3 mt-1">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2 font-display">Change Password</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <Input
                        type={showCurrentPw ? "text" : "password"}
                        placeholder="Current"
                        className="h-8 bg-secondary/60 border-border text-xs pr-8"
                      />
                      <button
                        onClick={() => setShowCurrentPw((p) => !p)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showCurrentPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="relative">
                      <Input
                        type={showNewPw ? "text" : "password"}
                        placeholder="New password"
                        className="h-8 bg-secondary/60 border-border text-xs pr-8"
                      />
                      <button
                        onClick={() => setShowNewPw((p) => !p)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showNewPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="mt-2 h-7 text-xs font-display border-border">
                    <Lock className="mr-1.5 h-3 w-3" /> Update Password
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── BETTING ── */}
          {active === "betting" && (
            <div>
              <SectionTitle icon={Wallet} label="Betting" color="text-arena-gold" />
              <div className="space-y-1">
                <SettingRow label="Daily Betting Limit" desc={`Used today: $${dailyBettingUsed} · Platform max: $${platformBettingMax}`}>
                  <div className="flex items-center gap-3 w-48">
                    <Slider
                      min={50} max={platformBettingMax} step={50}
                      value={[bettingLimit]}
                      onValueChange={([v]) => setBettingLimitLocal(v)}
                      className="flex-1"
                    />
                    <span className="text-xs font-mono text-arena-gold w-12 text-right">${bettingLimit}</span>
                  </div>
                </SettingRow>
                <SettingRow label="Auto Escrow" desc="Lock funds automatically when joining a match">
                  <Switch
                    checked={betting.autoEscrow}
                    onCheckedChange={(v) => setBetting((p) => ({ ...p, autoEscrow: v }))}
                  />
                </SettingRow>
                <SettingRow label="Confirm Bets" desc="Show confirmation dialog before each match" last>
                  <Switch
                    checked={betting.confirmBets}
                    onCheckedChange={(v) => setBetting((p) => ({ ...p, confirmBets: v }))}
                  />
                </SettingRow>

              </div>

              <div className="mt-4 p-3 rounded-lg border border-arena-gold/20 bg-arena-gold/5 text-[11px] text-muted-foreground leading-relaxed">
                <span className="text-arena-gold font-medium">Note: </span>
                Arena never holds your funds. All bets go directly into a smart contract escrow and are released to the winner instantly.
              </div>
            </div>
          )}

          {/* ── GAME ── */}
          {active === "game" && (
            <div>
              <SectionTitle icon={Gamepad2} label="Game Preferences" color="text-primary" />
              <div className="space-y-1">
                <SettingRow label="Default Game" desc="Pre-selected when creating a match">
                  <Select value={game.defaultGame} onValueChange={(v) => setGame((p) => ({ ...p, defaultGame: v }))}>
                    <SelectTrigger className="h-8 w-36 bg-secondary/60 border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["CS2","Valorant","Fortnite","Apex Legends","COD","PUBG","League of Legends"].map((g) => (
                        <SelectItem key={g} value={g}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Show Region Badge" desc="Display your region in match listings">
                  <Switch
                    checked={game.showRegion}
                    onCheckedChange={(v) => setGame((p) => ({ ...p, showRegion: v }))}
                  />
                </SettingRow>
                <SettingRow label="Auto-Ready" desc="Automatically ready up when match starts" last>
                  <Switch
                    checked={game.autoReady}
                    onCheckedChange={(v) => setGame((p) => ({ ...p, autoReady: v }))}
                  />
                </SettingRow>
              </div>
            </div>
          )}

          {/* ── DISPLAY ── */}
          {active === "display" && (
            <div>
              <SectionTitle icon={Globe} label="Display" color="text-arena-purple" />
              <div className="space-y-1">
                <SettingRow label="Language" desc="Interface language">
                  <Select value={preferences.language} onValueChange={(v) => setPreferences((p) => ({ ...p, language: v }))}>
                    <SelectTrigger className="h-8 w-36 bg-secondary/60 border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="he">עברית</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="ru">Русский</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Theme" desc="Color scheme" last>
                  <Select value={preferences.theme} onValueChange={(v) => setPreferences((p) => ({ ...p, theme: v }))}>
                    <SelectTrigger className="h-8 w-36 bg-secondary/60 border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </div>
            </div>
          )}

          {/* ── DANGER ── */}
          {active === "danger" && (
            <div>
              <SectionTitle icon={Trash2} label="Danger Zone" color="text-destructive" />
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Once you delete your account, there is no going back. All data will be permanently removed and smart contract history will remain on-chain.
              </p>

              {!showDeleteConfirm ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="font-display text-xs"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete Account
                </Button>
              ) : (
                <div className="space-y-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2 text-destructive text-xs">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Type <span className="font-mono font-bold">{user?.username ?? "your username"}</span> to confirm</span>
                  </div>
                  <Input
                    placeholder="Enter your username..."
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    className="h-8 bg-secondary border-border font-mono text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="font-display text-xs"
                      disabled={deleteConfirmName !== (user?.username ?? "")}
                      onClick={() => {
                        toast({ title: "Account Deleted", description: "Your account has been permanently removed.", variant: "destructive" });
                        setShowDeleteConfirm(false);
                        setDeleteConfirmName("");
                      }}
                    >
                      Confirm Delete
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="text-muted-foreground text-xs"
                      onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(""); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Save bar ── */}
        {active !== "danger" && (
          <div className="flex justify-end pt-4 mt-4 border-t border-border/50">
            <Button
              onClick={handleSave}
              size="sm"
              className={cn("font-display text-xs transition-all", saved ? "bg-primary/80" : "glow-green")}
            >
              {saved
                ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Saved</>
                : <><Save className="mr-1.5 h-3.5 w-3.5" /> Save Changes</>
              }
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
