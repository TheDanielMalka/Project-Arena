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
  Eye, EyeOff, CheckCircle2, SlidersHorizontal, ShieldAlert, Check, X,
  Smartphone, Copy, RefreshCw, KeyRound, ShieldCheck, ShieldOff, Mail,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { cn } from "@/lib/utils";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/passwordValidation";

// ─── Nav sections ──────────────────────────────────────────────
const SECTIONS = [
  { id: "account",       icon: User,             label: "Account",       color: "text-arena-cyan"   },
  { id: "notifications", icon: Bell,             label: "Notifications", color: "text-arena-purple" },
  { id: "security",      icon: Shield,           label: "Security",      color: "text-arena-orange" },
  { id: "betting",       icon: Wallet,           label: "Betting",       color: "text-arena-gold"   },
  { id: "game",          icon: Gamepad2,         label: "Game",          color: "text-primary"      },
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
  const { user, greetingType } = useUserStore();
  // Google users cannot change email — managed by Google OAuth
  const isGoogleAccount = greetingType === "google";
  const { platformBettingMax, dailyBettingLimit, dailyBettingUsed, setDailyBettingLimit } = useWalletStore();

  const [active, setActive] = useState<SectionId>("account");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwConfirmOpen, setPwConfirmOpen] = useState(false);
  const [pwUpdated, setPwUpdated] = useState(false);

  // ── Email change flow ──────────────────────────────────────────
  // Step 1 "verify"  → user enters password to prove identity
  // Step 2 "change"  → user enters new email + confirms
  // DB-ready: POST /api/auth/verify-password { password }
  //           PATCH /api/users/me { email: newEmail } — re-sends verification link
  type EmailStep = "idle" | "verify" | "change";
  const [emailStep, setEmailStep]       = useState<EmailStep>("idle");
  const [emailPw, setEmailPw]           = useState("");
  const [emailPwError, setEmailPwError] = useState("");
  const [newEmail, setNewEmail]         = useState("");
  const [emailUpdated, setEmailUpdated] = useState(false);
  const [showEmailPw, setShowEmailPw]   = useState(false);

  const handleEmailVerify = () => {
    if (!emailPw) { setEmailPwError("Please enter your password."); return; }
    // DB-ready: POST /api/auth/verify-password { password: emailPw }
    setEmailPwError("");
    setNewEmail(user?.email ?? "");
    setEmailStep("change");
  };

  const handleEmailUpdate = () => {
    if (!newEmail || !newEmail.includes("@")) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    // DB-ready: PATCH /api/users/me { email: newEmail }
    //           server sends verification link to newEmail before updating
    setEmailStep("idle");
    setEmailPw(""); setNewEmail(""); setEmailPwError("");
    setEmailUpdated(true);
    toast({ title: "✅ Email updated", description: `A verification link has been sent to ${newEmail}.` });
    setTimeout(() => setEmailUpdated(false), 3000);
  };

  // ── 2FA state machine ──────────────────────────────────────────
  // DB-ready: POST /api/auth/2fa/setup   → returns { secret, otpauthUrl, backupCodes }
  // DB-ready: POST /api/auth/2fa/verify  → { code } → activates 2FA on user record
  // DB-ready: DELETE /api/auth/2fa       → { password } → disables 2FA
  // DB-ready: server uses 'speakeasy' or 'otplib' to generate/verify TOTP secrets
  // DB-ready: otpauthUrl = `otpauth://totp/Arena:${username}?secret=${secret}&issuer=Arena`
  //           → render as QR via 'qrcode' npm package or Google Charts API
  type TwoFAStep = "idle" | "setup-qr" | "setup-verify" | "setup-backup" | "disable-confirm";
  const [twoFAStep, setTwoFAStep]       = useState<TwoFAStep>("idle");
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  // Simulated secret — DB-ready: returned by POST /api/auth/2fa/setup
  const SIMULATED_SECRET = "JBSWY3DPEHPK3PXP";
  const SIMULATED_BACKUP = ["A1B2-C3D4", "E5F6-G7H8", "I9J0-K1L2", "M3N4-O5P6", "Q7R8-S9T0", "U1V2-W3X4"];
  const [twoFACode, setTwoFACode]           = useState("");
  const [twoFACodeError, setTwoFACodeError] = useState(false);
  const [disablePw, setDisablePw]           = useState("");
  const [copiedSecret, setCopiedSecret]     = useState(false);
  const [copiedBackup, setCopiedBackup]     = useState(false);

  const handleCopySecret = () => {
    navigator.clipboard.writeText(SIMULATED_SECRET);
    setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000);
  };
  const handleCopyBackup = () => {
    navigator.clipboard.writeText(SIMULATED_BACKUP.join("\n"));
    setCopiedBackup(true); setTimeout(() => setCopiedBackup(false), 2000);
  };

  const handleTwoFAToggle = (v: boolean) => {
    if (v) {
      // DB-ready: call POST /api/auth/2fa/setup first — get secret + QR URL
      setTwoFACode(""); setTwoFACodeError(false);
      setTwoFAStep("setup-qr");
    } else {
      setDisablePw(""); setTwoFAStep("disable-confirm");
    }
  };

  const handleTwoFAVerify = () => {
    // DB-ready: POST /api/auth/2fa/verify { code: twoFACode }
    //           server validates TOTP code against stored secret (30s window ±1)
    //           on success: UPDATE users SET totp_enabled=true
    if (twoFACode.length !== 6 || !/^\d{6}$/.test(twoFACode)) {
      setTwoFACodeError(true); return;
    }
    setTwoFACodeError(false);
    setTwoFAStep("setup-backup");
  };

  const handleTwoFAFinish = () => {
    setTwoFAEnabled(true);
    setSecurity((p) => ({ ...p, twoFactor: true }));
    setTwoFAStep("idle"); setTwoFACode("");
    toast({ title: "🔐 2FA Enabled", description: "Your account is now protected with two-factor authentication." });
  };

  const handleTwoFADisable = () => {
    // DB-ready: DELETE /api/auth/2fa { password: disablePw }
    //           server verifies password then: UPDATE users SET totp_enabled=false, totp_secret=null
    if (!disablePw) return;
    setTwoFAEnabled(false);
    setSecurity((p) => ({ ...p, twoFactor: false }));
    setTwoFAStep("idle"); setDisablePw("");
    toast({ title: "2FA Disabled", description: "Two-factor authentication has been turned off.", variant: "destructive" });
  };

  const [notifications, setNotifications] = useState({
    matchResults: true, payouts: true, systemAlerts: true, promotions: false, sounds: true,
  });
  const [security, setSecurity] = useState({
    twoFactor: false, loginAlerts: true,
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

  const handlePasswordUpdate = () => {
    // DB-ready: PATCH /api/auth/password { currentPassword: currentPw, newPassword: newPw }
    setPwConfirmOpen(false);
    setPwUpdated(true);
    setCurrentPw(""); setNewPw("");
    toast({ title: "✅ Password updated", description: "Your password has been changed successfully." });
    setTimeout(() => setPwUpdated(false), 3000);
  };

  const handleSave = () => {
    setDailyBettingLimit(bettingLimit);
    setSaved(true);
    toast({ title: "Saved", description: "Your settings have been updated." });
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
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
                {/* Email — Google accounts: read-only | Password accounts: guarded change flow */}
                <SettingRow
                  label="Email"
                  desc={isGoogleAccount ? "Managed by Google — cannot be changed here" : "Used for login & alerts"}
                >
                  {isGoogleAccount ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground truncate max-w-[140px]">{user?.email}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-arena-cyan/10 text-arena-cyan border border-arena-cyan/20 font-display">Google</span>
                    </div>
                  ) : emailUpdated ? (
                    <span className="flex items-center gap-1 text-xs text-arena-green font-display">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verification sent
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]">{user?.email}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs font-display border-border/60 px-2"
                        onClick={() => { setEmailStep("verify"); setEmailPw(""); setEmailPwError(""); setShowEmailPw(false); }}
                      >
                        <Lock className="h-3 w-3 mr-1" /> Change
                      </Button>
                    </div>
                  )}
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
                {/* Two-Factor Auth — custom row with setup flow */}
                <SettingRow
                  label="Two-Factor Auth"
                  desc={twoFAEnabled ? "TOTP authentication active" : "Protect with Google Authenticator"}
                >
                  <div className="flex items-center gap-2">
                    {twoFAEnabled && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-arena-green/15 text-arena-green border border-arena-green/30 font-display">
                        ON
                      </Badge>
                    )}
                    <Switch
                      checked={twoFAEnabled}
                      onCheckedChange={handleTwoFAToggle}
                    />
                  </div>
                </SettingRow>
                {([
                  { key: "loginAlerts", label: "Login Alerts", desc: "Notify on new logins" },
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
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
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
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
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
                  {/* Password strength indicators */}
                  {newPw.length > 0 && (
                    <div className="mt-1.5 grid grid-cols-1 gap-0.5 px-0.5">
                      {PASSWORD_RULES.map((rule) => {
                        const ok = rule.test(newPw);
                        return (
                          <div key={rule.key} className="flex items-center gap-1.5">
                            {ok
                              ? <Check className="h-2.5 w-2.5 text-arena-green shrink-0" />
                              : <X className="h-2.5 w-2.5 text-destructive/60 shrink-0" />}
                            <span className={`text-[10px] ${ok ? "text-arena-green" : "text-muted-foreground/70"}`}>
                              {rule.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!currentPw || !isPasswordValid(newPw)}
                    onClick={() => setPwConfirmOpen(true)}
                    className={cn(
                      "mt-2 h-7 text-xs font-display border-border transition-all",
                      pwUpdated && "border-green-500/50 text-green-400",
                    )}
                  >
                    {pwUpdated
                      ? <><CheckCircle2 className="mr-1.5 h-3 w-3 text-green-400" /> Updated!</>
                      : <><Lock className="mr-1.5 h-3 w-3" /> Update Password</>
                    }
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

    {/* ── Email Change: Step 1 — Verify Password ── */}
    <Dialog open={emailStep === "verify"} onOpenChange={(o) => { if (!o) setEmailStep("idle"); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden border border-arena-cyan/30 bg-card">
        <DialogDescription className="sr-only">Verify identity to change email</DialogDescription>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-arena-cyan/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-arena-cyan/15 shrink-0">
            <Lock className="h-4 w-4 text-arena-cyan" />
          </div>
          <div>
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide">Confirm Your Identity</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">Step 1 of 2 — Enter your current password</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            For security, we need to verify it's you before changing your email address.
          </p>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type={showEmailPw ? "text" : "password"}
              placeholder="Current password"
              value={emailPw}
              onChange={(e) => { setEmailPw(e.target.value); setEmailPwError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleEmailVerify(); }}
              className="pl-9 pr-9 h-9 text-sm bg-secondary/60 border-border"
              autoFocus
            />
            <button type="button" onClick={() => setShowEmailPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showEmailPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {emailPwError && <p className="text-[11px] text-destructive">{emailPwError}</p>}
          {/* DB-ready: POST /api/auth/verify-password { password: emailPw } */}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="flex-1 text-xs font-display border border-border/60"
            onClick={() => setEmailStep("idle")}>Cancel</Button>
          <Button size="sm" disabled={!emailPw}
            className="flex-1 text-xs font-display bg-arena-cyan hover:bg-arena-cyan/80 text-black font-bold"
            onClick={handleEmailVerify}>
            Verify Identity
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Email Change: Step 2 — Enter New Email ── */}
    <Dialog open={emailStep === "change"} onOpenChange={(o) => { if (!o) setEmailStep("idle"); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden border border-arena-cyan/30 bg-card">
        <DialogDescription className="sr-only">Enter new email address</DialogDescription>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-arena-cyan/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-arena-cyan/15 shrink-0">
            <Mail className="h-4 w-4 text-arena-cyan" />
          </div>
          <div>
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide">Change Email Address</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">Step 2 of 2 — Enter your new email</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
            <p className="text-[10px] text-muted-foreground font-display uppercase tracking-wider mb-0.5">Current email</p>
            <p className="text-xs font-mono text-muted-foreground">{user?.email}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1.5">New email address</p>
            <Input
              type="email"
              placeholder="new@email.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleEmailUpdate(); }}
              className="h-9 text-sm bg-secondary/60 border-border"
              autoFocus
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {/* DB-ready: PATCH /api/users/me { email } → server sends verification to newEmail */}
            A verification link will be sent to your new address. Your email won't change until you click it.
          </p>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="flex-1 text-xs font-display border border-border/60"
            onClick={() => setEmailStep("idle")}>Cancel</Button>
          <Button size="sm"
            disabled={!newEmail || !newEmail.includes("@") || newEmail === user?.email}
            className="flex-1 text-xs font-display bg-arena-cyan hover:bg-arena-cyan/80 text-black font-bold"
            onClick={handleEmailUpdate}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Confirm & Send Link
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── 2FA Setup: Step 1 — QR Code & Secret ── */}
    <Dialog open={twoFAStep === "setup-qr"} onOpenChange={(o) => { if (!o) setTwoFAStep("idle"); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden border border-arena-cyan/30 bg-card">
        <DialogDescription className="sr-only">Set up two-factor authentication</DialogDescription>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-arena-cyan/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-arena-cyan/15 shrink-0">
            <Smartphone className="h-4 w-4 text-arena-cyan" />
          </div>
          <div>
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide">Set Up Authenticator</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">Step 1 of 2 — Scan or enter the key</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* QR placeholder — DB-ready: render <img src={otpauthUrl as QR}> via qrcode library */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-36 h-36 rounded-xl border-2 border-dashed border-border/60 bg-secondary/40 flex flex-col items-center justify-center gap-2">
              {/* DB-ready: <QRCodeSVG value={otpauthUrl} size={128} /> via 'qrcode.react' package */}
              <div className="grid grid-cols-5 gap-0.5 opacity-40">
                {Array.from({ length: 25 }).map((_, i) => (
                  <div key={i} className={cn("w-2.5 h-2.5 rounded-[1px]", Math.random() > 0.4 ? "bg-foreground" : "bg-transparent")} />
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground font-mono">QR code here</p>
            </div>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
              Open <span className="text-foreground font-medium">Google Authenticator</span> or any TOTP app and scan this QR code
            </p>
          </div>
          {/* Manual entry key */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-display">Or enter key manually</p>
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
              <code className="flex-1 font-mono text-xs text-arena-cyan tracking-widest">{SIMULATED_SECRET}</code>
              <button onClick={handleCopySecret} className="text-muted-foreground hover:text-foreground transition-colors">
                {copiedSecret ? <Check className="h-3.5 w-3.5 text-arena-green" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Time-based (TOTP) · 30 second window</p>
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="flex-1 text-xs font-display border border-border/60"
            onClick={() => setTwoFAStep("idle")}>Cancel</Button>
          <Button size="sm" className="flex-1 text-xs font-display bg-arena-cyan hover:bg-arena-cyan/80 text-black font-bold"
            onClick={() => { setTwoFACode(""); setTwoFACodeError(false); setTwoFAStep("setup-verify"); }}>
            Next — Enter Code
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── 2FA Setup: Step 2 — Verify Code ── */}
    <Dialog open={twoFAStep === "setup-verify"} onOpenChange={(o) => { if (!o) setTwoFAStep("idle"); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden border border-arena-cyan/30 bg-card">
        <DialogDescription className="sr-only">Verify your authenticator code</DialogDescription>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-arena-cyan/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-arena-cyan/15 shrink-0">
            <KeyRound className="h-4 w-4 text-arena-cyan" />
          </div>
          <div>
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide">Verify Your Code</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">Step 2 of 2 — Enter the 6-digit code</p>
          </div>
        </div>
        <div className="px-5 py-5 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Open your authenticator app and enter the 6-digit code shown for <span className="text-foreground font-medium">Arena</span>.
          </p>
          <div>
            <Input
              placeholder="000000"
              value={twoFACode}
              onChange={(e) => { setTwoFACode(e.target.value.replace(/\D/g, "").slice(0, 6)); setTwoFACodeError(false); }}
              maxLength={6}
              className={cn(
                "text-center font-mono text-xl tracking-[0.4em] h-12 bg-secondary/60 border-border",
                twoFACodeError && "border-destructive"
              )}
            />
            {twoFACodeError && (
              <p className="text-[11px] text-destructive mt-1">Invalid code — must be exactly 6 digits</p>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {/* DB-ready: server validates TOTP with ±1 window (30s tolerance) via speakeasy.totp.verify() */}
            Code rotates every 30 seconds. Make sure your device clock is synced.
          </p>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="flex-1 text-xs font-display border border-border/60"
            onClick={() => setTwoFAStep("setup-qr")}>Back</Button>
          <Button size="sm" className="flex-1 text-xs font-display bg-arena-cyan hover:bg-arena-cyan/80 text-black font-bold"
            disabled={twoFACode.length !== 6}
            onClick={handleTwoFAVerify}>
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Verify & Enable
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── 2FA Setup: Step 3 — Backup Codes ── */}
    <Dialog open={twoFAStep === "setup-backup"} onOpenChange={(o) => { if (!o) handleTwoFAFinish(); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden border border-arena-green/30 bg-card">
        <DialogDescription className="sr-only">Save your backup codes</DialogDescription>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-arena-green/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-arena-green/15 shrink-0">
            <ShieldCheck className="h-4 w-4 text-arena-green" />
          </div>
          <div>
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide text-arena-green">2FA Enabled!</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">Save your backup codes before closing</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            If you lose access to your authenticator app, use one of these codes to sign in.
            <span className="text-destructive font-medium"> Each code can only be used once.</span>
          </p>
          {/* DB-ready: backup codes generated server-side, bcrypt-hashed before storage */}
          <div className="rounded-lg border border-border/60 bg-secondary/40 p-3">
            <div className="grid grid-cols-2 gap-1.5">
              {SIMULATED_BACKUP.map((code) => (
                <code key={code} className="font-mono text-xs text-foreground tracking-widest text-center py-0.5">{code}</code>
              ))}
            </div>
          </div>
          <button onClick={handleCopyBackup}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            {copiedBackup ? <Check className="h-3 w-3 text-arena-green" /> : <Copy className="h-3 w-3" />}
            {copiedBackup ? "Copied!" : "Copy all backup codes"}
          </button>
        </div>
        <div className="px-5 pb-5">
          <Button size="sm" className="w-full text-xs font-display glow-green" onClick={handleTwoFAFinish}>
            <Check className="mr-1.5 h-3.5 w-3.5" /> I've saved my backup codes
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── 2FA Disable Confirmation ── */}
    <Dialog open={twoFAStep === "disable-confirm"} onOpenChange={(o) => { if (!o) setTwoFAStep("idle"); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden border border-destructive/30 bg-card">
        <DialogDescription className="sr-only">Disable two-factor authentication</DialogDescription>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-destructive/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/15 shrink-0">
            <ShieldOff className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide text-destructive">Disable 2FA</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">This will reduce your account security</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enter your current password to confirm you want to disable two-factor authentication.
          </p>
          <Input
            type="password"
            placeholder="Current password"
            value={disablePw}
            onChange={(e) => setDisablePw(e.target.value)}
            className="h-9 bg-secondary/60 border-border text-sm"
          />
          {/* DB-ready: DELETE /api/auth/2fa { password } → verify bcrypt → set totp_enabled=false */}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="flex-1 text-xs font-display border border-border/60"
            onClick={() => setTwoFAStep("idle")}>Cancel</Button>
          <Button size="sm" variant="destructive" className="flex-1 text-xs font-display font-bold"
            disabled={!disablePw}
            onClick={handleTwoFADisable}>
            <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> Disable 2FA
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Update Password Confirmation Dialog ── */}
    <Dialog open={pwConfirmOpen} onOpenChange={setPwConfirmOpen}>
      <DialogContent className="max-w-sm p-0 overflow-hidden border border-arena-orange/30 bg-card">
        <DialogDescription className="sr-only">Confirm password update</DialogDescription>

        {/* Header strip */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-arena-orange/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-arena-orange/15 shrink-0">
            <ShieldAlert className="h-4 w-4 text-arena-orange" />
          </div>
          <div>
            <DialogHeader>
              <DialogTitle className="font-display text-sm font-bold tracking-wide text-foreground">
                Confirm Password Change
              </DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground mt-0.5">This action will update your login credentials</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2.5 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Account</span>
              <span className="font-medium text-foreground font-mono">{user?.username ?? "—"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">New password length</span>
              <span className="font-medium text-foreground font-mono">{newPw.length} chars</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            You'll need to use the new password next time you sign in. Make sure you remember it or store it safely.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 text-xs font-display border border-border/60"
            onClick={() => setPwConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1 text-xs font-display bg-arena-orange hover:bg-arena-orange/80 text-black font-bold"
            onClick={handlePasswordUpdate}
          >
            <Lock className="mr-1.5 h-3.5 w-3.5" /> Yes, Update Password
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default SettingsPage;
