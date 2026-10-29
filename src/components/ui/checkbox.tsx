import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Case à cocher avec libellé cliquable (styles .check de globals.css). */
export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("check text-sm", className)}>
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}
