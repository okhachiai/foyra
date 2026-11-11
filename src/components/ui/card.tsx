import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cartes (classe .card + variante, cf. globals.css) :
 * - default : carte blanche standard (aussi carte analytique et carte de progression) ;
 * - hero : KPI principal, vert profond ;
 * - kpi : KPI secondaire, plus compacte ;
 * - table : carte de tableau, le tableau va presque jusqu'au bord.
 */
const VARIANTS = {
  default: "gap-3 p-5 sm:p-6",
  hero: "card-hero gap-3 p-5 sm:p-6",
  kpi: "gap-2 p-5",
  table: "card-table gap-3 px-2 pt-5 pb-2 sm:pt-6",
} as const;

export function Card({ variant = "default", className, children, ...props }: ComponentProps<"section"> & { variant?: keyof typeof VARIANTS }) {
  return (
    <section className={cn("card flex min-w-0 flex-col", VARIANTS[variant], className)} {...props}>
      {children}
    </section>
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("m-0 text-section font-bold tracking-tight text-heading", className)} {...props} />;
}

/** En-tête de section : titre, sous-titre facultatif, action à droite (lien, filtre, pastille). */
export function SectionHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-2", className)}>
      <div className="min-w-0 flex-1">
        <CardTitle>{title}</CardTitle>
        {subtitle && <p className="m-0 mt-1 text-label text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
