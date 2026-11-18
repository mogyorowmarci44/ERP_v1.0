/**
 * v2.2 – Időbeli elhatárolások (39x aktív, 48x passzív): nyitott tételek, emlékeztető és feloldás.
 * Feloldás = ellentétes tétel (a sorok oldala felcserélve) a választott napon, sourceType „accrual_release”,
 * sourceId = az eredeti tétel. A számla megérkezésekor a feloldás helyett a számlát is lehet a 48x-re könyvelni –
 * a lista ezért csak akkor jelez, ha a 39x / 48x számla egyenlege nem nulla.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { postEntry } from "./ledger";
import { round2 } from "./money";
import { today } from "./dates";

const { journalEntries, journalLines } = schema;

export type OpenAccrual = { entryId: number; number: string; date: string; description: string; account: string; kind: "aktív" | "passzív"; amount: number; ageDays: number };

export async function accrualBalances(companyId: number) {
  const rows = (await db.execute(sql`
    select a.code, a.name, coalesce(sum(l.debit - l.credit), 0)::float8 as bal from journal_lines l
    join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.company_id = ${companyId} and (a.code like '39%' or a.code like '48%') group by a.code, a.name having abs(sum(l.debit - l.credit)) >= 0.5 order by a.code`)) as unknown as Array<{ code: string; name: string; bal: number }>;
  return rows.map((r) => ({ code: r.code, name: r.name, balance: round2(Number(r.bal)) }));
}

export async function openAccruals(companyId: number): Promise<OpenAccrual[]> {
  const rows = (await db.execute(sql`
    select e.id, e.number, e.date::text as date, e.description, a.code,
      sum(case when a.code like '39%' then l.debit - l.credit else l.credit - l.debit end)::float8 as amount
    from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id
    where e.company_id = ${companyId} and (a.code like '39%' or a.code like '48%')
      and e.reversed_by_id is null and e.reversal_of_id is null
      and coalesce(e.source_type, '') not in ('accrual_release', 'storno')
      and not exists (select 1 from journal_entries r where r.company_id = e.company_id and r.source_type = 'accrual_release' and r.source_id = e.id and r.reversed_by_id is null)
    group by e.id, e.number, e.date, e.description, a.code
    having sum(case when a.code like '39%' then l.debit - l.credit else l.credit - l.debit end) > 0.5
    order by e.date`)) as unknown as Array<{ id: number; number: string; date: string; description: string; code: string; amount: number }>;
  const t = Date.parse(today());
  return rows.map((r) => ({ entryId: r.id, number: r.number, date: r.date, description: r.description, account: r.code, kind: r.code.startsWith("39") ? "aktív" : "passzív", amount: round2(Number(r.amount)), ageDays: Math.round((t - Date.parse(r.date)) / 86400000) }));
}

/** Emlékeztető: lejárt időszakú (a tétel hónapja már elmúlt) nyitott elhatárolások, ha a számla egyenlege nem nulla. */
export async function dueAccruals(companyId: number) {
  const bal = await accrualBalances(companyId);
  if (!bal.length) return [];
  const curMonth = today().slice(0, 7);
  return (await openAccruals(companyId)).filter((a) => a.date.slice(0, 7) < curMonth && bal.some((b) => b.code === a.account));
}

/** Feloldás: az eredeti tétel ellentétes könyvelése (sorok oldala felcserélve). */
export async function releaseAccrual(companyId: number, entryId: number, date: string, userId?: number) {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
    if (!e) throw new Error("A tétel nem található.");
    if (e.reversedById) throw new Error("A tétel sztornózva van.");
    const [done] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.sourceType, "accrual_release"), eq(journalEntries.sourceId, entryId), sql`${journalEntries.reversedById} is null`));
    if (done) throw new Error("Ez az elhatárolás már fel van oldva.");
    if (date < e.date) throw new Error("A feloldás nem lehet korábbi az elhatárolásnál.");
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId));
    const [j] = await tx.select({ code: schema.journals.code }).from(schema.journals).where(eq(schema.journals.id, e.journalId));
    return postEntry(tx, {
      companyId, journalCode: j?.code ?? "VN", date, userId, sourceType: "accrual_release", sourceId: entryId,
      description: `Elhatárolás feloldása – ${e.number}: ${e.description}`.slice(0, 500),
      lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.credit), credit: Number(l.debit), description: l.description, partnerId: l.partnerId, vehicleId: l.vehicleId })),
    });
  });
}
