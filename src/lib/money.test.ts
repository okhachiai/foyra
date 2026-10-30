import { describe, expect, it } from "vitest";
import { bigintToCents, formatCents, MAX_CENTS, parseCents } from "./money";

describe("parseCents (saisie montant)", () => {
  it.each([
    ["1 234,56", 123456],
    ["12.5", 1250],
    ["12,5", 1250],
    ["45,50", 4550],
    ["1 234,56", 123456],
    [" 7 ", 700],
  ])("%s → %i centimes", (input, cents) => expect(parseCents(input)).toBe(cents));

  it.each(["abc", "-3", "1,234", "", "0", "0,00", "1 23", "12,", "1e3", "99999999999"])("refuse « %s »", (input) =>
    expect(parseCents(input)).toBeNull(),
  );

  it("allowSigned : accepte 0 et les négatifs", () => {
    expect(parseCents("-20", { allowSigned: true })).toBe(-2000);
    expect(parseCents("0", { allowSigned: true })).toBe(0);
    expect(parseCents("-0", { allowSigned: true })).toBe(0);
    expect(parseCents("--3", { allowSigned: true })).toBeNull();
  });
});

describe("conversion exacte en centimes (sans flottant)", () => {
  it.each([
    ["19,99", 1999], // 19.99 * 100 = 1998.9999… en flottant
    ["0,07", 7],
    ["1.10", 110],
    ["0,29", 29], // 0.29 * 100 = 28.999…
    ["21474836,47", MAX_CENTS],
  ])("%s → %i", (input, cents) => expect(parseCents(input)).toBe(cents));

  it("refuse plus de deux décimales et au-delà de la limite", () => {
    expect([parseCents("1,005"), parseCents("12.345"), parseCents("21474836,48")]).toEqual([null, null, null]);
  });

  it("somme de centimes entiers exacte, là où les flottants dérivent", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(parseCents("0,1")! + parseCents("0,2")!).toBe(parseCents("0,3"));
  });

  it("grands entiers SQL : convertis exactement ou refusés, jamais arrondis", () => {
    expect(bigintToCents(9_007_199_254_740_991n)).toBe(Number.MAX_SAFE_INTEGER);
    expect(bigintToCents(-123n)).toBe(-123);
    expect(() => bigintToCents(9_007_199_254_740_992n)).toThrow(RangeError);
    expect(JSON.stringify({ total: bigintToCents(4_294_967_296n) })).toBe('{"total":4294967296}');
  });
});

describe("formatCents", () => {
  it("formate en fr-FR avec U+202F", () => {
    expect(formatCents(123456)).toBe("1 234,56 €");
    expect(formatCents(-2000)).toBe("-20,00 €");
  });
});
