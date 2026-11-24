/**
 * v3.10.0 – Napi banki letöltés ütemezett indítása (GitHub Actions hívja, `Authorization: Bearer <CRON_SECRET>`).
 * Minden összekapcsolt cég előző napig könyvelt tételei → Beérkező bizonylatok → javaslat / párosítás / könyvelés.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runBankSyncAll } from "@/lib/bank/sync";

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
  try {
    const results = await runBankSyncAll();
    const failed = results.some((r) => r.errors.length && !r.days);
    return NextResponse.json({ results }, { status: failed ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
