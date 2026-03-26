import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Mail, MessageCircle, Send, Trash2, Eye, Pencil,
  Search, CheckCheck, ArrowLeft, Users2,
  Inbox, ChevronRight, Plus,
} from "lucide-react";
import { useInboxStore }   from "@/stores/inboxStore";
import { useMessageStore } from "@/stores/messageStore";
import { useFriendStore }  from "@/stores/friendStore";
import { useUserStore }    from "@/stores/userStore";
import { useNotificationStore } from "@/stores/notificationStore";
import type { InboxMessage, Friendship } from "@/types";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────

const TIER_COLOR: Record<string, string> = {
  Bronze: "#CD7F32", Silver: "#A0A0A0", Gold: "#FFD700",
  Platinum: "#00C9C9", Diamond: "#A855F7", Master: "#FF2D55",
};

type MsgTab = "inbox" | "chats";
type Panel = { type: "inbox"; msg: InboxMessage } | { type: "chat"; friend: Friendship } | null;

// ─── Compose Dialog ───────────────────────────────────────────

interface ComposeProps {
  open: boolean;
  onClose: () => void;
  prefillArenaId?: string;
}

function ComposeDialog({ open, onClose, prefillArenaId }: ComposeProps) {
  const user         = useUserStore((s) => s.user);
  const sendInbox    = useInboxStore((s) => s.sendInboxMessage);
  const addNotif     = useNotificationStore((s) => s.addNotification);

  const [toArenaId, setToArenaId] = useState(prefillArenaId ?? "");
  const [subject,   setSubject]   = useState("");
  const [content,   setContent]   = useState("");
  const [error,     setError]     = useState("");
  const [sent,      setSent]      = useState(false);

  useEffect(() => {
    if (open) { setToArenaId(prefillArenaId ?? ""); setSent(false); setError(""); }
  }, [open, prefillArenaId]);

  const canSend = toArenaId.trim().length > 0 && subject.trim().length > 0 && content.trim().length > 0;

  const handleSend = () => {
    if (!user || !canSend) return;
    const result = sendInbox({
      myId: user.id, myName: user.username, myArenaId: user.arenaId,
      targetArenaId: toArenaId.trim(), subject, content,
    });
    if (!result.success) { setError(result.error ?? "Failed to send"); return; }
    addNotif({ type: "system", title: "✉️ Message Sent", message: `Message sent successfully.` });
    setSent(true);
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => { setToArenaId(""); setSubject(""); setContent(""); setError(""); setSent(false); }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md bg-background border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-display">
            <Pencil className="h-4 w-4 text-primary" /> New Message
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="text-center py-6 space-y-3">
            <CheckCheck className="h-10 w-10 text-primary mx-auto" />
            <p className="font-display text-sm font-semibold">Sent!</p>
            <p className="text-xs text-muted-foreground">Your message was delivered.</p>
            <Button size="sm" className="w-full" onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">To (Arena ID)</label>
              <Input
                placeholder="ARENA-XXXXXX"
                value={toArenaId}
                onChange={(e) => { setToArenaId(e.target.value.toUpperCase()); setError(""); }}
                className="bg-secondary/50 border-border/50 font-mono text-sm h-8"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Subject</label>
              <Input
                placeholder="What's this about?"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                className="bg-secondary/50 border-border/50 text-sm h-8"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Message</label>
              <Textarea
                placeholder="Write your message…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                maxLength={5000}
                className="bg-secondary/50 border-border/50 resize-none text-sm"
              />
              <p className="text-[10px] text-muted-foreground text-right">{content.length}/5000</p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1 border-border/50" onClick={handleClose}>Cancel</Button>
              <Button size="sm" className="flex-1 gap-1.5" onClick={handleSend} disabled={!canSend}>
                <Send className="h-3.5 w-3.5" /> Send
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────

function ChatPanel({ friend, myId, myUsername, onBack }: {
  friend: Friendship; myId: string; myUsername: string; onBack: () => void;
}) {
  const getConv  = useMessageStore((s) => s.getConversation);
  const sendMsg  = useMessageStore((s) => s.sendMessage);
  const markRead = useMessageStore((s) => s.markRead);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages  = getConv(friend.friendId);

  useEffect(() => { markRead(friend.friendId); }, [friend.friendId, markRead]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const tc = TIER_COLOR[friend.friendTier] ?? "#888";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50 shrink-0">
        <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground transition-colors mr-1">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display text-xs font-bold shrink-0"
          style={{ background: `${tc}20`, border: `1.5px solid ${tc}50`, color: tc }}>
          {friend.friendAvatarInitials}
        </div>
        <div>
          <p className="font-display text-xs font-semibold">{friend.friendUsername}</p>
          <p className="font-mono text-[9px] text-muted-foreground">{friend.friendArenaId}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {messages.map((msg) => {
          const mine = msg.senderId === myId;
          return (
            <div key={msg.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[72%] rounded-2xl px-3 py-2 text-sm",
                mine ? "bg-primary text-primary-foreground rounded-br-sm"
                     : "bg-secondary/60 text-foreground rounded-bl-sm")}>
                <p className="leading-relaxed break-words">{msg.content}</p>
                <p className={cn("text-[9px] mt-0.5 tabular-nums", mine ? "text-primary-foreground/60" : "text-muted-foreground")}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-xs">Start the conversation</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-3 py-3 border-t border-border/50 shrink-0">
        <Input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (input.trim()) { sendMsg({ myId, myUsername, friendId: friend.friendId, content: input }); setInput(""); } } }}
          placeholder={`Message ${friend.friendUsername}…`}
          className="flex-1 bg-secondary/50 border-border/50 text-sm h-8" maxLength={2000}
        />
        <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => { if (input.trim()) { sendMsg({ myId, myUsername, friendId: friend.friendId, content: input }); setInput(""); } }} disabled={!input.trim()}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function Messages() {
  const navigate        = useNavigate();
  const user            = useUserStore((s) => s.user);
  const inboxMessages   = useInboxStore((s) => s.messages);
  const markRead        = useInboxStore((s) => s.markAllRead);
  const markOneRead     = useInboxStore((s) => s.markRead);
  const deleteMessage   = useInboxStore((s) => s.deleteMessage);
  const inboxUnread     = useInboxStore((s) => s.getTotalUnread);
  const getConvUnread   = useMessageStore((s) => s.getUnreadCount);
  const chatUnread      = useMessageStore((s) => s.getTotalUnread);
  const getFriends      = useFriendStore((s) => s.getFriends);
  const friendships     = useFriendStore((s) => s.friendships);

  const [tab,          setTab]          = useState<MsgTab>("inbox");
  const [activePanel,  setActivePanel]  = useState<Panel>(null);
  const [composeOpen,  setComposeOpen]  = useState(false);
  const [search,       setSearch]       = useState("");

  const friends      = useMemo(() => getFriends(), [getFriends, friendships]);
  const visibleInbox = useMemo(() =>
    inboxMessages.filter((m) => !m.deleted &&
      (!search || m.senderName.toLowerCase().includes(search.toLowerCase()) || m.subject.toLowerCase().includes(search.toLowerCase()))
    ), [inboxMessages, search]);

  const handleOpenInbox = (msg: InboxMessage) => {
    setActivePanel({ type: "inbox", msg });
    if (!msg.read) markOneRead(msg.id);
  };

  const totalChatUnread = chatUnread();
  const totalInboxUnread = inboxUnread();

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Left panel ── */}
      <div className={cn(
        "flex flex-col w-full md:w-72 shrink-0 border-r border-border/50",
        activePanel ? "hidden md:flex" : "flex"
      )}>
        {/* Header */}
        <div className="px-4 pt-5 pb-3 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-base font-bold flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" /> Messages
            </h1>
            <Button size="sm" onClick={() => setComposeOpen(true)}
              className="h-7 px-3 text-xs gap-1">
              <Plus className="h-3.5 w-3.5" /> Compose
            </Button>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 text-xs font-medium">
            {([["inbox", "Inbox", totalInboxUnread], ["chats", "Chats", totalChatUnread]] as const).map(([t, label, count]) => (
              <button key={t} onClick={() => setTab(t as MsgTab)}
                className={cn("flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all",
                  tab === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}>
                {label}
                {count > 0 && <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-bold">{count}</span>}
              </button>
            ))}
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…" className="pl-8 h-7 bg-secondary/50 border-border/50 text-xs" />
          </div>
          {tab === "inbox" && totalInboxUnread > 0 && (
            <button onClick={() => markRead()} className="text-[10px] text-primary hover:underline self-start">
              Mark all as read
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {tab === "inbox" ? (
            visibleInbox.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p className="text-xs">No messages</p>
              </div>
            ) : visibleInbox.map((msg) => (
              <button key={msg.id}
                onClick={() => handleOpenInbox(msg)}
                className={cn("w-full text-left px-3 py-3 rounded-xl transition-all group",
                  activePanel?.type === "inbox" && activePanel.msg.id === msg.id
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-secondary/40 border border-transparent",
                  !msg.read && "border-l-2 border-l-primary rounded-l-none pl-2.5"
                )}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className={cn("text-xs truncate", !msg.read ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {msg.senderName}
                  </p>
                  <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                    {new Date(msg.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                </div>
                <p className={cn("text-xs truncate mb-0.5", !msg.read ? "font-medium" : "text-muted-foreground")}>
                  {msg.subject}
                </p>
                <p className="text-[10px] text-muted-foreground/70 truncate">{msg.content}</p>
              </button>
            ))
          ) : (
            friends.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p className="text-xs">No friends yet</p>
                <button onClick={() => navigate("/hub")} className="text-[10px] text-primary hover:underline mt-1">
                  Go to Hub →
                </button>
              </div>
            ) : friends.filter((f) => !search || f.friendUsername.toLowerCase().includes(search.toLowerCase())).map((f) => {
              const tc     = TIER_COLOR[f.friendTier] ?? "#888";
              const unread = getConvUnread(f.friendId);
              const isActive = activePanel?.type === "chat" && activePanel.friend.friendId === f.friendId;
              return (
                <button key={f.id}
                  onClick={() => setActivePanel({ type: "chat", friend: f })}
                  className={cn("w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5",
                    isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-secondary/40 border border-transparent")}>
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display text-xs font-bold"
                      style={{ background: `${tc}20`, border: `1.5px solid ${tc}40`, color: tc }}>
                      {f.friendAvatarInitials}
                    </div>
                    {unread > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[8px] flex items-center justify-center font-bold">
                        {unread}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-xs font-semibold truncate">{f.friendUsername}</p>
                    <p className="font-mono text-[9px] text-muted-foreground">{f.friendArenaId}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={cn("flex-1 min-w-0 flex flex-col", !activePanel && "hidden md:flex")}>
        {activePanel === null ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-15" />
              <p className="text-sm">Select a message or chat</p>
              <button onClick={() => setComposeOpen(true)}
                className="mt-3 text-xs text-primary hover:underline">
                + Compose new message
              </button>
            </div>
          </div>
        ) : activePanel.type === "inbox" ? (
          /* Inbox reading pane */
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 shrink-0">
              <button onClick={() => setActivePanel(null)} className="md:hidden text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-bold truncate">{activePanel.msg.subject}</p>
                <p className="text-xs text-muted-foreground">
                  From <span className="font-medium text-foreground">{activePanel.msg.senderName}</span>
                  <span className="font-mono text-primary ml-1.5 text-[10px]">({activePanel.msg.senderArenaId})</span>
                  <span className="ml-2 text-muted-foreground/60">
                    {new Date(activePanel.msg.createdAt).toLocaleString()}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!activePanel.msg.read && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                    onClick={() => markOneRead(activePanel.msg.id)} title="Mark read">
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => { deleteMessage(activePanel.msg.id); setActivePanel(null); }} title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {activePanel.msg.content}
              </p>
            </div>
            <div className="px-5 py-4 border-t border-border/50 shrink-0">
              <Button size="sm" variant="outline" className="text-xs border-border/50 gap-1.5"
                onClick={() => { setComposeOpen(true); }}>
                <Send className="h-3.5 w-3.5" /> Reply
              </Button>
            </div>
          </div>
        ) : (
          /* Chat pane */
          <ChatPanel
            friend={activePanel.friend}
            myId={user?.id ?? ""}
            myUsername={user?.username ?? ""}
            onBack={() => setActivePanel(null)}
          />
        )}
      </div>

      <ComposeDialog open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
