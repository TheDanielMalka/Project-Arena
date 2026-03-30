import { useUserStore } from "@/stores/userStore";
import { usePlayerStore } from "@/stores/playerStore";
import { isCurrentUserSlot, resolveRosterProfile, slotToProfileUsername } from "@/lib/matchPlayerDisplay";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { cn } from "@/lib/utils";

const PALETTE = [
  "#F97316", "#38BDF8", "#A855F7", "#22C55E", "#EAB308", "#EC4899", "#14B8A6", "#F43F5E", "#6366F1", "#84CC16",
];

function circleColor(name: string): string {
  if (!name.length) return PALETTE[0];
  return PALETTE[(name.charCodeAt(0) + name.charCodeAt(name.length - 1)) % PALETTE.length];
}

export interface MatchRosterAvatarProps {
  /** Raw roster value from match rows (user id, username, or mock slot). */
  slotValue: string;
  size?: number;
  className?: string;
  /** When true, the current user gets a primary ring. Default true. */
  highlightSelf?: boolean;
}

/**
 * Avatar for match rosters (History, Lobby, Dashboard, Live tracker).
 * Resolves `preset:` / `upload:` / emoji / initials from session user or `playerStore` mock catalog.
 * DB-ready: same fields as `users.avatar` + JOIN public profile by roster id/username from API.
 */
export function MatchRosterAvatar({
  slotValue,
  size = 28,
  className,
  highlightSelf = true,
}: MatchRosterAvatarProps) {
  const user = useUserStore((s) => s.user);
  const catalog = usePlayerStore((s) => s.players);

  const isYou = isCurrentUserSlot(slotValue, user?.id, user?.username);
  const displayKey = slotToProfileUsername(slotValue, user?.id, user?.username);
  const profile = resolveRosterProfile(slotValue, user?.id, user?.username, catalog);

  const avatar = isYou ? user?.avatar : profile?.avatar;
  const initials = isYou
    ? (user?.avatarInitials ?? "??")
    : (profile?.avatarInitials ?? displayKey.slice(0, 2).toUpperCase());

  const ring =
    highlightSelf && isYou ? "ring-2 ring-primary/55 ring-offset-1 ring-offset-background" : "ring-1 ring-border/40";

  const imgClass = cn("rounded-full shrink-0 object-cover", identityPortraitCropClassName, ring, className);
  const initialsClass = cn("rounded-full shrink-0 flex items-center justify-center font-bold text-white", ring, className);

  if (avatar?.startsWith("upload:")) {
    return (
      <img
        src={avatar.slice(7)}
        alt=""
        width={size}
        height={size}
        className={imgClass}
        style={{ width: size, height: size }}
        decoding="async"
      />
    );
  }

  const presetUrl = avatar && avatar !== "initials" ? getAvatarImageUrlFromStorage(avatar) : null;
  if (presetUrl) {
    return (
      <img
        src={presetUrl}
        alt=""
        width={size}
        height={size}
        className={imgClass}
        style={{ width: size, height: size }}
        decoding="async"
      />
    );
  }

  if (avatar && avatar !== "initials") {
    return (
      <span
        className={cn(
          "rounded-full flex items-center justify-center shrink-0 border border-border/60 bg-secondary/80",
          ring,
          className,
        )}
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
        {avatar}
      </span>
    );
  }

  const bg = circleColor(profile?.username ?? displayKey);
  return (
    <div
      className={initialsClass}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.max(9, size * 0.36),
      }}
    >
      {initials}
    </div>
  );
}
