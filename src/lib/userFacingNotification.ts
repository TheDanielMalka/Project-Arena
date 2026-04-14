/**
 * User-facing notification copy — no DB fields, APIs, or internal jargon.
 * Used when adding notifications and when hydrating rows from the API.
 */

export const userFacingNotification = {
  profileSaved: {
    title: "Profile updated",
    message: "Your photo, frame, and badge are saved. They’ll show across Arena.",
  },
  lookApplied: {
    title: "Look saved",
    message: "Your photo, frame, and badge are updated. Use Save if you also changed your username.",
  },
} as const;

/**
 * Rewrites known technical / dev-facing notification text (including legacy API copy).
 */
export function softenNotificationForDisplay(title: string, message: string): { title: string; message: string } {
  const t = title.trim();
  const m = message.trim();
  const blob = `${t}\n${m}`;

  if (
    /users\.(avatar|avatar_bg|equipped_badge_icon)/i.test(blob) ||
    /Identity saved for/i.test(blob) ||
    /same fields as DB/i.test(blob) ||
    /^✅\s*Profile Updated$/i.test(t)
  ) {
    return { ...userFacingNotification.profileSaved };
  }

  if (
    /DB fields on deploy/i.test(blob) ||
    /Forge preview/i.test(blob) ||
    /Synced to your Arena profile/i.test(blob) ||
    /Look locked in/i.test(t)
  ) {
    return { ...userFacingNotification.lookApplied };
  }

  return { title: t, message: m };
}
