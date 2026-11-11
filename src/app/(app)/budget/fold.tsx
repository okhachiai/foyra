"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardTitle } from "@/components/ui/card";

/**
 * <details> whose open state is remembered in the browser (under `storageKey`), closed by default:
 * it survives month changes and saves, which re-create the form.
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

/** Collapsible card (remembered by `id`, else by title). */
export function Fold({ id, title, aside, className, children }: { id?: string; title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <Remembered
        storageKey={`budget-fold:${id ?? title}`}
        className="group mt-0"
        summary={
          <summary className="m-0 flex list-none flex-wrap items-start justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <CardTitle>
              <span aria-hidden className="me-2 inline-block transition-transform group-open:rotate-90">›</span>
              {title}
            </CardTitle>
            {/* Fragment: `aside` comes from the server (sometimes as a deferred reference); as an only child it avoids React's spurious "key" warning. */}
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
 * A line's subcategories, collapsible (remembered by `id`: category or label, stable from one month to the next).
 * `aside` (checkboxes) sits on the <summary> row but outside it: a click inside a <summary> collapses the block.
 */
export function SubFold({ id, summary, aside, children }: { id: string; summary: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      {aside && <div className="absolute top-0 end-0 flex h-8 items-center">{aside}</div>}
      <Remembered
        storageKey={`budget-sub:${id}`}
        className="group/sub mt-0 pb-1"
        summary={
          <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-1.5 ps-9 text-label text-muted hover:text-heading [&::-webkit-details-marker]:hidden">
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
