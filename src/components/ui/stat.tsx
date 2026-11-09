import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

/** Indicateur de synthèse : libellé, valeur, note facultative. */
export function Stat({ label, value, tone, note, className }: { label: string; value: ReactNode; tone?: "neg" | "pos"; note?: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-1!", className)}>
      <span className="text-[0.9375rem] font-semibold text-heading">{label}</span>
      <strong className={cn("mt-2 text-[1.75rem] font-semibold tracking-tight", tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-heading")}>
        {value}
      </strong>
      {note && <small className="text-xs text-faint">{note}</small>}
    </Card>
  );
}
