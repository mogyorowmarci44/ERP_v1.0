/** Tervezés – adatbetöltés a főkönyvből és a terv-táblákból, javaslatok (ismétlődő költség, eladási ár / dátum). */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ForecastSettings } from "@/db/schema";
import { marginPurchaseBase, vehicleBookValues } from "./ledger";
import { fiscalYearStart, openItems } from "./reports";
import { today, addDaysIso } from "./dates";
import { round2 } from "./money";
import {
  normalizeSettings, calibrate, quantile, MIN_CALIBRATION_SALES,
  type FcOpening, type FcPlan, type FcItem, type SoldHistory, type Channel,
} from "./forecast";

const { accounts, journalEntries, journalLines, vehicles, invoices, invoiceLines, vatCodes, partners, payments, companies, forecastPlans, forecastPlanCosts, forecastItems, forecastSettings } = schema;

export async function getForecastSettings(companyId: number): Promise<ForecastSettings> {
  const [row] = await db.select().from(forecastSettings).where(eq(forecastSettings.companyId, companyId));
  return normalizeSettings(row?.settings);
}
export async function saveForecastSettings(companyId: number, s: ForecastSettings) {
  const v = normalizeSettings(s);
  await db.insert(forecastSettings).values({ companyId, settings: v })
    .onConflictDoUpdate({ target: forecastSettings.companyId, set: { settings: v, updatedAt: new Date() } });
}

/** Számlakód-előtag szerinti egyenleg (T − K), opcionális dátumtartománnyal. */
async function balanceByPrefix(companyId: number, prefixes: string[], from?: string, to?: string) {
  const rows = await db
    .select({ code: accounts.code, bal: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::float8` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.companyId, companyId), from ? sql`${journalEntries.date} >= ${from}` : sql`true`, to ? sql`${journalEntries.date} <= ${to}` : sql`true`))
    .groupBy(accounts.code);
  const out: Record<string, number> = {};
  for (const p of prefixes) out[p] = round2(rows.filter((r) => r.code.startsWith(p)).reduce((a, r) => a + Number(r.bal), 0));
  return { byPrefix: out, rows: rows.map((r) => ({ code: r.code, bal: Number(r.bal) })) };
}

export async function loadOpening(companyId: number, asOf = today()): Promise<FcOpening> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const all = await balanceByPrefix(companyId, ["381", "384", "466", "467", "468"], undefined, asOf);
  const fy = fiscalYearStart(asOf, company.fiscalYearStartMonth);
  const ytd = await balanceByPrefix(companyId, [], fy, asOf);
  const accRows = await db.select({ code: accounts.code, type: accounts.type }).from(accounts).where(eq(accounts.companyId, companyId));
  const typeOf = new Map(accRows.map((a) => [a.code, a.type]));
  let ytdPreTax = 0, revenue = 0, cogsMat = 0;
  for (const r of ytd.rows) {
    const t = typeOf.get(r.code);
    if ((t === "revenue" || t === "expense") && !r.code.startsWith("89")) ytdPreTax -= r.bal;
    if (/^9[123]/.test(r.code)) revenue -= r.bal;
    if (/^(811|814|815|51)/.test(r.code)) cogsMat += r.bal;
  }
  const [ins, outs] = await Promise.all([openItems(companyId, "in"), openItems(companyId, "out")]);
  const oi = [...outs.map((r) => ({ r, sign: 1 })), ...ins.map((r) => ({ r, sign: -1 }))].map(({ r, sign }) => ({
    date: r.dueDate ?? r.issueDate,
    amount: sign * Math.round((Number(r.grossHuf) * r.openFx) / (Number(r.grossFx) || 1)),
    channel: "bank" as Channel,
    label: `${sign > 0 ? "Vevő" : "Szállító"}: ${r.partnerName} ${r.invoiceNumber}`,
  }));
  return {
    openItems: oi,
    asOf,
    cash: all.byPrefix["381"],
    bank: all.byPrefix["384"],
    vatPayable: -round2(all.byPrefix["466"] + all.byPrefix["467"] + all.byPrefix["468"]),
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    vatPeriod: company.vatPeriod as FcOpening["vatPeriod"],
    ytdPreTax: round2(ytdPreTax),
    ytdHipaBase: round2(revenue - cogsMat),
  };
}

export type StockRow = {
  vehicle: typeof vehicles.$inferSelect;
  bookValue: number;
  marginBase: number;
  plan: (typeof forecastPlans.$inferSelect & { costs: (typeof forecastPlanCosts.$inferSelect)[] }) | null;
};
export type ClosedRow = {
  plan: typeof forecastPlans.$inferSelect;
  vehicle: typeof vehicles.$inferSelect;
  actualDate: string | null;
  actualGross: number;
  planCosts: number;
};

/** Készlet + tervek + lezárt (eladott) tervek a terv–tény összevetéshez. */
export async function loadPlans(companyId: number) {
  const vs = await db.select().from(vehicles).where(eq(vehicles.companyId, companyId)).orderBy(asc(vehicles.purchaseDate), asc(vehicles.id));
  const plans = await db.select().from(forecastPlans).where(eq(forecastPlans.companyId, companyId)).orderBy(asc(forecastPlans.id));
  const costs = plans.length ? await db.select().from(forecastPlanCosts).where(inArray(forecastPlanCosts.planId, plans.map((p) => p.id))).orderBy(asc(forecastPlanCosts.id)) : [];
  const withCosts = plans.map((p) => ({ ...p, costs: costs.filter((c) => c.planId === p.id) }));
  const inStock = vs.filter((v) => v.status !== "sold");
  const books = await vehicleBookValues(db, companyId, inStock.map((v) => v.id));
  const stock: StockRow[] = [];
  for (const v of inStock) {
    stock.push({ vehicle: v, bookValue: round2(books.get(v.id) ?? 0), marginBase: round2(await marginPurchaseBase(db, companyId, v.id)), plan: withCosts.find((p) => p.vehicleId === v.id) ?? null });
  }
  const planned = withCosts.filter((p) => p.vehicleId === null);
  const soldIds = vs.filter((v) => v.status === "sold").map((v) => v.id);
  const closedPlans = withCosts.filter((p) => p.vehicleId !== null && soldIds.includes(p.vehicleId));
  const actuals = closedPlans.length
    ? await db
        .select({ vehicleId: invoiceLines.vehicleId, date: sql<string>`max(${invoices.fulfillmentDate})`, gross: sql<number>`sum(${invoiceLines.grossHuf})::float8` })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .where(and(eq(invoices.companyId, companyId), eq(invoices.direction, "out"), eq(invoices.status, "posted"), inArray(invoiceLines.vehicleId, closedPlans.map((p) => p.vehicleId!))))
        .groupBy(invoiceLines.vehicleId)
    : [];
  const closed: ClosedRow[] = closedPlans.map((p) => {
    const a = actuals.find((x) => x.vehicleId === p.vehicleId);
    return { plan: p, vehicle: vs.find((v) => v.id === p.vehicleId)!, actualDate: a?.date ?? null, actualGross: round2(Number(a?.gross ?? 0)),
      planCosts: round2(p.costs.reduce((s, c) => s + Number(c.net), 0)) };
  });
  return { stock, planned, closed };
}

export const vehicleLabel = (v: { make: string; model: string; plate: string | null }) => `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : ""}`;

/** A számításhoz szükséges teljes bemenet. */
export async function loadForecastInput(companyId: number) {
  const [settings, opening, plans, itemsRows] = await Promise.all([
    getForecastSettings(companyId),
    loadOpening(companyId),
    loadPlans(companyId),
    db.select().from(forecastItems).where(eq(forecastItems.companyId, companyId)).orderBy(asc(forecastItems.startDate)),
  ]);
  const costOf = (c: typeof forecastPlanCosts.$inferSelect) => ({
    description: c.description, date: c.date, net: Number(c.net), vatRate: c.vatRate, deductible: c.deductible, capitalize: c.capitalize, payment: c.payment as Channel,
  });
  const fcPlans: FcPlan[] = [];
  const unplanned: string[] = [];
  for (const s of plans.stock) {
    const label = vehicleLabel(s.vehicle);
    if (!s.plan?.salePrice || !s.plan?.saleDate) { unplanned.push(label); continue; }
    fcPlans.push({ id: s.plan.id, label, stock: { bookValue: s.bookValue, marginBase: s.marginBase },
      sale: { date: s.plan.saleDate, price: Number(s.plan.salePrice), payment: s.plan.salePayment as Channel }, costs: s.plan.costs.map(costOf) });
  }
  for (const p of plans.planned) {
    if (!p.purchaseDate || !p.purchasePrice) continue;
    fcPlans.push({ id: p.id, label: p.label || `Terv #${p.id}`, purchase: { date: p.purchaseDate, price: Number(p.purchasePrice), payment: p.purchasePayment as Channel },
      sale: p.saleDate && p.salePrice ? { date: p.saleDate, price: Number(p.salePrice), payment: p.salePayment as Channel } : null, costs: p.costs.map(costOf) });
  }
  const items: FcItem[] = itemsRows.map((i) => ({ id: i.id, category: i.category, description: i.description, accountCode: i.accountCode, net: Number(i.net), vatRate: i.vatRate,
    deductible: i.deductible, frequency: i.frequency, startDate: i.startDate, endDate: i.endDate, payment: i.payment as Channel }));
  return { settings, opening, plans: fcPlans, items, unplanned, plansRaw: plans, itemsRows };
}

// ---------------------------------------------------------------------------
// Múltbeli eladások (kalibrálás, javasolt ár / dátum)
// ---------------------------------------------------------------------------

export async function soldHistory(companyId: number): Promise<SoldHistory[]> {
  const rows = await db.execute(sql`
    with sale as (
      select il.vehicle_id, max(i.fulfillment_date) as sale_date, sum(il.gross_huf) as gross
      from invoice_lines il join invoices i on i.id = il.invoice_id
      where i.company_id = ${companyId} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null
      group by il.vehicle_id),
    cogs as (
      select jl.vehicle_id, sum(jl.debit - jl.credit) as cogs
      from journal_lines jl join accounts a on a.id = jl.account_id
      where jl.company_id = ${companyId} and a.code like '814%' and jl.vehicle_id is not null group by jl.vehicle_id),
    firstin as (
      select jl.vehicle_id, min(e.date) as d from journal_lines jl join journal_entries e on e.id = jl.entry_id join accounts a on a.id = jl.account_id
      where jl.company_id = ${companyId} and a.code like '261%' and jl.debit > 0 and jl.vehicle_id is not null group by jl.vehicle_id)
    select s.sale_date::text as sale_date, s.gross::float8 as gross, c.cogs::float8 as cogs, coalesce(v.purchase_date, f.d)::text as purchase_date
    from sale s join vehicles v on v.id = s.vehicle_id and v.status = 'sold'
    join cogs c on c.vehicle_id = s.vehicle_id left join firstin f on f.vehicle_id = s.vehicle_id`);
  const list = (rows as unknown as Array<{ sale_date: string; gross: number; cogs: number; purchase_date: string | null }>);
  return list
    .filter((r) => r.purchase_date && Number(r.cogs) > 0)
    .map((r) => ({
      holdingDays: Math.max(0, Math.round((Date.parse(r.sale_date) - Date.parse(r.purchase_date!)) / 86400000)),
      markup: Number(r.gross) / Number(r.cogs),
    }));
}

export async function calibrationFor(companyId: number) {
  const [settings, hist] = await Promise.all([getForecastSettings(companyId), soldHistory(companyId)]);
  return { ...calibrate(hist, settings), history: hist };
}

/** Javasolt eladási ár és dátum egy tervezetlen autóra a múltbeli medián alapján. */
export function suggestSale(bookValue: number, purchaseDate: string | null, hist: SoldHistory[]) {
  const enough = hist.length >= MIN_CALIBRATION_SALES;
  const markup = enough ? quantile(hist.map((h) => h.markup), 0.5) : 1.15;
  const days = enough ? Math.round(quantile(hist.map((h) => h.holdingDays), 0.5)) : 45;
  const t = today();
  let date = purchaseDate ? addDaysIso(purchaseDate, days) : addDaysIso(t, 30);
  if (date < t) date = addDaysIso(t, 14);
  return { price: Math.round((bookValue * markup) / 10000) * 10000, date, basis: enough ? `${hist.length} korábbi eladás mediánja` : "alapértelmezés (+15%, 45 nap)" };
}

// ---------------------------------------------------------------------------
// Ismétlődő költség javaslatok az elmúlt 3 lezárt hónapból
// ---------------------------------------------------------------------------

export type CostSuggestion = {
  key: string;
  accountCode: string;
  accountName: string;
  partnerName: string | null;
  months: number;
  monthlyNet: number;
  vatRate: number;
  payment: Channel;
  frequency: "monthly";
};

export async function costSuggestions(companyId: number): Promise<CostSuggestion[]> {
  const t = today();
  const firstOfThis = t.slice(0, 7) + "-01";
  const from = (() => { const d = new Date(firstOfThis + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 3); return d.toISOString().slice(0, 10); })();
  const to = addDaysIso(firstOfThis, -1);
  // 1) szállítói számlák költségsorai (5-ös számlaosztály, nem a készletre)
  const invRows = await db
    .select({
      code: accounts.code, name: accounts.name, partner: partners.name, month: sql<string>`to_char(${invoices.fulfillmentDate}, 'YYYY-MM')`,
      net: sql<number>`sum(${invoiceLines.netHuf})::float8`, vat: sql<number>`sum(${invoiceLines.vatHuf})::float8`,
      cash: sql<number>`(select count(*) from payments pm join accounts ma on ma.id = pm.money_account_id where pm.invoice_id = ${invoices.id} and ma.code like '381%')::int`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(accounts, eq(accounts.id, invoiceLines.accountId))
    .innerJoin(partners, eq(partners.id, invoices.partnerId))
    .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.direction, "in"), eq(invoices.status, "posted"), sql`${accounts.code} like '5%'`,
      sql`${invoices.fulfillmentDate} between ${from} and ${to}`, sql`${invoiceLines.vehicleId} is null`))
    .groupBy(accounts.code, accounts.name, partners.name, sql`to_char(${invoices.fulfillmentDate}, 'YYYY-MM')`, invoices.id);
  // 2) számla nélküli költségtételek (bankköltség, biztosítás …): vegyes tételek 5-ös számlán
  const entRows = await db.execute(sql`
    select a.code, a.name, coalesce(p.name, '') as partner, to_char(e.date, 'YYYY-MM') as month, sum(l.debit - l.credit)::float8 as net,
      bool_or(exists (select 1 from journal_lines l2 join accounts a2 on a2.id = l2.account_id where l2.entry_id = e.id and a2.code like '381%')) as cash
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id left join partners p on p.id = l.partner_id
    where l.company_id = ${companyId} and a.code like '5%' and e.source_type = 'manual' and e.reversed_by_id is null and e.reversal_of_id is null
      and e.date between ${from} and ${to}
    group by a.code, a.name, p.name, to_char(e.date, 'YYYY-MM')`);
  type Acc = { code: string; name: string; partner: string; months: Set<string>; byMonth: Map<string, number>; net: number; vat: number; cash: number; n: number };
  const map = new Map<string, Acc>();
  const add = (code: string, name: string, partner: string, month: string, net: number, vat: number, cash: boolean) => {
    const key = `${code}|${partner}`;
    const a = map.get(key) ?? { code, name, partner, months: new Set<string>(), byMonth: new Map<string, number>(), net: 0, vat: 0, cash: 0, n: 0 };
    a.months.add(month); a.byMonth.set(month, (a.byMonth.get(month) ?? 0) + net); a.net += net; a.vat += vat; a.n++; if (cash) a.cash++;
    map.set(key, a);
  };
  for (const r of invRows) add(r.code, r.name, r.partner, r.month, Number(r.net), Number(r.vat), r.cash > 0);
  for (const r of entRows as unknown as Array<{ code: string; name: string; partner: string; month: string; net: number; cash: boolean }>)
    add(r.code, r.name, r.partner, r.month, Number(r.net), 0, !!r.cash);
  const out: CostSuggestion[] = [];
  for (const [key, a] of map) {
    if (a.months.size < 2 || a.net <= 0) continue; // legalább 2 hónapban előfordult
    const rate = a.net > 0 ? (a.vat / a.net) * 100 : 0;
    out.push({ key, accountCode: a.code, accountName: a.name, partnerName: a.partner || null, months: a.months.size,
      monthlyNet: Math.round(a.byMonth.get([...a.months].sort().pop()!) ?? a.net / a.months.size), vatRate: rate > 20 ? 27 : rate > 12 ? 18 : rate > 3 ? 5 : 0, payment: a.cash * 2 > a.n ? "cash" : "bank", frequency: "monthly" });
  }
  return out.sort((x, y) => y.monthlyNet - x.monthlyNet);
}
