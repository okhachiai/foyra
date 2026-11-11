import Link from "next/link";
import { addMonths } from "@/lib/amortization";
import { formatMonth } from "@/lib/budget";
import { monthLabel } from "@/lib/ledger";
import { Icon } from "./icon";
import { getI18n } from "@/lib/i18n-server";

/** Month picker: ‹ month › as links (?m=YYYY-MM on `path`), no JavaScript. */
export async function MonthNav({ path, month }: { path: string; month: Date }) {
  const { t, intl } = await getI18n();
  const href = (n: number) => `${path}?m=${formatMonth(addMonths(month, n))}`;
  return (
    <nav className="month-nav" aria-label={t("Month")}>
      <Link href={href(-1)} aria-label={t("Previous month")}><Icon name="chevronLeft" className="size-4" /></Link>
      <span aria-current="date">{monthLabel(month, intl)}</span>
      <Link href={href(1)} aria-label={t("Next month")}><Icon name="chevron" className="size-4" /></Link>
    </nav>
  );
}
