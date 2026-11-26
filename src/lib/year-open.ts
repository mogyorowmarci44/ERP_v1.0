import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { accountIdByCode, lockPeriod, manualEntry } from "@/lib/ledger";
import { trialBalance } from "@/lib/reports";
import { round2 } from "@/lib/money";
import { listVatPeriods } from "@/lib/vat-closing";
import { depreciationStatus } from "@/lib/assets";

/**
 * v6.6.0 – Évnyitás egy gombbal.
 *
 * A mérlegszámlák egyenlege a programban automatikusan nyit, az eredményszámlák üzleti évenként indulnak. Az évnyitás az előző
 * üzleti év adózott eredményét vezeti át az eredménytartalékba (nyereségnél T 493 / K 414, veszteségnél fordítva), a következő
 * üzleti év első napjára, és kérésre lezárja az év hónapjait. A mérlegben az át nem vezetett korábbi eredmény addig is az
 * eredménytartalék sorában jelenik meg; az átvezetés után a 414-es számlán, tényleges tételként.
 */
const SOURCE = "year_open";

export function fyRange(fy: number, startMonth: number) {
  const sm = String(startMonth).padStart(2, "0");
  const from = `${fy}-${sm}-01`;
  const next = `${fy + 1}-${sm}-01`;
  const to = new Date(Date.parse(`${next}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { from, to, next };
}

/** Az üzleti év adózott eredménye (az eredményszámlák egyenlege; nyereség pozitív). */
export async function yearResult(cid: number, fy: number, startMonth: number) {
  const { from, to } = fyRange(fy, startMonth);
  const tb = await trialBalance(cid, from, to);
  const pl = tb.filter((r) => r.type === "expense" || r.type === "revenue");
  const result = round2(-pl.reduce((s, r) => s + r.periodDebit - r.periodCredit, 0));
  const tax = round2(tb.filter((r) => r.code.startsWith("891")).reduce((s, r) => s + r.periodDebit - r.periodCredit, 0));
  return { result, tax };
}

/** Már átvezetett évek (a nyitó tétel dátumából). */
export async function openedYears(cid: number, startMonth: number): Promise<Map<number, { entryId: number; number: string; amount: number }>> {
  const rows = await db
    .select({ id: schema.journalEntries.id, number: schema.journalEntries.number, date: schema.journalEntries.date, amount: sql<number>`(select coalesce(sum(debit),0)::float8 from journal_lines l where l.entry_id = ${schema.journalEntries.id})` })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.sourceType, SOURCE), sql`${schema.journalEntries.reversedById} is null`))
    .orderBy(asc(schema.journalEntries.date));
  const m = new Map<number, { entryId: number; number: string; amount: number }>();
  for (const r of rows) {
    const [y, mo] = r.date.split("-").map(Number);
    const fy = (mo >= startMonth ? y : y - 1) - 1; // a nyitó tétel a következő év első napján van
    m.set(fy, { entryId: r.id, number: r.number, amount: Number(r.amount) });
  }
  return m;
}

/** Az évnyitás előtti ellenőrzőlista (figyelmeztetések – a nyitást nem akadályozzák). */
export async function yearChecklist(cid: number, fy: number, startMonth: number) {
  const { from, to } = fyRange(fy, startMonth);
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
  const [vatAll, dep, locks, res] = await Promise.all([
    Promise.all(years.map((y) => listVatPeriods(cid, y))).then((x) => x.flat()),
    depreciationStatus(cid, Number(to.slice(0, 4))),
    db.select({ year: schema.periodLocks.year, month: schema.periodLocks.month }).from(schema.periodLocks).where(eq(schema.periodLocks.companyId, cid)),
    yearResult(cid, fy, startMonth),
  ]);
  const months: { year: number; month: number }[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  const lockedN = months.filter((m) => locks.some((l) => l.year === m.year && l.month === m.month)).length;
  return {
    from, to, result: res.result, tax: res.tax, months,
    items: [
      { key: "vat", ok: !vatAll.some((p) => p.to <= to && p.to >= from && p.ended && !p.closed && (Math.abs(p.m466) >= 0.5 || Math.abs(p.m467) >= 0.5)), label: "ÁFA-időszakok lezárva (466 / 467 → 468)", href: `reports/vat/closing?year=${to.slice(0, 4)}` },
      { key: "dep", ok: !dep.hasAssets || dep.openMonths.length === 0, label: "Értékcsökkenés elszámolva", href: `assets?year=${to.slice(0, 4)}` },
      { key: "tax", ok: res.tax !== 0 || res.result <= 0, label: "Társasági adó (891) lekönyvelve", href: `closing/taxes?fy=${fy}` },
      { key: "locks", ok: lockedN === months.length, label: `Hónapok zárolva (${lockedN}/${months.length})`, href: "settings" },
    ],
  };
}

/** Az év adózott eredményének átvezetése az eredménytartalékba (+ kérésre az év hónapjainak zárolása). */
export async function openYear(cid: number, fy: number, opts: { userId: number; lockMonths: boolean }) {
  const [c] = await db.select({ sm: schema.companies.fiscalYearStartMonth }).from(schema.companies).where(eq(schema.companies.id, cid));
  const sm = c?.sm ?? 1;
  const done = await openedYears(cid, sm);
  if (done.has(fy)) throw new Error(`A ${fy}. év eredménye már át van vezetve (${done.get(fy)!.number}).`);
  // a korábbi, eredményt mutató évek előbb
  const [first] = await db.select({ d: sql<string>`min(${schema.journalEntries.date})` }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid));
  if (first?.d) {
    const [fy0y, fy0m] = first.d.split("-").map(Number);
    const fy0 = fy0m >= sm ? fy0y : fy0y - 1;
    for (let y = fy0; y < fy; y++) {
      if (done.has(y)) continue;
      const r = await yearResult(cid, y, sm);
      if (Math.abs(r.result) >= 0.5) throw new Error(`Előbb a ${y}. év eredményét vezesd át.`);
    }
  }
  const { next, to } = fyRange(fy, sm);
  if (next > new Date().toISOString().slice(0, 10)) throw new Error(`A ${fy}. üzleti év még nem zárult le (${to}).`);
  const { result } = await yearResult(cid, fy, sm);
  const entry = await db.transaction(async (tx) => {
    if (Math.abs(result) < 0.5) return null;
    const [a493, a414] = await Promise.all([accountIdByCode(tx, cid, "493"), accountIdByCode(tx, cid, "414")]);
    const amt = Math.abs(result);
    const desc = `Évnyitás: a ${fy}. év adózott eredményének átvezetése az eredménytartalékba`;
    return manualEntry(cid, {
      journalCode: "VN", date: next, description: desc, sourceType: SOURCE,
      lines: result > 0
        ? [{ accountId: a493, debit: amt, credit: 0, description: desc }, { accountId: a414, debit: 0, credit: amt, description: desc }]
        : [{ accountId: a414, debit: amt, credit: 0, description: desc }, { accountId: a493, debit: 0, credit: amt, description: desc }],
    }, opts.userId, tx);
  });
  // a hónapok zárolása a sikeres átvezetés után
  if (opts.lockMonths) {
    const { months } = await yearChecklist(cid, fy, sm);
    for (const m of months) await lockPeriod(cid, m.year, m.month, opts.userId);
  }
  return { result, entry };
}
