import { describe, expect, it } from "vitest";
import { formatCents, parseCents } from "./money";

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

  it("accepte 0 et les négatifs pour un solde initial", () => {
    expect(parseCents("-20", { allowSigned: true })).toBe(-2000);
    expect(parseCents("0", { allowSigned: true })).toBe(0);
    expect(parseCents("-0", { allowSigned: true })).toBe(0);
    expect(parseCents("--3", { allowSigned: true })).toBeNull();
  });
});

describe("formatCents", () => {
  it("formate en fr-FR avec U+202F", () => {
    expect(formatCents(123456)).toBe("1 234,56 €");
    expect(formatCents(-2000)).toBe("-20,00 €");
  });
});
