import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck, AlertTriangle, Clock3, Wallet, Ban, PhoneCall,
  Heart, Brain, ChevronDown, ChevronUp, AlertOctagon, Scale,
  Eye, UserX, Info, Swords, BarChart3,
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
    title: "Arena's Approach — Skill-Based Competition & Player Protection",
    content: (
      <div className="space-y-3">
        <p>
          Arena is a <strong className="text-foreground">peer-to-peer, skill-based competition platform</strong> where
          players stake funds on the outcome of their own in-game performance. Because real money is at stake, Arena
          takes player protection seriously and maintains a proactive responsible gaming framework.
        </p>
        <p>
          Our approach is modeled on the higher standards applied by licensed operators — including deposit limits,
          self-exclusion tools, warning-sign monitoring, and direct access to support resources — even though Arena
          is a skill-based platform and not a licensed gambling operator.
        </p>
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-2">
          <p className="text-primary font-medium text-xs uppercase tracking-widest mb-1">Our Commitment</p>
          <p>
            Arena is committed to ensuring that competition on our platform remains entertaining and within healthy
            limits. We provide tools to help you stay in control and will never encourage or incentivize players to
            exceed limits they have set for themselves.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 2,
    icon: <ShieldCheck className="h-5 w-5 text-arena-gold" />,
    title: "Age Requirement — 18+ Strictly Enforced",
    content: (
      <div className="space-y-3">
        <div className="bg-arena-gold/10 border border-arena-gold/30 rounded-lg p-3">
          <p className="text-arena-gold font-semibold flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4" /> Minimum Age: 18 Years
          </p>
          <p>
            You must be at least <strong className="text-foreground">18 years of age</strong> to create an account or
            participate in any real-money match on Arena. This requirement is strictly enforced at registration via
            mandatory age confirmation and ongoing account monitoring.
          </p>
        </div>
        <p>
          Arena does not knowingly allow users under 18 to access real-money features. If we discover that a user
          is under the minimum age, the account will be closed immediately, all pending matches will be cancelled,
          and funds will be returned subject to verification.
        </p>
        <p>
          <strong className="text-foreground">Parent and guardian notice:</strong> If you believe a minor has
          accessed Arena, contact us immediately at <span className="text-primary font-mono">safety@arena.gg</span>.
          We will investigate and act swiftly.
        </p>
      </div>
    ),
  },
  {
    id: 3,
    icon: <Brain className="h-5 w-5 text-arena-cyan" />,
    title: "Understanding the Risks — What You Should Know",
    content: (
      <div className="space-y-3">
        <p>
          Staking real money on competitive outcomes — even skill-based ones — carries real financial risk. A strong
          performance record does not guarantee future results. Every match carries the possibility of a full loss
          of your staked amount.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: "Financial risk", desc: "You may lose the full staked amount on any match. Only stake what you can afford to lose entirely." },
            { label: "Variance", desc: "Even highly skilled players can lose streaks. Do not stake based on assumed winning streaks." },
            { label: "Emotional impact", desc: "Losses can affect mood and judgment. Never play to recover losses or when emotionally compromised." },
            { label: "Time investment", desc: "Competitive gaming requires significant time. Ensure staking doesn't interfere with work, sleep, or relationships." },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-border/50 bg-secondary/30 px-4 py-3">
              <p className="text-xs font-semibold text-foreground mb-1">{item.label}</p>
              <p className="text-xs">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 4,
    icon: <Wallet className="h-5 w-5 text-arena-gold" />,
    title: "Financial Controls — Budgets, Limits, and Spending",
    content: (
      <div className="space-y-3">
        <p>
          Responsible staking requires setting and respecting financial boundaries <strong className="text-foreground">before</strong> you
          start, not after a losing session. Arena provides controls to help you manage your spending.
        </p>
        <ul className="space-y-2 list-none">
          {[
            "Set a personal session budget before you enter the lobby and stop when you reach it — regardless of results.",
            "Use Arena's deposit limits to cap how much you can add to your account per day, week, or month.",
            "Track your net position regularly: total deposited minus total withdrawn. Be honest about your financial outcome.",
            "Never chase losses by increasing stakes. A larger bet after a loss is a risk multiplier, not a recovery strategy.",
            "Do not play with borrowed money, credit, or funds allocated to essential expenses.",
            "Platform fee: Arena deducts a 5% commission automatically from each completed match pot. Factor this into your calculations.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-arena-gold mt-0.5 shrink-0">›</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: 5,
    icon: <Clock3 className="h-5 w-5 text-arena-cyan" />,
    title: "Time Management — Sessions, Breaks, and Balance",
    content: (
      <div className="space-y-3">
        <p>
          Unhealthy patterns often develop gradually through extended sessions and erosion of other life priorities.
          Maintaining a structured relationship with time spent on Arena protects both your well-being and your play quality.
        </p>
        <ul className="space-y-2 list-none">
          {[
            "Set a session time limit in advance and use Arena's session timer tool to enforce it.",
            "Take a mandatory break of at least 10 minutes every 90 minutes of active play.",
            "Do not play late at night, when fatigued, or under the influence of alcohol or substances — these impair judgment and reaction time.",
            "Ensure gaming time does not displace sleep, work obligations, family time, or physical activity.",
            "If you skip meals, social events, or sleep to continue playing, this is a warning sign requiring immediate attention.",
            "Use reality check notifications: periodic reminders showing your session duration and net result.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-arena-cyan mt-0.5 shrink-0">›</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: 6,
    icon: <BarChart3 className="h-5 w-5 text-arena-purple" />,
    title: "Self-Assessment — Recognizing Problem Patterns",
    content: (
      <div className="space-y-3">
        <p>
          The following questions are based on recognized problem-gambling screening tools adapted for
          skill-based competition platforms. Answer honestly — this is for your benefit only.
        </p>
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 space-y-2">
          <p className="text-destructive font-semibold text-xs uppercase tracking-widest mb-2">Warning Signs — Answer Honestly</p>
          {[
            "Do you stake more than you originally intended once a session starts?",
            "Have you tried to cut back on staking but found it difficult?",
            "Do you feel restless or irritable when unable to play?",
            "Do you stake to escape stress, anxiety, or personal problems?",
            "After a loss, do you return quickly to try to win it back?",
            "Have you hidden your staking activity from family or friends?",
            "Has staking affected your finances, relationships, or job performance?",
            "Have you borrowed money or sold possessions to fund matches?",
          ].map((q, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-destructive/60 font-mono shrink-0">{i + 1}.</span>
              <span>{q}</span>
            </div>
          ))}
        </div>
        <p>
          If you answered <strong className="text-foreground">yes to two or more</strong> of the above, we strongly
          recommend using Arena's self-exclusion tools and contacting one of the support resources listed in §11.
        </p>
      </div>
    ),
  },
  {
    id: 7,
    icon: <Ban className="h-5 w-5 text-destructive" />,
    title: "Self-Exclusion and Cooling-Off Periods",
    content: (
      <div className="space-y-3">
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-destructive font-semibold mb-1">Your Right to Take a Break</p>
          <p>
            You have the right to exclude yourself from Arena at any time and for any duration. Self-exclusion is
            immediate, irrevocable for its chosen duration, and cannot be shortened once activated.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Cooling-Off", duration: "24h – 6 weeks", desc: "Short break. Matchmaking paused. Account remains accessible for review." },
            { label: "Self-Exclusion", duration: "6 weeks – 12 months", desc: "Extended break. Full account lockdown. No access to lobby or wallet." },
            { label: "Permanent Exclusion", duration: "Indefinite", desc: "Account closed permanently. Cannot be reversed. Available on request." },
          ].map((opt) => (
            <div key={opt.label} className="rounded-lg border border-border/50 bg-secondary/30 px-4 py-3">
              <p className="text-xs font-semibold text-foreground">{opt.label}</p>
              <p className="text-xs text-primary font-mono mb-1">{opt.duration}</p>
              <p className="text-xs">{opt.desc}</p>
            </div>
          ))}
        </div>
        <p>
          To activate self-exclusion, go to <span className="text-primary font-mono">Settings → Responsible Gaming → Self-Exclusion</span>,
          or contact <span className="text-primary font-mono">safety@arena.gg</span>. During any exclusion period,
          open matches will be completed and funds returned to your wallet. No new matches can be created or joined.
        </p>
        <p>
          <strong className="text-foreground">Third-party exclusion (UK):</strong> UK-based users can register
          with GAMSTOP (gamstop.co.uk) to self-exclude from all UK-licensed operators simultaneously.
        </p>
      </div>
    ),
  },
  {
    id: 8,
    icon: <Eye className="h-5 w-5 text-arena-purple" />,
    title: "Reality Checks and Session Monitoring",
    content: (
      <div className="space-y-3">
        <p>
          Arena's reality check system provides periodic in-platform alerts during active sessions showing:
        </p>
        <ul className="space-y-2 list-none">
          {[
            "Total time elapsed in the current session",
            "Net staked amount vs. net returned in the session",
            "Number of matches played",
            "Current balance vs. session start balance",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-arena-purple mt-0.5 shrink-0">›</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>
          Reality checks can be configured in <span className="text-primary font-mono">Settings → Responsible Gaming</span> to
          trigger every 30, 60, or 90 minutes. You may not disable reality checks if a self-imposed time limit is active.
        </p>
        <p>
          Arena also monitors account-level patterns. If our systems detect indicators of problem behavior
          (rapid stake escalation, loss-chasing patterns, abnormal session lengths), we may proactively reach
          out and offer support resources — without judgment.
        </p>
      </div>
    ),
  },
  {
    id: 9,
    icon: <Heart className="h-5 w-5 text-destructive" />,
    title: "Mental Health and Emotional Well-Being",
    content: (
      <div className="space-y-3">
        <p>
          Competitive gaming is inherently emotional. Losses can trigger frustration, anxiety, or the urge to
          continue playing past healthy limits. Recognizing the emotional dimension of staked competition is
          an important part of responsible participation.
        </p>
        <div className="bg-secondary/40 border border-border/50 rounded-lg p-4 space-y-2">
          <p className="text-xs font-semibold text-foreground uppercase tracking-widest mb-2">Healthy Mindset Principles</p>
          {[
            "Accept that losses are a normal part of skill-based competition — even for top players.",
            "Never play when you are stressed, upset, intoxicated, or sleep-deprived.",
            "Treat a loss as feedback on your performance, not as a reason to stake more.",
            "Maintain non-gaming activities and social relationships as your primary source of well-being.",
            "Celebrate discipline and limit-setting as much as in-game wins.",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-primary shrink-0 mt-0.5">✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p>
          If gaming is causing significant distress or has become a way to cope with difficult emotions, we
          encourage you to reach out to a mental health professional. Support resources are listed in §11.
        </p>
      </div>
    ),
  },
  {
    id: 10,
    icon: <UserX className="h-5 w-5 text-arena-orange" />,
    title: "Protecting Vulnerable Users",
    content: (
      <div className="space-y-3">
        <p>
          Arena implements additional safeguards for users identified as potentially vulnerable, including those
          who show patterns consistent with problem behavior or who self-identify as needing additional protection.
        </p>
        <ul className="space-y-2 list-none">
          {[
            "Accounts flagged by our monitoring systems may be temporarily restricted pending a welfare check.",
            "Arena staff will never pressure or incentivize a user to increase their stake levels.",
            "Marketing communications exclude users who have activated any form of limit or exclusion.",
            "Arena does not offer loss-rebate bonuses, loss-chasing incentives, or VIP tiers based on volume staked.",
            "Users may designate a trusted contact (family member or counselor) to be notified if exclusion tools are activated.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-arena-orange mt-0.5 shrink-0">›</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="bg-arena-orange/10 border border-arena-orange/30 rounded-lg p-3 mt-1">
          <p className="text-arena-orange font-semibold text-xs mb-1">Financial Hardship</p>
          <p>
            If you are experiencing financial hardship, Arena will cooperate fully with any freeze, exclusion,
            or fund-return request. Contact <span className="font-mono text-foreground">safety@arena.gg</span> —
            requests are processed within 24 hours.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 11,
    icon: <PhoneCall className="h-5 w-5 text-primary" />,
    title: "Support Resources and Helplines",
    content: (
      <div className="space-y-4">
        <p>
          The following organizations provide free, confidential support for problem gambling and gaming-related
          financial or mental health issues. Arena does not endorse or affiliate with any of these organizations —
          they are listed solely for your benefit.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { region: "UK", name: "GamCare / National Gambling Helpline", contact: "0808 8020 133", url: "gamcare.org.uk", hours: "24/7" },
            { region: "UK", name: "BeGambleAware", contact: "begambleaware.org", url: "begambleaware.org", hours: "24/7 online" },
            { region: "UK", name: "GAMSTOP (Self-Exclusion)", contact: "gamstop.co.uk", url: "gamstop.co.uk", hours: "Self-service" },
            { region: "US", name: "National Problem Gambling Helpline", contact: "1-800-522-4700", url: "ncpgambling.org", hours: "24/7" },
            { region: "AU", name: "Gambling Help Online", contact: "1800 858 858", url: "gamblinghelponline.org.au", hours: "24/7" },
            { region: "IL", name: "ERAN (Emotional First Aid)", contact: "1201", url: "eran.org.il", hours: "24/7" },
            { region: "Global", name: "Gamblers Anonymous", contact: "gamblersanonymous.org", url: "gamblersanonymous.org", hours: "Meeting-based" },
            { region: "Arena", name: "Arena Safety Team", contact: "safety@arena.gg", url: "arena.gg", hours: "Response < 24h" },
          ].map((res) => (
            <div key={res.name} className="rounded-lg border border-border/50 bg-secondary/30 px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-foreground">{res.name}</p>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">{res.region}</Badge>
              </div>
              <p className="text-xs text-primary font-mono">{res.contact}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{res.hours}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/70 italic">
          Contact information is provided for reference only. Arena is not responsible for the services or accuracy
          of third-party organizations. Always verify contact details on official websites.
        </p>
      </div>
    ),
  },
  {
    id: 12,
    icon: <Scale className="h-5 w-5 text-arena-cyan" />,
    title: "Arena's Commitments and Regulatory Standards",
    content: (
      <div className="space-y-3">
        <p>
          This Responsible Gaming policy is modeled on guidance from licensed operators and regulators including
          the UK Gambling Commission's Safer Gambling Standards, GamCare's operational framework, and the National
          Council on Problem Gambling's best practices. Arena is not a licensed gambling operator, but voluntarily
          adopts these higher standards.
        </p>
        <p>
          Arena commits to:
        </p>
        <ul className="space-y-1.5 list-none">
          {[
            "Never encouraging or rewarding excessive or loss-chasing play behavior.",
            "Providing self-exclusion tools that are immediate, irrevocable, and effective.",
            "Not targeting responsible gaming tool users with promotional communications.",
            "Training customer support staff to recognize and respond to problem behavior indicators.",
            "Reviewing and updating this policy annually or as regulatory guidance evolves.",
            "Cooperating with regulators, courts, and law enforcement on problem gaming matters.",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="text-arena-cyan mt-0.5 shrink-0">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground/70 italic pt-1">
          Note: This page should be reviewed by qualified legal and compliance counsel before production launch in
          any licensed jurisdiction.
        </p>
      </div>
    ),
  },
];

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

const ResponsibleGaming = () => {
  const [allOpen, setAllOpen] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-wide flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-primary" />
              Responsible Gaming
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Player protection standards and tools for safer, healthier competition on Arena.
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
          <Badge variant="outline" className="font-mono text-xs">Version: 1.0</Badge>
          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">18+ Only</Badge>
          <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs">Real Stakes</Badge>
          <Badge className="bg-arena-cyan/20 text-arena-cyan border-arena-cyan/30 text-xs">Player First</Badge>
        </div>

        {/* Quick Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          {[
            { icon: <Ban className="h-4 w-4 text-destructive" />, label: "Self-Exclusion", desc: "Instant, irrevocable cooling-off and exclusion tools" },
            { icon: <Wallet className="h-4 w-4 text-arena-gold" />, label: "Spending Limits", desc: "Deposit, session, and stake limits you control" },
            { icon: <PhoneCall className="h-4 w-4 text-primary" />, label: "Free Support", desc: "24/7 helplines and Arena safety team access" },
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
            This Responsible Gaming policy is a high-standard informational framework. Before production launch,
            all provisions — including self-exclusion enforcement, limit mechanisms, and jurisdiction-specific
            compliance requirements — must be implemented technically and reviewed by qualified legal and compliance
            counsel. Arena is not a licensed gambling operator. Nothing herein constitutes legal, financial, or
            therapeutic advice.
          </p>
        </div>
      </div>

      {/* Emergency CTA */}
      <div className="border border-primary/30 bg-primary/5 rounded-xl px-5 py-4 flex items-start gap-3">
        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm space-y-1">
          <p className="font-semibold text-foreground">Need help right now?</p>
          <p className="text-muted-foreground">
            Contact Arena's safety team at{" "}
            <span className="text-primary font-mono">safety@arena.gg</span> or call the National Gambling
            Helpline (UK) on <span className="text-primary font-mono">0808 8020 133</span> — free, confidential,
            available 24/7.
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

export default ResponsibleGaming;
