import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Swords, Mail, Lock, Eye, EyeOff, User, Gamepad2, KeyRound, Chrome, Check, X } from "lucide-react";
import { useUserStore } from "@/stores/userStore";
import { useToast } from "@/hooks/use-toast";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/passwordValidation";
import { cn } from "@/lib/utils";

const Auth = () => {
  const navigate = useNavigate();
  const { login, signup, loginWithGoogle, isAuthenticated } = useUserStore();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupSteamId, setSignupSteamId] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [confirmedAge, setConfirmedAge] = useState(false);
  const [signupFieldErrors, setSignupFieldErrors] = useState<
    Partial<Record<"username" | "email" | "steam", string>>
  >({});

  // Redirect if already logged in (do NOT navigate during render)
  useEffect(() => {
    if (isAuthenticated) navigate("/dashboard", { replace: true });
  }, [isAuthenticated, navigate]);

  if (isAuthenticated) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      toast({ title: "Missing fields", description: "Please enter email and password.", variant: "destructive" });
      return;
    }
    const ok = await login(loginEmail, loginPassword);
    if (!ok) {
      toast({ title: "Login failed", description: "Invalid email or password.", variant: "destructive" });
      return;
    }
    navigate("/dashboard");
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
    const result = await signup(signupUsername, signupEmail, signupPassword, signupSteamId);
    if (result.ok === false) {
      const msg = result.detail ?? "Please check your details and try again.";
      if (result.field === "email") setSignupFieldErrors({ email: msg });
      else if (result.field === "username") setSignupFieldErrors({ username: msg });
      else if (result.field === "steam") setSignupFieldErrors({ steam: msg });
      else {
        toast({ title: "Signup failed", description: msg, variant: "destructive" });
      }
      return;
    }
    navigate("/dashboard");
  };

  const handleGoogle = () => {
    loginWithGoogle();
    navigate("/dashboard");
  };

  if (forgotMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md bg-card border-border">
          <CardHeader className="text-center">
            <h1 className="font-display text-3xl font-bold text-primary text-glow-green tracking-wider mb-1">ARENA</h1>
            <CardTitle className="font-display text-xl">Reset Password</CardTitle>
            <p className="text-sm text-muted-foreground">Enter your email to receive a reset link</p>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <Button className="w-full glow-green font-display" onClick={() => {
              toast({ title: "Email sent!", description: "Check your inbox for the reset link." });
              setForgotMode(false);
            }}>
              Send Reset Link
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setForgotMode(false)}>
              Back to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 gap-4">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <h1 className="font-display text-3xl font-bold text-primary text-glow-green tracking-wider mb-1">ARENA</h1>
          <p className="text-sm text-muted-foreground">Play for Stakes</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
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
                <Button type="submit" className="w-full glow-green font-display text-base">
                  <Swords className="mr-2 h-4 w-4" /> Enter Arena
                </Button>

                <div className="flex items-center gap-3 my-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground uppercase tracking-widest">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <Button type="button" variant="outline" className="w-full border-border hover:bg-secondary font-display" onClick={handleGoogle}>
                  <Chrome className="mr-2 h-4 w-4" /> Continue with Google
                </Button>
              </form>
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
                <div>
                  <label className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                    <Gamepad2 className="h-3 w-3" /> Steam ID
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="76561198XXXXXXXX"
                      value={signupSteamId}
                      onChange={(e) => {
                        setSignupSteamId(e.target.value);
                        setSignupFieldErrors((p) => ({ ...p, steam: undefined }));
                      }}
                      className={cn(
                        "pl-10 bg-secondary border-border font-mono",
                        signupFieldErrors.steam && "border-destructive",
                      )}
                      aria-invalid={!!signupFieldErrors.steam}
                    />
                  </div>
                  {signupFieldErrors.steam ? (
                    <p className="text-xs text-destructive mt-1">{signupFieldErrors.steam}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Find your Steam ID at steamid.io
                    </p>
                  )}
                </div>

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
                  disabled={!confirmedAge || !agreedToTerms}
                >
                  <Swords className="mr-2 h-4 w-4" /> Create Account
                </Button>

                <div className="flex items-center gap-3 my-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground uppercase tracking-widest">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <Button type="button" variant="outline" className="w-full border-border hover:bg-secondary font-display" onClick={handleGoogle}>
                  <Chrome className="mr-2 h-4 w-4" /> Sign up with Google
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Public legal footer */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
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
