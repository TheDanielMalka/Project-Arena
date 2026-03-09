import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Send, Users } from "lucide-react";
import { useUserStore } from "@/stores/userStore";

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  isSystem?: boolean;
}

interface MatchChatProps {
  matchId: string;
  players: string[];
}

const MatchChat = ({ matchId, players }: MatchChatProps) => {
  const { user } = useUserStore();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "sys-1", sender: "System", text: "Match lobby created. Good luck!", timestamp: new Date(), isSystem: true },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !user) return;
    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: user.username,
      text: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, msg]);
    setInput("");
  };

  return (
    <Card className="bg-card border-border flex flex-col h-[400px]">
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="font-display text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-arena-cyan" /> Match Chat
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" /> {players.length} online
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-3 pt-0 overflow-hidden">
        <ScrollArea className="flex-1 pr-2">
          <div ref={scrollRef} className="space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className={msg.isSystem ? "text-center" : ""}>
                {msg.isSystem ? (
                  <p className="text-xs text-muted-foreground italic">{msg.text}</p>
                ) : (
                  <div className={`${msg.sender === user?.username ? "ml-auto text-right" : ""} max-w-[80%]`}>
                    <p className="text-xs text-muted-foreground mb-0.5">{msg.sender}</p>
                    <div
                      className={`inline-block px-3 py-1.5 rounded-lg text-sm ${
                        msg.sender === user?.username
                          ? "bg-primary/20 text-primary"
                          : "bg-secondary text-foreground"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="flex gap-2 mt-2 shrink-0">
          <Input
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="bg-secondary border-border text-sm"
          />
          <Button size="icon" onClick={handleSend} disabled={!input.trim()} className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default MatchChat;
