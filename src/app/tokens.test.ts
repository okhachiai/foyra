import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Contrastes WCAG des tokens de globals.css, en clair et en sombre (le sombre surcharge le clair). */
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const light = vars(css.match(/\n:root \{([\s\S]*?)\n\}/)![1]);
const dark = { ...light, ...vars(css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\}/)![1]) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Texte : 4,5:1 (AA). Aplats porteurs de sens (barres, courbes) : 3:1 (WCAG 1.4.11).
const TEXT: [string, string][] = [
  ...["text", "heading", "muted", "faint", "accent", "neg", "warn", "pos"].flatMap((fg) =>
    ["surface", "bg", "surface-secondary", "sidebar-bg"].map((bg): [string, string] => [fg, bg]),
  ),
  ["accent-text", "accent"], ["accent-ink", "accent-tint"], ["neg", "expense-tint"],
  ["warn", "warn-tint"], ["info-ink", "info-tint"], ["hero-text", "hero"], ["hero-muted", "hero"],
];
const FILLS = ["accent", "expense", "info"];

describe.each([["clair", light], ["sombre", dark]] as const)("tokens %s", (_, t) => {
  it.each(TEXT)("texte --%s sur --%s ≥ 4,5:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(FILLS)("aplat --%s sur --surface ≥ 3:1", (fill) => {
    expect(ratio(t[fill], t.surface)).toBeGreaterThanOrEqual(3);
  });
});
