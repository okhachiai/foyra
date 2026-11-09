/** Symbole Foyra « Arche » : F dont le bras devient une arche, barre abritée dessous. Couleur = currentColor. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M10 42V22A16 16 0 0 1 26 6h12v8H26a8 8 0 0 0-8 8v20z" />
      <path d="M22 26h12v8H22z" />
    </svg>
  );
}
