import Link from "next/link";
import { addMonths } from "@/lib/amortization";
import { formatMonth } from "@/lib/budget";
import { monthLabel } from "@/lib/ledger";
import { Icon } from "./icon";

/** Sélecteur de mois : ‹ mois › en liens (?m=AAAA-MM sur `path`), sans JavaScript. */
export function MonthNav({ path, month }: { path: string; month: Date }) {
  const href = (n: number) => `${path}?m=${formatMonth(addMonths(month, n))}`;
  return (
    <nav className="month-nav" aria-label="Mois">
      <Link href={href(-1)} aria-label="Mois précédent"><Icon name="chevronLeft" className="size-4" /></Link>
      <span aria-current="date">{monthLabel(month)}</span>
      <Link href={href(1)} aria-label="Mois suivant"><Icon name="chevron" className="size-4" /></Link>
    </nav>
  );
}
