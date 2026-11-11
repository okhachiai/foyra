import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Indicateur de synthèse (carte KPI secondaire) : libellé, valeur, note facultative.
 * Classes CSS (.stat) plutôt qu’utilitaires : .stat-group les remet en lignes en mobile (globals.css). */
export function Stat({ label, value, tone, note, className }: { label: string; value: ReactNode; tone?: "neg" | "pos"; note?: ReactNode; className?: string }) {
  return (
    <section className={cn("card stat", className)}>
      <span className="text-label font-semibold text-muted">{label}</span>
      <strong className={cn("kpi-value", tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-heading")}>{value}</strong>
      {note && <small className="text-label text-faint">{note}</small>}
    </section>
  );
}
