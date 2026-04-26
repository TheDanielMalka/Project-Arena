import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Swords, Mail, Lock, Eye, EyeOff, User, Gamepad2, Check, X, Home, Loader2 } from "lucide-react";
import { useUserStore } from "@/stores/userStore";
import { useToast } from "@/hooks/use-toast";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/passwordValidation";
import { cn } from "@/lib/utils";
import { ArenaGlobalStarfield } from "@/components/visual/ArenaGlobalStarfield";
import { ArenaLogo } from "@/components/shared/ArenaLogo";
import { apiResendVerification, apiForgotPassword, apiResetPassword } from "@/lib/engine-api";

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, signup, loginWithGoogleIdToken, isAuthenticated, completeTwoFactorLogin } = useUserStore();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [confirmedAge, setConfirmedAge] = useState(false);
  const [signupFieldErrors, setSignupFieldErrors] = useState<
    Partial<Record<"username" | "email", string>>
  >({});
  const [loginRateLimited, setLoginRateLimited] = useState(false);
  const [signupRateLimited, setSignupRateLimited] = useState(false);
  const [loginAuthPhase, setLoginAuthPhase] = useState<"credentials" | "2fa">("credentials");
  const [loginTempToken, setLoginTempToken] = useState("");
  const [loginTwoFaCode, setLoginTwoFaCode] = useState("");
  const [authTab, setAuthTab] = useState<"login" | "signup">("login");
  const [verifyEmailPending, setVerifyEmailPending] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [loginNotVerifiedEmail, setLoginNotVerifiedEmail] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const hasGoogleClient = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim());

  // Redirect if already logged in (do NOT navigate during render)
  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const v = searchParams.get("verified");
    if (v === "1") {
      toast({ title: "Email verified!", description: "Your account is verified. You can now log in." });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (v === "expired") {
      toast({ title: "Link expired", description: "Verification link has expired. Please request a new one.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    const rt = searchParams.get("reset_token");
    if (rt) {
      setResetToken(rt);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (isAuthenticated) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      toast({ title: "Missing fields", description: "Please enter email and password.", variant: "destructive" });
      return;
    }
    const result = await login(loginEmail, loginPassword);
    if (result === "rate_limited") {
      toast({ title: "Too many requests", description: "Too many requests — please wait a moment and try again", variant: "destructive" });
      setLoginRateLimited(true);
      setTimeout(() => setLoginRateLimited(false), 3000);
      return;
    }
    if (typeof result === "object" && result !== null && "needs_2fa" in result) {
      setLoginTempToken(result.temp_token);
      setLoginTwoFaCode("");
      setLoginAuthPhase("2fa");
      return;
    }
    if (result && typeof result === "object" && "_email_not_verified" in result) {
      setLoginNotVerifiedEmail(result.email || loginEmail);
      return;
    }
    if (!result) {
      toast({ title: "Login failed", description: "Invalid email or password.", variant: "destructive" });
      return;
    }
    navigate("/");
  };

  const handleLogin2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = loginTwoFaCode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      toast({ title: "Invalid code", description: "Enter the 6-digit code from your authenticator app.", variant: "destructive" });
      return;
    }
    const ok = await completeTwoFactorLogin(loginTempToken, code);
    if (!ok) {
      toast({ title: "Verification failed", description: "Code was not accepted. Try again.", variant: "destructive" });
      return;
    }
    setLoginAuthPhase("credentials");
    setLoginTempToken("");
    setLoginTwoFaCode("");
    navigate("/");
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupFieldErrors({});
    if (!signupUsername || !signupEmail || !signupPassword) {
      toast({ title: "Missing fields", description: "Please fill all required fields.", variant: "destructive" });
      return;
    }
    if (!isPasswordValid(signupPassword)) {
      toast({ title: "Password too weak", description: "Please meet all password requirements below.", variant: "destructive" });
      return;
    }
    if (!confirmedAge) {
      toast({ title: "Age confirmation required", description: "You must confirm you are 18 or older.", variant: "destructive" });
      return;
    }
    if (!agreedToTerms) {
      toast({ title: "Terms required", description: "You must agree to the Terms of Service.", variant: "destructive" });
      return;
    }
    const result = await signup(signupUsername, signupEmail, signupPassword);
    if (result.ok === false) {
      if (result.status === 429) {
        toast({ title: "Too many requests", description: "Too many requests — please wait a moment and try again", variant: "destructive" });
        setSignupRateLimited(true);
        setTimeout(() => setSignupRateLimited(false), 3000);
        return;
      }
      const msg = result.detail ?? "Please check your details and try again.";
      if (result.field === "email") setSignupFieldErrors({ email: msg });
      else if (result.field === "username") setSignupFieldErrors({ username: msg });
      else {
        toast({ title: "Signup failed", description: msg, variant: "destructive" });
      }
      return;
    }
    if (result.ok && result.verification_required) {
      setVerifyEmailPending(result.email ?? signupEmail);
      return;
    }
    navigate("/");
  };

  const handleGoogleCredential = async (credential: string | undefined) => {
    if (!credential) {
      toast({
        title: "Google sign-in failed",
        description: "No credential returned from Google.",
        variant: "destructive",
      });
      return;
    }
    const result = await loginWithGoogleIdToken(credential);
    if (result === "rate_limited") {
      toast({
        title: "Too many requests",
        description: "Too many requests — please wait a moment and try again",
        variant: "destructive",
      });
      return;
    }
    if (typeof result === "object" && result !== null && "needs_2fa" in result) {
      setAuthTab("login");
      setLoginTempToken(result.temp_token);
      setLoginTwoFaCode("");
      setLoginAuthPhase("2fa");
      return;
    }
    if (!result) {
      toast({
        title: "Google sign-in failed",
        description: "Could not verify your Google account. Try again or use email and password.",
        variant: "destructive",
      });
      return;
    }
    navigate("/");
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    await apiForgotPassword(forgotEmail);
    setForgotLoading(false);
    setForgotSent(true);
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    if (!isPasswordValid(resetPassword)) {
      toast({ title: "Password too weak", description: "Please meet all password requirements.", variant: "destructive" });
      return;
    }
    if (resetPassword !== resetConfirm) {
      toast({ title: "Passwords don't match", description: "Both fields must be identical.", variant: "destructive" });
      return;
    }
    setResetLoading(true);
    const result = await apiResetPassword(resetToken, resetPassword);
    setResetLoading(false);
    if (!result.success) {
      if (result.error === "invalid_or_expired_token") {
        toast({ title: "Link expired", description: "This reset link has expired. Please request a new one.", variant: "destructive" });
      } else {
        toast({ title: "Failed", description: result.error ?? "Could not reset password.", variant: "destructive" });
      }
      return;
    }
    setResetToken(null);
    setResetPassword("");
    setResetConfirm("");
    toast({ title: "Password updated!", description: "You can now log in with your new password." });
  };

  const handleResend = async (email: string) => {
    setResendLoading(true);
    await apiResendVerification(email);
    setResendLoading(false);
    toast({ title: "Email sent!", description: "Check your inbox for the verification link." });
  };

  if (resetToken) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-background px-4">
        <ArenaGlobalStarfield className="fixed inset-0 z-0" />
        <Card className="relative z-[1] w-full max-w-md bg-card border-border">
          <CardHeader className="text-center flex flex-col items-center gap-1">
            <ArenaLogo variant="compact" markSize={30} className="mb-1" />
            <Lock className="h-8 w-8 text-primary" />
            <p className="font-display text-xl font-bold text-foreground tracking-wide">Set new password</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showResetPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="pl-10 pr-10 bg-secondary border-border"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Confirm new password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showResetPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    className="pl-10 bg-secondary border-border"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="space-y-1">
                {PASSWORD_RULES.map((rule) => (
                  <div key={rule.label} className={cn("flex items-center gap-2 text-xs", rule.test(resetPassword) ? "text-green-400" : "text-muted-foreground")}>
                    {rule.test(resetPassword) ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {rule.label}
                  </div>
                ))}
              </div>
              <Button type="submit" className="w-full glow-green font-display text-base" disabled={resetLoading}>
                {resetLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Swords className="mr-2 h-4 w-4" />}
                Update Password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (verifyEmailPending) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-background px-4">
        <ArenaGlobalStarfield className="fixed inset-0 z-0" />
        <Card className="relative z-[1] w-full max-w-md bg-card border-border text-center">
          <CardHeader className="flex flex-col items-center gap-2 pb-2">
            <ArenaLogo variant="compact" markSize={30} className="mb-1" />
            <Mail className="h-10 w-10 text-primary" />
            <p className="font-display text-xl font-bold text-foreground tracking-wide">Check your email</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We sent a verification link to <span className="text-foreground font-medium">{verifyEmailPending}</span>.
              Click the link to activate your account.
            </p>
            <p className="text-xs text-muted-foreground">Didn't receive it? Check your spam folder or resend below.</p>
            <Button className="w-full font-display" variant="outline" disabled={resendLoading}
              onClick={() => void handleResend(verifyEmailPending)}>
              {resendLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Resend verification email
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground text-xs"
              onClick={() => setVerifyEmailPending(null)}>
              Back to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loginNotVerifiedEmail) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-background px-4">
        <ArenaGlobalStarfield className="fixed inset-0 z-0" />
        <Card className="relative z-[1] w-full max-w-md bg-card border-border text-center">
          <CardHeader className="flex flex-col items-center gap-2 pb-2">
            <ArenaLogo variant="compact" markSize={30} className="mb-1" />
            <Mail className="h-10 w-10 text-yellow-400" />
            <p className="font-display text-xl font-bold text-foreground tracking-wide">Email not verified</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your account hasn't been verified yet. Check your inbox for the verification email
              {loginNotVerifiedEmail ? <> sent to <span className="text-foreground font-medium">{loginNotVerifiedEmail}</span></> : null}.
            </p>
            <Button className="w-full font-display" disabled={resendLoading}
              onClick={() => void handleResend(loginNotVerifiedEmail)}>
              {resendLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Resend verification email
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground text-xs"
              onClick={() => setLoginNotVerifiedEmail(null)}>
              Back to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (forgotMode) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-background px-4">
        <ArenaGlobalStarfield className="fixed inset-0 z-0" />
        <Card className="relative z-[1] w-full max-w-md bg-card border-border">
          <CardHeader className="text-center flex flex-col items-center gap-1">
            <ArenaLogo variant="compact" markSize={30} className="mb-1" />
            <p className="font-display text-xl font-bold text-foreground tracking-wide">Reset Password</p>
            <p className="text-sm text-muted-foreground">
              {forgotSent ? "Check your inbox" : "Enter your email to receive a reset link"}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {forgotSent ? (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  If an account exists for <span className="text-foreground font-medium">{forgotEmail}</span>, a reset link has been sent. Check your spam folder too.
                </p>
                <Button className="w-full font-display" variant="outline" onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(""); }}>
                  Back to Login
                </Button>
              </>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="pl-10 bg-secondary border-border"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full glow-green font-display" disabled={forgotLoading}>
                  {forgotLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Send Reset Link
                </Button>
                <Button variant="ghost" className="w-full text-muted-foreground" type="button" onClick={() => setForgotMode(false)}>
                  Back to Login
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-background px-4 gap-4">
      <ArenaGlobalStarfield className="fixed inset-0 z-0" />
      <Card className="relative z-[1] w-full max-w-md bg-card border-border">
        <CardHeader className="text-center flex flex-col items-center gap-1">
          <ArenaLogo variant="compact" markSize={32} className="mb-1" />
          <p className="text-sm text-muted-foreground">Play for Stakes</p>
        </CardHeader>
        <CardContent>
          <Tabs
            value={authTab}
            onValueChange={(v) => {
              const t = v as "login" | "signup";
              setAuthTab(t);
              if (t === "login") {
                setLoginAuthPhase("credentials");
                setLoginTempToken("");
                setLoginTwoFaCode("");
              }
              if (t === "signup") {
                setLoginAuthPhase("credentials");
                setLoginTempToken("");
                setLoginTwoFaCode("");
              }
            }}
            className="w-full"
          >
            <TabsList className="w-full bg-secondary border border-border mb-4">
              <TabsTrigger value="login" className="flex-1 font-display data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                Login
              </TabsTrigger>
              <TabsTrigger value="signup" className="flex-1 font-display data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                Sign Up
              </TabsTrigger>
            </TabsList>

            {/* LOGIN */}
            <TabsContent value="login">
              {loginAuthPhase === "2fa" ? (
                <form onSubmit={handleLogin2fa} className="space-y-4">
                  <p className="text-sm text-muted-foreground text-center">
                    Two-factor authentication is enabled. Enter the 6-digit code from your authenticator app.
                  </p>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Authenticator code</label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      value={loginTwoFaCode}
                      onChange={(e) => setLoginTwoFaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="bg-secondary border-border font-mono text-center text-lg tracking-[0.3em]"
                    />
                  </div>
                  <Button type="submit" className="w-full glow-green font-display text-base">
                    <Swords className="mr-2 h-4 w-4" /> Verify &amp; enter
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-muted-foreground text-sm"
                    onClick={() => {
                      setLoginAuthPhase("credentials");
                      setLoginTempToken("");
                      setLoginTwoFaCode("");
                    }}
                  >
                    Back to email &amp; password
                  </Button>
                </form>
              ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="pl-10 bg-secondary border-border"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="pl-10 pr-10 bg-secondary border-border"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <button type="button" onClick={() => setForgotMode(true)} className="text-xs text-primary hover:underline">
                    Forgot password?
                  </button>
                </div>
                <Button type="submit" className="w-full glow-green font-display text-base" disabled={loginRateLimited}>
                  <Swords className="mr-2 h-4 w-4" /> {loginRateLimited ? "Please wait…" : "Enter Arena"}
                </Button>

                <Button
                  type="button"
                  className="w-full glow-green font-display text-base"
                  onClick={() => navigate("/")}
                >
                  <Home className="mr-2 h-4 w-4" /> Back to Site
                </Button>
              </form>
              )}
            </TabsContent>

            {/* SIGN UP */}
            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Choose a username"
                      value={signupUsername}
                      onChange={(e) => {
                        setSignupUsername(e.target.value);
                        setSignupFieldErrors((p) => ({ ...p, username: undefined }));
                      }}
                      className={cn("pl-10 bg-secondary border-border", signupFieldErrors.username && "border-destructive")}
                      aria-invalid={!!signupFieldErrors.username}
                    />
                  </div>
                  {signupFieldErrors.username ? (
                    <p className="text-xs text-destructive mt-1">{signupFieldErrors.username}</p>
                  ) : null}
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={signupEmail}
                      onChange={(e) => {
                        setSignupEmail(e.target.value);
                        setSignupFieldErrors((p) => ({ ...p, email: undefined }));
                      }}
                      className={cn("pl-10 bg-secondary border-border", signupFieldErrors.email && "border-destructive")}
                      aria-invalid={!!signupFieldErrors.email}
                    />
                  </div>
                  {signupFieldErrors.email ? (
                    <p className="text-xs text-destructive mt-1">{signupFieldErrors.email}</p>
                  ) : null}
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Create a strong password"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      className="pl-10 pr-10 bg-secondary border-border"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Password strength indicators */}
                  {signupPassword.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-0.5">
                      {PASSWORD_RULES.map((rule) => {
                        const ok = rule.test(signupPassword);
                        return (
                          <div key={rule.key} className="flex items-center gap-1.5">
                            {ok
                              ? <Check className="h-3 w-3 text-arena-green shrink-0" />
                              : <X className="h-3 w-3 text-destructive/70 shrink-0" />}
                            <span className={`text-[11px] ${ok ? "text-arena-green" : "text-muted-foreground"}`}>
                              {rule.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground/60 -mb-1 flex items-center gap-1.5">
                  <Gamepad2 className="h-3 w-3 shrink-0" />
                  Connect your Steam / Riot account after signup from your Profile.
                </p>

                {/* Legal Checkboxes */}
                <div className="space-y-3 pt-1">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <button
                      type="button"
                      onClick={() => setConfirmedAge(!confirmedAge)}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                        confirmedAge
                          ? "bg-arena-gold border-arena-gold"
                          : "border-border bg-secondary group-hover:border-arena-gold/60"
                      }`}
                    >
                      {confirmedAge && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
                    </button>
                    <span className="text-xs text-muted-foreground leading-relaxed">
                      I confirm that I am{" "}
                      <strong className="text-arena-gold">18 years of age or older</strong>{" "}
                      and that real-money competition is lawful in my jurisdiction.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <button
                      type="button"
                      onClick={() => setAgreedToTerms(!agreedToTerms)}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                        agreedToTerms
                          ? "bg-primary border-primary"
                          : "border-border bg-secondary group-hover:border-primary/60"
                      }`}
                    >
                      {agreedToTerms && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
                    </button>
                    <span className="text-xs text-muted-foreground leading-relaxed">
                      I have read and agree to the{" "}
                      <Link
                        to="/legal/terms"
                        target="_blank"
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Terms of Service
                      </Link>
                      , including acknowledgment that I may lose staked funds, that Arena is a
                      skill-based platform, and that the use of VPNs to bypass geographic restrictions is prohibited.
                    </span>
                  </label>
                </div>

                <Button
                  type="submit"
                  className="w-full glow-green font-display text-base"
                  disabled={!confirmedAge || !agreedToTerms || signupRateLimited}
                >
                  <Swords className="mr-2 h-4 w-4" /> {signupRateLimited ? "Please wait…" : "Create Account"}
                </Button>

                <Button
                  type="button"
                  className="w-full glow-green font-display text-base"
                  onClick={() => navigate("/")}
                >
                  <Home className="mr-2 h-4 w-4" /> Back to Site
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Public legal footer */}
      <div className="relative z-[1] flex items-center gap-4 text-xs text-muted-foreground/60">
        <Link to="/legal/terms" target="_blank" className="hover:text-muted-foreground transition-colors">
          Terms of Service
        </Link>
        <span>·</span>
        <Link to="/legal/privacy" target="_blank" className="hover:text-muted-foreground transition-colors">
          Privacy Policy
        </Link>
        <span>·</span>
        <Link to="/legal/responsible-gaming" target="_blank" className="hover:text-muted-foreground transition-colors">
          Responsible Gaming
        </Link>
      </div>
    </div>
  );
};

export default Auth;
