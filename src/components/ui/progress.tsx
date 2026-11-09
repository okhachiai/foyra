import { cn } from "@/lib/utils";

export type ProgressTone = "accent" | "expense" | "warning" | "info";

/**
 * Barre réel / prévu (<progress> natif, cf. .progress). Au-delà du prévu : pleine, couleur dépense en texte (--neg).
 * Prévu nul : vide, ou pleine en dépassement si du réel existe.
 */
export function ProgressBar({ value, max, tone = "accent", label, className }: { value: number; max: number; tone?: ProgressTone; label: string; className?: string }) {
  const over = value > max;
  const top = max > 0 ? max : 1;
  return (
    <progress
      className={cn("progress", over ? "over" : tone !== "accent" && tone, className)}
      value={over ? top : Math.max(value, 0)}
      max={top}
      aria-label={label}
    />
  );
}
