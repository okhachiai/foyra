import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  default: "text-accent-soft bg-accent/15 border-accent/40",
  success: "text-pos bg-pos/10 border-pos/40",
  warning: "text-warn bg-warn/10 border-warn/40",
  danger: "text-neg bg-neg/10 border-neg/40",
  muted: "text-muted bg-white/5 border-border",
} as const;

export function Badge({ tone = "default", className, ...props }: ComponentProps<"span"> & { tone?: keyof typeof TONES }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)} {...props} />;
}
