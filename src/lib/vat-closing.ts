/**
 * v2.2 – ÁFA-zárás: a bevallási időszak végén a 466 (előzetesen felszámított) és 467 (fizetendő) egyenlegének
 * átvezetése a 468 (ÁFA elszámolási) számlára. A 468 egyenlege a bevallás szerinti fizetendő / visszaigényelhető ÁFA;
 * a NAV-nak utalás T 468 / K 384.
 * A zárás az időszak végéig felhalmozott (még át nem vezetett) teljes egyenleget viszi át – a korábbi, le nem zárt
 * időszakokat is, illetve a 467-re közvetlenül könyvelt befizetéseket is.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/db";
import { accountIdByCode, postEntry, reverseEntry } from "./ledger";
import { round2 } from "./money";
import { today } from "./dates";

const { vatClosings, companies } = schema;

export type VatPeriodRow = {
  from: string; to: string; label: string; closed: { id: number; payable: number; number: string | null } | null;
  /** az időszak forgalma (ÁFA-zárás nélkül) */ m466: number; m467: number;
  /** átvezetendő halmozott egyenleg az időszak végén */ b466: number; b467: number; net: number; ended: boolean;
};

const MONTH = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function vatPeriods(kind: "monthly" | "quarterly" | "yearly", year: number) {
  const step = kind === "monthly" ? 1 : kind === "quarterly" ? 3 : 12;
  const out: Array<{ from: string; to: string; label: string }> = [];
  for (let m = 1; m <= 12; m += step) {
    const e = m + step - 1;
    out.push({ from: iso(year, m, 1), to: iso(year, e, lastDay(year, e)), label: kind === "monthly" ? `${year}. ${MONTH[m - 1]}` : kind === "quarterly" ? `${year}. ${(m + 2) / 3}. negyedév` : `${year}. év` });
  }
  return out;
}

async function balances(companyId: number, to: string, from?: string, excludeClosings = false) {
  const rows = (await db.execute(sql`
    select a.code, coalesce(sum(l.debit - l.credit), 0)::float8 as bal from journal_lines l
    join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.company_id = ${companyId} and e.date <= ${to} ${from ? sql`and e.date >= ${from}` : sql``}
      ${excludeClosings ? sql`and coalesce(e.source_type, '') <> 'vat_closing'` : sql``} and a.code in ('466', '467') group by a.code`)) as unknown as Array<{ code: string; bal: number }>;
  const b = (c: string) => round2(Number(rows.find((r) => r.code === c)?.bal ?? 0));
  return { b466: b("466"), b467: round2(-b("467")) };
}

/** v3.9.6 – A 466 / 467 napi forgalma (T − K) egyetlen lekérdezéssel; a zárótételek külön jelölve. */
async function vatDailyMoves(companyId: number, to: string, tx: DbOrTx = db) {
  const rows = (await tx.execute(sql`
    select e.date::text as d, a.code, (coalesce(e.source_type, '') = 'vat_closing'
        or e.reversal_of_id in (select id from journal_entries where company_id = ${companyId} and source_type = 'vat_closing')) as cl,
      coalesce(sum(l.debit - l.credit), 0)::float8 as bal
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.company_id = ${companyId} and e.date <= ${to} and a.code in ('466', '467')
    group by 1, 2, 3`)) as unknown as Array<{ d: string; code: string; cl: boolean; bal: number }>;
  return rows.map((r) => ({ d: String(r.d).slice(0, 10), code: r.code, cl: !!r.cl, bal: Number(r.bal) }));
}

export async function listVatPeriods(companyId: number, year: number): Promise<VatPeriodRow[]> {
  const t = today();
  const yearEnd = `${year}-12-31`;
  const [[c], closings, moves] = await Promise.all([
    db.select({ vatPeriod: companies.vatPeriod }).from(companies).where(eq(companies.id, companyId)),
    db.select({ c: vatClosings, number: schema.journalEntries.number }).from(vatClosings)
      .leftJoin(schema.journalEntries, eq(schema.journalEntries.id, vatClosings.journalEntryId))
      .where(eq(vatClosings.companyId, companyId)).orderBy(asc(vatClosings.toDate)),
    vatDailyMoves(companyId, yearEnd < t ? yearEnd : t),
  ]);
  const sumOf = (code: string, pred: (m: (typeof moves)[number]) => boolean) => round2(moves.filter((m) => m.code === code && pred(m)).reduce((a, m) => a + m.bal, 0));
  const out: VatPeriodRow[] = [];
  for (const p of vatPeriods(c.vatPeriod, year)) {
    if (p.from > t) break;
    const cl = closings.find((x) => x.c.toDate === p.to);
    // halmozott (még át nem vezetett) egyenleg az időszak végén – a zárótételekkel együtt
    const b = cl ? { b466: 0, b467: 0 } : { b466: sumOf("466", (m) => m.d <= p.to), b467: round2(-sumOf("467", (m) => m.d <= p.to)) };
    const inP = (m: (typeof moves)[number]) => !m.cl && m.d >= p.from && m.d <= p.to;
    out.push({ ...p, closed: cl ? { id: cl.c.id, payable: Number(cl.c.payable), number: cl.number } : null, m466: sumOf("466", inP), m467: round2(-sumOf("467", inP)), ...b, net: round2(b.b467 - b.b466), ended: p.to < t });
  }
  return out;
}

/**
 * v3.9.6 – A meglévő ÁFA-zárások újraszámolása időrendben (pl. ha a zárás után az időszakba könyveltek, vagy egy
 * tételt átkönyveltek): minden zárás pontosan a még át nem vezetett 466 / 467 egyenleget viszi a 468-ra.
 * A zárótételek sorai helyben módosulnak, minden változás a tétel-naplóba (journal_line_changes) kerül.
 */
export async function recomputeVatClosings(companyId: number, userId?: number) {
  return db.transaction(async (tx) => {
    const closings = await tx.select().from(vatClosings).where(eq(vatClosings.companyId, companyId)).orderBy(asc(vatClosings.toDate));
    if (!closings.length) return { changed: 0 };
    const moves = await vatDailyMoves(companyId, closings[closings.length - 1].toDate, tx);
    const [a466, a467, a468] = await Promise.all(["466", "467", "468"].map((c) => accountIdByCode(tx, companyId, c)));
    let done466 = 0, done467 = 0, changed = 0;
    for (const c of closings) {
      const cum = (code: string) => round2(moves.filter((m) => m.code === code && !m.cl && m.d <= c.toDate).reduce((a, m) => a + m.bal, 0));
      const b466 = round2(cum("466") - done466);
      const b467 = round2(-(cum("467") - done467));
      done466 = round2(done466 + b466); done467 = round2(done467 - b467);
      const net = round2(b467 - b466);
      if (!c.journalEntryId) continue;
      const want = new Map<number, { debit: number; credit: number }>([
        [a467, { debit: b467 > 0 ? b467 : 0, credit: b467 < 0 ? -b467 : 0 }],
        [a466, { debit: b466 < 0 ? -b466 : 0, credit: b466 > 0 ? b466 : 0 }],
        [a468, { debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 }],
      ]);
      const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, c.journalEntryId));
      const log: Array<typeof schema.journalLineChanges.$inferInsert> = [];
      for (const [accountId, w] of want) {
        const l = lines.find((x) => x.accountId === accountId);
        const zero = Math.abs(w.debit) < 0.005 && Math.abs(w.credit) < 0.005;
        if (l && zero) {
          await tx.delete(schema.journalLines).where(eq(schema.journalLines.id, l.id));
          log.push({ companyId, entryId: c.journalEntryId, lineId: null, field: "line_deleted", oldValue: `${l.debit}/${l.credit}`, newValue: null, userId: userId ?? null });
        } else if (l && (Number(l.debit) !== w.debit || Number(l.credit) !== w.credit)) {
          await tx.update(schema.journalLines).set({ debit: w.debit, credit: w.credit }).where(eq(schema.journalLines.id, l.id));
          if (Number(l.debit) !== w.debit) log.push({ companyId, entryId: c.journalEntryId, lineId: l.id, field: "debit", oldValue: String(l.debit), newValue: String(w.debit), userId: userId ?? null });
          if (Number(l.credit) !== w.credit) log.push({ companyId, entryId: c.journalEntryId, lineId: l.id, field: "credit", oldValue: String(l.credit), newValue: String(w.credit), userId: userId ?? null });
        } else if (!l && !zero) {
          const [n] = await tx.insert(schema.journalLines).values({ entryId: c.journalEntryId, companyId, accountId, debit: w.debit, credit: w.credit, description: "ÁFA-zárás (újraszámolva)" }).returning();
          log.push({ companyId, entryId: c.journalEntryId, lineId: n.id, field: "line_added", oldValue: null, newValue: `${w.debit}/${w.credit}`, userId: userId ?? null });
        }
      }
      if (log.length) { await tx.insert(schema.journalLineChanges).values(log); changed++; }
      if (Number(c.payable) !== net) await tx.update(vatClosings).set({ payable: net }).where(eq(vatClosings.id, c.id));
    }
    return { changed };
  });
}

/** Zárás: VN tétel az időszak utolsó napjával – T 467 / K 466, a különbözet a 468-ra. */
export async function closeVatPeriod(companyId: number, from: string, to: string, userId?: number) {
  const [exists] = await db.select().from(vatClosings).where(and(eq(vatClosings.companyId, companyId), eq(vatClosings.toDate, to)));
  if (exists) throw new Error("Ez az időszak már le van zárva.");
  const { b466, b467 } = await balances(companyId, to);
  if (Math.abs(b466) < 0.5 && Math.abs(b467) < 0.5) throw new Error("Nincs átvezetendő ÁFA-egyenleg.");
  const net = round2(b467 - b466);
  return db.transaction(async (tx) => {
    const [a466, a467, a468] = await Promise.all(["466", "467", "468"].map((c) => accountIdByCode(tx, companyId, c)));
    const side = (accountId: number, amount: number, debitIfPositive: boolean, description: string) =>
      Math.abs(amount) < 0.005 ? [] : [{ accountId, debit: (amount > 0) === debitIfPositive ? Math.abs(amount) : 0, credit: (amount > 0) === debitIfPositive ? 0 : Math.abs(amount), description }];
    const lines = [
      ...side(a467, b467, true, "Fizetendő ÁFA átvezetése"),
      ...side(a466, b466, false, "Előzetesen felszámított ÁFA átvezetése"),
      ...side(a468, net, false, net >= 0 ? "Fizetendő ÁFA (bevallás)" : "Visszaigényelhető / levonható többlet"),
    ];
    const entry = await postEntry(tx, { companyId, journalCode: "VN", date: to, userId, sourceType: "vat_closing", description: `ÁFA-zárás ${from} – ${to}`, lines });
    await tx.insert(vatClosings).values({ companyId, fromDate: from, toDate: to, payable: net, journalEntryId: entry.id });
    return { entry, net };
  });
}

export async function reopenVatPeriod(companyId: number, closingId: number, userId?: number) {
  const [c] = await db.select().from(vatClosings).where(and(eq(vatClosings.companyId, companyId), eq(vatClosings.id, closingId)));
  if (!c) throw new Error("A zárás nem található.");
  const later = await db.select({ id: vatClosings.id }).from(vatClosings).where(and(eq(vatClosings.companyId, companyId), sql`${vatClosings.toDate} > ${c.toDate}`));
  if (later.length) throw new Error("Előbb a későbbi időszakok zárását vond vissza.");
  return db.transaction(async (tx) => {
    await tx.delete(vatClosings).where(eq(vatClosings.id, c.id));
    const rev = c.journalEntryId ? await reverseEntry(tx, companyId, c.journalEntryId, c.toDate, userId, "ÁFA-zárás visszavonása") : null;
    return rev;
  });
}

/** Lejárt, de le nem zárt időszakok (emlékeztetőhöz). */
export async function unclosedVatPeriods(companyId: number) {
  const y = Number(today().slice(0, 4));
  const rows = (await Promise.all([listVatPeriods(companyId, y - 1), listVatPeriods(companyId, y)])).flat();
  // csak azok, amelyekben volt ÁFA-forgalom (a halmozott egyenleg a következő zárással is átvezethető)
  return rows.filter((r) => r.ended && !r.closed && (Math.abs(r.m466) >= 0.5 || Math.abs(r.m467) >= 0.5));
}
