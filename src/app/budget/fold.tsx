"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardTitle } from "@/components/ui/card";

const key = (title: string) => `budget-fold:${title}`;

/**
 * Carte pliable, fermée par défaut. L'état ouvert est mémorisé dans le navigateur (par titre) :
 * il survit aux changements de mois et aux enregistrements, qui recréent la carte.
 */
export function Fold({ title, aside, className, children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(key(title)) === "1");
    } catch {}
  }, [title]);

  return (
    <Card className={className}>
      <details
        open={open}
        onToggle={(e) => {
          const now = e.currentTarget.open;
          setOpen(now);
          try {
            if (now) localStorage.setItem(key(title), "1");
            else localStorage.removeItem(key(title));
          } catch {}
        }}
        className="group mt-0"
      >
        <summary className="m-0 flex list-none flex-wrap items-start justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <CardTitle>
            <span aria-hidden className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
            {title}
          </CardTitle>
          {aside}
        </summary>
        <div className="mt-3 flex flex-col gap-3">{children}</div>
      </details>
    </Card>
  );
}
