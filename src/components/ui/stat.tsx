import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

/** Indicateur de synthèse : libellé, valeur, note facultative. */
export function Stat({ label, value, tone, note, className }: { label: string; value: ReactNode; tone?: "neg" | "pos"; note?: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-1!", className)}>
      <span className="text-sm text-muted">{label}</span>
      <strong className={cn("text-3xl font-semibold tabular-nums tracking-tight", tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-heading")}>
        {value}
      </strong>
      {note && <small className="text-xs text-faint">{note}</small>}
    </Card>
  );
}
