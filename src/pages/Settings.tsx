import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
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
  Ticket, Monitor, MessageSquare,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/passwordValidation";
import { SupportTicketDialog } from "@/components/support/SupportTicketDialog";
import { useClientStore } from "@/stores/clientStore";
import { clearArenaLocalPreferences } from "@/lib/localArenaPrefs";
import { ArenaPageShell } from "@/components/visual";
import type { UserSettingsRegion } from "@/types";
import {
  apiChangePassword,
  apiAuth2faSetup,
  apiAuth2faVerify,
  apiAuth2faDisable,
  apiPatchUserSettings,
  apiPatchPreferredGame,
  apiDeleteMyAccount,
  apiGetForumProfile,
  apiPatchForumProfile,
} from "@/lib/engine-api";

// ─── Nav sections ──────────────────────────────────────────────
const SECTIONS = [
  { id: "account",       icon: User,             label: "Account",       color: "text-arena-cyan"   },
  { id: "notifications", icon: Bell,             label: "Notifications", color: "text-arena-purple" },
  { id: "security",      icon: Shield,           label: "Security",      color: "text-arena-orange" },
  { id: "betting",       icon: Wallet,           label: "Betting",       color: "text-arena-gold"   },
  { id: "game",          icon: Gamepad2,         label: "Game",          color: "text-primary"      },
  { id: "forum",         icon: MessageSquare,    label: "Forum",         color: "text-arena-cyan"   },
  { id: "support",       icon: Ticket,           label: "Help & ticket", color: "text-arena-cyan"   },
  { id: "danger",        icon: Trash2,           label: "Danger Zone",   color: "text-destructive"  },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

// ─── Row helpers ───────────────────────────────────────────────
const SettingRow = ({
  label, desc, children, last = false, stack = false,
}: { label: string; desc?: string; children: React.ReactNode; last?: boolean; stack?: boolean }) => (
  <div className={cn(
    "py-3 gap-3",
    !last && "border-b border-border/50",
    stack
      ? "flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      : "flex items-center justify-between gap-4",
  )}>
    <div className="min-w-0">
      <p className="text-sm font-medium leading-tight">{label}</p>
      {desc && <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{desc}</p>}
    </div>
    <div className={stack ? "w-full sm:w-auto sm:shrink-0" : "shrink-0"}>{children}</div>
  </div>
);

const SectionTitle = ({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) => (
  <div className="flex items-center gap-2 mb-4">
    <Icon className={cn("h-4 w-4", color)} />
    <h2 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">{label}</h2>
  </div>
);

// ─── Forum settings sub-component ─────────────────────────────
function ForumSettingsSection() {
  const token = useUserStore((s) => s.token);
  const { toast } = useToast();
  const [signature, setSignature] = useState("");
  const [badge, setBadge] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiGetForumProfile(token).then((data) => {
      if (data) {
        setSignature(data.signature ?? "");
        setBadge(data.badge ?? "");
      }
      setLoaded(true);
    });
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    const ok = await apiPatchForumProfile(token, {
      signature: signature.trim() || undefined,
      badge: badge.trim() || undefined,
    });
    setSaving(false);
    toast(ok
      ? { title: "Forum profile saved" }
      : { title: "Failed to save", variant: "destructive" }
    );
  };

  if (!loaded) return <div className="text-xs text-muted-foreground py-4">Loading…</div>;

  return (
    <div>
      <SectionTitle icon={MessageSquare} label="Forum" color="text-arena-cyan" />
      <div className="space-y-4">
        <SettingRow label="Forum Signature" desc="Appears below every post you make (max 200 chars)" stack>
          <div className="w-full">
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value.slice(0, 200))}
              placeholder="e.g. CS2 Global Elite · EST 2019"
              className="w-full bg-white/5 border border-border/40 rounded px-3 py-1.5 text-sm outline-none focus:border-arena-cyan/40 transition-colors text-foreground placeholder:text-muted-foreground/40"
            />
            <p className="text-[10px] text-muted-foreground/50 text-right mt-0.5">
              {signature.length}/200
            </p>
          </div>
        </SettingRow>
        <SettingRow label="Forum Badge" desc="Custom badge shown on your user card (max 40 chars)" last stack>
          <div className="w-full">
            <input
              value={badge}
              onChange={(e) => setBadge(e.target.value.slice(0, 40))}
              placeholder="e.g. Season 1 Champion"
              className="w-full bg-white/5 border border-border/40 rounded px-3 py-1.5 text-sm outline-none focus:border-arena-cyan/40 transition-colors text-foreground placeholder:text-muted-foreground/40"
            />
            {badge && (
              <div className="mt-1.5 inline-flex px-2 py-0.5 rounded border border-arena-cyan/30 text-[11px] text-arena-cyan/80 bg-arena-cyan/5">
                {badge}
              </div>
            )}
          </div>
        </SettingRow>
        <div className="pt-2">
          <Button
            size="sm"
            className="arena-hud-btn gap-1.5"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save Forum Profile"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────
const ENGINE_REGION_OPTIONS: { value: UserSettingsRegion; label: string }[] = [
  { value: "EU", label: "Europe (EU)" },
  { value: "NA", label: "North America" },
  { value: "ASIA", label: "Asia" },
  { value: "SA", label: "South America" },
  { value: "OCE", label: "Oceania" },
  { value: "ME", label: "Middle East" },
];

const SettingsPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, greetingType, token, logout, updateProfile } = useUserStore();
  const clientStatusLabel = useClientStore((s) => s.statusLabel);
  const clientVersion = useClientStore((s) => s.version);
  const [searchParams, setSearchParams] = useSearchParams();
  // Google users cannot change email — managed by Google OAuth
  const isGoogleAccount = user?.authProvider === "google" || greetingType === "google";
  const { platformBettingMax, dailyBettingLimit, dailyBettingUsed, setDailyBettingLimit } = useWalletStore();

  const [active, setActive] = useState<SectionId>("account");
  const [supportTicketOpen, setSupportTicketOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null);
  const [deleteReady, setDeleteReady] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deleteCountdownStartedRef = useRef(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwConfirmOpen, setPwConfirmOpen] = useState(false);
  const [pwUpdated, setPwUpdated] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [gameSaving, setGameSaving] = useState(false);

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
  const [twoFAQrUri, setTwoFAQrUri]     = useState("");
  const [twoFASecret, setTwoFASecret]   = useState("");
  const [twoFASetupBusy, setTwoFASetupBusy] = useState(false);
  const [twoFACode, setTwoFACode]           = useState("");
  const [twoFACodeError, setTwoFACodeError] = useState(false);
  const [disablePw, setDisablePw]           = useState("");
  const [disableTotp, setDisableTotp]     = useState("");
  const [copiedSecret, setCopiedSecret]     = useState(false);

  useEffect(() => {
    setTwoFAEnabled(user?.twoFactorEnabled ?? false);
  }, [user?.twoFactorEnabled]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearInterval(deleteTimerRef.current);
    };
  }, []);

  const resetDeleteFlow = () => {
    if (deleteTimerRef.current) {
      clearInterval(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    deleteCountdownStartedRef.current = false;
    setDeleteInput("");
    setDeleteCountdown(null);
    setDeleteReady(false);
    setShowDeleteConfirm(false);
  };

  const onDeleteInputChange = (v: string) => {
    setDeleteInput(v);
    if (v !== "delete") {
      deleteCountdownStartedRef.current = false;
      if (deleteTimerRef.current) {
        clearInterval(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
      setDeleteCountdown(null);
      setDeleteReady(false);
      return;
    }
    if (showDeleteConfirm && !deleteCountdownStartedRef.current) {
      deleteCountdownStartedRef.current = true;
      setDeleteCountdown(10);
      setDeleteReady(false);
      deleteTimerRef.current = setInterval(() => {
        setDeleteCountdown((c) => {
          if (c <= 1) {
            if (deleteTimerRef.current) {
              clearInterval(deleteTimerRef.current);
              deleteTimerRef.current = null;
            }
            setDeleteReady(true);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
  };

  const handleCopySecret = async () => {
    if (!twoFASecret) return;
    const ok = await copyTextToClipboard(twoFASecret);
    if (ok) {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
      toast({ title: "Secret copied", description: "Store it somewhere safe." });
    } else {
      toast({ variant: "destructive", title: "Copy failed", description: "Copy the secret manually from the field above." });
    }
  };

  const handleTwoFAToggle = async (v: boolean) => {
    if (!token) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    if (v) {
      setTwoFACode(""); setTwoFACodeError(false);
      setTwoFASetupBusy(true);
      const r = await apiAuth2faSetup(token);
      setTwoFASetupBusy(false);
      if (r.ok === false) {
        toast({ title: "2FA setup failed", description: r.detail ?? "Try again later.", variant: "destructive" });
        return;
      }
      setTwoFAQrUri(r.qr_uri);
      setTwoFASecret(r.secret);
      setTwoFAStep("setup-qr");
    } else {
      setDisablePw(""); setDisableTotp(""); setTwoFAStep("disable-confirm");
    }
  };

  const handleTwoFAVerify = async () => {
    if (!token) return;
    if (twoFACode.length !== 6 || !/^\d{6}$/.test(twoFACode)) {
      setTwoFACodeError(true); return;
    }
    setTwoFACodeError(false);
    const r = await apiAuth2faVerify(token, twoFACode);
    if (r.ok === false) {
      toast({ title: "Invalid code", description: r.detail ?? "Check your authenticator app.", variant: "destructive" });
      return;
    }
    setTwoFAStep("setup-backup");
  };

  const handleTwoFAFinish = () => {
    setTwoFAEnabled(true);
    updateProfile({ twoFactorEnabled: true });
    setSecurity((p) => ({ ...p, twoFactor: true }));
    setTwoFAStep("idle"); setTwoFACode("");
    setTwoFAQrUri(""); setTwoFASecret("");
    toast({ title: "🔐 2FA Enabled", description: "Your account is now protected with two-factor authentication." });
  };

  const handleTwoFADisable = async () => {
    if (!token || !disablePw || disableTotp.length !== 6) return;
    const r = await apiAuth2faDisable(token, disablePw, disableTotp);
    if (r.ok === false) {
      toast({ title: "Could not disable 2FA", description: r.detail ?? "Check password and code.", variant: "destructive" });
      return;
    }
    setTwoFAEnabled(false);
    updateProfile({ twoFactorEnabled: false });
    setSecurity((p) => ({ ...p, twoFactor: false }));
    setTwoFAStep("idle"); setDisablePw(""); setDisableTotp("");
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

  useEffect(() => {
    if (!user) return;
    setSecurity((p) => ({ ...p, twoFactor: !!user.twoFactorEnabled }));
    setGame((g) => ({ ...g, defaultGame: user.preferredGame ?? "CS2" }));
  }, [user?.id, user?.twoFactorEnabled, user?.preferredGame]);

  // Deep link: /settings?section=support, /settings?section=support&openTicket=1
  useEffect(() => {
    const sec = searchParams.get("section");
    const openT = searchParams.get("openTicket") === "1";
    if (sec === "support" || openT) setActive("support");
    if (openT) {
      setSupportTicketOpen(true);
      const n = new URLSearchParams(searchParams);
      n.delete("openTicket");
      setSearchParams(n, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handlePasswordUpdate = async () => {
    if (!token) {
      toast({ title: "Sign in required", description: "Log in to change your password.", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      const res = await apiChangePassword(token, currentPw, newPw);
      setPwConfirmOpen(false);
      if (res.ok === false) {
        toast({
          title: "Could not update password",
          description: res.detail ?? "Check your current password and try again.",
          variant: "destructive",
        });
        return;
      }
      setPwUpdated(true);
      setCurrentPw("");
      setNewPw("");
      toast({
        title: "Password updated",
        description: "You will be signed out — sign in again with your new password.",
      });
      setTimeout(() => setPwUpdated(false), 3000);
      logout();
    } finally {
      setPwSaving(false);
    }
  };

  const handleSave = () => {
    setDailyBettingLimit(bettingLimit);
    setSaved(true);
    toast({ title: "Saved", description: "Your settings have been updated." });
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <ArenaPageShell variant="settings" contentClassName="space-y-6">
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
      <div className="flex-1 pl-3 sm:pl-6 flex flex-col min-w-0">
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
                  stack
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
                <SettingRow label="Region" desc="Affects matchmaking pool (saved to your account)" last stack>
                  <Select
                    value={(user?.region as UserSettingsRegion) || "EU"}
                    onValueChange={async (v) => {
                      if (!token) return;
                      const region = v as UserSettingsRegion;
                      const r = await apiPatchUserSettings(token, region);
                      if (r.ok === false) {
                        toast({
                          title: "Could not save region",
                          description: r.detail ?? "Try again.",
                          variant: "destructive",
                        });
                        return;
                      }
                      updateProfile({ region: r.region });
                      toast({ title: "Region saved", description: `Your region is set to ${r.region}.` });
                    }}
                  >
                    <SelectTrigger className="h-8 w-full sm:w-44 bg-secondary/60 border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENGINE_REGION_OPTIONS.map(({ value, label }) => (
                        <SelectItem key={value} value={value} className="text-xs">
                          {label}
                        </SelectItem>
                      ))}
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
                      disabled={twoFASetupBusy}
                      onCheckedChange={(v) => void handleTwoFAToggle(v)}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                <SettingRow label="Daily Betting Limit" desc={`Used today: $${dailyBettingUsed} · Platform max: $${platformBettingMax}`} stack>
                  <div className="flex items-center gap-3 w-full sm:w-48">
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
              <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-primary shrink-0" />
                  <h2 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">Arena Client</h2>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Same status as the header and Match Lobby. Install the desktop app so staked matches can verify capture on your PC.
                </p>
                <p className="text-xs font-mono text-foreground">
                  {clientStatusLabel()}
                  {clientVersion ? ` · v${clientVersion}` : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="text-xs h-8" asChild>
                    <Link to="/client">Why &amp; download</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8 text-muted-foreground"
                    type="button"
                    onClick={() => {
                      const { clearedKeys } = clearArenaLocalPreferences();
                      toast({
                        title: "Local data cleared",
                        description:
                          clearedKeys.length > 0
                            ? `Removed: ${clearedKeys.join(", ")}`
                            : "No Arena local keys were set.",
                      });
                    }}
                  >
                    Clear local onboarding flags
                  </Button>
                </div>
              </div>
              <SectionTitle icon={Gamepad2} label="Game Preferences" color="text-primary" />
              <div className="space-y-1">
                <SettingRow label="Default Game" desc="Pre-selected when creating a match" stack>
                  <Select value={game.defaultGame} onValueChange={(v) => setGame((p) => ({ ...p, defaultGame: v }))}>
                    <SelectTrigger className="h-8 w-full sm:w-36 bg-secondary/60 border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    {/* DB-ready: options driven by games.enabled — Coming Soon games disabled until Client supports them */}
                    <SelectContent>
                      {[
                        { name: "CS2",               active: true  },
                        { name: "Valorant",           active: true  },
                        { name: "Fortnite",           active: false },
                        { name: "Apex Legends",       active: false },
                        { name: "COD",                active: false },
                        { name: "PUBG",               active: false },
                        { name: "League of Legends",  active: false },
                      ].map(({ name, active }) => (
                        <SelectItem
                          key={name}
                          value={name}
                          disabled={!active}
                          title={
                            !active
                              ? "Ranked play when Arena Client and engine support this title."
                              : undefined
                          }
                          className={!active ? "opacity-40 cursor-not-allowed" : ""}
                        >
                          {name}{!active ? " (Coming Soon)" : ""}
                        </SelectItem>
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
              <div className="pt-3 flex justify-end">
                <Button
                  size="sm"
                  className="arena-hud-btn gap-1.5 w-full sm:w-auto"
                  disabled={gameSaving}
                  onClick={async () => {
                    if (!token) return;
                    setGameSaving(true);
                    const ok = await apiPatchPreferredGame(token, game.defaultGame);
                    setGameSaving(false);
                    if (ok) {
                      updateProfile({ preferredGame: game.defaultGame as import("@/types").Game });
                      toast({ title: "Game preferences saved" });
                    } else {
                      toast({ title: "Failed to save", variant: "destructive" });
                    }
                  }}
                >
                  <Save className="h-3.5 w-3.5" />
                  {gameSaving ? "Saving…" : "Save Game Preferences"}
                </Button>
              </div>
            </div>
          )}

          {/* ── HELP & TICKET ── */}
          {active === "support" && (
            <div>
              <SectionTitle icon={Ticket} label="Help & ticket" color="text-arena-cyan" />
              <p className="text-sm text-muted-foreground mb-4 max-w-md leading-relaxed">
                Submit a ticket for account access, payments & escrow, bugs, match outcomes, or general feedback.
                Admins review tickets in the <span className="text-foreground font-medium">Reports</span> queue (same pipeline as match appeals).
              </p>
              <Button
                type="button"
                className="glow-green font-display"
                onClick={() => setSupportTicketOpen(true)}
              >
                <Ticket className="h-4 w-4 mr-2" />
                New support ticket
              </Button>
            </div>
          )}

          {/* ── FORUM ── */}
          {active === "forum" && (
            <ForumSettingsSection />
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
                  onClick={() => {
                    setShowDeleteConfirm(true);
                    setDeleteInput("");
                    deleteCountdownStartedRef.current = false;
                    setDeleteCountdown(null);
                    setDeleteReady(false);
                    if (deleteTimerRef.current) {
                      clearInterval(deleteTimerRef.current);
                      deleteTimerRef.current = null;
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete Account
                </Button>
              ) : (
                <div className="space-y-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2 text-destructive text-xs">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Type <span className="font-mono font-bold">delete</span> exactly to begin the safety countdown</span>
                  </div>
                  <Input
                    placeholder='Type "delete"'
                    value={deleteInput}
                    onChange={(e) => onDeleteInputChange(e.target.value)}
                    className="h-8 bg-secondary border-border font-mono text-xs"
                  />
                  {deleteInput === "delete" && deleteCountdown !== null && deleteCountdown > 0 && (
                    <p className="text-xs text-muted-foreground font-display">
                      Deleting in {deleteCountdown}…
                    </p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="font-display text-xs"
                      disabled={!deleteReady || !token || deleteSubmitting}
                      onClick={async () => {
                        if (!token) return;
                        setDeleteSubmitting(true);
                        const r = await apiDeleteMyAccount(token, "delete");
                        setDeleteSubmitting(false);
                        if (r.ok === false) {
                          toast({
                            title: "Deletion failed",
                            description: r.detail ?? "Please try again.",
                            variant: "destructive",
                          });
                          resetDeleteFlow();
                          return;
                        }
                        toast({ title: "Account deleted", description: "Your session has ended.", variant: "destructive" });
                        logout();
                        navigate("/");
                      }}
                    >
                      {deleteSubmitting ? "Deleting…" : "Delete my account permanently"}
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="text-muted-foreground text-xs"
                      onClick={resetDeleteFlow}
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
              className={cn("font-display text-xs transition-all w-full sm:w-auto", saved ? "bg-primary/80" : "glow-green")}
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
            <div className="w-40 h-40 rounded-xl border border-border/60 bg-white p-1 flex items-center justify-center overflow-hidden">
              {twoFAQrUri ? (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=152x152&data=${encodeURIComponent(twoFAQrUri)}`}
                  alt="Authenticator QR"
                  className="w-[152px] h-[152px]"
                />
              ) : (
                <p className="text-[10px] text-muted-foreground p-2 text-center">Loading QR…</p>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
              Open <span className="text-foreground font-medium">Google Authenticator</span> or any TOTP app and scan this QR code
            </p>
          </div>
          {/* Manual entry key */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-display">Or enter key manually</p>
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
              <code className="flex-1 font-mono text-xs text-arena-cyan tracking-widest break-all">{twoFASecret || "—"}</code>
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
          <Button
            size="sm"
            className="flex-1 text-xs font-display bg-arena-cyan hover:bg-arena-cyan/80 text-black font-bold"
            disabled={!twoFASecret || twoFASetupBusy}
            onClick={() => { setTwoFACode(""); setTwoFACodeError(false); setTwoFAStep("setup-verify"); }}
          >
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
            onClick={() => void handleTwoFAVerify()}>
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
            <p className="text-[11px] text-muted-foreground mt-0.5">Confirmation</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The server does not issue one-time backup codes yet. Store your authenticator secret safely, or use your app&apos;s
            account recovery if you lose the device.
          </p>
          <p className="text-[10px] text-arena-orange/90 border border-arena-orange/25 rounded-md px-2 py-1.5 bg-arena-orange/5">
            {/* TODO[VERIF]: optional recovery codes when backend adds hashed backup_codes */}
            Backup codes may be added in a future engine release.
          </p>
        </div>
        <div className="px-5 pb-5">
          <Button size="sm" className="w-full text-xs font-display glow-green" onClick={handleTwoFAFinish}>
            <Check className="mr-1.5 h-3.5 w-3.5" /> Done
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
          <p className="text-[11px] text-muted-foreground">Authenticator code</p>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="000000"
            maxLength={6}
            value={disableTotp}
            onChange={(e) => setDisableTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="h-9 bg-secondary/60 border-border text-sm font-mono tracking-widest text-center"
          />
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="ghost" size="sm" className="flex-1 text-xs font-display border border-border/60"
            onClick={() => setTwoFAStep("idle")}>Cancel</Button>
          <Button size="sm" variant="destructive" className="flex-1 text-xs font-display font-bold"
            disabled={!disablePw || disableTotp.length !== 6}
            onClick={() => void handleTwoFADisable()}>
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
            disabled={pwSaving}
            onClick={() => void handlePasswordUpdate()}
          >
            <Lock className="mr-1.5 h-3.5 w-3.5" /> {pwSaving ? "Updating…" : "Yes, Update Password"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <SupportTicketDialog
      open={supportTicketOpen}
      onOpenChange={setSupportTicketOpen}
      mode="general_support"
    />
    </>
    </ArenaPageShell>
  );
};

export default SettingsPage;
