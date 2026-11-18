/**
 * v2.2 – ÁFA-zárás: a bevallási időszak végén a 466 (előzetesen felszámított) és 467 (fizetendő) egyenlegének
 * átvezetése a 468 (ÁFA elszámolási) számlára. A 468 egyenlege a bevallás szerinti fizetendő / visszaigényelhető ÁFA;
 * a NAV-nak utalás T 468 / K 384.
 * A zárás az időszak végéig felhalmozott (még át nem vezetett) teljes egyenleget viszi át – a korábbi, le nem zárt
 * időszakokat is, illetve a 467-re közvetlenül könyvelt befizetéseket is.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
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

export async function listVatPeriods(companyId: number, year: number): Promise<VatPeriodRow[]> {
  const [c] = await db.select({ vatPeriod: companies.vatPeriod }).from(companies).where(eq(companies.id, companyId));
  const closings = await db.select({ c: vatClosings, number: schema.journalEntries.number }).from(vatClosings)
    .leftJoin(schema.journalEntries, eq(schema.journalEntries.id, vatClosings.journalEntryId))
    .where(eq(vatClosings.companyId, companyId)).orderBy(asc(vatClosings.toDate));
  const t = today();
  const out: VatPeriodRow[] = [];
  for (const p of vatPeriods(c.vatPeriod, year)) {
    if (p.from > t) break;
    const cl = closings.find((x) => x.c.toDate === p.to);
    const b = cl ? { b466: 0, b467: 0 } : await balances(companyId, p.to);
    const mv = await balances(companyId, p.to, p.from, true);
    out.push({ ...p, closed: cl ? { id: cl.c.id, payable: Number(cl.c.payable), number: cl.number } : null, m466: mv.b466, m467: mv.b467, ...b, net: round2(b.b467 - b.b466), ended: p.to < t });
  }
  return out;
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
    const rev = c.journalEntryId ? await reverseEntry(tx, companyId, c.journalEntryId, c.toDate, userId, "ÁFA-zárás visszavonása") : null;
    await tx.delete(vatClosings).where(eq(vatClosings.id, c.id));
    return rev;
  });
}

/** Lejárt, de le nem zárt időszakok (emlékeztetőhöz). */
export async function unclosedVatPeriods(companyId: number) {
  const y = Number(today().slice(0, 4));
  const rows = [...(await listVatPeriods(companyId, y - 1)), ...(await listVatPeriods(companyId, y))];
  // csak azok, amelyekben volt ÁFA-forgalom (a halmozott egyenleg a következő zárással is átvezethető)
  return rows.filter((r) => r.ended && !r.closed && (Math.abs(r.m466) >= 0.5 || Math.abs(r.m467) >= 0.5));
}
