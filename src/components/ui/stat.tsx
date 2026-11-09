import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

/** Indicateur de synthèse (carte KPI secondaire) : libellé, valeur, note facultative. */
export function Stat({ label, value, tone, note, className }: { label: string; value: ReactNode; tone?: "neg" | "pos"; note?: ReactNode; className?: string }) {
  return (
    <Card variant="kpi" className={className}>
      <span className="text-label font-semibold text-muted">{label}</span>
      <strong className={cn("kpi-value", tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-heading")}>{value}</strong>
      {note && <small className="text-label text-faint">{note}</small>}
    </Card>
  );
}
