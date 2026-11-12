import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { generateAutoReports } from "@/lib/report";

/** Déclencheur des rapports automatiques — quotidien, et bilan du mois écoulé le 1er (appelé par le service cron) : jeton `CRON_TOKEN` en Bearer, vide ⇒ tout est refusé. */
export async function POST(req: Request) {
  const expected = Buffer.from(process.env.CRON_TOKEN ?? "");
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const created = await generateAutoReports(new Date());
  return NextResponse.json({ created });
}
