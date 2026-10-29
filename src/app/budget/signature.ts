import type { ItemFields } from "@/lib/budget";

/** Empreinte des valeurs affichées d'une ligne : identique à la soumission = ligne non modifiée (cases non affichées : undefined). */
export const itemSignature = (f: ItemFields) => JSON.stringify([f.label, f.amount, f.included, f.recurring, f.shared, f.reserve]);
