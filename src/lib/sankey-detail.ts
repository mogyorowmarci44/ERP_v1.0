/** Sankey részletező: anyagköltség és igénybe vett szolgáltatások főkönyvi számlánként, ELÁBÉ gépkocsinként. */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { journalLines, journalEntries, accounts, vehicles } = schema;
export type DetailItem = { key: string; label: string; value: number };
export type SankeyDetail = Partial<Record<"IV5" | "IV6" | "IV8", DetailItem[]>>;

const MAX_ITEMS = 7;
/** A legnagyobb tételek + „egyéb” összevonás, csak pozitív értékek. */
function top(items: DetailItem[], restLabel: string): DetailItem[] {
  const pos = items.filter((x) => x.value >= 1).sort((a, b) => b.value - a.value);
  if (pos.length <= MAX_ITEMS + 1) return pos;
  const head = pos.slice(0, MAX_ITEMS);
  const rest = pos.slice(MAX_ITEMS);
  return [...head, { key: "rest", label: `${restLabel} (${rest.length} db)`, value: rest.reduce((s, x) => s + x.value, 0) }];
}

export async function sankeyDetail(companyId: number, from: string, to: string): Promise<SankeyDetail> {
  const period = and(eq(journalLines.companyId, companyId), gte(journalEntries.date, from), lte(journalEntries.date, to));
  const byAcc = await db
    .select({ code: accounts.code, name: accounts.name, v: sql<number>`sum(${journalLines.debit} - ${journalLines.credit})::float8` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(period, sql`${accounts.code} like '5%'`))
    .groupBy(accounts.code, accounts.name);
  const other5 = (c: string) => c.startsWith("5") && !["51", "52", "53", "54", "55", "56", "57", "58", "59"].some((p) => c.startsWith(p));
  const acc = (pred: (c: string) => boolean) => byAcc.filter((r) => pred(r.code)).map((r) => ({ key: r.code, label: `${r.code} ${r.name}`, value: Math.round(Number(r.v)) }));

  const byVeh = await db
    .select({ id: vehicles.id, make: vehicles.make, model: vehicles.model, plate: vehicles.plate, vin: vehicles.vin, v: sql<number>`sum(${journalLines.debit} - ${journalLines.credit})::float8` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(vehicles, eq(vehicles.id, journalLines.vehicleId))
    .where(and(period, sql`(${accounts.code} like '811%' or ${accounts.code} like '812%' or ${accounts.code} like '813%' or ${accounts.code} like '814%')`))
    .groupBy(vehicles.id, vehicles.make, vehicles.model, vehicles.plate, vehicles.vin);
  const veh = byVeh.map((r) => ({
    key: r.id ? `v${r.id}` : "none",
    label: r.id ? `${r.make} ${r.model}${r.plate ? ` (${r.plate})` : r.vin ? ` (…${r.vin.slice(-6)})` : ""}` : "Gépkocsihoz nem rendelt",
    value: Math.round(Number(r.v)),
  }));

  return {
    IV5: top(acc((c) => c.startsWith("51")), "Egyéb anyag"),
    IV6: top(acc((c) => c.startsWith("52") || other5(c)), "Egyéb szolgáltatás"),
    IV8: top(veh, "További autók"),
  };
}
