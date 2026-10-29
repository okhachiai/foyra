export const MAX_CENTS = 2_147_483_647; // limite d'un Int PostgreSQL

/**
 * « 1 234,56 » → 123456, « 12.5 » → 1250. Renvoie null si la saisie est invalide.
 * Par défaut le montant doit être > 0 ; `allowSigned` accepte 0 et les négatifs (solde initial).
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
 * Somme SQL (bigint) → centimes en number. Refuse au-delà de Number.MAX_SAFE_INTEGER plutôt que d'arrondir
 * silencieusement ; les valeurs transmises aux composants client restent ainsi sérialisables et exactes.
 */
export function bigintToCents(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Montant hors limites");
  return Number(v);
}

/** 123456 → « 1 234,56 € » (séparateur de milliers U+202F, format fr-FR). */
export function formatCents(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(cents / 100);
}

/** Valeur pour un champ de saisie : 123456 → « 1234,56 ». */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
