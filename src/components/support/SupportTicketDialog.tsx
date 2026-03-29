import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/stores/userStore";
import { useReportStore } from "@/stores/reportStore";
import type { SupportTopic, TicketReason } from "@/types";
import { getOpponentSlotForUser } from "@/lib/matchOpponentSlot";
import type { Match } from "@/types";
import { slotToProfileUsername } from "@/lib/matchPlayerDisplay";
import { ImagePlus, X } from "lucide-react";

const MAX_ATTACHMENT_BYTES = 450_000;

const REASON_LABELS: Record<TicketReason, string> = {
  cheating: "Cheating / unfair play",
  harassment: "Harassment / toxicity",
  fake_screenshot: "Wrong / fake result",
  disconnect_abuse: "Disconnect / no-show abuse",
  other: "Other",
};

const TOPIC_LABELS: Record<SupportTopic, string> = {
  account_access: "Account & login",
  payments_escrow: "Payments & escrow",
  bug_technical: "Bug / technical issue",
  match_outcome: "Match outcome dispute",
  feedback: "Feedback & suggestions",
  other: "Other",
};

const PLATFORM_REPORTED_ID = "platform";
const PLATFORM_REPORTED_USERNAME = "Support queue";

export type SupportTicketDialogMode = "match_dispute" | "general_support";

export interface SupportTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SupportTicketDialogMode;
  /** When mode is match_dispute */
  match?: Match | null;
  onSubmitted?: () => void;
}

export function SupportTicketDialog({
  open,
  onOpenChange,
  mode,
  match,
  onSubmitted,
}: SupportTicketDialogProps) {
  const { toast } = useToast();
  const user = useUserStore((s) => s.user);
  const submitReport = useReportStore((s) => s.submitReport);

  const [reason, setReason] = useState<TicketReason>("fake_screenshot");
  const [topic, setTopic] = useState<SupportTopic>("other");
  const [description, setDescription] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);

  const reset = () => {
    setReason("fake_screenshot");
    setTopic("other");
    setDescription("");
    setAttachmentPreview(null);
    setAttachmentName(null);
  };

  useEffect(() => {
    if (open) reset();
  }, [open, mode, match?.id]);

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Images only", description: "Please attach a PNG or JPEG.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({
        title: "File too large",
        description: `Max about ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB for now.`,
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : null;
      if (url) {
        setAttachmentPreview(url);
        setAttachmentName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (!user) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    const trimmed = description.trim();
    if (trimmed.length < 12) {
      toast({
        title: "Add more detail",
        description: "Please describe what happened (at least a few words).",
        variant: "destructive",
      });
      return;
    }

    if (mode === "general_support") {
      const body = `[${TOPIC_LABELS[topic]}]\n\n${trimmed}`;
      submitReport({
        reporterId: user.id,
        reporterName: user.username,
        reportedId: PLATFORM_REPORTED_ID,
        reportedUsername: PLATFORM_REPORTED_USERNAME,
        reason: "other",
        description: body,
        ticketCategory: "general_support",
        supportTopic: topic,
        attachmentDataUrl: attachmentPreview ?? undefined,
      });
      toast({
        title: "Ticket sent",
        description: "Support will review your message. You’ll see updates in notifications when the backend is live.",
      });
    } else {
      if (!match) {
        toast({ title: "No match selected", variant: "destructive" });
        return;
      }
      const myId = user.id;
      const oppSlot = getOpponentSlotForUser(match, myId);
      const oppDisplay = slotToProfileUsername(oppSlot, user.id, user.username);
      const header = `Match ${match.id} · ${match.game} ${match.mode} · vs ${oppDisplay}\n\n`;
      submitReport({
        reporterId: user.id,
        reporterName: user.username,
        reportedId: oppSlot,
        reportedUsername: oppDisplay,
        reason,
        description: header + trimmed,
        ticketCategory: "match_dispute",
        matchId: match.id,
        attachmentDataUrl: attachmentPreview ?? undefined,
      });
      toast({
        title: "Appeal submitted",
        description: "An admin will see this under Reports. Keep any extra proof handy.",
      });
    }

    reset();
    onOpenChange(false);
    onSubmitted?.();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display">
            {mode === "match_dispute" ? "Appeal this match" : "Submit a support ticket"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mode === "match_dispute"
              ? "Describe why you believe the result should be reviewed. Attach a screenshot if it helps."
              : "Choose a topic and describe your issue. Our team sees tickets in the admin panel."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {mode === "general_support" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Topic</Label>
              <Select value={topic} onValueChange={(v) => setTopic(v as SupportTopic)}>
                <SelectTrigger className="bg-secondary border-border text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {(Object.entries(TOPIC_LABELS) as [SupportTopic, string][]).map(([k, lab]) => (
                    <SelectItem key={k} value={k} className="text-sm">
                      {lab}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "match_dispute" && match && (
            <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground font-mono">
              {match.game} · {match.mode} · ID {match.id.slice(0, 12)}…
            </div>
          )}

          {mode === "match_dispute" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as TicketReason)}>
                <SelectTrigger className="bg-secondary border-border text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {(Object.entries(REASON_LABELS) as [TicketReason, string][]).map(([k, lab]) => (
                    <SelectItem key={k} value={k} className="text-sm">
                      {lab}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Details</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                mode === "match_dispute"
                  ? "What went wrong with this match?"
                  : "What do you need help with?"
              }
              className="min-h-[100px] bg-secondary border-border text-sm resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Screenshot (optional)</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-secondary/50 text-xs hover:bg-secondary transition-colors">
                  <ImagePlus className="h-3.5 w-3.5" /> Add image
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={onFile} />
              </label>
              {attachmentPreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setAttachmentPreview(null);
                    setAttachmentName(null);
                  }}
                >
                  <X className="h-3 w-3 mr-1" /> Remove
                </Button>
              )}
            </div>
            {attachmentName && <p className="text-[10px] text-muted-foreground">{attachmentName}</p>}
            {attachmentPreview && (
              <img src={attachmentPreview} alt="" className="mt-1 max-h-28 rounded-md border border-border object-contain" />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button type="button" className="glow-green font-display" onClick={handleSubmit}>
            Confirm & send ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
