import { describe, it, expect, beforeEach } from "vitest";
import { useReportStore } from "@/stores/reportStore";

// Reset store between tests
beforeEach(() => {
  useReportStore.setState({ tickets: [] });
});

describe("reportStore — submitReport", () => {
  it("creates a match_dispute ticket with matchId and category", () => {
    useReportStore.setState({ tickets: [] });
    const store = useReportStore.getState();
    const ticket = store.submitReport({
      reporterId: "user-001",
      reporterName: "Tester",
      reportedId: "opp-slot",
      reportedUsername: "Opponent",
      reason: "fake_screenshot",
      description: "Match outcome looks wrong",
      ticketCategory: "match_dispute",
      matchId: "M-test-999",
    });
    expect(ticket.ticketCategory).toBe("match_dispute");
    expect(ticket.matchId).toBe("M-test-999");
    expect(ticket.status).toBe("open");
  });

  it("creates a ticket with status 'open'", () => {
    const store = useReportStore.getState();
    const ticket = store.submitReport({
      reporterId:        "user-001",
      reporterName:      "ArenaPlayer_01",
      reportedId:        "user-002",
      reportedUsername:  "WingmanPro",
      reason:            "cheating",
      description:       "Used aimbot in our match — obvious wall hacks too",
    });
    expect(ticket.status).toBe("open");
    expect(ticket.reporterName).toBe("ArenaPlayer_01");
    expect(ticket.reportedUsername).toBe("WingmanPro");
    expect(ticket.reason).toBe("cheating");
    expect(ticket.id).toBeTruthy();
    expect(ticket.createdAt).toBeTruthy();
  });

  it("adds the ticket to the store", () => {
    const store = useReportStore.getState();
    store.submitReport({
      reporterId:       "user-001",
      reporterName:     "ArenaPlayer_01",
      reportedId:       "user-002",
      reportedUsername: "WingmanPro",
      reason:           "harassment",
      description:      "Sent offensive messages after the match ended",
    });
    expect(useReportStore.getState().tickets).toHaveLength(1);
  });

  it("increments ticket ID on each submission", () => {
    const store = useReportStore.getState();
    const t1 = store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "cheating", description: "Evidence here for ticket one test",
    });
    const t2 = store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u3", reportedUsername: "C",
      reason: "other", description: "Evidence here for ticket two test case",
    });
    expect(t1.id).not.toBe(t2.id);
  });

  it("prepends new tickets (most recent first)", () => {
    const store = useReportStore.getState();
    store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "cheating", description: "First report submitted by user",
    });
    store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u3", reportedUsername: "C",
      reason: "other", description: "Second report submitted after first",
    });
    const tickets = useReportStore.getState().tickets;
    expect(tickets[0].reportedUsername).toBe("C");
    expect(tickets[1].reportedUsername).toBe("B");
  });
});

describe("reportStore — updateTicketStatus", () => {
  it("changes status and sets adminNote", () => {
    const store = useReportStore.getState();
    const ticket = store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "cheating", description: "Confirmed aimbot usage with video evidence",
    });
    useReportStore.getState().updateTicketStatus(ticket.id, "investigating", "Under active review");
    const updated = useReportStore.getState().tickets.find((t) => t.id === ticket.id);
    expect(updated?.status).toBe("investigating");
    expect(updated?.adminNote).toBe("Under active review");
    expect(updated?.updatedAt).toBeTruthy();
  });

  it("resolves a ticket", () => {
    const store = useReportStore.getState();
    const ticket = store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "harassment", description: "Threatening messages documented in screenshots",
    });
    useReportStore.getState().updateTicketStatus(ticket.id, "resolved");
    const updated = useReportStore.getState().tickets.find((t) => t.id === ticket.id);
    expect(updated?.status).toBe("resolved");
  });

  it("dismisses a ticket", () => {
    const store = useReportStore.getState();
    const ticket = store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "other", description: "Some other type of violation occurred here",
    });
    useReportStore.getState().updateTicketStatus(ticket.id, "dismissed", "No violation found");
    const updated = useReportStore.getState().tickets.find((t) => t.id === ticket.id);
    expect(updated?.status).toBe("dismissed");
    expect(updated?.adminNote).toBe("No violation found");
  });
});

describe("reportStore — ticket categories and new fields", () => {
  it("ticketCategory defaults to 'player_report' when not provided", () => {
    const ticket = useReportStore.getState().submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "cheating", description: "Obvious aimbot usage throughout the match",
    });
    expect(ticket.ticketCategory).toBe("player_report");
  });

  it("creates a general_support ticket with supportTopic and null-safe reportedId", () => {
    const ticket = useReportStore.getState().submitReport({
      reporterId: "u1", reporterName: "A",
      reportedId: "platform", reportedUsername: "Support queue",
      reason: "other",
      description: "I cannot access my account after changing email",
      ticketCategory: "general_support",
      supportTopic: "account_access",
    });
    expect(ticket.ticketCategory).toBe("general_support");
    expect(ticket.supportTopic).toBe("account_access");
    expect(ticket.matchId).toBeUndefined();
  });

  it("creates a match_dispute ticket with matchId correctly set", () => {
    const ticket = useReportStore.getState().submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "fake_screenshot",
      description: "Screenshot score does not match server data at all",
      ticketCategory: "match_dispute",
      matchId: "M-test-42",
    });
    expect(ticket.ticketCategory).toBe("match_dispute");
    expect(ticket.matchId).toBe("M-test-42");
    expect(ticket.supportTopic).toBeUndefined();
  });

  it("stores attachmentDataUrl when provided", () => {
    const fakeDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANS";
    const ticket = useReportStore.getState().submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "B",
      reason: "fake_screenshot",
      description: "Here is a screenshot showing the doctored result",
      attachmentDataUrl: fakeDataUrl,
    });
    expect(ticket.attachmentDataUrl).toBe(fakeDataUrl);
  });
});

describe("reportStore — getTicketsByReported", () => {
  it("returns only tickets for the specified username", () => {
    const store = useReportStore.getState();
    store.submitReport({
      reporterId: "u1", reporterName: "A", reportedId: "u2", reportedUsername: "xDragon99",
      reason: "cheating", description: "Aimbot confirmed across five separate match recordings",
    });
    store.submitReport({
      reporterId: "u3", reporterName: "B", reportedId: "u4", reportedUsername: "BlazeFury",
      reason: "harassment", description: "Hostile messages sent after every single match",
    });
    store.submitReport({
      reporterId: "u5", reporterName: "C", reportedId: "u2", reportedUsername: "xDragon99",
      reason: "fake_screenshot", description: "Screenshot was clearly edited in Photoshop",
    });
    const result = useReportStore.getState().getTicketsByReported("xDragon99");
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.reportedUsername === "xDragon99")).toBe(true);
  });

  it("returns empty array when no tickets for username", () => {
    const result = useReportStore.getState().getTicketsByReported("NonExistentPlayer");
    expect(result).toHaveLength(0);
  });
});
