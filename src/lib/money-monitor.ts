/** Pénztár- és bankfigyelő: pénzeszköz számlák (38x) egyenlegei, idősorai, figyelmeztetései. */
import { and, asc, eq, like, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { round2 } from "./money";
import { buckets, type Granularity } from "./statements";
import { getMnbRate } from "./fx-service";
import { addDaysIso, today as todayFn } from "./dates";

const { accounts, journalLines, journalEntries } = schema;

export type MoneyAccount = {
  id: number; code: string; name: string; currency: string; isCash: boolean;
  balanceHuf: number; balanceFx: number | null; avgRate: number | null;
  mnbRate: number | null; mnbRateDate: string | null; revaluedHuf: number | null; unrealized: number | null;
  series: Array<{ label: string; start: string; end: string; close: number; inflow: number; outflow: number }>;
  negativeDays: Array<{ date: string; balance: number }>;
  minClose: number; maxClose: number;
};

export async function moneyMonitor(companyId: number, from: string, to: string, gran: Granularity) {
  const accs = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), like(accounts.code, "38%"), eq(accounts.isPosting, true), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.code));
  const asOf = todayFn();
  const end = to > asOf ? to : asOf;
  const rows = await db
    .select({
      accountId: journalLines.accountId,
      date: journalEntries.date,
      huf: sql<number>`sum(${journalLines.debit} - ${journalLines.credit})::float8`,
      inflow: sql<number>`sum(case when ${journalLines.debit} > 0 then ${journalLines.debit} else 0 end + case when ${journalLines.credit} < 0 then -${journalLines.credit} else 0 end)::float8`,
      outflow: sql<number>`sum(case when ${journalLines.credit} > 0 then ${journalLines.credit} else 0 end + case when ${journalLines.debit} < 0 then -${journalLines.debit} else 0 end)::float8`,
      fx: sql<number>`coalesce(sum(case when ${journalLines.debit} <> 0 then ${journalLines.amountFx} else -${journalLines.amountFx} end), 0)::float8`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, companyId), lte(journalEntries.date, end), like(sql`(select code from accounts a where a.id = ${journalLines.accountId})`, "38%")))
    .groupBy(journalLines.accountId, journalEntries.date)
    .orderBy(asc(journalEntries.date));

  const cols = buckets(from, to, gran);
  const result: MoneyAccount[] = [];
  for (const a of accs) {
    const mine = rows.filter((r) => r.accountId === a.id);
    const balAt = (d: string) => round2(mine.filter((r) => r.date <= d).reduce((s, r) => s + Number(r.huf), 0));
    const series = cols.map((c) => {
      const inP = mine.filter((r) => r.date >= c.start && r.date <= c.end);
      return {
        label: c.label, start: c.start, end: c.end, close: balAt(c.end),
        inflow: round2(inP.reduce((s, r) => s + Number(r.inflow), 0)),
        outflow: round2(inP.reduce((s, r) => s + Number(r.outflow), 0)),
      };
    });
    // napi záró egyenlegek a tartományban: negatív pénztár / bank figyelése
    const negativeDays: Array<{ date: string; balance: number }> = [];
    let run = balAt(addDaysIso(from, -1));
    const byDate = new Map(mine.map((r) => [r.date, Number(r.huf)]));
    for (const r of mine) {
      if (r.date < from || r.date > to) continue;
      run = round2(run + (byDate.get(r.date) ?? 0));
      if (run < -0.5) negativeDays.push({ date: r.date, balance: run });
    }
    const balanceHuf = balAt(asOf);
    let balanceFx: number | null = null, avgRate: number | null = null, mnbRate: number | null = null, mnbRateDate: string | null = null, revaluedHuf: number | null = null, unrealized: number | null = null;
    if (a.currency !== "HUF") {
      balanceFx = round2(mine.filter((r) => r.date <= asOf).reduce((s, r) => s + Number(r.fx), 0));
      avgRate = Math.abs(balanceFx) > 0.004 ? Math.round((balanceHuf / balanceFx) * 100) / 100 : null;
      try {
        const r = await getMnbRate(a.currency, asOf);
        mnbRate = r.rate; mnbRateDate = r.rateDate;
        revaluedHuf = Math.round(balanceFx * r.rate);
        unrealized = round2(revaluedHuf - balanceHuf);
      } catch { /* MNB nem érhető el – a felület jelzi */ }
    }
    const closes = series.map((s) => s.close);
    result.push({
      id: a.id, code: a.code, name: a.name, currency: a.currency, isCash: a.code.startsWith("381"),
      balanceHuf, balanceFx, avgRate, mnbRate, mnbRateDate, revaluedHuf, unrealized, series, negativeDays,
      minClose: Math.min(0, ...closes), maxClose: Math.max(0, ...closes),
    });
  }
  return { accounts: result, columns: cols, asOf, total: round2(result.reduce((s, a) => s + a.balanceHuf, 0)) };
}
