import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Globe, Lock, UserCheck, Mail, Eye, Database,
  Cpu, ChevronDown, ChevronUp, AlertTriangle, Swords,
  FileText, Info, ShieldCheck,
} from "lucide-react";

interface Section {
  id: number;
  icon: React.ReactNode;
  title: string;
  content: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 1,
    icon: <Swords className="h-5 w-5 text-primary" />,
    title: "What Is Arena — Platform Context",
    content: (
      <div className="space-y-3">
        <p>
          Arena is a <strong className="text-foreground">peer-to-peer, skill-based competitive gaming platform</strong>.
          Players compete against each other in supported video game titles using real game clients published and
          operated by third-party game developers (such as Valve, Riot Games, Epic Games, and others). Arena does not
          develop, publish, or operate any of the supported games.
        </p>
        <p>
          Arena's role is limited to: facilitating match creation between players, verifying match outcomes using the
          Arena Desktop Client (which reads on-screen game results via optical character recognition), managing
          on-chain escrow via the ArenaEscrow smart contract, and releasing payouts to the verified winner.
        </p>
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
          <p className="text-primary font-semibold text-xs uppercase tracking-widest mb-1">Skill-Based Classification</p>
          <p>
            Match outcomes on Arena are determined exclusively by player performance within the game. Arena does not
            control, influence, or predict match outcomes. We rely on the game publisher's official software, servers,
            and anti-cheat systems for result integrity.
          </p>
        </div>
        <p>
          Understanding this structure is important for privacy purposes: some data we process originates from your
          interactions with third-party games, not directly from Arena systems.
        </p>
      </div>
    ),
  },
  {
    id: 2,
    icon: <Shield className="h-5 w-5 text-muted-foreground" />,
    title: "Who We Are & How to Contact Us",
    content: (
      <div className="space-y-3">
        <p>
          Arena ("we", "us", "our") operates the Arena platform including the web application, Arena Desktop Client,
          and associated APIs and smart contracts.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {[
            { label: "Data Controller", value: "[Insert legal entity name]" },
            { label: "Registered Address", value: "[Insert registered address]" },
            { label: "Privacy Contact", value: "privacy@arena.gg" },
            { label: "DPO (if appointed)", value: "[Insert DPO details]" },
          ].map((item) => (
            <div key={item.label} className="bg-secondary/40 border border-border/50 rounded-lg px-3 py-2">
              <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">{item.label}</p>
              <p className="text-foreground text-xs mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
        <p>
          For all privacy-related requests, contact us at <strong className="text-foreground">privacy@arena.gg</strong> with
          the subject line matching your request type (e.g., "Data Access Request", "Data Deletion Request").
        </p>
      </div>
    ),
  },
  {
    id: 3,
    icon: <AlertTriangle className="h-5 w-5 text-arena-gold" />,
    title: "Age Requirement — 18+ Only",
    content: (
      <div className="space-y-3">
        <div className="bg-arena-gold/10 border border-arena-gold/30 rounded-lg p-3">
          <p className="text-arena-gold font-semibold mb-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Strict Age Restriction
          </p>
          <p>
            Arena is intended exclusively for individuals who are{" "}
            <strong className="text-foreground">18 years of age or older</strong> (or the minimum legal age in your
            jurisdiction, if higher). We do not knowingly collect, process, or store personal data from any person
            under 18 years of age.
          </p>
        </div>
        <p>
          At registration, users are required to explicitly confirm their age via a mandatory checkbox. This
          confirmation is recorded along with the account creation timestamp and IP address as part of our compliance
          obligations.
        </p>
        <p>
          If we become aware that personal data has been submitted by or on behalf of a person under 18, we will
          immediately suspend the account, delete all associated personal data, and reverse any pending transactions
          to the extent technically possible. If you believe an underage individual has created an account, please
          contact us immediately at <strong className="text-foreground">privacy@arena.gg</strong>.
        </p>
        <p>
          We do not use age-gating techniques that can be trivially bypassed. Age confirmation constitutes a binding
          representation by the user. Misrepresentation of age is a material breach of our Terms of Service.
        </p>
      </div>
    ),
  },
  {
    id: 4,
    icon: <FileText className="h-5 w-5 text-muted-foreground" />,
    title: "Scope — What This Policy Covers",
    content: (
      <div className="space-y-3">
        <p>This Privacy Policy applies to personal data processed when you:</p>
        <ul className="space-y-1.5">
          {[
            "Visit or use the Arena web application (arena.gg and subdomains)",
            "Create an account and use authenticated platform features",
            "Use the Arena Desktop Client for game session detection and result reporting",
            "Participate in staked matches, disputes, or support interactions",
            "Connect third-party accounts (Steam, Google, etc.) via OAuth",
            "Access Arena APIs, smart contracts, or blockchain-facing services",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <span className="text-primary mt-1 shrink-0">›</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>
          This Policy does not cover the privacy practices of third-party game publishers, blockchain networks,
          wallet providers, or other external services you may use in connection with Arena. Those services are
          governed by their own privacy policies.
        </p>
      </div>
    ),
  },
  {
    id: 5,
    icon: <Database className="h-5 w-5 text-arena-cyan" />,
    title: "Personal Data We Collect",
    content: (
      <div className="space-y-4">
        {[
          {
            title: "Account & Identity Data",
            items: [
              "Username, email address, password hash (never plaintext)",
              "Date of birth / age confirmation record",
              "Country of residence and language preference",
              "Profile settings, avatar, and display preferences",
              "Registration timestamp, IP address at creation",
            ],
          },
          {
            title: "Wallet & Transaction Data",
            items: [
              "Blockchain wallet addresses (public — visible on-chain)",
              "Network selection (BSC, Solana, Ethereum, etc.)",
              "Stake history, deposit and withdrawal records",
              "Match pot amounts, payout records, platform fee logs",
              "KYC/AML verification data (where triggered by threshold or regulation)",
            ],
          },
          {
            title: "Match & Platform Activity",
            items: [
              "Match IDs, game titles, match modes and results",
              "Dispute submissions and resolution records",
              "In-game metadata captured by the Desktop Client (scoreboard OCR data)",
              "Steam IDs, game account identifiers linked to your Arena account",
              "Anti-fraud signals, behavioral patterns, and anomaly flags",
            ],
          },
          {
            title: "Technical & Device Data",
            items: [
              "IP address, geolocation (country/region level)",
              "Browser type and version, operating system",
              "Device identifiers, screen resolution",
              "Session logs, page navigation, feature usage telemetry",
              "Desktop Client: running process names (only for supported game detection), OS version",
            ],
          },
          {
            title: "Compliance Data (where required)",
            items: [
              "Identity verification documents (where KYC is triggered)",
              "Source-of-funds declarations",
              "Sanctions screening results (OFAC and equivalents)",
              "Tax-related information where applicable by law",
            ],
          },
        ].map((group) => (
          <div key={group.title}>
            <p className="text-xs font-semibold text-foreground mb-1.5">{group.title}</p>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs">
                  <span className="text-primary mt-0.5 shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 6,
    icon: <Eye className="h-5 w-5 text-primary" />,
    title: "How We Use Your Personal Data",
    content: (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { purpose: "Service Delivery", desc: "Account management, match creation, escrow handling, payout logic, leaderboards, XP/level tracking." },
            { purpose: "Game Verification", desc: "Desktop Client reads on-screen results via OCR to verify match outcomes — no gameplay data is recorded or stored beyond the result." },
            { purpose: "Fraud & Abuse Prevention", desc: "Detecting cheating, collusion, match manipulation, multi-accounting, chargebacks, and financial fraud." },
            { purpose: "Legal Compliance", desc: "AML/KYC checks, sanctions screening, tax reporting, regulatory requests, and audit obligations." },
            { purpose: "Security & Integrity", desc: "Incident response, intrusion detection, access control, account recovery, and platform integrity." },
            { purpose: "Product Improvement", desc: "Usage analytics, performance monitoring, feature development, and UX optimization." },
            { purpose: "Communications", desc: "Service notifications, security alerts, dispute updates, and (where consented) product announcements." },
            { purpose: "Dispute Resolution", desc: "Investigating contested matches, reviewing submitted evidence, and making binding platform determinations." },
          ].map((item) => (
            <div key={item.purpose} className="bg-secondary/30 border border-border/40 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-foreground">{item.purpose}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 7,
    icon: <Cpu className="h-5 w-5 text-arena-cyan" />,
    title: "Desktop Client & Game Data",
    content: (
      <div className="space-y-3">
        <p>
          The Arena Desktop Client is a lightweight background application that enables automatic match result
          verification without manual input. We are transparent about exactly what data it accesses:
        </p>
        <div className="bg-secondary/40 border border-border rounded-lg p-3 space-y-2 text-sm">
          <p className="font-semibold text-foreground text-xs uppercase tracking-widest">What the Client Does</p>
          <ul className="space-y-1">
            {[
              "Monitors running system processes to detect when a supported game is active (process name only — no game content is read)",
              "Captures screen regions containing the match result/scoreboard at match end",
              "Applies OCR to extract: player names, scores, win/loss status",
              "Transmits the extracted result data to Arena servers over encrypted HTTPS",
              "Discards captured images immediately after OCR extraction — screenshots are not stored",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs">
                <span className="text-primary shrink-0 mt-0.5">›</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm">
          <p className="font-semibold text-foreground text-xs uppercase tracking-widest mb-1">What the Client Does NOT Do</p>
          <ul className="space-y-1">
            {[
              "Does not access, record, or transmit gameplay footage, audio, or in-game chat",
              "Does not access files, documents, browser data, or any non-game content",
              "Does not inject into or modify game processes",
              "Does not run when no supported game is detected",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs">
                <span className="text-destructive shrink-0 mt-0.5">✕</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <p>
          <strong className="text-foreground">Third-party game data:</strong> Game publishers (Valve, Riot, Epic, etc.)
          independently collect data through their own clients, anti-cheat systems, and services. Arena has no
          control over this data collection. Please review each publisher's privacy policy for details.
        </p>
      </div>
    ),
  },
  {
    id: 8,
    icon: <Globe className="h-5 w-5 text-arena-cyan" />,
    title: "Blockchain & On-Chain Data",
    content: (
      <div className="space-y-3">
        <p>
          Arena uses blockchain-based smart contracts for escrow and payout. Blockchain networks are public and
          immutable by design. You should be aware of the following privacy implications:
        </p>
        <ul className="space-y-2">
          {[
            "Your wallet address and all on-chain transactions (deposits, match stakes, payouts) are permanently recorded on a public blockchain and visible to anyone.",
            "Arena cannot delete or modify on-chain data — this is a fundamental property of blockchain networks.",
            "While wallet addresses are pseudonymous, they can potentially be linked to your identity by third parties through blockchain analytics.",
            "Arena does not publish a direct mapping of wallet addresses to usernames publicly, but may disclose this in response to valid legal process.",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <span className="text-arena-cyan mt-1 shrink-0">›</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>
          If privacy on-chain is important to you, consider using a dedicated wallet address for Arena activity.
        </p>
      </div>
    ),
  },
  {
    id: 9,
    icon: <Globe className="h-5 w-5 text-muted-foreground" />,
    title: "Sharing & Disclosure of Personal Data",
    content: (
      <div className="space-y-3">
        <p>We do not sell your personal data. We may share it only in the following circumstances:</p>
        <ul className="space-y-2">
          {[
            { who: "Service Providers", what: "Infrastructure, cloud hosting (AWS/Azure), KYC/identity verification, payment processors, fraud detection, analytics, and customer support vendors. Bound by data processing agreements." },
            { who: "Law Enforcement & Regulators", what: "Where required by valid legal process (court order, subpoena, regulatory demand), national security requirements, or to prevent imminent harm or financial crime." },
            { who: "Sanctions Screening", what: "We screen against OFAC and equivalent international sanctions lists. Flagged data may be shared with compliance authorities." },
            { who: "Business Transactions", what: "In connection with any merger, acquisition, asset sale, or financing — subject to equivalent privacy protections and notification where required by law." },
            { who: "Dispute Resolution", what: "Match evidence (OCR data, timestamps, account metadata) shared internally for dispute investigation. Fraud evidence may be shared with game publishers or law enforcement." },
            { who: "With Your Consent", what: "For any purpose you explicitly authorize at the time of request." },
          ].map((item) => (
            <div key={item.who} className="border-l-2 border-border pl-3 py-1">
              <p className="text-xs font-semibold text-foreground">{item.who}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.what}</p>
            </div>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: 10,
    icon: <Eye className="h-5 w-5 text-muted-foreground" />,
    title: "Cookies & Tracking Technologies",
    content: (
      <div className="space-y-3">
        <p>We use the following types of cookies and tracking technologies:</p>
        <ul className="space-y-2">
          {[
            { type: "Essential Cookies", desc: "Required for core platform functionality (authentication sessions, security tokens, CSRF protection). Cannot be disabled without breaking the service." },
            { type: "Analytics Cookies", desc: "Help us understand how users interact with Arena (page views, feature usage, error rates). Where required by law, we request consent before setting these." },
            { type: "Preference Cookies", desc: "Store your settings (language, display preferences). Cleared when you clear browser data." },
          ].map((item) => (
            <div key={item.type} className="bg-secondary/30 border border-border/40 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-foreground">{item.type}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
          ))}
        </ul>
        <p>
          We do not use advertising or cross-site tracking cookies. We do not share cookie data with advertising
          networks or data brokers.
        </p>
        <p>
          You may manage cookies through your browser settings. Disabling essential cookies will prevent you from
          accessing authenticated features.
        </p>
      </div>
    ),
  },
  {
    id: 11,
    icon: <Shield className="h-5 w-5 text-primary" />,
    title: "Legal Bases for Processing (EU / UK GDPR)",
    content: (
      <div className="space-y-3">
        <p>For users in the EEA, UK, and other GDPR-equivalent jurisdictions, we process your personal data under the following legal bases:</p>
        <ul className="space-y-2">
          {[
            { base: "Contract (Art. 6(1)(b))", desc: "Processing necessary to deliver our services — account management, match facilitation, escrow handling, payouts, and dispute resolution." },
            { base: "Legal Obligation (Art. 6(1)(c))", desc: "AML/KYC compliance, sanctions screening, tax and financial reporting, and responses to lawful regulatory or legal process." },
            { base: "Legitimate Interests (Art. 6(1)(f))", desc: "Fraud prevention, security, anti-cheat measures, platform integrity, product analytics, and service improvement — subject to balancing tests." },
            { base: "Consent (Art. 6(1)(a))", desc: "Where required for non-essential cookies, marketing communications, or other processing not covered by the above." },
          ].map((item) => (
            <div key={item.base} className="border-l-2 border-primary/30 pl-3 py-1">
              <p className="text-xs font-semibold text-foreground">{item.base}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: 12,
    icon: <Globe className="h-5 w-5 text-arena-cyan" />,
    title: "International Data Transfers",
    content: (
      <div className="space-y-3">
        <p>
          Arena's infrastructure is hosted primarily on AWS (EU region). However, your data may be processed in
          countries outside your country of residence as part of our global service delivery and compliance operations.
        </p>
        <p>
          Where personal data is transferred outside the EEA or UK, we ensure appropriate safeguards are in place,
          including Standard Contractual Clauses (SCCs), adequacy decisions, or equivalent binding protections as
          required by applicable law.
        </p>
        <p>
          Blockchain transactions are processed on public distributed networks (e.g., Polygon, BSC, Ethereum) that
          operate globally with no single jurisdiction of processing.
        </p>
      </div>
    ),
  },
  {
    id: 13,
    icon: <Lock className="h-5 w-5 text-primary" />,
    title: "Data Retention & Security",
    content: (
      <div className="space-y-3">
        <p>
          We retain personal data only for as long as necessary to fulfill the purposes described in this Policy,
          satisfy legal and regulatory obligations, resolve disputes, enforce agreements, and maintain security
          records.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            { category: "Account Data", period: "Duration of account + 5 years post-closure (legal hold)" },
            { category: "Match & Payout Records", period: "7 years (financial records requirement)" },
            { category: "KYC / AML Data", period: "5 years from last transaction (regulatory minimum)" },
            { category: "Security & Fraud Logs", period: "3 years" },
            { category: "Support Tickets", period: "3 years" },
            { category: "Marketing Consents", period: "Until withdrawn + 1 year" },
          ].map((item) => (
            <div key={item.category} className="bg-secondary/30 border border-border/40 rounded-lg px-3 py-2">
              <p className="font-semibold text-foreground">{item.category}</p>
              <p className="text-muted-foreground mt-0.5">{item.period}</p>
            </div>
          ))}
        </div>
        <p>
          <strong className="text-foreground">Security measures include:</strong> encryption in transit (TLS 1.3),
          encrypted storage for sensitive fields, role-based access controls, multi-factor authentication for
          administrative access, intrusion detection systems, and regular security audits.
        </p>
        <p>
          No system is 100% secure. In the event of a data breach affecting your rights, we will notify you and
          relevant authorities within the timeframes required by applicable law (e.g., 72 hours under GDPR).
        </p>
      </div>
    ),
  },
  {
    id: 14,
    icon: <UserCheck className="h-5 w-5 text-arena-gold" />,
    title: "Your Privacy Rights",
    content: (
      <div className="space-y-4">
        <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
        <div className="space-y-2">
          {[
            { right: "Right to Access", desc: "Request a copy of the personal data we hold about you and how it is used.", email: "Privacy / Personal Data Access" },
            { right: "Right to Rectification", desc: "Request correction of inaccurate or incomplete personal data.", email: "Privacy / Personal Data Rectification" },
            { right: "Right to Erasure", desc: "Request deletion of your personal data, subject to legal retention obligations.", email: "Erasure / Personal Data Deletion" },
            { right: "Right to Restriction", desc: "Request that we restrict processing of your data in certain circumstances.", email: "Privacy / Processing Restriction" },
            { right: "Right to Portability", desc: "Receive your personal data in a structured, machine-readable format.", email: "Privacy / Data Portability" },
            { right: "Right to Object", desc: "Object to processing based on legitimate interests, including profiling.", email: "Privacy / Objection to Processing" },
            { right: "Right to Withdraw Consent", desc: "Where processing is based on consent, withdraw it at any time without affecting prior processing.", email: "Privacy / Withdraw Consent" },
          ].map((item) => (
            <div key={item.right} className="border-l-2 border-arena-gold/30 pl-3 py-1">
              <p className="text-xs font-semibold text-foreground">{item.right}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
              <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                Email: privacy@arena.gg · Subject: "{item.email}"
              </p>
            </div>
          ))}
        </div>
        <div className="bg-secondary/30 border border-border/40 rounded-lg px-3 py-2 text-xs space-y-1">
          <p className="font-semibold text-foreground">Jurisdiction-Specific Notes</p>
          <p><strong className="text-foreground">EU/EEA & UK:</strong> GDPR/UK GDPR rights apply. Right to lodge a complaint with your national supervisory authority (e.g., ICO in the UK, CNIL in France).</p>
          <p><strong className="text-foreground">California (CCPA):</strong> Right to know, delete, correct, and opt out of sale (we do not sell data). Contact us via the details above.</p>
          <p><strong className="text-foreground">Israel:</strong> Rights under the Protection of Privacy Law 5741-1981, including access and correction rights.</p>
        </div>
        <p className="text-sm">
          We may verify your identity before processing rights requests. We aim to respond within 30 days (or
          the shorter period required by applicable law).
        </p>
      </div>
    ),
  },
  {
    id: 15,
    icon: <Info className="h-5 w-5 text-muted-foreground" />,
    title: "Changes to This Policy",
    content: (
      <div className="space-y-3">
        <p>
          We may update this Privacy Policy from time to time. Material changes will be communicated via
          in-platform notification or email at least 14 days before taking effect (where practicable for non-urgent
          changes). Changes required by law or to address security incidents may take effect immediately.
        </p>
        <p>
          The "Last Updated" date at the top of this page reflects the most recent revision. Continued use of
          Arena after the effective date constitutes acceptance of the updated Policy.
        </p>
        <p>
          We encourage you to review this Policy periodically. Historical versions are available upon request.
        </p>
      </div>
    ),
  },
  {
    id: 16,
    icon: <Mail className="h-5 w-5 text-primary" />,
    title: "Contact Us",
    content: (
      <div className="space-y-3">
        <p>
          For all privacy-related inquiries, data subject requests, or concerns about how we handle your personal
          data, please contact us:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Privacy Email", value: "privacy@arena.gg" },
            { label: "DPO Contact", value: "[Insert DPO contact]" },
            { label: "Postal Address", value: "[Insert registered address]" },
          ].map((item) => (
            <div key={item.label} className="bg-secondary/40 border border-border/50 rounded-lg px-3 py-3">
              <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">{item.label}</p>
              <p className="text-foreground text-xs mt-1">{item.value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          We will confirm receipt of your request within 5 business days and aim to resolve all requests within
          30 days. Complex requests may require up to 90 days with prior notification.
        </p>
      </div>
    ),
  },
];

const ExpandableSection = ({ section, forceOpen }: { section: Section; forceOpen: boolean }) => {
  const [localOpen, setLocalOpen] = useState(false);
  const open = forceOpen || localOpen;

  return (
    <div className={`border rounded-xl overflow-hidden transition-all duration-200 ${open ? "border-primary/30 bg-card" : "border-border bg-card/60 hover:border-border/80"}`}>
      <button
        onClick={() => setLocalOpen(!localOpen)}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0">{section.icon}</span>
          <span className="text-xs font-mono text-muted-foreground/50 shrink-0">§{section.id}</span>
          <span className="font-display font-semibold text-sm text-foreground">{section.title}</span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 text-sm text-muted-foreground border-t border-border/50 leading-relaxed">
          {section.content}
        </div>
      )}
    </div>
  );
};

const PrivacyPolicy = () => {
  const [allOpen, setAllOpen] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary" />
              Privacy Policy
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              How Arena collects, uses, and protects your personal data.
            </p>
          </div>
          <button
            onClick={() => setAllOpen(!allOpen)}
            className="text-xs text-primary hover:underline font-display mt-1 shrink-0"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="font-mono text-xs">Last Updated: 2026-03-26</Badge>
          <Badge variant="outline" className="font-mono text-xs">Version: 2.0</Badge>
          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Skill-Based P2P</Badge>
          <Badge className="bg-arena-gold/20 text-arena-gold border-arena-gold/30 text-xs">18+ Only</Badge>
          <Badge className="bg-arena-cyan/20 text-arena-cyan border-arena-cyan/30 text-xs">GDPR · CCPA · IL</Badge>
        </div>

        {/* Quick cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          {[
            { icon: <ShieldCheck className="h-4 w-4 text-primary" />, label: "We Don't Sell Data", desc: "Your personal data is never sold to third parties" },
            { icon: <Cpu className="h-4 w-4 text-arena-cyan" />, label: "Minimal Collection", desc: "Desktop Client reads scores only — no gameplay recorded" },
            { icon: <AlertTriangle className="h-4 w-4 text-arena-gold" />, label: "18+ Enforced", desc: "Age confirmation recorded at registration" },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3 bg-secondary/40 border border-border/50 rounded-lg px-4 py-3">
              {item.icon}
              <div>
                <p className="text-xs font-semibold text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {SECTIONS.map((section) => (
          <ExpandableSection key={section.id} section={section} forceOpen={allOpen} />
        ))}
      </div>

      {/* Legal Notice */}
      <div className="border border-border/50 rounded-xl px-5 py-4 flex items-start gap-3 bg-card/40">
        <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-sm space-y-1">
          <p className="font-semibold text-foreground">Legal Notice</p>
          <p className="text-muted-foreground">
            This Privacy Policy is a high-standard template designed for a skill-based competitive gaming platform
            operating across multiple jurisdictions. Before production launch, all provisions must be reviewed and
            finalized by qualified legal counsel — particularly GDPR Article 13/14 notices, DPA registrations, and
            jurisdiction-specific disclosure requirements. Nothing herein constitutes legal advice.
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/50 text-center pb-4">
        Arena © {new Date().getFullYear()} — All rights reserved. Last Updated: 2026-03-26
      </p>
    </div>
  );
};

export default PrivacyPolicy;
