import { sql } from "@/db";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** Állapot-végpont elérhetőség-figyeléshez (v6.7.0: verzió és adatbázis-válaszidő is). */
export async function GET() {
  const t0 = Date.now();
  try {
    await sql`select 1`;
    return Response.json({ ok: true, version: APP_VERSION, dbMs: Date.now() - t0 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, version: APP_VERSION }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
