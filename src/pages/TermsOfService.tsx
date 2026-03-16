import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Scale, ShieldAlert, Gavel, AlertOctagon } from "lucide-react";

const TermsOfService = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
          <FileText className="h-8 w-8 text-primary" />
          Terms of Service
        </h1>
        <p className="text-muted-foreground mt-1">
          Binding terms governing your use of Arena products and real-stakes gaming features.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">Effective Date: 2026-03-16</Badge>
          <Badge variant="outline">Version: 1.0</Badge>
          <Badge variant="outline">Jurisdictions: UK / EU / US / Israel</Badge>
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">1) Acceptance of Terms</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            By creating an account, accessing, or using Arena services, you agree to these Terms of Service and all
            applicable policies referenced herein (including Privacy Policy and Responsible Gaming standards).
          </p>
          <p>
            If you do not agree, you must discontinue use immediately.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">2) Eligibility and Restricted Use</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc pl-5 space-y-1">
            <li>You must be at least 18 years old (or legal age in your jurisdiction).</li>
            <li>You may use Arena only where online real-money gaming is lawful.</li>
            <li>You may not use the platform from restricted or sanctioned jurisdictions.</li>
            <li>You may not create or operate multiple accounts without explicit permission.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">3) Account Security and Verification</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>You are responsible for account credentials and all activity under your account.</p>
          <p>
            Arena may request identity verification, source-of-funds information, residency, and additional compliance
            checks (including KYC/AML/sanctions) before enabling or continuing specific features.
          </p>
          <p>
            We may suspend, limit, or terminate accounts pending verification or where risk signals indicate abuse.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">4) Wallet, Stakes, Fees, and Payouts</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc pl-5 space-y-1">
            <li>Users are responsible for wallet access, gas/network fees, and transaction accuracy.</li>
            <li>Stakes may be locked in escrow when joining an eligible match.</li>
            <li>Payouts may be delayed where disputes, fraud checks, or compliance reviews are required.</li>
            <li>Platform fees, if applicable, are disclosed in product settings or match flows.</li>
            <li>Chargeback abuse, payment fraud, or bonus abuse may result in reversals and account closure.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">5) Prohibited Conduct</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>You must not engage in conduct including, without limitation:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Cheating, exploit abuse, botting, account sharing, or collusion.</li>
            <li>Manipulation of match outcomes, evidence flows, or validation systems.</li>
            <li>Money laundering, fraud, identity misuse, or unauthorized payment activity.</li>
            <li>Abusive, discriminatory, threatening, or unlawful behavior toward any user or staff member.</li>
            <li>Attempts to bypass limits, sanctions, geofencing, or security controls.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">6) Responsible Gaming Controls</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Arena supports tools consistent with safer gaming standards, including spend/time controls and exclusion
            options where available.
          </p>
          <p>
            You are responsible for using these controls appropriately. If risk indicators are detected, Arena may
            impose temporary or permanent restrictions for user protection and legal compliance.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Gavel className="h-5 w-5 text-arena-gold" />
            7) Disputes, Investigations, and Enforcement
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Arena may investigate disputed matches, suspicious behavior, payout conflicts, and policy breaches.
          </p>
          <p>
            During review, Arena may freeze escrow/payouts, request additional evidence, and issue outcomes including
            win assignment, refund, void, suspension, or termination.
          </p>
          <p>Platform determinations are made using available technical, gameplay, and compliance evidence.</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">8) Intellectual Property</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Arena software, branding, UI, content, and service components are protected by intellectual property laws.
            You receive a limited, revocable, non-transferable license to use the service in accordance with these
            Terms.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            9) Service Availability and Warranty Disclaimer
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Services are provided on an "as is" and "as available" basis. Arena does not guarantee uninterrupted,
            error-free, or always-available operation.
          </p>
          <p>
            To the maximum extent permitted by law, Arena disclaims warranties, express or implied, including fitness
            for a particular purpose and non-infringement.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">10) Limitation of Liability</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            To the extent permitted by applicable law, Arena and its affiliates are not liable for indirect, incidental,
            special, consequential, or punitive damages, including loss of profits, data, or goodwill.
          </p>
          <p>
            Aggregate liability, where not excluded, is limited to the greater of: (a) fees paid to Arena during the
            preceding 12 months, or (b) the minimum amount required by applicable law.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">11) Indemnification</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            You agree to indemnify and hold harmless Arena, its affiliates, officers, and employees from claims,
            liabilities, losses, and costs arising from your breach of these Terms, unlawful conduct, or misuse of the
            platform.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Scale className="h-5 w-5 text-arena-cyan" />
            12) Governing Law and Jurisdiction
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            These Terms are governed by the laws of <strong>[Insert governing jurisdiction]</strong>, subject to
            mandatory consumer protections in your country of residence where applicable.
          </p>
          <p>
            Exclusive jurisdiction and venue: <strong>[Insert courts/arbitration venue]</strong>, unless otherwise
            required by non-waivable law.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg">13) Changes to Terms</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Arena may update these Terms from time to time. Material updates will be communicated through in-product
            notice, email, or account messaging where appropriate.
          </p>
          <p>Continued use after effective date constitutes acceptance of revised Terms.</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-destructive/30">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-destructive" />
            Legal Notice
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            This page is a high-standard product legal template. Before production launch, it must be finalized by
            qualified legal counsel in each target jurisdiction.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default TermsOfService;
