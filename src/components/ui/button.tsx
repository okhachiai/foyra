import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = { default: "", secondary: "secondary", danger: "danger", link: "link" } as const;
const SIZES = { default: "", sm: "min-h-9 px-3 text-sm" } as const;

export type ButtonVariant = keyof typeof VARIANTS;

/** Classes d'un bouton (styles .button / .secondary / .danger de globals.css). */
export const buttonVariants = ({ variant = "default", size = "default", className }: { variant?: ButtonVariant; size?: keyof typeof SIZES; className?: string } = {}) =>
  cn("button", VARIANTS[variant], SIZES[size], className);

export function Button({ variant, size, className, type = "button", ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: keyof typeof SIZES }) {
  return <button type={type} className={buttonVariants({ variant, size, className })} {...props} />;
}

/** Lien présenté comme un bouton. */
export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: keyof typeof SIZES }) {
  return <Link className={buttonVariants({ variant, size, className })} {...props} />;
}
