import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Carte bento : fond panneau, coins arrondis, halo qui suit le pointeur (classe .card, cf. Spotlight). */
export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("card flex min-w-0 flex-col gap-3 p-5 sm:p-6", className)} {...props}>
      <Beams />
      {children}
    </section>
  );
}

/** Faisceaux lumineux qui parcourent les 4 bords de la carte parente (cf. .beams dans globals.css). */
export function Beams() {
  return <div aria-hidden className="beams"><i /><i /><i /><i /></div>;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-start justify-between gap-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("m-0 text-base font-semibold tracking-tight text-heading", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("m-0 text-sm text-muted", className)} {...props} />;
}
