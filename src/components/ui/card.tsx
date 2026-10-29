import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Carte bento : fond panneau, coins arrondis, halo qui suit le pointeur (classe .card, cf. Spotlight). */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("card flex min-w-0 flex-col gap-3 p-5 sm:p-6", className)} {...props} />;
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
