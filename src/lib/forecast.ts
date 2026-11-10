/**
 * Tervezés (forecast) – tiszta számítás, adatbázis nélkül (tesztelhető).
 *
 * Bemenet: készletre / tervezett beszerzésre vonatkozó eladási tervek, autóhoz kötött költségek,
 * ismétlődő és egyszeri tételek, nyitó pénzeszközök, a folyó üzleti év tényleges eredménye.
 * Kimenet havonta: eredmény (árbevétel, ELÁBÉ, fedezet, költségek), ÁFA (különbözeti + levonható,
 * befizetés a bevallási gyakoriság szerint), pénzáramlás pénztárra és bankra bontva napi szimulációval,
 * valamint az évvégi társasági adó és iparűzési adó becslése.
 *
 * Különbözeti ÁFA (Áfa tv. 210–219. §): tételes módszer, autónként (eladási ár − beszerzési ár) × 27/127,
 * negatív különbözet esetén 0, és nem csökkenti más autó adóalapját.
 */
import type { ForecastScenarioParams, ForecastSettings } from "@/db/schema";

export type Scenario = "base" | "pessimistic" | "optimistic";
export const SCENARIO_LABEL: Record<Scenario, string> = { pessimistic: "Rosszabb", base: "Alap", optimistic: "Jobb" };
export const SCENARIOS: Scenario[] = ["pessimistic", "base", "optimistic"];
export type Channel = "cash" | "bank";

export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = {
  pessimistic: { priceAdj: -0.05, dateShiftDays: 30, vehicleCostAdj: 0.2, fixedCostAdj: 0.1 },
  optimistic: { priceAdj: 0.03, dateShiftDays: -14, vehicleCostAdj: -0.1, fixedCostAdj: 0 },
  horizonMonths: 12,
  hipaRate: 0.02,
  taoRate: 0.09,
  calibratedFrom: null,
};
const ZERO: ForecastScenarioParams = { priceAdj: 0, dateShiftDays: 0, vehicleCostAdj: 0, fixedCostAdj: 0 };

export function normalizeSettings(s: Partial<ForecastSettings> | null | undefined): ForecastSettings {
  const d = DEFAULT_FORECAST_SETTINGS;
  const p = (x: Partial<ForecastScenarioParams> | undefined, def: ForecastScenarioParams): ForecastScenarioParams => ({
    priceAdj: num(x?.priceAdj, def.priceAdj),
    dateShiftDays: Math.round(num(x?.dateShiftDays, def.dateShiftDays)),
    vehicleCostAdj: num(x?.vehicleCostAdj, def.vehicleCostAdj),
    fixedCostAdj: num(x?.fixedCostAdj, def.fixedCostAdj),
  });
  return {
    pessimistic: p(s?.pessimistic, d.pessimistic),
    optimistic: p(s?.optimistic, d.optimistic),
    horizonMonths: Math.min(36, Math.max(3, Math.round(num(s?.horizonMonths, d.horizonMonths)))),
    hipaRate: num(s?.hipaRate, d.hipaRate),
    taoRate: num(s?.taoRate, d.taoRate),
    calibratedFrom: s?.calibratedFrom ?? null,
  };
}
const num = (x: unknown, def: number) => (typeof x === "number" && Number.isFinite(x) ? x : def);
export function scenarioParams(s: ForecastSettings, sc: Scenario): ForecastScenarioParams {
  return sc === "base" ? ZERO : sc === "pessimistic" ? s.pessimistic : s.optimistic;
}

// ---------------------------------------------------------------------------
// Bemenet
// ---------------------------------------------------------------------------

export type FcCost = { description: string; date: string | null; net: number; vatRate: number; deductible: boolean; capitalize: boolean; payment: Channel };
export type FcPlan = {
  id: number;
  label: string;
  /** Meglévő készlet: a könyv szerinti érték (261 egyenleg) és a különbözeti ÁFA alapja. */
  stock?: { bookValue: number; marginBase: number } | null;
  /** Tervezett beszerzés (bruttó vételár = ÁFA-alap és bekerülési érték). */
  purchase?: { date: string; price: number; payment: Channel } | null;
  sale?: { date: string; price: number; payment: Channel } | null;
  costs: FcCost[];
};
export type FcItem = {
  id: number;
  category: string; // expense | asset | loan_in | loan_out | capital_in | dividend | other_in | other_out
  description: string;
  accountCode?: string | null;
  net: number;
  vatRate: number;
  deductible: boolean;
  frequency: string; // once | monthly | quarterly | yearly
  startDate: string;
  endDate?: string | null;
  payment: Channel;
};
export type FcOpening = {
  asOf: string; // ma
  cash: number; // 381* egyenleg (HUF)
  bank: number; // 384* egyenleg (HUF)
  /** Nyitott ÁFA-kötelezettség (pozitív = fizetendő) a főkönyvből. */
  vatPayable: number;
  fiscalYearStartMonth: number;
  vatPeriod: "monthly" | "quarterly" | "yearly";
  /** A folyó üzleti év tényleges adózás előtti eredménye a mai napig. */
  ytdPreTax: number;
  /** A folyó üzleti év tényleges HIPA-alapja (nettó árbevétel − ELÁBÉ − anyagköltség). */
  ytdHipaBase: number;
  /** Nyitott vevő- (+) és szállítói (−) számlák a főkönyvből: esedékességkor rendeződnek. */
  openItems?: Array<{ date: string; amount: number; channel: Channel; label: string }>;
};

// ---------------------------------------------------------------------------
// Dátum segédek
// ---------------------------------------------------------------------------

export const addDays = (d: string, n: number) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const ym = (d: string) => d.slice(0, 7);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};
const lastDay = (month: string) => addDays(addMonths(month, 1) + "-01", -1);
const clampDay = (month: string, day: number) => {
  const ld = Number(lastDay(month).slice(8));
  return `${month}-${String(Math.min(day, ld)).padStart(2, "0")}`;
};
const r0 = (x: number) => Math.round(x);
const marginVat = (gross: number, base: number) => Math.max(0, r0(((gross - base) * 27) / 127));

/** ÁFA-bevallási időszak vége → befizetési határidő (havi/negyedéves: köv. hó 20., éves: köv. év febr. 25.). */
export function vatDueDate(date: string, period: FcOpening["vatPeriod"]): string {
  const [y, m] = date.split("-").map(Number);
  if (period === "yearly") return `${y + 1}-02-25`;
  const endMonth = period === "quarterly" ? Math.ceil(m / 3) * 3 : m;
  const next = addMonths(`${y}-${String(endMonth).padStart(2, "0")}`, 1);
  return `${next}-20`;
}

// ---------------------------------------------------------------------------
// Kimenet
// ---------------------------------------------------------------------------

export type FcMonth = {
  month: string;
  revenue: number; // nettó árbevétel (különbözeti ÁFA nélkül)
  cogs: number; // ELÁBÉ
  grossMargin: number;
  vehicleCosts: number; // azonnal elszámolt autós költség
  fixedCosts: number; // ismétlődő + egyszeri költség
  preTax: number;
  salesGross: number;
  carsSold: number;
  marginVat: number;
  inputVat: number;
  vatBalance: number; // marginVat − inputVat (+ = fizetendő)
  vatPaid: number;
  taxPaid: number; // TAO + HIPA befizetés
  cashIn: number;
  cashOut: number;
  endCash: number;
  endBank: number;
  minCash: number;
  minBank: number;
  minCashDate: string;
  minBankDate: string;
};
export type FcSaleRow = {
  planId: number;
  label: string;
  saleDate: string;
  salePrice: number;
  marginBase: number;
  marginVat: number;
  netRevenue: number;
  cogs: number;
  grossMargin: number;
  inHorizon: boolean;
  shifted: boolean;
};
export type FcYear = { year: string; actualPreTax: number; forecastPreTax: number; preTax: number; hipa: number; tao: number; afterTax: number; payDate: string; partial: boolean };
export type FcResult = {
  scenario: Scenario;
  months: FcMonth[];
  sales: FcSaleRow[];
  years: FcYear[];
  warnings: string[];
  totals: { revenue: number; grossMargin: number; preTax: number; marginVat: number; inputVat: number; carsSold: number; endCash: number; endBank: number; minTotal: number; minTotalDate: string };
};

type Ev = { date: string; channel: Channel | null; amount: number; kind: "sale" | "purchase" | "cost" | "item" | "vat" | "tax" | "loan" | "capital"; note: string };

/** A forecast futtatása egy forgatókönyvre. */
export function runForecast(
  input: { opening: FcOpening; plans: FcPlan[]; items: FcItem[]; settings: ForecastSettings },
  scenario: Scenario,
): FcResult {
  const { opening, settings } = input;
  const p = scenarioParams(settings, scenario);
  const start = ym(opening.asOf);
  const months = Array.from({ length: settings.horizonMonths }, (_, i) => addMonths(start, i));
  const horizonEnd = lastDay(months[months.length - 1]);
  const warnings: string[] = [];
  const M = new Map<string, FcMonth>();
  for (const m of months)
    M.set(m, { month: m, revenue: 0, cogs: 0, grossMargin: 0, vehicleCosts: 0, fixedCosts: 0, preTax: 0, salesGross: 0, carsSold: 0, marginVat: 0, inputVat: 0,
      vatBalance: 0, vatPaid: 0, taxPaid: 0, cashIn: 0, cashOut: 0, endCash: 0, endBank: 0, minCash: 0, minBank: 0, minCashDate: "", minBankDate: "" });
  const bucket = (d: string) => M.get(ym(d < opening.asOf ? opening.asOf : d));
  const events: Ev[] = [];
  const atLeastToday = (d: string) => (d < opening.asOf ? opening.asOf : d);
  // ÁFA időszakok: (esedékesség) → egyenleg
  const vatByDue = new Map<string, number>();
  const addVat = (date: string, amount: number) => {
    const due = vatDueDate(date, opening.vatPeriod);
    vatByDue.set(due, (vatByDue.get(due) ?? 0) + amount);
  };
  // Üzleti év szerinti eredmény / HIPA-alap a tervből
  const fyKey = (d: string) => {
    const [y, m] = d.split("-").map(Number);
    return String(m >= opening.fiscalYearStartMonth ? y : y - 1);
  };
  const fyPreTax = new Map<string, number>();
  const fyHipa = new Map<string, number>();
  const addPl = (d: string, preTax: number, hipaBase: number) => {
    const k = fyKey(d);
    fyPreTax.set(k, (fyPreTax.get(k) ?? 0) + preTax);
    fyHipa.set(k, (fyHipa.get(k) ?? 0) + hipaBase);
  };

  const sales: FcSaleRow[] = [];
  for (const plan of input.plans) {
    let capitalized = 0;
    let base: number;
    let book: number;
    if (plan.stock) {
      base = plan.stock.marginBase;
      book = plan.stock.bookValue;
    } else if (plan.purchase) {
      base = plan.purchase.price;
      book = plan.purchase.price;
      const d = atLeastToday(plan.purchase.date);
      if (d <= horizonEnd) events.push({ date: d, channel: plan.purchase.payment, amount: -plan.purchase.price, kind: "purchase", note: plan.label });
    } else continue;

    for (const c of plan.costs) {
      const net = r0(c.net * (1 + p.vehicleCostAdj));
      const vat = r0((net * c.vatRate) / 100);
      const d = atLeastToday(c.date ?? plan.purchase?.date ?? opening.asOf);
      if (d > horizonEnd) continue;
      const costValue = net + (c.deductible ? 0 : vat);
      if (c.capitalize) capitalized += costValue;
      else {
        const b = bucket(d);
        if (b) b.vehicleCosts += costValue;
        addPl(d, -costValue, 0);
      }
      if (c.deductible && vat) {
        const b = bucket(d);
        if (b) b.inputVat += vat;
        addVat(d, -vat);
      }
      events.push({ date: d, channel: c.payment, amount: -(net + vat), kind: "cost", note: `${plan.label}: ${c.description}` });
    }

    if (!plan.sale) {
      if (!plan.stock) warnings.push(`${plan.label}: tervezett beszerzés eladási terv nélkül`);
      continue;
    }
    const price = r0(plan.sale.price * (1 + p.priceAdj));
    let date = addDays(plan.sale.date, p.dateShiftDays);
    if (date < opening.asOf) date = opening.asOf;
    if (plan.purchase && date < plan.purchase.date) date = plan.purchase.date;
    const vat = marginVat(price, base);
    const cogs = book + capitalized;
    const row: FcSaleRow = {
      planId: plan.id, label: plan.label, saleDate: date, salePrice: price, marginBase: base, marginVat: vat, netRevenue: price - vat,
      cogs, grossMargin: price - vat - cogs, inHorizon: date <= horizonEnd, shifted: ym(date) !== ym(atLeastToday(plan.sale.date)),
    };
    sales.push(row);
    if (plan.stock && base <= 0) warnings.push(`${plan.label}: nincs különbözeti ÁFA-alap (beszerzési ár) – az ÁFA a teljes eladási árból számolódik`);
    if (!row.inHorizon) continue;
    const b = bucket(date)!;
    b.revenue += row.netRevenue;
    b.cogs += cogs;
    b.salesGross += price;
    b.carsSold += 1;
    b.marginVat += vat;
    addVat(date, vat);
    addPl(date, row.grossMargin, row.grossMargin);
    events.push({ date, channel: plan.sale.payment, amount: price, kind: "sale", note: plan.label });
  }

  // Ismétlődő / egyszeri tételek
  const step = (f: string) => (f === "monthly" ? 1 : f === "quarterly" ? 3 : f === "yearly" ? 12 : 0);
  for (const it of input.items) {
    const st = step(it.frequency);
    const dates: string[] = [];
    const day = Number(it.startDate.slice(8));
    if (st === 0) dates.push(it.startDate);
    else for (let m = ym(it.startDate); m <= ym(horizonEnd); m = addMonths(m, st)) dates.push(clampDay(m, day));
    for (const d of dates) {
      if (d < opening.asOf || d > horizonEnd) continue;
      if (it.endDate && d > it.endDate) continue;
      const isCost = it.category === "expense";
      const net = r0(it.net * (isCost ? 1 + p.fixedCostAdj : 1));
      const vat = it.category === "expense" || it.category === "asset" ? r0((net * it.vatRate) / 100) : 0;
      const b = bucket(d)!;
      if (isCost) {
        const cost = net + (it.deductible ? 0 : vat);
        b.fixedCosts += cost;
        const materials = (it.accountCode ?? "").startsWith("51") ? cost : 0;
        addPl(d, -cost, -materials);
      }
      if (vat && it.deductible) {
        b.inputVat += vat;
        addVat(d, -vat);
      }
      const inflow = ["loan_in", "capital_in", "other_in"].includes(it.category);
      events.push({ date: d, channel: it.payment, amount: inflow ? net : -(net + vat), kind: inflow ? (it.category === "loan_in" ? "loan" : "capital") : "item", note: it.description });
    }
  }

  // Nyitott vevő- és szállítói számlák (esedékességkor, lejártak ma)
  for (const o of opening.openItems ?? []) {
    const d = atLeastToday(o.date);
    if (d <= horizonEnd) events.push({ date: d, channel: o.channel, amount: o.amount, kind: "item", note: o.label });
  }

  // ÁFA befizetések: a nyitó kötelezettség a folyó időszak esedékességével együtt
  addVat(opening.asOf, opening.vatPayable);
  let vatCarry = 0;
  for (const due of [...vatByDue.keys()].sort()) {
    const amount = r0((vatByDue.get(due) ?? 0) + vatCarry);
    if (amount > 0) {
      vatCarry = 0;
      if (due <= horizonEnd) events.push({ date: due, channel: "bank", amount: -amount, kind: "vat", note: "ÁFA befizetés" });
    } else vatCarry = amount; // visszaigénylés helyett továbbvitel (a 1 M Ft-os küszöb alatt)
  }

  // Éves adók (TAO + HIPA): a folyó év tény + terv, befizetés a következő év május 31-ig
  const years: FcYear[] = [];
  const curFy = fyKey(opening.asOf);
  const fyList = [...new Set([curFy, ...[...fyPreTax.keys()]])].sort();
  for (const y of fyList) {
    const actual = y === curFy ? opening.ytdPreTax : 0;
    const fcPre = r0(fyPreTax.get(y) ?? 0);
    const hipaBase = (y === curFy ? opening.ytdHipaBase : 0) + (fyHipa.get(y) ?? 0);
    const hipa = r0(Math.max(0, hipaBase) * settings.hipaRate);
    const preTax = r0(actual + fcPre - hipa);
    const tao = r0(Math.max(0, preTax) * settings.taoRate);
    const fyEndMonth = addMonths(`${y}-${String(opening.fiscalYearStartMonth).padStart(2, "0")}`, 11);
    const payDate = lastDay(addMonths(fyEndMonth, 5));
    years.push({ year: y, actualPreTax: r0(actual), forecastPreTax: fcPre, preTax, hipa, tao, afterTax: preTax - tao, payDate, partial: lastDay(fyEndMonth) > horizonEnd });
    if (payDate <= horizonEnd && lastDay(fyEndMonth) <= horizonEnd && tao + hipa > 0)
      events.push({ date: payDate, channel: "bank", amount: -(tao + hipa), kind: "tax", note: `TAO + HIPA ${y}` });
  }

  // Napi pénzszimuláció (hónaponként: nyitó = előző hó záró)
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  let cash = opening.cash;
  let bank = opening.bank;
  let minTotal = cash + bank;
  let minTotalDate = opening.asOf;
  let ei = 0;
  for (const m of months) {
    const b = M.get(m)!;
    b.minCash = cash; b.minBank = bank;
    b.minCashDate = b.minBankDate = m === start ? opening.asOf : `${m}-01`;
    for (; ei < events.length && ym(events[ei].date) <= m; ei++) {
      const e = events[ei];
      if (e.channel === "cash") cash += e.amount;
      else bank += e.amount;
      if (e.amount > 0) b.cashIn += e.amount;
      else b.cashOut += -e.amount;
      if (e.kind === "vat") b.vatPaid += -e.amount;
      if (e.kind === "tax") b.taxPaid += -e.amount;
      if (cash < b.minCash) { b.minCash = cash; b.minCashDate = e.date; }
      if (bank < b.minBank) { b.minBank = bank; b.minBankDate = e.date; }
      if (cash + bank < minTotal) { minTotal = cash + bank; minTotalDate = e.date; }
    }
    b.endCash = cash; b.endBank = bank;
    b.grossMargin = b.revenue - b.cogs;
    b.preTax = b.grossMargin - b.vehicleCosts - b.fixedCosts;
    b.vatBalance = b.marginVat - b.inputVat;
    if (b.minCash < 0) warnings.push(`${m}: a pénztár mínuszba megy (${fmt(b.minCash)} Ft, ${b.minCashDate})`);
    if (b.minBank < 0) warnings.push(`${m}: a bankszámla mínuszba megy (${fmt(b.minBank)} Ft, ${b.minBankDate})`);
  }
  for (const s of sales) if (!s.inHorizon) warnings.push(`${s.label}: a tervezett eladás (${s.saleDate}) a tervezési horizonton túl van`);

  const list = months.map((m) => M.get(m)!);
  const sum = (f: (x: FcMonth) => number) => list.reduce((a, x) => a + f(x), 0);
  return {
    scenario,
    months: list,
    sales,
    years,
    warnings,
    totals: {
      revenue: sum((x) => x.revenue), grossMargin: sum((x) => x.grossMargin), preTax: sum((x) => x.preTax), marginVat: sum((x) => x.marginVat),
      inputVat: sum((x) => x.inputVat), carsSold: sum((x) => x.carsSold), endCash: list[list.length - 1].endCash, endBank: list[list.length - 1].endBank,
      minTotal, minTotalDate,
    },
  };
}
const fmt = (x: number) => Math.round(x).toLocaleString("hu-HU");

// ---------------------------------------------------------------------------
// Kalibrálás a múltbeli eladásokból
// ---------------------------------------------------------------------------

export type SoldHistory = { holdingDays: number; markup: number }; // markup = bruttó eladási ár / könyv szerinti érték
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const MIN_CALIBRATION_SALES = 8;

/** Rosszabb = gyengébb negyed (P25 árrés, P75 forgási idő), jobb = erősebb negyed, az alaphoz (medián) képest. */
export function calibrate(history: SoldHistory[], current: ForecastSettings): { settings: ForecastSettings; used: boolean; stats?: { n: number; medianDays: number; medianMarkup: number } } {
  const h = history.filter((x) => x.markup > 0 && Number.isFinite(x.markup) && x.holdingDays >= 0);
  if (h.length < MIN_CALIBRATION_SALES) return { settings: current, used: false };
  const mk = h.map((x) => x.markup), dd = h.map((x) => x.holdingDays);
  const medM = quantile(mk, 0.5), medD = quantile(dd, 0.5);
  const round3 = (x: number) => Math.round(x * 1000) / 1000;
  const settings: ForecastSettings = {
    ...current,
    pessimistic: { ...current.pessimistic, priceAdj: round3(clamp(quantile(mk, 0.25) / medM - 1, -0.15, 0)), dateShiftDays: Math.round(clamp(quantile(dd, 0.75) - medD, 0, 120)) },
    optimistic: { ...current.optimistic, priceAdj: round3(clamp(quantile(mk, 0.75) / medM - 1, 0, 0.1)), dateShiftDays: Math.round(clamp(quantile(dd, 0.25) - medD, -60, 0)) },
    calibratedFrom: `${h.length} eladás alapján`,
  };
  return { settings, used: true, stats: { n: h.length, medianDays: Math.round(medD), medianMarkup: medM } };
}
