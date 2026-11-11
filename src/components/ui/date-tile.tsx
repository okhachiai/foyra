import { dateFmt } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";

/** Due-date tile: two-digit day, short month. */
export async function DateTile({ date }: { date: Date }) {
  const { intl } = await getI18n();
  return (
    <span className="date-tile">
      <b>{String(date.getUTCDate()).padStart(2, "0")}</b>
      <small>{dateFmt({ month: "short" }, intl).format(date)}</small>
    </span>
  );
}
