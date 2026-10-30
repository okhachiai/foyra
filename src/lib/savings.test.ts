import { describe, expect, it } from "vitest";
import { savingsSeries } from "./savings";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("savingsSeries", () => {
  it("additionne par mois, cumule depuis le reste antérieur, lit le prévu", () => {
    const months = [d("2026-08-01"), d("2026-09-01"), d("2026-10-01")];
    const paid = [
      { occurredOn: d("2026-08-05"), amount: 10000 },
      { occurredOn: d("2026-08-20"), amount: 5000 },
      { occurredOn: d("2026-10-01"), amount: 20000 },
    ];
    expect(savingsSeries(months, paid, new Map([["2026-09", 30000]]), 1000)).toEqual([
      { month: "2026-08", planned: 0, actual: 15000, cumulative: 16000 },
      { month: "2026-09", planned: 30000, actual: 0, cumulative: 16000 },
      { month: "2026-10", planned: 0, actual: 20000, cumulative: 36000 },
    ]);
  });
});
