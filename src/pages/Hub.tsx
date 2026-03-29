import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Users2, Search, UserPlus, UserCheck, Clock, MessageCircle,
  Send, X, ChevronRight, Check, Flag, ArrowLeft,
  Mail, Trash2, Eye, Pencil, Inbox, Plus, CheckCheck, Shuffle,
} from "lucide-react";
import { usePlayerStore }  from "@/stores/playerStore";
import { useFriendStore }  from "@/stores/friendStore";
import { useMessageStore } from "@/stores/messageStore";
import { useInboxStore }   from "@/stores/inboxStore";
import { useUserStore }    from "@/stores/userStore";
import { useNotificationStore } from "@/stores/notificationStore";
import type { Game, Friendship, InboxMessage } from "@/types";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────

// DB-ready: comingSoon driven by games.enabled — flip to false when Client supports the game
const GAME_FILTERS: Array<{ label: string; value: Game | ""; comingSoon?: boolean }> = [
  { label: "All",              value: ""                  },
  { label: "CS2",              value: "CS2"               },
  { label: "Valorant",         value: "Valorant"          },
  { label: "Fortnite",         value: "Fortnite",          comingSoon: true },
  { label: "Apex Legends",     value: "Apex Legends",      comingSoon: true },
  { label: "PUBG",             value: "PUBG",              comingSoon: true },
  { label: "COD",              value: "COD",               comingSoon: true },
  { label: "League of Legends",value: "League of Legends", comingSoon: true },
];

const TIER_COLOR: Record<string, string> = {
  Bronze: "#CD7F32", Silver: "#A0A0A0", Gold: "#FFD700",
  Platinum: "#00C9C9", Diamond: "#A855F7", Master: "#FF2D55",
};

type HubTab  = "community" | "friends" | "messages";
type MsgTab  = "inbox" | "chats";
type Panel   = { type: "inbox"; msg: InboxMessage } | { type: "chat"; friend: Friendship } | null;

// ─── Friend Chat Panel (used in Friends tab split view) ────────

interface FriendChatPanelProps {
  friend: Friendship;
  myId: string;
  myUsername: string;
  onClose: () => void;
}

function FriendChatPanel({ friend, myId, myUsername, onClose }: FriendChatPanelProps) {
  const getConversation = useMessageStore((s) => s.getConversation);
  const sendMessage     = useMessageStore((s) => s.sendMessage);
  const markRead        = useMessageStore((s) => s.markRead);

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages  = getConversation(friend.friendId);

  useEffect(() => {
    markRead(friend.friendId);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [friend.friendId, markRead, messages.length]);

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;
    sendMessage({ myId, myUsername, friendId: friend.friendId, content });
    setInput("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const tc = TIER_COLOR[friend.friendTier] ?? "#888";

  return (
    <div className="flex flex-col h-full border-l border-border/30">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/30 shrink-0"
        style={{ background: `${tc}08` }}>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[10px] font-bold shrink-0"
            style={{ background: `${tc}20`, border: `1px solid ${tc}40`, color: tc }}
          >
            {friend.friendAvatarInitials}
          </div>
          <div className="min-w-0">
            <p className="font-display text-[11px] font-bold leading-tight truncate">{friend.friendUsername}</p>
            <p className="font-mono text-[9px] leading-tight" style={{ color: tc }}>{friend.friendArenaId}</p>
          </div>
          <span
            className="hidden sm:inline-flex items-center px-1.5 py-px rounded-full text-[8px] font-bold shrink-0 ml-1"
            style={{ background: `${tc}15`, color: tc, border: `1px solid ${tc}30` }}
          >
            {friend.friendRank}
          </span>
        </div>
        <button onClick={onClose} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-0.5">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-1 min-h-0"
        style={{ background: "hsl(var(--background)/0.4)" }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-1.5">
            <MessageCircle className="h-7 w-7 opacity-40" />
            <p className="text-[11px]">Say hello to {friend.friendUsername}</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === myId;
            const time   = new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[78%] rounded-xl px-2.5 py-1.5",
                  isMine
                    ? "bg-primary text-primary-foreground rounded-br-[3px]"
                    : "bg-secondary/80 text-foreground rounded-bl-[3px] border border-border/20"
                )}>
                  <p className="text-[11px] leading-relaxed break-words">{msg.content}</p>
                  <p className={cn("text-[8px] tabular-nums text-right mt-0.5 leading-none",
                    isMine ? "text-primary-foreground/50" : "text-muted-foreground/60")}>
                    {time}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-t border-border/30 shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={`Message…`}
          className="flex-1 bg-secondary/40 border-border/30 text-[12px] h-7 rounded-lg px-2.5"
          maxLength={2000}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className={cn(
            "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-all",
            input.trim()
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary/50 text-muted-foreground/30 cursor-not-allowed"
          )}
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Messages Tab: Chat Panel ──────────────────────────────────

function MsgChatPanel({ friend, myId, myUsername, onBack }: {
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

  const doSend = () => {
    if (!input.trim()) return;
    sendMsg({ myId, myUsername, friendId: friend.friendId, content: input });
    setInput("");
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 shrink-0"
        style={{ background: `${tc}08` }}>
        <button onClick={onBack} className="md:hidden text-muted-foreground/40 hover:text-muted-foreground transition-colors mr-0.5">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[10px] font-bold shrink-0"
          style={{ background: `${tc}20`, border: `1px solid ${tc}40`, color: tc }}>
          {friend.friendAvatarInitials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-[11px] font-bold leading-tight truncate">{friend.friendUsername}</p>
          <p className="font-mono text-[9px] leading-tight" style={{ color: tc }}>{friend.friendArenaId}</p>
        </div>
        <span
          className="hidden sm:inline-flex items-center px-1.5 py-px rounded-full text-[8px] font-bold shrink-0"
          style={{ background: `${tc}15`, color: tc, border: `1px solid ${tc}30` }}
        >
          {friend.friendRank}
        </span>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-1 min-h-0"
        style={{ background: "hsl(var(--background)/0.4)" }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-1.5">
            <MessageCircle className="h-7 w-7 opacity-40" />
            <p className="text-[11px]">Say hello to {friend.friendUsername}</p>
          </div>
        )}
        {messages.map((msg) => {
          const mine = msg.senderId === myId;
          const time = new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={msg.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[78%] rounded-xl px-2.5 py-1.5",
                mine
                  ? "bg-primary text-primary-foreground rounded-br-[3px]"
                  : "bg-secondary/80 text-foreground rounded-bl-[3px] border border-border/20"
              )}>
                <p className="text-[11px] leading-relaxed break-words">{msg.content}</p>
                <p className={cn("text-[8px] tabular-nums text-right mt-0.5 leading-none",
                  mine ? "text-primary-foreground/50" : "text-muted-foreground/60")}>
                  {time}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-t border-border/30 shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }}
          placeholder="Message…"
          className="flex-1 bg-secondary/40 border-border/30 text-[12px] h-7 rounded-lg px-2.5"
          maxLength={2000}
        />
        <button
          onClick={doSend}
          disabled={!input.trim()}
          className={cn(
            "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-all",
            input.trim()
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary/50 text-muted-foreground/30 cursor-not-allowed"
          )}
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Compose Dialog ───────────────────────────────────────────

interface ComposeProps {
  open: boolean;
  onClose: () => void;
  prefillArenaId?: string;
}

function ComposeDialog({ open, onClose, prefillArenaId }: ComposeProps) {
  const user      = useUserStore((s) => s.user);
  const sendInbox = useInboxStore((s) => s.sendInboxMessage);
  const addNotif  = useNotificationStore((s) => s.addNotification);

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
    addNotif({ type: "system", title: "✉️ Message Sent", message: "Message sent successfully." });
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
          <DialogDescription className="sr-only">
            Compose and send a direct message to another Arena player. Enter their Arena ID to look them up.
          </DialogDescription>
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

// ─── Friend Request Modal ──────────────────────────────────────

interface FriendRequestModalProps {
  open: boolean;
  targetUsername: string;
  targetArenaId: string;
  onClose: () => void;
  onConfirm: (message: string) => void;
}

function FriendRequestModal({ open, targetUsername, targetArenaId, onClose, onConfirm }: FriendRequestModalProps) {
  const [message, setMessage] = useState("");
  const handleClose = () => { onClose(); setTimeout(() => setMessage(""), 300); };
  const handleConfirm = () => { onConfirm(message.trim()); setMessage(""); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xs bg-background border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-xs font-display font-semibold">
            <UserPlus className="h-3.5 w-3.5 text-primary" /> Add Friend
          </DialogTitle>
          <DialogDescription className="sr-only">
            Send a friend request to connect with this player on Arena. You can include an optional message.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-secondary/30 border border-border/40">
            <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center font-display text-[10px] font-bold text-primary shrink-0">
              {targetUsername.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-semibold">{targetUsername}</p>
              <p className="font-mono text-[9px] text-primary/70">{targetArenaId}</p>
            </div>
          </div>
          <Textarea
            placeholder="Add a message… (optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={200}
            className="bg-secondary/50 border-border/50 resize-none text-xs"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 border-border/50 h-8 text-xs" onClick={handleClose}>Cancel</Button>
            <Button size="sm" className="flex-1 h-8 text-xs gap-1" onClick={handleConfirm}>
              <UserPlus className="h-3 w-3" /> Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Hub Page ─────────────────────────────────────────────────

export default function Hub() {
  const navigate        = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as HubTab) || "community";
  const setTab = (t: HubTab) => setSearchParams({ tab: t });

  const user            = useUserStore((s) => s.user);
  const searchPlayers   = usePlayerStore((s) => s.searchPlayers);
  const addNotif        = useNotificationStore((s) => s.addNotification);

  // Friend store
  const friendships        = useFriendStore((s) => s.friendships);
  const getFriends         = useFriendStore((s) => s.getFriends);
  const getPendingReceived = useFriendStore((s) => s.getPendingReceived);
  const getPendingSent     = useFriendStore((s) => s.getPendingSent);
  const getRelationship    = useFriendStore((s) => s.getRelationship);
  const sendFriendRequest  = useFriendStore((s) => s.sendFriendRequest);
  const acceptRequest      = useFriendStore((s) => s.acceptRequest);
  const declineRequest     = useFriendStore((s) => s.declineRequest);
  const removeFriend       = useFriendStore((s) => s.removeFriend);

  // Message store
  const getUnreadCount  = useMessageStore((s) => s.getUnreadCount);
  const getChatUnread   = useMessageStore((s) => s.getTotalUnread);

  // Inbox store
  const inboxMessages   = useInboxStore((s) => s.messages);
  const markAllRead     = useInboxStore((s) => s.markAllRead);
  const markOneRead     = useInboxStore((s) => s.markRead);
  const deleteMessage   = useInboxStore((s) => s.deleteMessage);
  const getInboxUnread  = useInboxStore((s) => s.getTotalUnread);

  // Community tab state
  const [query,       setQuery]       = useState("");
  const [gameFilter,  setGameFilter]  = useState<Game | "">("");
  const [refreshSeed, setRefreshSeed] = useState(() => Date.now());
  const handleShuffle = useCallback(() => setRefreshSeed(Date.now()), []);

  // Friends tab state
  const [friendSearch,     setFriendSearch]     = useState("");
  const [activeChatFriend, setActiveChatFriend] = useState<Friendship | null>(null);

  // Messages tab state
  const [msgTab,       setMsgTab]       = useState<MsgTab>("inbox");
  const [activePanel,  setActivePanel]  = useState<Panel>(null);
  const [composeOpen,  setComposeOpen]  = useState(false);
  const [msgSearch,    setMsgSearch]    = useState("");
  const [replyArenaId, setReplyArenaId] = useState<string | undefined>(undefined);

  // Friend request modal
  const [frModalTarget, setFrModalTarget] = useState<{
    id: string; username: string; arenaId: string;
    avatarInitials: string; rank: string; tier: string; preferredGame: string;
  } | null>(null);

  // Derived data
  const communityResults = useMemo(
    () => searchPlayers(query, gameFilter || undefined).filter((p) => p.id !== user?.id),
    [query, gameFilter, searchPlayers, user?.id]
  );

  // 9 random players for the no-search view
  const displayedPlayers = useMemo(() => {
    if (query || gameFilter) return communityResults; // searching: show all
    const arr = [...communityResults];
    let s = refreshSeed;
    for (let i = arr.length - 1; i > 0; i--) {
      s = ((s * 1103515245 + 12345) >>> 0);
      const j = s % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, 9);
  }, [communityResults, refreshSeed, query, gameFilter]);

  const friends         = useMemo(() => getFriends(), [getFriends, friendships]);
  const pendingReceived = useMemo(() => user ? getPendingReceived(user.id) : [], [getPendingReceived, user, friendships]);
  const pendingSent     = useMemo(() => user ? getPendingSent(user.id) : [], [getPendingSent, user, friendships]);

  const filteredFriends = useMemo(() =>
    friends.filter((f) => !friendSearch || f.friendUsername.toLowerCase().includes(friendSearch.toLowerCase())),
    [friends, friendSearch]
  );

  const visibleInbox = useMemo(() =>
    inboxMessages.filter((m) => !m.deleted &&
      (!msgSearch || m.senderName.toLowerCase().includes(msgSearch.toLowerCase()) ||
        m.subject.toLowerCase().includes(msgSearch.toLowerCase()))
    ),
    [inboxMessages, msgSearch]
  );

  const totalChatUnread  = getChatUnread();
  const totalInboxUnread = getInboxUnread();
  const totalMsgUnread   = totalChatUnread + totalInboxUnread;

  // Handlers
  const handleAddFriend = (player: ReturnType<typeof searchPlayers>[0]) => {
    if (!user) return;
    setFrModalTarget({
      id: player.id, username: player.username, arenaId: player.arenaId,
      avatarInitials: player.avatarInitials, rank: player.rank,
      tier: player.tier, preferredGame: player.preferredGame,
    });
  };

  const handleFrConfirm = (message: string) => {
    if (!user || !frModalTarget) return;
    sendFriendRequest({
      myId: user.id, myUsername: user.username,
      myArenaId: user.arenaId, myAvatarInitials: user.avatarInitials,
      myRank: user.rank, myTier: user.tier, myPreferredGame: user.preferredGame,
      targetId: frModalTarget.id, targetUsername: frModalTarget.username,
      targetArenaId: frModalTarget.arenaId, targetAvatarInitials: frModalTarget.avatarInitials,
      targetRank: frModalTarget.rank, targetTier: frModalTarget.tier,
      targetPreferredGame: frModalTarget.preferredGame,
      message: message || undefined,
    });
    addNotif({
      type: "system", title: "Friend Request Sent",
      message: `Request sent to ${frModalTarget.username} (${frModalTarget.arenaId})`,
    });
    setFrModalTarget(null);
  };

  const handleAccept = (f: Friendship) => {
    acceptRequest(f.id);
    addNotif({ type: "system", title: "Friend Added! 🎮", message: `You and ${f.friendUsername} are now friends.` });
  };

  const handleDecline = (f: Friendship) => { declineRequest(f.id); };

  const handleRemoveFriend = (friendId: string, friendUsername: string) => {
    removeFriend(friendId);
    if (activeChatFriend?.friendId === friendId) setActiveChatFriend(null);
    addNotif({ type: "system", title: "Friend Removed", message: `${friendUsername} removed from friends.` });
  };

  const handleOpenInbox = (msg: InboxMessage) => {
    setActivePanel({ type: "inbox", msg });
    if (!msg.read) markOneRead(msg.id);
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <Users2 className="h-6 w-6 text-primary" />
              Hub
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Find players, manage friends, send messages
            </p>
          </div>
          {user && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-secondary/30">
              <span className="text-[10px] text-muted-foreground">Your ID</span>
              <span className="font-mono text-xs font-bold text-primary">{user.arenaId}</span>
            </div>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mt-4 border-b border-border/50">
          {([
            { key: "community", label: "Community" },
            { key: "friends",   label: "Friends"   },
            { key: "messages",  label: "Messages"  },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium font-display capitalize transition-all border-b-2 -mb-px flex items-center gap-1.5",
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              {key === "friends" && friends.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  {friends.length}
                </span>
              )}
              {key === "friends" && totalChatUnread > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                  {totalChatUnread}
                </span>
              )}
              {key === "friends" && pendingReceived.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-arena-orange/80 text-white">
                  {pendingReceived.length}
                </span>
              )}
              {key === "messages" && totalMsgUnread > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                  {totalMsgUnread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Community Tab ── */}
      {tab === "community" && (
        <div className="flex-1 flex flex-col px-6 pb-4 overflow-hidden">

          {/* Search + game filters (fixed, no scroll) */}
          <div className="space-y-2.5 mb-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by username or Arena ID…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 h-8 text-sm bg-secondary/50 border-border/50"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GAME_FILTERS.map((f) =>
                f.comingSoon ? (
                  // Coming Soon pill — visible, non-clickable
                  <span key={f.value}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border border-border/30 bg-secondary/20 text-muted-foreground/35 cursor-not-allowed select-none">
                    {f.label}
                    <span className="text-[8px] font-bold tracking-wide text-muted-foreground/30">SOON</span>
                  </span>
                ) : (
                  <button
                    key={f.value}
                    onClick={() => setGameFilter(f.value as Game | "")}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all",
                      gameFilter === f.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/40 border-border/40 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {f.label}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Grid header — shuffle button when not searching */}
          {!query && !gameFilter && (
            <div className="flex items-center justify-end mb-2 shrink-0">
              <button
                onClick={handleShuffle}
                className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-primary transition-colors"
              >
                <Shuffle className="h-3 w-3" /> Shuffle
              </button>
            </div>
          )}

          {/* Player grid — no scroll, compact rows */}
          {displayedPlayers.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Users2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No players found{query ? ` matching "${query}"` : ""}</p>
              </div>
            </div>
          ) : (
            <div className={cn(
              "grid grid-cols-3 gap-2",
              (query || gameFilter) && "overflow-y-auto flex-1"
            )}>
              {displayedPlayers.map((player) => {
                const tierColor    = TIER_COLOR[player.tier] ?? "#888";
                const relationship = getRelationship(player.id);
                return (
                  <div
                    key={player.id}
                    className="flex items-center gap-2 p-2 rounded-xl border border-border/40 bg-secondary/20 hover:border-border/60 transition-all min-w-0"
                  >
                    {/* Avatar */}
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[10px] font-bold shrink-0 cursor-pointer"
                      style={{ background: `${tierColor}20`, border: `1.5px solid ${tierColor}50`, color: tierColor }}
                      onClick={() => navigate(`/players/${player.username}`)}
                    >
                      {player.avatar && player.avatar !== "initials"
                        ? <span className="text-xs">{player.avatar}</span>
                        : player.avatarInitials}
                    </div>

                    {/* Info */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigate(`/players/${player.username}`)}
                    >
                      <p className="font-display text-[11px] font-semibold truncate leading-tight hover:text-primary transition-colors">
                        {player.username}
                      </p>
                      <div className="flex items-center gap-1 mt-px">
                        <span className="text-[9px] font-semibold" style={{ color: tierColor }}>
                          {player.rank}
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          {player.stats.winRate.toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    {/* Action icon */}
                    {relationship === "accepted" ? (
                      <span title="Friends"><UserCheck className="h-3.5 w-3.5 text-primary shrink-0" /></span>
                    ) : relationship === "pending" ? (
                      <button
                        onClick={() => {
                          const f = friendships.find((fr) => fr.friendId === player.id && fr.status === "pending");
                          if (f) declineRequest(f.id);
                        }}
                        title="Cancel request"
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAddFriend(player)}
                        title="Add Friend"
                        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Friends Tab ── */}
      {tab === "friends" && (
        <div className="flex-1 flex min-h-0">
          <div className={cn(
            "flex flex-col border-r border-border/50 shrink-0 transition-all",
            activeChatFriend ? "w-[260px] hidden md:flex" : "flex-1 md:w-[300px] md:flex-none"
          )}>
            <div className="p-4 space-y-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search friends…"
                  value={friendSearch}
                  onChange={(e) => setFriendSearch(e.target.value)}
                  className="pl-8 h-8 bg-secondary/50 border-border/50 text-sm"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-3">
              {pendingReceived.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-arena-orange font-medium uppercase tracking-wider px-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Requests ({pendingReceived.length})
                  </p>
                  {pendingReceived.map((f) => {
                    const tc = TIER_COLOR[f.friendTier] ?? "#888";
                    return (
                      <div key={f.id} className="rounded-xl border border-arena-orange/20 bg-arena-orange/5 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display text-xs font-bold shrink-0"
                            style={{ background: `${tc}20`, border: `1.5px solid ${tc}50`, color: tc }}>
                            {f.friendAvatarInitials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-display text-xs font-semibold truncate">{f.friendUsername}</p>
                            <p className="font-mono text-[9px] text-muted-foreground">{f.friendArenaId}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleAccept(f)}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium">
                            <Check className="h-3 w-3" /> Accept
                          </button>
                          <button onClick={() => handleDecline(f)}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
                            <X className="h-3 w-3" /> Decline
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {pendingSent.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">
                    Sent Requests
                  </p>
                  {pendingSent.map((f) => {
                    const tc = TIER_COLOR[f.friendTier] ?? "#888";
                    return (
                      <div key={f.id} className="flex items-center gap-2 px-2 py-2 rounded-xl border border-border/30 bg-secondary/10">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[10px] font-bold shrink-0"
                          style={{ background: `${tc}20`, border: `1.5px solid ${tc}40`, color: tc }}>
                          {f.friendAvatarInitials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{f.friendUsername}</p>
                          <p className="text-[9px] text-muted-foreground">Pending…</p>
                        </div>
                        <button onClick={() => declineRequest(f.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors" title="Cancel request">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredFriends.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">
                    Friends — {friends.length}
                  </p>
                  {filteredFriends.map((f) => {
                    const tc       = TIER_COLOR[f.friendTier] ?? "#888";
                    const unread   = getUnreadCount(f.friendId);
                    const isActive = activeChatFriend?.friendId === f.friendId;
                    return (
                      <div
                        key={f.id}
                        className={cn(
                          "flex items-center gap-2.5 px-2 py-2.5 rounded-xl cursor-pointer transition-all group",
                          isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-secondary/50 border border-transparent"
                        )}
                        onClick={() => setActiveChatFriend(isActive ? null : f)}
                      >
                        <div className="relative shrink-0">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display text-xs font-bold"
                            style={{ background: `${tc}20`, border: `1.5px solid ${tc}50`, color: tc }}>
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
                          <p className="text-[9px] text-muted-foreground font-mono">{f.friendArenaId}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <MessageCircle className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {friends.length === 0 && pendingReceived.length === 0 && pendingSent.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <Users2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No friends yet</p>
                  <p className="text-xs mt-1 opacity-70">Go to Community tab to find players</p>
                  <button onClick={() => setTab("community")} className="mt-3 text-xs text-primary hover:underline">
                    Browse players →
                  </button>
                </div>
              )}
            </div>
          </div>

          {activeChatFriend ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="md:hidden px-4 pt-3 shrink-0">
                <button onClick={() => setActiveChatFriend(null)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to friends
                </button>
              </div>
              <FriendChatPanel
                friend={activeChatFriend}
                myId={user?.id ?? ""}
                myUsername={user?.username ?? ""}
                onClose={() => setActiveChatFriend(null)}
              />
            </div>
          ) : (
            <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a friend to start chatting</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Messages Tab ── */}
      {tab === "messages" && (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left panel */}
          <div className={cn(
            "flex flex-col w-full md:w-72 shrink-0 border-r border-border/50",
            activePanel ? "hidden md:flex" : "flex"
          )}>
            <div className="px-4 pt-4 pb-3 shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-display text-sm font-bold flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" /> Messages
                </p>
                <Button size="sm" onClick={() => setComposeOpen(true)} className="h-7 px-3 text-xs gap-1">
                  <Plus className="h-3.5 w-3.5" /> Compose
                </Button>
              </div>
              <div className="flex gap-1 text-xs font-medium">
                {([["inbox", "Inbox", totalInboxUnread], ["chats", "Chats", totalChatUnread]] as const).map(([t, label, count]) => (
                  <button key={t} onClick={() => setMsgTab(t as MsgTab)}
                    className={cn("flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all",
                      msgTab === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}>
                    {label}
                    {count > 0 && (
                      <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-bold">{count}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input value={msgSearch} onChange={(e) => setMsgSearch(e.target.value)}
                  placeholder="Search…" className="pl-8 h-7 bg-secondary/50 border-border/50 text-xs" />
              </div>
              {msgTab === "inbox" && totalInboxUnread > 0 && (
                <button onClick={() => markAllRead()} className="text-[10px] text-primary hover:underline self-start">
                  Mark all as read
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
              {msgTab === "inbox" ? (
                visibleInbox.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Inbox className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p className="text-xs">No messages</p>
                  </div>
                ) : visibleInbox.map((msg) => (
                  <button key={msg.id} onClick={() => handleOpenInbox(msg)}
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
                        {new Date(msg.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
                    <button onClick={() => setTab("friends")} className="text-[10px] text-primary hover:underline mt-1">
                      Go to Friends →
                    </button>
                  </div>
                ) : friends.filter((f) => !msgSearch || f.friendUsername.toLowerCase().includes(msgSearch.toLowerCase())).map((f) => {
                  const tc     = TIER_COLOR[f.friendTier] ?? "#888";
                  const unread = getUnreadCount(f.friendId);
                  const isActive = activePanel?.type === "chat" && activePanel.friend.friendId === f.friendId;
                  return (
                    <button key={f.id} onClick={() => setActivePanel({ type: "chat", friend: f })}
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

          {/* Right panel */}
          <div className={cn("flex-1 min-w-0 flex flex-col", !activePanel && "hidden md:flex")}>
            {activePanel === null ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Mail className="h-12 w-12 mx-auto mb-3 opacity-15" />
                  <p className="text-sm">Select a message or chat</p>
                  <button onClick={() => setComposeOpen(true)} className="mt-3 text-xs text-primary hover:underline">
                    + Compose new message
                  </button>
                </div>
              </div>
            ) : activePanel.type === "inbox" ? (
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
                        {new Date(activePanel.msg.createdAt).toLocaleString("en-US")}
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
                    onClick={() => {
                      setReplyArenaId(activePanel.msg.senderArenaId);
                      setComposeOpen(true);
                    }}>
                    <Send className="h-3.5 w-3.5" /> Reply
                  </Button>
                </div>
              </div>
            ) : (
              <MsgChatPanel
                friend={activePanel.friend}
                myId={user?.id ?? ""}
                myUsername={user?.username ?? ""}
                onBack={() => setActivePanel(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <FriendRequestModal
        open={frModalTarget !== null}
        targetUsername={frModalTarget?.username ?? ""}
        targetArenaId={frModalTarget?.arenaId ?? ""}
        onClose={() => setFrModalTarget(null)}
        onConfirm={handleFrConfirm}
      />
      <ComposeDialog
        open={composeOpen}
        prefillArenaId={replyArenaId}
        onClose={() => { setComposeOpen(false); setReplyArenaId(undefined); }}
      />
    </div>
  );
}
