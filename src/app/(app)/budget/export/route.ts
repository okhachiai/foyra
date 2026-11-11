import { requireUser } from "@/lib/auth";
import { formatMonth, parseMonth } from "@/lib/budget";
import { exportMonth } from "@/lib/budget-file";

/** GET /budget/export?m=YYYY-MM: the whole month (budget, transactions, payments) as JSON, to re-import into another database. */
export async function GET(req: Request) {
  const user = await requireUser();
  const month = parseMonth(new URL(req.url).searchParams.get("m") ?? undefined);
  if (!month) return new Response("Invalid month.", { status: 400 });
  return new Response(JSON.stringify(await exportMonth(user.householdId, month), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="foyra-${formatMonth(month)}.json"` },
  });
}
