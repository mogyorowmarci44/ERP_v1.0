/**
 * v2.2 – KPI-Dashboard (kereskedő cégekre). Minden mutató a könyvelésből számol, az elmúlt 12 hónapra (TTM),
 * ha a cég fiatalabb, a meglévő időszakra (a havi átlagok ennyi hónapra vetítve).
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { trialBalance, type TrialBalanceRow } from "./reports";
import { addDaysIso, today } from "./dates";
import { firstEntryDate } from "./forecast-data";
import { memberLoans } from "./member-loans";
import { eprQuarter } from "./epr-card";
import { quarterOf, quarterLabel } from "./epr";
import { round2 } from "./money";

export type KpiCar = {
  id: number; label: string; group: string; origin: "import" | "domestic" | null;
  purchaseDate: string | null; saleDate: string | null; status: string;
  base: number; cost: number; bookValue: number;
  saleGross: number; saleNet: number; marginVat: number;
  grossMargin: number | null; netProfit: number | null; days: number | null; cashDays: number | null;
  planPrice: number | null; planDate: string | null;
};
type GroupRow = { key: string; count: number; avgMargin: number; avgNet: number; avgDays: number | null; marginPct: number; medF2: number | null };

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Medián – a kiugró (pl. nagyon olcsó vagy nagyon drága, nagyon gyorsan vagy lassan eladott) autók nem húzzák el. */
const median = (xs: number[]): number | null => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const sumBy = (tb: TrialBalanceRow[], pred: (c: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.closingDebit - r.closingCredit, 0);
/** Időszaki forgalom (T − K) – eredményszámlákhoz: a kivonat záró egyenlege az üzleti év elejétől halmoz, nem az időszak elejétől. */
const flowBy = (tb: TrialBalanceRow[], pred: (c: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.periodDebit - r.periodCredit, 0);
const ymOf = (d: string) => d.slice(0, 7);
const groupKey = (make: string, model: string) => {
  const m = (model.split(/\s+/)[0] ?? "").replace(/['’]/g, "").toLowerCase();
  return `${make} ${m.charAt(0).toUpperCase()}${m.slice(1)}`;
};

/**
 * `asOf`: a számítás napja – a tavalyi összehasonlításhoz egy évvel korábbi nappal is lefut, ugyanazzal a módszerrel
 * (akkori készlet, akkor eladott autók, akkori egyenlegek). Ha a cégnek akkor még nem volt könyvelése: null.
 */
export async function companyKpis(companyId: number, asOf = today()) {
  const t = asOf;
  const yearAgo = addDaysIso(t, -365);
  const [firstEntry, opStart] = await Promise.all([firstEntryDate(companyId), operationStartOf(companyId)]);
  // a működés kezdete előtti időszak (alakulás, első vásárlások) nem számít bele az időszakba és az évesítésbe
  const start = firstEntry && opStart ? (opStart > firstEntry ? opStart : firstEntry) : firstEntry ?? opStart;
  if (asOf !== today() && (!start || start > asOf)) return null;
  const first = start && start <= t ? start : t;
  const from = first > yearAgo ? first : yearAgo;
  const months = Math.max(1, Math.min(12, (Date.parse(t) - Date.parse(from)) / (86400000 * 30.4375)));

  const rows = (await db.execute(sql`
    with sale as (
      select il.vehicle_id, max(i.fulfillment_date) d, sum(il.gross_huf) gross, sum(il.net_huf) net
      from invoice_lines il join invoices i on i.id = il.invoice_id
      where i.company_id = ${companyId} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null group by il.vehicle_id),
    salepay as (
      select il.vehicle_id, max(p.date) d from invoice_lines il join invoices i on i.id = il.invoice_id join payments p on p.invoice_id = i.id
      where i.company_id = ${companyId} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null group by il.vehicle_id),
    buy as (
      select il.vehicle_id, sum(il.gross_huf) gross, min(i.fulfillment_date) d
      from invoice_lines il join invoices i on i.id = il.invoice_id join vat_codes vc on vc.id = il.vat_code_id
      where i.company_id = ${companyId} and i.direction = 'in' and i.status = 'posted' and vc.kind = 'margin' and il.vehicle_id is not null group by il.vehicle_id),
    buypay as (
      select il.vehicle_id, min(p.date) d from invoice_lines il join invoices i on i.id = il.invoice_id join vat_codes vc on vc.id = il.vat_code_id join payments p on p.invoice_id = i.id
      where i.company_id = ${companyId} and i.direction = 'in' and i.status = 'posted' and vc.kind = 'margin' and il.vehicle_id is not null group by il.vehicle_id),
    gl as (
      select jl.vehicle_id,
        sum(case when a.code like '814%' then jl.debit - jl.credit else 0 end) cogs,
        sum(case when a.code like '26%' then jl.debit - jl.credit else 0 end) book,
        sum(case when a.code like '26%' then jl.debit else 0 end) cost_in,
        min(case when a.code like '26%' and jl.debit > 0 then e.date end) first_in
      from journal_lines jl join accounts a on a.id = jl.account_id join journal_entries e on e.id = jl.entry_id
      where jl.company_id = ${companyId} and jl.vehicle_id is not null group by jl.vehicle_id),
    plan as (select distinct on (vehicle_id) vehicle_id, sale_price, sale_date from forecast_plans where company_id = ${companyId} and vehicle_id is not null order by vehicle_id, id desc)
    select v.id, v.make, v.model, v.plate, v.status::text status, v.epr_origin origin, v.purchase_price::float8 pp,
      coalesce(v.purchase_date, b.d, g.first_in)::text purchase_date, s.d::text sale_date,
      coalesce(s.gross, 0)::float8 sale_gross, coalesce(s.net, 0)::float8 sale_net,
      coalesce(b.gross, 0)::float8 base_inv, coalesce(g.cogs, 0)::float8 cogs, coalesce(g.book, 0)::float8 book, coalesce(g.cost_in, 0)::float8 cost_in,
      bp.d::text buy_pay, sp.d::text sale_pay, pl.sale_price::float8 plan_price, pl.sale_date::text plan_date
    from vehicles v
    left join sale s on s.vehicle_id = v.id left join buy b on b.vehicle_id = v.id left join gl g on g.vehicle_id = v.id
    left join buypay bp on bp.vehicle_id = v.id left join salepay sp on sp.vehicle_id = v.id left join plan pl on pl.vehicle_id = v.id
    where v.company_id = ${companyId}`)) as unknown as Array<Record<string, string | number | null>>;

  const cars: KpiCar[] = rows.map((r) => {
    // az `asOf` napon: eladott, ha addig kiszámlázták; a később eladott autó akkor még készleten volt
    const sold = r.status === "sold" && !!r.sale_date && String(r.sale_date) <= t;
    const soldLater = r.status === "sold" && !sold;
    const base = r.pp != null ? Number(r.pp) : Number(r.base_inv);
    const cost = sold ? Number(r.cogs) || Number(r.cost_in) : Number(r.cost_in);
    const saleGross = Number(r.sale_gross), saleNet = Number(r.sale_net);
    const pd = r.purchase_date as string | null, sd = r.sale_date as string | null;
    const cashFrom = (r.buy_pay as string | null) ?? pd, cashTo = (r.sale_pay as string | null) ?? sd;
    return {
      id: Number(r.id),
      label: `${r.make} ${r.model}${r.plate ? ` (${r.plate})` : ""}`,
      group: groupKey(String(r.make), String(r.model)),
      origin: (r.origin as KpiCar["origin"]) ?? null,
      purchaseDate: pd, saleDate: sold ? sd : null, status: sold ? "sold" : "in_stock",
      base: round2(base), cost: round2(cost), bookValue: round2(soldLater ? Number(r.cost_in) : Number(r.book)),
      saleGross: round2(saleGross), saleNet: round2(saleNet), marginVat: round2(saleGross - saleNet),
      grossMargin: sold ? round2(saleGross - cost) : null,
      netProfit: sold ? round2(saleNet - cost) : null,
      days: sold && pd && sd ? days(pd, sd) : null,
      cashDays: sold && cashFrom && cashTo ? days(cashFrom, cashTo) : null,
      planPrice: r.plan_price != null ? Number(r.plan_price) : null, planDate: (r.plan_date as string | null) ?? null,
    };
  });

  const soldTtm = cars.filter((c) => c.saleDate && c.saleDate >= from && c.saleDate <= t);
  const stock = cars.filter((c) => c.status !== "sold" && c.purchaseDate && c.purchaseDate <= t);

  // --- Főkönyv: eredmény, rezsi, pénz ------------------------------------------------
  const [ttm, all, loans, epr] = await Promise.all([
    trialBalance(companyId, from, t),
    trialBalance(companyId, firstEntry && firstEntry <= t ? firstEntry : first, t),
    memberLoans(companyId, t).catch(() => null),
    eprQuarter(companyId, quarterOf(t)).catch(() => null),
  ]);
  const preTax = -flowBy(ttm, (c) => c.startsWith("9")) - flowBy(ttm, (c) => c.startsWith("5") || c.startsWith("8"));
  const overhead = flowBy(ttm, (c) => c.startsWith("5"));
  const overheadCash = flowBy(ttm, (c) => c.startsWith("5") && !c.startsWith("57"));
  const fixedMonthly = overheadCash / months;
  const cash = sumBy(all, (c) => c.startsWith("38") && !c.startsWith("389"));
  const payables = -sumBy(all, (c) => c.startsWith("45"));

  // havi zárókészlet (26x) az elmúlt 12 hónap végén – a lekötött tőke átlagához
  const stockRows = (await db.execute(sql`
    with m as (select (date_trunc('month', d) + interval '1 month - 1 day')::date me from generate_series(${from}::date, ${t}::date, interval '1 month') d)
    select m.me::text me, coalesce((select sum(jl.debit - jl.credit) from journal_lines jl join accounts a on a.id = jl.account_id join journal_entries e on e.id = jl.entry_id
      where jl.company_id = ${companyId} and a.code like '26%' and e.date <= least(m.me, ${t}::date)), 0)::float8 v from m order by m.me`)) as unknown as Array<{ me: string; v: number }>;
  const avgCapital = avg(stockRows.map((r) => Number(r.v)));

  // --- Készlet és forgás ---------------------------------------------------------------
  const age = (c: KpiCar) => (c.purchaseDate ? days(c.purchaseDate, t) : 0);
  const buckets = [
    { label: "0–30 nap", min: 0, max: 30 }, { label: "31–60 nap", min: 31, max: 60 },
    { label: "61–90 nap", min: 61, max: 90 }, { label: "90 napnál régebben", min: 91, max: 99999 },
  ].map((b) => {
    const xs = stock.filter((c) => age(c) >= b.min && age(c) <= b.max);
    return { ...b, count: xs.length, value: round2(xs.reduce((s, c) => s + c.bookValue, 0)) };
  });
  // átlagos készletdarabszám: hónapvégi darabszámok átlaga
  const avgStockCount = avg(stockRows.map((r) => cars.filter((c) => c.purchaseDate && c.purchaseDate <= r.me && (!c.saleDate || c.saleDate > r.me)).length));
  const soldPerMonth = soldTtm.length / months;

  // --- Készlet a teljes múltra (minden valaha készleten volt autó), mediánnal --------------
  const ever = cars.filter((c) => c.purchaseDate && c.purchaseDate <= t);
  const holdAll = ever.map((c) => days(c.purchaseDate!, c.saleDate ?? t));
  const holdSold = ever.filter((c) => c.saleDate).map((c) => days(c.purchaseDate!, c.saleDate!));
  const costAll = ever.map((c) => c.cost).filter((x) => x > 0);
  // hónapvégi darabszámok és havi eladások a cég teljes működésére
  const histMonths: string[] = [];
  {
    let idx = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1;
    const end = Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)) - 1;
    for (; idx <= end; idx++) histMonths.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  const monthEndOf = (ym: string) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return d > t ? t : d; };
  const histCounts = histMonths.map((ym) => { const me = monthEndOf(ym); return ever.filter((c) => c.purchaseDate! <= me && (!c.saleDate || c.saleDate > me)).length; });
  const histSold = histMonths.map((ym) => ever.filter((c) => c.saleDate && ymOf(c.saleDate) === ym).length);
  const medStockCount = median(histCounts);
  const medSoldPerMonth = median(histSold);
  const soldAll = ever.filter((c) => c.saleDate).length;
  const histYears = Math.max(1 / 12, histMonths.length / 12);

  // --- Fedezet (az időszakban eladott autók) -------------------------------------------
  const netSold = soldTtm.reduce((s2, c) => s2 + c.saleNet, 0);
  const f1 = soldTtm.map((c) => c.saleNet - c.base);
  const f2 = soldTtm.map((c) => c.saleNet - c.cost);
  const totalF1 = f1.reduce((a, b) => a + b, 0), totalF2 = f2.reduce((a, b) => a + b, 0);
  const ratio = netSold ? totalF2 / netSold : null;
  const monthlyRevenue = netSold / months;
  const beRevenue = ratio && ratio > 0 ? fixedMonthly / ratio : null;

  // --- Havi trend (12 hónap) -----------------------------------------------------------
  const trend = Array.from({ length: 12 }, (_, i) => {
    // tisztán egész számokkal (időzóna- és nyári időszámítás-független)
    const idx = Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)) - 1 - (11 - i);
    const ym = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
    const sold = cars.filter((c) => c.saleDate && ymOf(c.saleDate) === ym);
    return { ym, bought: cars.filter((c) => c.purchaseDate && ymOf(c.purchaseDate) === ym).length, sold: sold.length, profit: round2(sold.reduce((s, c) => s + (c.netProfit ?? 0), 0)) };
  });

  // --- Csoportosítások ------------------------------------------------------------------
  const groupBy = (key: (c: KpiCar) => string): GroupRow[] => {
    const m = new Map<string, KpiCar[]>();
    for (const c of soldTtm) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
    return [...m.entries()].map(([k, xs]) => {
      const gross = xs.reduce((s, c) => s + c.saleGross, 0);
      const marg = xs.reduce((s, c) => s + (c.grossMargin ?? 0), 0);
      const dd = xs.map((c) => c.days).filter((x): x is number => x != null);
      const f2 = median(xs.map((c) => c.saleNet - c.cost));
      return { key: k, count: xs.length, avgMargin: round2(marg / xs.length), avgNet: round2(avg(xs.map((c) => c.netProfit ?? 0))), avgDays: dd.length ? Math.round(median(dd)!) : null, marginPct: gross ? marg / gross : 0, medF2: f2 == null ? null : round2(f2) };
    }).sort((a, b) => b.count - a.count || b.avgMargin - a.avgMargin);
  };

  // --- Különbözeti ÁFA negyedévente (utolsó 4) -----------------------------------------
  const qNow = quarterOf(t);
  const quarters = Array.from({ length: 4 }, (_, i) => {
    let y = qNow.year, q = qNow.q - (3 - i);
    while (q < 1) { q += 4; y -= 1; }
    const xs = cars.filter((c) => c.saleDate && quarterOf(c.saleDate).year === y && quarterOf(c.saleDate).q === q);
    return { label: quarterLabel({ year: y, q: q as 1 | 2 | 3 | 4 }), count: xs.length, vat: round2(xs.reduce((s, c) => s + c.marginVat, 0)) };
  });

  // --- Terv vs. tény (eladott autók, amelyeknek volt Forecast-terve) -------------------
  const planned = soldTtm.filter((c) => c.planPrice);
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
  const grossSold = sum(soldTtm.map((c) => c.saleGross));
  const marginSold = sum(soldTtm.map((c) => c.grossMargin ?? 0));
  const baseSold = sum(soldTtm.map((c) => c.base));
  const avgNetCar = avg(soldTtm.map((c) => c.netProfit ?? 0));
  const eprSoldInQ = cars.filter((c) => c.saleDate && quarterOf(c.saleDate).year === qNow.year && quarterOf(c.saleDate).q === qNow.q).length;

  return {
    asOf: t, from, months: Math.round(months * 10) / 10, partial: months < 11.5,
    stock: {
      count: stock.length, value: round2(stock.reduce((s, c) => s + c.bookValue, 0)),
      avgTied: round2(avg(stock.map((c) => c.bookValue))), buckets,
      medTiedAll: costAll.length ? round2(median(costAll)!) : null, everCount: ever.length,
      cars: stock.map((c) => ({ ...c, age: age(c) })).sort((a, b) => b.age - a.age),
      monthsOfSales: medSoldPerMonth ? stock.length / medSoldPerMonth : soldPerMonth > 0 ? stock.length / soldPerMonth : null,
    },
    turnover: {
      medDaysAll: holdAll.length ? Math.round(median(holdAll)!) : null,
      medDaysSold: holdSold.length ? Math.round(median(holdSold)!) : null,
      medStockCount, medSoldPerMonth, soldAll, histMonths: histMonths.length,
      rateAll: medStockCount ? soldAll / histYears / medStockCount : null,
      avgDays: soldTtm.some((c) => c.days != null) ? Math.round(avg(soldTtm.map((c) => c.days).filter((x): x is number => x != null))) : null,
      soldCount: soldTtm.length, avgStockCount: Math.round(avgStockCount * 10) / 10,
      rate: avgStockCount > 0 ? (soldTtm.length * (12 / months)) / avgStockCount : null,
    },
    profit: {
      avgGrossMargin: round2(avg(soldTtm.map((c) => c.grossMargin ?? 0))),
      marginPct: grossSold ? marginSold / grossSold : null,
      avgNetBeforeOverhead: round2(avgNetCar),
      overheadPerCar: soldTtm.length ? round2(overhead / soldTtm.length) : null,
      avgNetAfterOverhead: soldTtm.length ? round2(avgNetCar - overhead / soldTtm.length) : null,
      refurbPct: baseSold ? (sum(soldTtm.map((c) => c.cost)) - baseSold) / baseSold : null,
      byModel: groupBy((c) => c.group),
      byOrigin: groupBy((c) => (c.origin === "import" ? "Import (nem HU)" : c.origin === "domestic" ? "Belföld (HU)" : "Nincs megadva")),
    },
    margin: {
      soldCount: soldTtm.length, netRevenue: round2(netSold),
      medF1: median(f1), medF2: median(f2), totalF1: round2(totalF1), totalF2: round2(totalF2),
      ratio, fixed: round2(overhead), coverage: overhead > 0 ? totalF2 / overhead : null,
      beRevenueMonthly: beRevenue == null ? null : round2(beRevenue), monthlyRevenue: round2(monthlyRevenue),
      safety: beRevenue != null && monthlyRevenue > 0 ? (monthlyRevenue - beRevenue) / monthlyRevenue : null,
      medDaily: median(soldTtm.filter((c) => c.days && c.days > 0).map((c) => (c.saleNet - c.cost) / c.days!)),
      medOnCost: median(soldTtm.filter((c) => c.cost > 0).map((c) => (c.saleNet - c.cost) / c.cost)),
      /** v3.9.5 – medián bruttó fedezet a beszerzési árhoz viszonyítva (TTM; ha nincs, az összes eladott autó). */
      medF1OnBase: median((soldTtm.length ? soldTtm : cars.filter((c) => c.status === "sold")).filter((c) => c.base > 0).map((c) => (c.saleNet - c.base) / c.base)),
    },
    money: {
      cash: round2(cash), payables: round2(payables), fixedMonthly: round2(fixedMonthly),
      free: round2(cash - payables - fixedMonthly),
      preTax: round2(preTax), avgCapital: round2(avgCapital),
      roc: avgCapital > 0 ? (preTax * (12 / months)) / avgCapital : null,
      cashCycle: soldTtm.some((c) => c.cashDays != null) ? Math.round(avg(soldTtm.map((c) => c.cashDays).filter((x): x is number => x != null))) : null,
      loans: loans ? { balance: round2(loans.total), nextDue: loans.members.map((m) => m.nextDue).filter((d): d is string => !!d).sort()[0] ?? null, overdue: round2(loans.members.reduce((s, m) => s + m.overdue, 0)) } : null,
    },
    ops: {
      trend,
      breakEven: avgNetCar > 0 ? fixedMonthly / avgNetCar : null,
      planVsActual: {
        count: planned.length,
        priceDiff: planned.length ? round2(avg(planned.map((c) => c.saleGross - (c.planPrice ?? 0)))) : null,
        dateDiff: planned.filter((c) => c.planDate).length ? Math.round(avg(planned.filter((c) => c.planDate).map((c) => days(c.planDate!, c.saleDate!)))) : null,
        rows: planned.map((c) => ({ label: c.label, plan: c.planPrice!, actual: c.saleGross, planDate: c.planDate, saleDate: c.saleDate })),
      },
    },
    tax: {
      quarters,
      avgMarginVat: round2(avg(soldTtm.map((c) => c.marginVat))),
      epr: epr ? { label: quarterLabel(epr.quarter), fee: epr.totals.fee, liable: epr.totals.count, sold: eprSoldInQ, deadline: epr.deadline } : null,
    },
  };
}
export type CompanyKpis = Awaited<ReturnType<typeof companyKpis>>;

/** A cég beállított működési kezdete (Beállítások › Működés kezdete), ha van. */
export async function operationStartOf(companyId: number): Promise<string | null> {
  const [c] = await db.select({ s: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, companyId));
  const v = c?.s?.operationStart;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
