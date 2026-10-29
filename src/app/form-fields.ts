// Lecture de champs à trois états (affiché ? coché ?) : module ordinaire, hors "use server", donc testable.

export const str = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();

/** Case « commune » : `sharedField` absent (case non affichée) → undefined (choix laissé au serveur) ; sinon cochée ou non. */
export const sharedField = (fd: FormData) => (fd.has("sharedField") ? fd.has("shared") : undefined);

/** Propriétaire d'un compte : champ absent ou égal à `ownerWas` → undefined (inchangé) ; vide → null (compte commun). */
export function ownerField(fd: FormData) {
  const changed = fd.has("ownerId") && !(fd.has("ownerWas") && str(fd, "ownerId") === str(fd, "ownerWas"));
  return changed ? str(fd, "ownerId") || null : undefined;
}

/** Cases « Commune » / « Réserve » d'une ligne de budget : `<prefix>flags` absent (non affichées) → undefined (inchangées). */
export function itemFlags(fd: FormData, prefix: string) {
  const flags = fd.has(`${prefix}flags`);
  return { shared: flags ? fd.get(`${prefix}shared`) === "on" : undefined, reserve: flags ? fd.get(`${prefix}reserve`) === "on" : undefined };
}
