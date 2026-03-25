import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Scale, ShieldAlert, Gavel, AlertOctagon,
  Swords, Trophy, Wallet, Globe, Lock, Eye, ChevronDown, ChevronUp,
  ShieldCheck, UserX, Zap, AlertTriangle, Info,
} from "lucide-react";

interface Section {
  id: number;
  icon: React.ReactNode;
  title: string;
  accent?: string;
  content: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 1,
    icon: <Swords className="h-5 w-5 text-primary" />,
    title: "Nature of Service — Skill-Based Competition Platform",
    content: (
      <div className="space-y-3">
        <p>
          Arena operates a <strong className="text-foreground">peer-to-peer, skill-based competition platform</strong> that
          allows users to enter head-to-head or team matches in supported video games and place stakes on the outcome.
          Arena is not a casino, gambling operator, bookmaker, or lottery service.
        </p>
        <p>
          Match outcomes on Arena are determined exclusively by players' in-game performance and skill, using real game
          clients with active anti-cheat enforcement by the game publisher. Arena does not control, influence, or determine
          match outcomes.
        </p>
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-2">
          <p className="text-primary font-medium text-xs uppercase tracking-widest mb-1">Skill-Based Classification</p>
          <p>
            Platforms where outcomes are determined predominantly by participant skill rather than chance are legally
            distinguished from gambling in many jurisdictions. Arena is designed and operated as a skill-based competition
            service. It is your responsibility to verify local laws before participating.
          </p>
        </div>
        <p>
          Stakes are locked in a non-custodial smart contract (ArenaEscrow) for the duration of each match. Arena
          does not hold, control, or have access to player funds at any time. The contract releases funds
          automatically upon verified match result.
        </p>
      </div>
    ),
  },
  {
    id: 2,
    icon: <FileText className="h-5 w-5 text-muted-foreground" />,
    title: "Acceptance of Terms",
    content: (
      <div className="space-y-3">
        <p>
          By creating an account, checking the acceptance boxes during registration, or otherwise accessing or using
          Arena services, you enter into a legally binding agreement with Arena and agree to be bound by these Terms of
          Service ("Terms"), together with our Privacy Policy and any supplemental policies referenced herein.
        </p>
        <p>
          If you do not agree to these Terms in full, you must not create an account or use Arena services.
        </p>
        <p>
          Your acceptance is recorded at the time of registration, including the IP address, device fingerprint, and
          timestamp of your confirmation. This constitutes a valid and enforceable electronic acknowledgment.
        </p>
      </div>
    ),
  },
  {
    id: 3,
    icon: <ShieldCheck className="h-5 w-5 text-arena-gold" />,
    title: "Eligibility — Age Requirement and Jurisdiction",
    accent: "arena-gold",
    content: (
      <div className="space-y-3">
        <div className="bg-arena-gold/10 border border-arena-gold/30 rounded-lg p-3">
          <p className="text-arena-gold font-semibold flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4" /> Age Requirement — 18+
          </p>
          <p>
            You must be at least <strong className="text-foreground">18 years of age</strong> (or the minimum legal age
            in your jurisdiction, if higher) to create an account or participate in any real-money match. By registering,
            you represent and warrant that you meet this requirement.
          </p>
        </div>
        <p>
          <strong className="text-foreground">Jurisdiction responsibility:</strong> You represent that your use of Arena
          is lawful under the laws of your country, state, province, or territory of residence. It is your sole
          responsibility to determine whether skill-based competition with financial stakes is permitted where you live.
          Arena does not constitute legal or regulatory advice.
        </p>
        <p>
          Arena reserves the right to restrict access from jurisdictions where operations are not compliant with local
          law. Restricted jurisdictions include, but are not limited to: United States (federal and certain states), United
          Kingdom, Australia, France, Germany, Netherlands, Russia, Iran, North Korea, and OFAC-sanctioned territories.
          This list may be updated without notice.
        </p>
        <p>
          <strong className="text-foreground">Multiple accounts:</strong> Each user may hold only one account. Creating
          multiple accounts for any reason — including circumventing restrictions or bans — is strictly prohibited and
          will result in permanent closure of all associated accounts and forfeiture of any balances.
        </p>
      </div>
    ),
  },
  {
    id: 4,
    icon: <Globe className="h-5 w-5 text-destructive" />,
    title: "VPN, Proxy, and Geo-Restriction Bypass — Strictly Prohibited",
    accent: "destructive",
    content: (
      <div className="space-y-3">
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-destructive font-semibold mb-1">Prohibited Use of Anonymization Tools</p>
          <p>
            You must not use a VPN, proxy server, Tor network, IP masking service, or any other technology to disguise
            your true geographic location, circumvent geographic restrictions, or access Arena from a restricted
            jurisdiction.
          </p>
        </div>
        <p>
          Violation of this provision may result in: immediate account suspension, forfeiture of funds in contested
          matches, permanent ban, and referral to relevant authorities where applicable.
        </p>
        <p>
          Arena employs IP geolocation, behavioral analysis, and account pattern detection to enforce geographic
          restrictions. Evasion attempts are logged and may be shared with regulators and law enforcement upon request.
        </p>
      </div>
    ),
  },
  {
    id: 5,
    icon: <AlertTriangle className="h-5 w-5 text-arena-orange" />,
    title: "Financial Risk Acknowledgment",
    accent: "arena-orange",
    content: (
      <div className="space-y-3">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          <p className="text-amber-400 font-semibold mb-1">Important — Risk of Financial Loss</p>
          <p>
            By participating in staked matches, you acknowledge that you may lose the full amount of your stake. Past
            performance in matches does not guarantee future results. You should only stake amounts you are prepared to
            lose in full.
          </p>
        </div>
        <p>
          Arena is a competition platform, not an investment vehicle. Stakes are forfeited to the winning player (minus
          platform fee) upon match result. Refunds are available only in specific circumstances defined in Section 9.
        </p>
        <p>
          <strong className="text-foreground">Platform fee:</strong> Arena charges a 5% commission on the total pot of
          each completed match. This fee is deducted automatically by the smart contract prior to payout. No additional
          hidden fees apply.
        </p>
      </div>
    ),
  },
  {
    id: 6,
    icon: <Lock className="h-5 w-5 text-arena-cyan" />,
    title: "Account Security and Identity Verification",
    content: (
      <div className="space-y-3">
        <p>
          You are solely responsible for maintaining the security of your account credentials and for all activity
          conducted through your account. Do not share your login credentials with any third party.
        </p>
        <p>
          Arena may, at its discretion or when required by applicable law, request identity verification (KYC),
          source-of-funds documentation, proof of age, residency confirmation, or additional AML/compliance information
          before enabling real-money features, processing withdrawals, or continuing service.
        </p>
        <p>
          Failure to complete requested verification may result in restriction, suspension, or closure of your account
          and withholding of funds pending compliance review.
        </p>
        <p>
          Arena screens accounts against international sanctions lists (including OFAC SDN) as part of AML obligations.
          Accounts flagged during screening will be suspended pending review.
        </p>
      </div>
    ),
  },
  {
    id: 7,
    icon: <Wallet className="h-5 w-5 text-primary" />,
    title: "Smart Contract Escrow, Stakes, and Payouts",
    content: (
      <div className="space-y-3">
        <p>
          <strong className="text-foreground">Non-custodial escrow:</strong> When you join a staked match, your stake is
          transferred to the ArenaEscrow smart contract deployed on the applicable blockchain network. At no point does
          Arena hold, control, or have access to escrowed funds. The contract is public, immutable, and auditable.
        </p>
        <p>
          <strong className="text-foreground">Payout mechanism:</strong> Upon receipt of a verified match result from the
          Arena Vision Engine oracle, the contract automatically releases the total pot (minus 5% platform fee) to the
          verified winner's wallet address.
        </p>
        <p>
          <strong className="text-foreground">Timeout refund:</strong> If no verified result is submitted within the
          match timeout window (2 hours), either player may trigger an automatic refund of their original stake via the
          smart contract. This mechanism protects players if the Vision Engine becomes unavailable.
        </p>
        <p>
          <strong className="text-foreground">Network fees:</strong> Blockchain transaction fees (gas) associated with
          match creation, joining, and payout are the responsibility of the participating players. Arena does not control
          network congestion or gas prices.
        </p>
        <p>
          Payouts may be delayed where disputes, fraud investigations, sanctions screening, or compliance reviews are in
          progress. Arena is not liable for delays attributable to blockchain network conditions.
        </p>
      </div>
    ),
  },
  {
    id: 8,
    icon: <Trophy className="h-5 w-5 text-primary" />,
    title: "Game Integrity, Anti-Cheat, and Third-Party Games",
    content: (
      <div className="space-y-3">
        <p>
          Arena supports competitions in third-party video games (including but not limited to: CS2, Valorant, Fortnite,
          Call of Duty). These games are owned and operated by their respective publishers. Arena has no affiliation with,
          endorsement from, or control over these games, their anti-cheat systems, or their match outcomes.
        </p>
        <div className="bg-secondary/60 border border-border rounded-lg p-3">
          <p className="text-foreground font-medium mb-1">No Liability for Game-Side Outcomes</p>
          <p>
            Arena is not responsible for bans, disconnections, server outages, bugs, or any other conditions caused by
            third-party game software or infrastructure. In the event of a game-side technical failure mid-match, the
            dispute resolution process defined in Section 9 applies.
          </p>
        </div>
        <p>
          <strong className="text-foreground">Cheating using in-game hacks, aimbots, wallhacks, macros, or any
          third-party software that provides an unfair advantage is strictly prohibited</strong> and constitutes fraud
          against your opponent. Arena relies on the game publisher's anti-cheat systems as the primary enforcement
          mechanism. Detection by a game's anti-cheat (e.g., VAC, Vanguard, EasyAntiCheat) constitutes presumptive
          evidence of cheating in any pending Arena dispute.
        </p>
        <p>
          Confirmed cheaters face: permanent account ban, forfeiture of all balances, retroactive compensation to
          defrauded opponents (including matches where evidence is submitted post-hoc), and referral to legal authorities
          where financial fraud is established.
        </p>
      </div>
    ),
  },
  {
    id: 9,
    icon: <Gavel className="h-5 w-5 text-arena-gold" />,
    title: "Disputes, Investigations, and Enforcement",
    content: (
      <div className="space-y-3">
        <p>
          Arena may investigate disputed matches, suspicious account behavior, payout conflicts, and reported policy
          breaches. During any investigation, Arena may freeze escrow, suspend payouts, request evidence (screenshots,
          video, logs), and restrict account access.
        </p>
        <p>
          <strong className="text-foreground">Possible outcomes:</strong> win assignment, partial or full refund, match
          void, stake forfeiture, temporary suspension, or permanent account termination. Platform determinations are
          made using available technical, gameplay, vision-engine, and compliance evidence and are at Arena's sole
          discretion.
        </p>
        <p>
          <strong className="text-foreground">Dispute submission:</strong> Disputes must be submitted within 48 hours
          of match completion. Late submissions may be declined at Arena's discretion.
        </p>
        <p>
          Arena's decisions on disputes are final and binding, subject only to applicable mandatory consumer protection
          laws in your jurisdiction. You waive the right to challenge dispute outcomes through chargebacks or third-party
          payment reversal mechanisms.
        </p>
      </div>
    ),
  },
  {
    id: 10,
    icon: <UserX className="h-5 w-5 text-destructive" />,
    title: "Prohibited Conduct",
    accent: "destructive",
    content: (
      <div className="space-y-3">
        <p>You must not engage in the following conduct. This list is illustrative, not exhaustive:</p>
        <ul className="space-y-2">
          {[
            "Using cheats, hacks, aimbots, macros, exploits, or unauthorized third-party software in any match.",
            "Match-fixing, collusion, self-play via alternate accounts, or any coordinated manipulation of match outcomes.",
            "Money laundering, structuring transactions to evade reporting thresholds, or using Arena proceeds for unlawful purposes.",
            "Identity fraud, impersonation, or use of another person's account or payment method.",
            "Attempting to access, exploit, reverse-engineer, or tamper with Arena systems, smart contracts, APIs, or databases.",
            "Using VPNs, proxies, or other tools to bypass geographic restrictions or account bans.",
            "Harassment, threats, hate speech, or abusive conduct toward other users, staff, or third parties.",
            "Creating multiple accounts, sharing accounts, or selling/transferring accounts.",
            "Abuse of the dispute system through false claims or fabricated evidence.",
            "Any conduct that violates applicable law or regulation in your jurisdiction.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-destructive mt-0.5 shrink-0">✕</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: 11,
    icon: <Zap className="h-5 w-5 text-primary" />,
    title: "Responsible Gaming",
    content: (
      <div className="space-y-3">
        <p>
          Arena promotes responsible participation. Users are encouraged to set personal limits on stakes and session
          duration. If you believe you may have a problem with compulsive competition or financial self-control, seek
          help from a professional organization in your country.
        </p>
        <p>
          Arena may impose stake limits, cooling-off periods, or temporary account restrictions where usage patterns
          suggest potential harm. These measures do not constitute an admission of liability.
        </p>
        <p>
          Self-exclusion requests may be submitted to support. Once processed, exclusions are irrevocable for the
          requested period and cannot be reversed for any reason including claimed financial urgency.
        </p>
      </div>
    ),
  },
  {
    id: 12,
    icon: <Eye className="h-5 w-5 text-muted-foreground" />,
    title: "Intellectual Property",
    content: (
      <p>
        All Arena software, platform design, branding, user interfaces, analytics systems, and service components are
        the exclusive intellectual property of Arena and its licensors. You receive a limited, non-exclusive,
        non-transferable, revocable license to use the service solely as intended and in accordance with these Terms.
        You may not copy, modify, distribute, sell, or reverse-engineer any Arena component.
      </p>
    ),
  },
  {
    id: 13,
    icon: <ShieldAlert className="h-5 w-5 text-primary" />,
    title: "Service Availability and Warranty Disclaimer",
    content: (
      <div className="space-y-3">
        <p>
          Arena services are provided on an <strong className="text-foreground">"as is"</strong> and{" "}
          <strong className="text-foreground">"as available"</strong> basis without warranties of any kind, express or
          implied. Arena does not warrant that services will be uninterrupted, error-free, or free from security
          vulnerabilities.
        </p>
        <p>
          To the maximum extent permitted by law, Arena disclaims all warranties including merchantability, fitness for
          a particular purpose, title, and non-infringement.
        </p>
      </div>
    ),
  },
  {
    id: 14,
    icon: <Scale className="h-5 w-5 text-arena-cyan" />,
    title: "Limitation of Liability",
    content: (
      <div className="space-y-3">
        <p>
          To the extent permitted by applicable law, Arena and its affiliates, directors, officers, employees, and agents
          are not liable for indirect, incidental, special, consequential, or punitive damages, including loss of stakes,
          profits, data, goodwill, or opportunity — even if advised of the possibility of such damages.
        </p>
        <p>
          Arena's aggregate liability for any claim arising out of or related to these Terms or the services, where not
          otherwise excluded, is limited to the greater of: (a) the total platform fees paid by you to Arena during the
          12 months preceding the claim, or (b) the minimum amount required by non-waivable applicable law.
        </p>
        <p>
          Nothing in these Terms limits liability for fraud, death, or personal injury caused by gross negligence where
          such limitation is prohibited by mandatory law.
        </p>
      </div>
    ),
  },
  {
    id: 15,
    icon: <Gavel className="h-5 w-5 text-muted-foreground" />,
    title: "Indemnification",
    content: (
      <p>
        You agree to indemnify, defend, and hold harmless Arena, its affiliates, officers, directors, employees,
        contractors, and agents from and against any claims, liabilities, losses, damages, judgments, fines, and
        reasonable legal fees arising out of or related to: (a) your breach of these Terms; (b) your violation of
        any applicable law; (c) your misuse of Arena services; (d) disputes between you and any other user; or (e)
        any false representation made by you in connection with registration or account use.
      </p>
    ),
  },
  {
    id: 16,
    icon: <Scale className="h-5 w-5 text-arena-cyan" />,
    title: "Governing Law and Dispute Resolution",
    content: (
      <div className="space-y-3">
        <p>
          These Terms are governed by the laws of <strong className="text-foreground">[Insert governing jurisdiction]</strong>,
          without regard to conflict-of-law principles, and subject to mandatory consumer protections applicable in your
          country of residence.
        </p>
        <p>
          Any dispute arising from or related to these Terms that cannot be resolved informally shall be submitted to
          binding arbitration under the rules of <strong className="text-foreground">[Insert arbitration body]</strong>,
          conducted in <strong className="text-foreground">[Insert seat of arbitration]</strong>. The language of
          arbitration shall be English.
        </p>
        <p>
          <strong className="text-foreground">Class action waiver:</strong> You waive any right to participate in any
          class action, collective, or representative proceeding against Arena. All claims must be brought on an
          individual basis.
        </p>
        <p className="text-xs text-muted-foreground/70 italic">
          Note: Governing law and arbitration seat to be confirmed by qualified legal counsel prior to production launch.
        </p>
      </div>
    ),
  },
  {
    id: 17,
    icon: <Info className="h-5 w-5 text-muted-foreground" />,
    title: "Changes to Terms",
    content: (
      <div className="space-y-3">
        <p>
          Arena may update these Terms periodically. Material changes will be communicated via in-platform notification,
          email, or account messaging at least 14 days before taking effect (where practicable). Continued use of the
          platform after the effective date constitutes binding acceptance of the updated Terms.
        </p>
        <p>
          For changes required by law or to address security risks, shorter notice periods may apply. You should review
          these Terms regularly.
        </p>
      </div>
    ),
  },
];

const SectionCard = ({ section }: { section: Section }) => {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`border rounded-xl overflow-hidden transition-all duration-200 ${
        open ? "border-primary/30 bg-card" : "border-border bg-card/60 hover:border-border/80"
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0">{section.icon}</span>
          <span className="text-xs font-mono text-muted-foreground/50 shrink-0">§{section.id}</span>
          <span className="font-display font-semibold text-sm text-foreground truncate">{section.title}</span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 text-sm text-muted-foreground border-t border-border/50">
          {section.content}
        </div>
      )}
    </div>
  );
};

const TermsOfService = () => {
  const [allOpen, setAllOpen] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              Terms of Service
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Binding terms governing your use of Arena — a skill-based competitive gaming platform.
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
          <Badge variant="outline" className="font-mono text-xs">Effective: 2026-03-26</Badge>
          <Badge variant="outline" className="font-mono text-xs">Version: 2.0</Badge>
          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Skill-Based Platform</Badge>
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">18+ Only</Badge>
          <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs">Real Stakes</Badge>
        </div>

        {/* Quick Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          {[
            { icon: <Trophy className="h-4 w-4 text-primary" />, label: "Skill-Based", desc: "Outcomes decided by player skill, not chance" },
            { icon: <Wallet className="h-4 w-4 text-arena-cyan" />, label: "Non-Custodial", desc: "Funds held in smart contract, never by Arena" },
            { icon: <ShieldCheck className="h-4 w-4 text-arena-gold" />, label: "P2P Only", desc: "Player vs player — Arena takes no position" },
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
      <div className="border border-destructive/30 bg-destructive/5 rounded-xl px-5 py-4 flex items-start gap-3">
        <AlertOctagon className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="text-sm space-y-1">
          <p className="font-semibold text-foreground">Legal Notice</p>
          <p className="text-muted-foreground">
            These Terms constitute a high-standard legal template designed for a skill-based competition platform.
            Before production launch, all provisions — in particular governing law, arbitration venue, and
            jurisdiction-specific compliance clauses — must be reviewed and finalized by qualified legal counsel in
            each target jurisdiction. Arena is not a licensed gambling operator. Nothing herein constitutes legal,
            financial, or tax advice.
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/50 text-center pb-4">
        Arena © {new Date().getFullYear()} — All rights reserved.
        Last updated: 2026-03-26
      </p>
    </div>
  );
};

// Separate component to support forceOpen prop
const ExpandableSection = ({ section, forceOpen }: { section: Section; forceOpen: boolean }) => {
  const [localOpen, setLocalOpen] = useState(false);
  const open = forceOpen || localOpen;

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-all duration-200 ${
        open ? "border-primary/30 bg-card" : "border-border bg-card/60 hover:border-border/80"
      }`}
    >
      <button
        onClick={() => setLocalOpen(!localOpen)}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0">{section.icon}</span>
          <span className="text-xs font-mono text-muted-foreground/50 shrink-0">§{section.id}</span>
          <span className="font-display font-semibold text-sm text-foreground">{section.title}</span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 text-sm text-muted-foreground border-t border-border/50 leading-relaxed">
          {section.content}
        </div>
      )}
    </div>
  );
};

export default TermsOfService;
