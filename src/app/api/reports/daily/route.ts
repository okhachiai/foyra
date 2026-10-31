import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseDay, todayIn } from "@/lib/ledger";
import { generateAutoReports } from "@/lib/report";

/** Déclencheur des rapports automatiques — quotidien, et bilan du mois écoulé le 1er (appelé par le service cron) : jeton `CRON_TOKEN` en Bearer, vide ⇒ tout est refusé. */
export async function POST(req: Request) {
  const expected = Buffer.from(process.env.CRON_TOKEN ?? "");
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const created = await generateAutoReports(parseDay(todayIn(process.env.TZ ?? "Europe/Paris"))!);
  return NextResponse.json({ created });
}
