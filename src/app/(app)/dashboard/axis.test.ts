import { describe, expect, it } from "vitest";
import { axisTicks } from "./charts";

describe("axisTicks", () => {
  it("pas rond, 0 inclus, bornes couvrant les données (résultat négatif)", () => {
    // Cas réel : revenus 6105 €, résultat −3000 € (centimes).
    const t = axisTicks(-300_000, 610_500);
    const step = t[1] - t[0];
    expect([1, 2, 2.5, 5].some((r) => step / 10 ** Math.floor(Math.log10(step)) === r)).toBe(true);
    expect(t).toContain(0);
    expect(t[0]).toBeLessThanOrEqual(-300_000);
    expect(t.at(-1)).toBeGreaterThanOrEqual(610_500);
    expect(t.every((v, i) => i === 0 || v - t[i - 1] === step)).toBe(true);
  });

  it("données positives : part de 0 ; données nulles : au moins deux graduations", () => {
    expect(axisTicks(0, 450_000)[0]).toBe(0);
    expect(axisTicks(0, 0).length).toBeGreaterThanOrEqual(2);
  });
});
