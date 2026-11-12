import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { encryptLegacyKeys } from "@/lib/llm";
import { processNextReport } from "@/lib/report";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const expected = Buffer.from(process.env.CRON_TOKEN ?? "");
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  if (!expected.length || given.length !== expected.length || !timingSafeEqual(expected, given)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await encryptLegacyKeys();
  return NextResponse.json({ processed: await processNextReport() });
}
