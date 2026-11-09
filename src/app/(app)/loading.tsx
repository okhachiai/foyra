/** Chargement d'une page connectée : squelette sobre (titre, 3 chiffres, un bloc). */
export default function Loading() {
  return (
    <div role="status" aria-label="Chargement" className="flex flex-col gap-4 pt-2">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-8 w-64 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-[var(--r-lg)]" />)}
      </div>
      <div className="skeleton h-72 rounded-[var(--r-lg)]" />
    </div>
  );
}
