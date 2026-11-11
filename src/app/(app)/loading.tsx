import { getI18n } from "@/lib/i18n-server";

/** Loading a signed-in page: plain skeleton (title, 3 figures, one block). */
export default async function Loading() {
  const { t } = await getI18n();
  return (
    <div role="status" aria-label={t("Loading")} className="flex flex-col gap-4 pt-2">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-8 w-64 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-[var(--r-lg)]" />)}
      </div>
      <div className="skeleton h-72 rounded-[var(--r-lg)]" />
    </div>
  );
}
