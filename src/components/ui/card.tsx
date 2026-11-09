import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cartes (classe .card + variante, cf. globals.css) :
 * - default : carte blanche standard (aussi carte analytique et carte de progression) ;
 * - hero : KPI principal, vert profond ;
 * - kpi : KPI secondaire, plus compacte ;
 * - table : carte de tableau, le tableau va presque jusqu'au bord ;
 * - due : tuile d'échéance, sur fond secondaire.
 */
const VARIANTS = {
  default: "gap-3 p-5 sm:p-6",
  hero: "card-hero gap-3 p-5 sm:p-6",
  kpi: "gap-2 p-5",
  table: "card-table gap-3 px-2 pt-5 pb-2 sm:pt-6",
  due: "card-due gap-2 p-4",
} as const;

export type CardVariant = keyof typeof VARIANTS;

export function Card({ variant = "default", className, children, ...props }: ComponentProps<"section"> & { variant?: CardVariant }) {
  return (
    <section className={cn("card flex min-w-0 flex-col", VARIANTS[variant], className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-start justify-between gap-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("m-0 text-section font-bold tracking-tight text-heading", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("m-0 text-label text-muted", className)} {...props} />;
}

/** En-tête de section : titre, sous-titre facultatif, action à droite (lien, filtre, pastille). */
export function SectionHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <CardHeader className={cn("flex-nowrap items-start", className)}>
      <div className="min-w-0 flex-1">
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription className="mt-1">{subtitle}</CardDescription>}
      </div>
      {action}
    </CardHeader>
  );
}
