import { create } from "zustand";
import type {
  SupportTicket,
  SupportTicketCategory,
  SupportTopic,
  TicketReason,
  TicketStatus,
} from "@/types";

// ─── Seed Data ────────────────────────────────────────────────
// DB-ready: replace with GET /api/admin/reports

const SEED_TICKETS: SupportTicket[] = [
  {
    id: "T-001",
    reporterId: "user-003",
    reporterName: "DUNELZ",
    reportedId: "U-301",
    reportedUsername: "xDragon99",
    reason: "cheating",
    description:
      "This player had a 98% headshot rate across our last 3 matches. Definitely using aimbot — I have video proof.",
    status: "investigating",
    adminNote: "Pattern matches known cheat software fingerprint — under active review",
    createdAt: "2026-03-08T10:30:00Z",
    updatedAt: "2026-03-08T12:00:00Z",
  },
  {
    id: "T-002",
    reporterId: "user-002",
    reporterName: "WingmanPro",
    reportedId: "U-288",
    reportedUsername: "BlazeFury",
    reason: "harassment",
    description:
      "BlazeFury sent threatening messages after losing the match. Screenshots available on request.",
    status: "open",
    createdAt: "2026-03-09T08:15:00Z",
  },
  {
    id: "T-003",
    reporterId: "user-004",
    reporterName: "NovaBlade",
    reportedId: "U-260",
    reportedUsername: "PhantomAce",
    reason: "fake_screenshot",
    description:
      "Player submitted a doctored screenshot claiming victory. Score shown (42–2) doesn't match the API data (23–18).",
    status: "resolved",
    adminNote: "Screenshot confirmed as edited — match awarded to NovaBlade",
    createdAt: "2026-03-07T15:45:00Z",
    updatedAt: "2026-03-07T18:00:00Z",
  },
];

// ─── Store ────────────────────────────────────────────────────

interface ReportState {
  tickets: SupportTicket[];

  // DB-ready: replace with POST /api/reports
  submitReport: (report: {
    reporterId: string;
    reporterName: string;
    reportedId: string;
    reportedUsername: string;
    reason: TicketReason;
    description: string;
    ticketCategory?: SupportTicketCategory;
    matchId?: string;
    attachmentDataUrl?: string;
    supportTopic?: SupportTopic;
  }) => SupportTicket;

  // DB-ready: replace with PATCH /api/admin/reports/:id
  updateTicketStatus: (
    ticketId: string,
    status: TicketStatus,
    adminNote?: string
  ) => void;

  // DB-ready: replace with GET /api/admin/reports?reported=username
  getTicketsByReported: (username: string) => SupportTicket[];
}

export const useReportStore = create<ReportState>((set, get) => ({
  tickets: SEED_TICKETS,

  submitReport: (report) => {
    const ticket: SupportTicket = {
      id: `T-${String(get().tickets.length + 1).padStart(3, "0")}`,
      ...report,
      ticketCategory: report.ticketCategory ?? "player_report",
      status: "open",
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tickets: [ticket, ...s.tickets] }));
    return ticket;
  },

  updateTicketStatus: (ticketId, status, adminNote) =>
    set((s) => ({
      tickets: s.tickets.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              status,
              adminNote: adminNote ?? t.adminNote,
              updatedAt: new Date().toISOString(),
            }
          : t
      ),
    })),

  getTicketsByReported: (username) =>
    get().tickets.filter((t) => t.reportedUsername === username),
}));
