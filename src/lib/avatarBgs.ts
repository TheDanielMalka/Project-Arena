// ── Avatar background color lookup — shared across all components ─────────────
// Mirrors BgDef preview values defined in Profile.tsx.

export const BG_COLORS: Record<string, string> = {
  default:  "#EF4444",
  blue:     "#3B82F6",
  purple:   "#A855F7",
  cyan:     "#22D3EE",
  green:    "#22C55E",
  orange:   "#F97316",
  fire:     "#F97316",
  ice:      "#7DD3FC",
  electric: "#FACC15",
  void:     "#7C3AED",
  gold:     "#EAB308",
  rainbow:  "#EC4899",
  aurora:   "#34D399",
  lava:     "#DC2626",
};

export function getBgColor(bgId: string | undefined): string {
  return BG_COLORS[bgId ?? "default"] ?? BG_COLORS.default;
}
