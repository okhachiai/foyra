"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardTitle } from "@/components/ui/card";

/**
 * <details> dont l'état ouvert est mémorisé dans le navigateur (sous `storageKey`), fermé par défaut :
 * il survit aux changements de mois et aux enregistrements, qui recréent le formulaire.
 */
function Remembered({ storageKey, className, summary, children }: { storageKey: string; className?: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey) === "1");
    } catch {}
  }, [storageKey]);

  return (
    <details
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        try {
          if (now) localStorage.setItem(storageKey, "1");
          else localStorage.removeItem(storageKey);
        } catch {}
      }}
      className={className}
    >
      {summary}
      {children}
    </details>
  );
}

/** Carte pliable (mémorisée par titre). */
export function Fold({ title, aside, className, children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <Remembered
        storageKey={`budget-fold:${title}`}
        className="group mt-0"
        summary={
          <summary className="m-0 flex list-none flex-wrap items-start justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <CardTitle>
              <span aria-hidden className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
              {title}
            </CardTitle>
            {/* Fragment : `aside` vient du serveur (parfois en référence différée) ; seul enfant, il échappe au faux avertissement « key » de React. */}
            <>{aside}</>
          </summary>
        }
      >
        <div className="mt-3 flex flex-col gap-3">{children}</div>
      </Remembered>
    </Card>
  );
}

/**
 * Sous-catégories d'une ligne, repliables (mémorisées par `id` : catégorie ou libellé, stables d'un mois à l'autre).
 * `aside` (cases à cocher) est posé sur la ligne du <summary> mais hors de lui : un clic dans un <summary> replie le bloc.
 */
export function SubFold({ id, summary, aside, children }: { id: string; summary: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      {aside && <div className="absolute top-0 right-0 flex h-8 items-center">{aside}</div>}
      <Remembered
        storageKey={`budget-sub:${id}`}
        className="group/sub mt-0 pb-1"
        summary={
          <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-1.5 pl-9 text-label text-muted hover:text-heading [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block transition-transform group-open/sub:rotate-90">›</span>
            {summary}
          </summary>
        }
      >
        {children}
      </Remembered>
    </div>
  );
}
