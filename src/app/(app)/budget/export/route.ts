import { requireUser } from "@/lib/auth";
import { formatMonth, parseMonth } from "@/lib/budget";
import { exportMonth } from "@/lib/budget-file";

/** GET /budget/export?m=AAAA-MM : tout le mois (budget, opérations, paiements) en JSON, à réimporter dans une autre base. */
export async function GET(req: Request) {
  const user = await requireUser();
  const month = parseMonth(new URL(req.url).searchParams.get("m") ?? undefined);
  if (!month) return new Response("Mois invalide.", { status: 400 });
  return new Response(JSON.stringify(await exportMonth(user.householdId, month), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="foyra-${formatMonth(month)}.json"` },
  });
}
