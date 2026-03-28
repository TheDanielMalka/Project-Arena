// ─── Password Validation ─────────────────────────────────────────
// Shared utility used by Auth (signup) and Settings (change password).
// DB-ready: same rules must be enforced server-side in POST /api/auth/register
//           and PATCH /api/auth/password (use a shared Zod schema or middleware).

export interface PasswordRule {
  key: string;
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { key: "length",    label: "8–20 characters",          test: (pw) => pw.length >= 8 && pw.length <= 20 },
  { key: "uppercase", label: "At least 1 uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { key: "lowercase", label: "At least 1 lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { key: "number",    label: "At least 1 number",           test: (pw) => /[0-9]/.test(pw) },
  { key: "special",   label: "At least 1 special character (!@#$…)", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

/** Returns true only if ALL rules pass */
export const isPasswordValid = (pw: string): boolean =>
  PASSWORD_RULES.every((r) => r.test(pw));

/** Returns array of rule keys that are currently failing */
export const getFailingRules = (pw: string): string[] =>
  PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.key);
