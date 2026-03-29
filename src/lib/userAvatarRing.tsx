// Shared avatar disc for sidebar / headers — reads `users.avatar` the same way as Dashboard.
import type { ReactNode } from "react";
import { getAvatarImageUrlFromStorage, identityPortraitCropClassName } from "@/lib/avatarPresets";
import { cn } from "@/lib/utils";

export function renderUserAvatarDiscContent(options: {
  avatar: string | undefined;
  /** When avatar === "initials", show these (prefer DB users.avatar_initials, else username). */
  initialsSource: string;
  sizePx: number;
  /** Tailwind rounding for the inner media (sidebar uses rounded-md-ish square). */
  mediaRoundedClass?: string;
}): ReactNode {
  const { avatar, initialsSource, sizePx, mediaRoundedClass = "rounded-full" } = options;
  const av = avatar ?? "initials";
  const initials = (initialsSource || "??").slice(0, 2).toUpperCase();

  if (av === "initials") {
    return (
      <span
        className="relative z-[1] font-display font-bold text-white"
        style={{
          fontSize: sizePx * 0.32,
          fontWeight: 700,
          textShadow: "0 1px 8px rgba(0,0,0,0.65)",
        }}
      >
        {initials}
      </span>
    );
  }
  if (av.startsWith("upload:")) {
    return (
      <img
        src={av.slice(7)}
        className={cn("relative z-[1] h-full w-full", mediaRoundedClass, identityPortraitCropClassName)}
        alt=""
      />
    );
  }
  const presetUrl = getAvatarImageUrlFromStorage(av);
  if (presetUrl) {
    return (
      <img
        src={presetUrl}
        className={cn("relative z-[1] h-full w-full", mediaRoundedClass, identityPortraitCropClassName)}
        alt=""
        decoding="async"
      />
    );
  }
  return <span className="relative z-[1]" style={{ fontSize: sizePx * 0.45 }}>{av}</span>;
}
