/** v3.9.4 – Könyvelésre váró piszkozatok irányonként (a rontott számlák nélkül) + a teendő linkje. */
import { and, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

export async function draftCounts(cid: number): Promise<{ total: number; out: number; in: number; href: string }> {
  const rows = await db
    .select({ dir: schema.invoices.direction, n: count() })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.companyId, cid), eq(schema.invoices.status, "draft"), isNull(schema.invoices.voidedAt)))
    .groupBy(schema.invoices.direction);
  const out = rows.find((r) => r.dir === "out")?.n ?? 0, inn = rows.find((r) => r.dir === "in")?.n ?? 0;
  // ha csak az egyik irányban van piszkozat, oda visz; ha mindkettőben, a nagyobbikba
  return { total: out + inn, out, in: inn, href: `/c/${cid}/invoices?dir=${inn > out ? "in" : "out"}` };
}

export const draftText = (d: { total: number; out: number; in: number }) =>
  d.out && d.in ? `${d.total} számla piszkozatban (${d.out} vevő, ${d.in} szállítói) – még nincs lekönyvelve`
  : `${d.total} ${d.out ? "vevőszámla" : "szállítói számla"} piszkozatban – még nincs lekönyvelve`;
