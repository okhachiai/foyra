import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICTS, translate } from "./i18n";

/** Every source file under src/, except tests. */
function sources(dir = new URL("..", import.meta.url).pathname): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [p] : [];
  });
}

/** String literals passed as the first argument of t(…), including both branches of a ternary. */
function usedKeys() {
  const keys = new Set<string>();
  for (const file of sources()) {
    for (const [, arg] of readFileSync(file, "utf8").matchAll(/\bt\(\s*((?:[^(),"]|"(?:[^"\\]|\\.)*")+)/g)) {
      // Skip enum values compared in a ternary condition (t(role === "ADMIN" ? "Administrator" : "Member")).
      for (const [, s] of arg.matchAll(/"((?:[^"\\]|\\.)*)"/g)) if (!/^[A-Z_]+$/.test(s)) keys.add(JSON.parse(`"${s}"`));
    }
  }
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("falls back to English and fills placeholders", () => {
    expect(translate("en", "{n} late", { n: 2 })).toBe("2 late");
    expect(translate("fr", "{n} late", { n: 2 })).toBe("2 en retard");
    expect(translate("fr", "No such key")).toBe("No such key");
  });

  it.each(Object.keys(DICTS) as (keyof typeof DICTS)[])("%s: every t(\"…\") key is translated", (locale) => {
    const missing = [...usedKeys()].filter((k) => !(k in DICTS[locale]));
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(DICTS) as (keyof typeof DICTS)[])("%s: translations keep the same placeholders", (locale) => {
    const wrong = Object.entries(DICTS[locale]).filter(([en, tr]) => placeholders(en).join() !== placeholders(tr).join());
    expect(wrong).toEqual([]);
  });
});
