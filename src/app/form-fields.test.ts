import { describe, expect, it } from "vitest";
import { itemFlags, sharedField } from "./form-fields";

const fd = (entries: readonly (readonly [string, string])[]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("champs à trois états", () => {
  it.each([
    ["case absente", [], undefined],
    ["affichée, cochée", [["sharedField", "1"], ["shared", "on"]], true],
    ["affichée, décochée", [["sharedField", "1"]], false],
  ] as const)("sharedField : %s", (_, entries, expected) => {
    expect(sharedField(fd(entries))).toBe(expected);
    expect(sharedField(fd(entries)) ?? true).toBe(expected ?? true); // charges : commune par défaut
  });

  it.each([
    ["marqueur absent", [["1:shared", "on"]], { shared: undefined, reserve: undefined }],
    ["affichées, cochées", [["1:flags", "1"], ["1:shared", "on"], ["1:reserve", "on"]], { shared: true, reserve: true }],
    ["affichées, décochées", [["1:flags", "1"]], { shared: false, reserve: false }],
  ] as const)("itemFlags : %s", (_, entries, expected) => {
    expect(itemFlags(fd(entries), "1:")).toEqual(expected);
  });
});
