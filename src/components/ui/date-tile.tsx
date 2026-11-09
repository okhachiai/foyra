const short = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

/** Pavé de date d'une échéance : jour sur deux chiffres, mois abrégé. */
export function DateTile({ date }: { date: Date }) {
  return (
    <span className="date-tile">
      <b>{String(date.getUTCDate()).padStart(2, "0")}</b>
      <small>{short.format(date)}</small>
    </span>
  );
}
