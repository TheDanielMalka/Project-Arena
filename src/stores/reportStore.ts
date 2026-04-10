import { create } from "zustand";
import type {
  SupportTicket,
  SupportTicketCategory,
  SupportTopic,
  TicketReason,
  TicketStatus,
} from "@/types";

// ─── Store ────────────────────────────────────────────────────
// Admin Reports tab uses GET /admin/support/tickets (not this list).

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
  // DB-ready: replace with GET /api/admin/reports?category=X — used by Admin panel tab filters
  getTicketsByCategory: (category: SupportTicketCategory) => SupportTicket[];
}

export const useReportStore = create<ReportState>((set, get) => ({
  tickets: [],

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

  getTicketsByCategory: (category) =>
    get().tickets.filter((t) => (t.ticketCategory ?? "player_report") === category),
}));
