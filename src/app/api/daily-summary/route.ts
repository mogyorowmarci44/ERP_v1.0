/**
 * v3.9.2 – Napi összefoglaló ütemezett indítása (GitHub Actions hívja, `Authorization: Bearer <CRON_SECRET>`).
 * Naponta egyszer küld, Budapest szerint 6:45 és 12:00 között az első hívásra; a többi hívás „skipped”.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailySummary } from "@/lib/daily-summary/send";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const r = await runDailySummary({ trigger: "cron", force });
    return NextResponse.json(r, { status: r.log && r.log.failed && !r.log.sent ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
