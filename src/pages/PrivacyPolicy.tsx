import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Globe, Lock, UserCheck, Mail } from "lucide-react";

const PrivacyPolicy = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          Privacy Policy
        </h1>
        <p className="text-muted-foreground mt-1">
          Global privacy standards for Arena users across UK, EU, US, and Israel.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">Effective Date: 2026-03-16</Badge>
          <Badge variant="outline">Version: 1.0</Badge>
          <Badge variant="outline">Applies to: Web, Client, API</Badge>
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">1) Who We Are</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Arena ("we", "us", "our") operates a competitive gaming platform with real-money stakes and related
            services.
          </p>
          <p>
            Data Controller: <strong>[Insert legal entity name]</strong>
          </p>
          <p>
            Registered Address: <strong>[Insert registered address]</strong>
          </p>
          <p>
            Privacy Contact: <strong>[Insert privacy email]</strong>
          </p>
          <p>
            DPO (if appointed): <strong>[Insert DPO details]</strong>
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">2) Scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>This policy applies when you use:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>The Arena web application and authenticated account areas</li>
            <li>Desktop client functionality and match validation flows</li>
            <li>Customer support, security, compliance, and payment operations</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">3) Personal Data We Collect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong>Account and Profile:</strong> username, email, account identifiers, country, and profile settings.
          </p>
          <p>
            <strong>Wallet and Transaction Data:</strong> wallet addresses, network selection, stake history, deposits,
            withdrawals, and payout records.
          </p>
          <p>
            <strong>Match and Platform Activity:</strong> match IDs, outcomes, disputes, gameplay metadata, and
            anti-fraud signals.
          </p>
          <p>
            <strong>Technical and Device Data:</strong> IP address, browser/app logs, cookies, device fingerprints,
            and usage telemetry.
          </p>
          <p>
            <strong>Compliance Data (where required):</strong> identity checks, sanctions screening, source-of-funds
            checks, and risk flags.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">4) How We Use Personal Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide account access, matchmaking flows, escrow handling, and payout logic</li>
            <li>Detect fraud, abuse, cheating, chargebacks, and suspicious behavior</li>
            <li>Comply with legal obligations (AML/KYC, tax, accounting, sanctions, lawful requests)</li>
            <li>Secure services, investigate incidents, and maintain platform integrity</li>
            <li>Improve product performance, UX, and operational reliability</li>
            <li>Send service communications and, where lawful, marketing communications</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">5) Legal Bases (EU/UK)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>For users in the EEA and UK, we process personal data under one or more of the following bases:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Contract:</strong> to deliver requested services and fulfill platform obligations.
            </li>
            <li>
              <strong>Legal Obligation:</strong> to satisfy AML, financial, and regulatory duties.
            </li>
            <li>
              <strong>Legitimate Interests:</strong> security, fraud prevention, analytics, and service improvement.
            </li>
            <li>
              <strong>Consent:</strong> where required (for specific cookies or marketing channels).
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-arena-cyan" />
            6) International Transfers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Your data may be processed in countries outside your place of residence. Where required, we use
            appropriate safeguards, including Standard Contractual Clauses (SCCs), contractual protections, and
            security controls aligned with applicable law.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">7) Sharing and Disclosure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>We may share personal data with:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Payment, wallet, identity, and fraud-prevention providers</li>
            <li>Infrastructure, security, analytics, and customer support providers</li>
            <li>Auditors, legal advisors, and regulators where required</li>
            <li>Law enforcement or authorities under lawful process</li>
            <li>Corporate transaction parties (e.g., merger or acquisition), subject to safeguards</li>
          </ul>
          <p>We do not sell personal data in exchange for money.</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            8) Retention and Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            We retain personal data only as long as needed for service delivery, legal compliance, dispute handling,
            accounting, and security obligations.
          </p>
          <p>
            We apply technical and organizational safeguards, including access controls, encryption in transit,
            monitoring, and incident response practices.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-arena-gold" />
            9) Your Privacy Rights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Depending on your jurisdiction, you may have rights to access, correct, delete, restrict, object, and
            request portability of your personal data.
          </p>
          <p>
            <strong>EU/UK:</strong> GDPR/UK GDPR rights, including complaint rights to your supervisory authority.
          </p>
          <p>
            <strong>US (state laws):</strong> rights may include access, deletion, correction, and opt-out rights where
            applicable.
          </p>
          <p>
            <strong>Israel:</strong> rights under the Protection of Privacy Law and related regulations, including
            access and correction requests.
          </p>
          <p>To exercise rights, contact us via the details below. We may verify identity before processing requests.</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">10) Cookies and Tracking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            We use essential cookies for core service functionality and may use analytics and preference cookies where
            lawful. Where required, we request consent and provide controls to manage non-essential cookies.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">11) Minors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Arena is intended for adults only (18+ or legal age in your jurisdiction). We do not knowingly provide
            services to underage users.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-primary/30">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            12) Contact and Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Privacy Email: <strong>[Insert privacy email]</strong>
          </p>
          <p>
            DPO Contact (if appointed): <strong>[Insert DPO contact]</strong>
          </p>
          <p>
            Postal Address: <strong>[Insert registered address]</strong>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default PrivacyPolicy;
