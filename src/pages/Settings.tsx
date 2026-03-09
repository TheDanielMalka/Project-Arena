import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings2, Bell, Shield, Globe, Monitor, Volume2, Trash2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/stores/userStore";
import { AlertCircle } from "lucide-react";

const SettingsPage = () => {
  const { toast } = useToast();
  const { user } = useUserStore();
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [notifications, setNotifications] = useState({
    matchResults: true,
    payouts: true,
    systemAlerts: true,
    promotions: false,
    sounds: true,
  });

  const [security, setSecurity] = useState({
    twoFactor: false,
    loginAlerts: true,
    withdrawWhitelist: false,
  });

  const [preferences, setPreferences] = useState({
    language: "en",
    timezone: "UTC",
    theme: "dark",
  });

  const handleSave = () => {
    toast({ title: "Settings Saved", description: "Your preferences have been updated." });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
          <Settings2 className="h-8 w-8 text-primary" /> Settings
        </h1>
        <p className="text-muted-foreground mt-1">Manage your account preferences</p>
      </div>

      {/* Notifications */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Bell className="h-5 w-5 text-arena-cyan" /> Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {([
            { key: "matchResults", label: "Match Results", desc: "Get notified when matches end" },
            { key: "payouts", label: "Payouts", desc: "Notifications for deposits & withdrawals" },
            { key: "systemAlerts", label: "System Alerts", desc: "Important platform updates" },
            { key: "promotions", label: "Promotions", desc: "Special offers and events" },
            { key: "sounds", label: "Sound Effects", desc: "Play sounds for notifications" },
          ] as const).map((item) => (
            <div key={item.key} className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{item.label}</Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch
                checked={notifications[item.key]}
                onCheckedChange={(checked) => setNotifications((p) => ({ ...p, [item.key]: checked }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-arena-orange" /> Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {([
            { key: "twoFactor", label: "Two-Factor Authentication", desc: "Add an extra layer of security" },
            { key: "loginAlerts", label: "Login Alerts", desc: "Get notified of new login attempts" },
            { key: "withdrawWhitelist", label: "Withdrawal Whitelist", desc: "Only allow withdrawals to saved addresses" },
          ] as const).map((item) => (
            <div key={item.key} className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{item.label}</Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch
                checked={security[item.key]}
                onCheckedChange={(checked) => setSecurity((p) => ({ ...p, [item.key]: checked }))}
              />
            </div>
          ))}

          <Separator className="bg-border" />

          <div>
            <Label className="text-sm font-medium">Change Password</Label>
            <div className="flex gap-2 mt-2">
              <Input type="password" placeholder="Current password" className="bg-secondary border-border" />
              <Input type="password" placeholder="New password" className="bg-secondary border-border" />
              <Button variant="outline" size="sm" className="font-display shrink-0">Update</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-arena-purple" /> Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">Language</Label>
              <Select value={preferences.language} onValueChange={(v) => setPreferences((p) => ({ ...p, language: v }))}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="he">עברית</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="ru">Русский</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium mb-2 block">Theme</Label>
              <Select value={preferences.theme} onValueChange={(v) => setPreferences((p) => ({ ...p, theme: v }))}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="bg-card border-destructive/30">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" /> Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Once you delete your account, there is no going back. All data will be permanently removed.
          </p>

          {!showDeleteConfirm ? (
            <Button variant="destructive" size="sm" className="font-display" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete Account
            </Button>
          ) : (
            <div className="space-y-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <p className="text-sm font-medium">
                  Type <span className="font-mono font-bold">{user?.username ?? "your username"}</span> to confirm deletion
                </p>
              </div>
              <Input
                placeholder="Enter your username..."
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className="bg-secondary border-border font-mono"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="font-display"
                  disabled={deleteConfirmName !== (user?.username ?? "")}
                  onClick={() => {
                    toast({ title: "Account Deleted", description: "Your account has been permanently removed.", variant: "destructive" });
                    setShowDeleteConfirm(false);
                    setDeleteConfirmName("");
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Confirm Delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(""); }}
                  className="text-muted-foreground"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} className="glow-green font-display">
          <Save className="mr-2 h-4 w-4" /> Save All Settings
        </Button>
      </div>
    </div>
  );
};

export default SettingsPage;
