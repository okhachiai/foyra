import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Carte : fond blanc, bord fin, coins 16px (classe .card, cf. globals.css). */
export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("card flex min-w-0 flex-col gap-3 p-5 sm:p-6", className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-start justify-between gap-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("m-0 text-[1.0625rem] font-semibold tracking-tight text-heading", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("m-0 text-sm text-muted", className)} {...props} />;
}
