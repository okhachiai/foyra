export const MAX_CENTS = 2_147_483_647; // PostgreSQL Int limit

/**
 * "1 234,56" → 123456, "12.5" → 1250. Returns null for invalid input.
 * By default the amount must be > 0; `allowSigned` accepts 0 and negatives.
 */
export function parseCents(input: string, { allowSigned = false } = {}): number | null {
  let s = input.trim().replace(/[\s  ]+/g, " ");
  let sign = 1;
  if (allowSigned && s.startsWith("-")) {
    sign = -1;
    s = s.slice(1).trimStart();
  }
  const m = /^(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1].replace(/ /g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents > MAX_CENTS) return null;
  if (!allowSigned && cents === 0) return null;
  return sign * cents || 0;
}

/**
 * SQL sum (bigint) → cents as number. Throws beyond Number.MAX_SAFE_INTEGER instead of silently rounding,
 * so values passed to client components stay serializable and exact.
 */
export function bigintToCents(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Amount out of range");
  return Number(v);
}

/** 123456 → "€1,234.56" (en-GB), "1 234,56 €" (fr-FR). `intl`: Intl locale tag, see INTL in i18n.ts. */
export function formatCents(cents: number, currency = "EUR", intl = "en-GB"): string {
  return new Intl.NumberFormat(intl, { style: "currency", currency }).format(cents / 100);
}

/** 123456 → "€1,235": rounded to the unit, for summaries and charts. */
export function formatWhole(cents: number, currency = "EUR", intl = "en-GB"): string {
  return new Intl.NumberFormat(intl, { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

/** Input field value: 123456 → "1234.56" (parseCents accepts both separators). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
