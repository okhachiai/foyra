"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icon";

/** Erreur inattendue d'une page connectée : message neutre (aucun détail technique affiché), réessai ou retour. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="card mx-auto mt-8 flex max-w-lg flex-col items-start gap-3 p-6">
      <span className="kpi-icon expense"><Icon name="alert" className="size-4" /></span>
      <h1 className="m-0 text-section">Cette page n’a pas pu s’afficher</h1>
      <p className="m-0 text-muted">Une erreur inattendue s’est produite. Vos données n’ont pas été modifiées par cet affichage.</p>
      <div className="form-actions mt-1 w-full">
        <button type="button" onClick={reset}>Réessayer</button>
        <Link href="/tableau-de-bord" className="button secondary">Tableau de bord</Link>
      </div>
    </div>
  );
}
