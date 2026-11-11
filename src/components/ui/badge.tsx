import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Texte sur fond teinté : couleurs *-ink / --neg / --warn, contrastes vérifiés par tokens.test.ts. */
const TONES = {
  success: "text-accent-ink bg-accent-tint",
  warning: "text-warn bg-warn-tint",
  danger: "text-neg bg-expense-tint",
  info: "text-info-ink bg-info-tint",
  muted: "text-muted bg-raised",
} as const;

/** Pastille de statut. `dot` : point coloré devant le libellé (statut d'une ligne de tableau, d'une échéance). */
export function Badge({ tone = "success", dot, className, children, ...props }: ComponentProps<"span"> & { tone?: keyof typeof TONES; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--r-sm)] px-2 py-0.5 text-label font-semibold", TONES[tone], className)} {...props}>
      {dot && <i aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
