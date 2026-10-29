import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** État vide explicite : jamais de chiffre ni de graphique inventé. */
export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("flex flex-col items-start gap-2 rounded-3xl border border-dashed border-border p-5 text-sm", className)}>
      <p className="m-0 font-medium text-heading">{title}</p>
      {children && <div className="m-0 text-muted">{children}</div>}
      {action}
    </div>
  );
}
