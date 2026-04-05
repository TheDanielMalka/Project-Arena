import type { InboxMessage } from "@/types";

/** Two messages — mirrors inbox-store.test resetStore (1 unread). */
export const INBOX_STORE_TEST_FIXTURE: InboxMessage[] = [
  {
    id: "inb-001",
    senderId: "user-003",
    senderName: "ShadowKill3r",
    senderArenaId: "ARENA-SK0003",
    receiverId: "user-001",
    subject: "Tournament invite",
    content: "You in?",
    read: false,
    deleted: false,
    createdAt: "2026-03-09T09:00:00Z",
  },
  {
    id: "inb-002",
    senderId: "user-002",
    senderName: "WingmanPro",
    senderArenaId: "ARENA-WP0002",
    receiverId: "user-001",
    subject: "GG last night",
    content: "That was insane.",
    read: true,
    deleted: false,
    createdAt: "2026-03-08T22:00:00Z",
  },
];

/** Three messages — mirrors Hub messages tab seed (1 unread). */
export const INBOX_HUB_TEST_FIXTURE: InboxMessage[] = [
  ...INBOX_STORE_TEST_FIXTURE,
  {
    id: "inb-003",
    senderId: "user-010",
    senderName: "NightHawk",
    senderArenaId: "ARENA-NH0011",
    receiverId: "user-001",
    subject: "Arena tip: Apex squad needed",
    content: "Looking for 3 more players.",
    read: true,
    deleted: false,
    createdAt: "2026-03-07T14:30:00Z",
  },
];
