import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  default: "text-accent bg-accent-tint border-transparent",
  success: "text-pos bg-pos/10 border-transparent",
  warning: "text-warn bg-warn/10 border-transparent",
  danger: "text-neg bg-neg/10 border-transparent",
  muted: "text-muted bg-raised border-transparent",
} as const;

export function Badge({ tone = "default", className, ...props }: ComponentProps<"span"> & { tone?: keyof typeof TONES }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)} {...props} />;
}
