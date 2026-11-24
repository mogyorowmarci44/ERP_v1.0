/**
 * v4.1.0 – ERP-térkép: a modulok metrótérképként, a cégválasztó oldalról elérhetően (még cég kiválasztása előtt).
 * Önálló, bejelentkezéshez kötött oldal; a „Megnyitás” gombok a felhasználó saját cégeire / egységeire mutatnak.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/auth";
import { APP_VERSION } from "@/lib/version";
import { fillTerkep } from "@/lib/terkep";

export const dynamic = "force-dynamic";

let template: string | null = null;
const page = () => (template ??= readFileSync(path.join(process.cwd(), "src/app/terkep/terkep.html"), "utf8"));


export async function GET() {
  const user = await getUser();
  if (!user) return new Response(null, { status: 307, headers: { Location: "/login" } });
  const list = await db
    .select({ id: schema.companies.id, name: schema.companies.name, entityType: schema.companies.entityType })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(schema.companies.name);
  const html = fillTerkep(page(), list, APP_VERSION);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
