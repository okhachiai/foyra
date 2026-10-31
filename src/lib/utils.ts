/** Concatène les classes non vides. Pas de fusion des conflits Tailwind : une surcharge en conflit passe par `!`. */
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
