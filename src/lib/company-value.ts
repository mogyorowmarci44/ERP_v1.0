/**
 * v2.2 – Cégérték (kereskedő cégekre) – három módszer:
 *  1. Korrigált nettó eszközérték: könyv szerinti saját tőke, a készlet a várható nettó eladási értéken, a becsült adóval.
 *  2. Eredményszorzós: (elmúlt 12 hónap adózás előtti eredménye + értékcsökkenés) × szorzó + pénzeszközök − hitelek / tagi kölcsön.
 *  3. Előretekintő: könyv szerinti saját tőke + a Forecast szerinti eredmény a folyó üzleti év végéig (jelenértéken) − az év TAO + HIPA (három forgatókönyv).
 */
import { hipaTax, taoCalc } from "./corp-tax";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { trialBalance, type TrialBalanceRow } from "./reports";
import { addDaysIso, today } from "./dates";
import { firstEntryDate, loadForecastInput, loadPlans, vehicleLabel } from "./forecast-data";
import { runForecast, SCENARIOS, type Scenario } from "./forecast";
import { round2 } from "./money";
import { operationStartOf } from "./kpi";

export const DEFAULT_VALUATION_MULTIPLE = 3;
export const DEFAULT_DISCOUNT_RATE = 0.15;

type Line = { label: string; amount: number; hint?: string };
export type StockRevaluation = { label: string; bookValue: number; salePrice: number | null; marginVat: number; plannedCosts: number; netRealizable: number; uplift: number };

export type CompanyValue = {
  asOf: string;
  rates: { tao: number; hipa: number };
  balance: { assets: number; liabilities: number; bookEquity: number; cash: number; stockBook: number; receivables: number; payables: number; memberLoans: number; bankLoans: number; vatPayable: number };
  nav: { lines: Line[]; stock: StockRevaluation[]; uplift: number; taxBase: number; tax: number; value: number };
  multiple: { lines: Line[]; from: string; months: number; annualized: boolean; preTax: number; depreciation: number; earnings: number; multiple: number; value: number };
  forward: { lines: Line[]; discountRate: number; months: number; empty: boolean; scenarios: Record<Scenario, { preTax: number; afterTax: number; pv: number; value: number }> };
};

const mv = (gross: number, base: number) => Math.max(0, Math.round(((gross - base) * 27) / 127));
const sumBy = (tb: TrialBalanceRow[], pred: (code: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.closingDebit - r.closingCredit, 0);
/** Időszaki forgalom (T − K) az eredményszámlákhoz (a kivonat záró egyenlege az üzleti év elejétől halmoz). */
const flowBy = (tb: TrialBalanceRow[], pred: (code: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.periodDebit - r.periodCredit, 0);
/** Az üzleti év utolsó napja a TAO/HIPA befizetési határidőből (év vége + 5 hónap, hó vége). */
const lastOfFy = (payDate: string) => {
  const d = new Date(payDate + "T00:00:00Z");
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 5); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
const monthsBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / (86400000 * 30.4375));

export async function companyValue(companyId: number, opts: { multiple?: number; discountRate?: number } = {}): Promise<CompanyValue> {
  const t = today();
  const yearAgo = addDaysIso(t, -365);
  const [firstEntry, opStart] = await Promise.all([firstEntryDate(companyId), operationStartOf(companyId)]);
  const first = firstEntry ?? t;
  // az eredményszorzós módszer 12 hónapja nem kezdődhet a működés kezdete előtt
  const opFirst = opStart && opStart > first ? opStart : first;
  const [all, ttm, ytd, plans, input] = await Promise.all([
    trialBalance(companyId, first, t),
    trialBalance(companyId, opFirst > yearAgo ? opFirst : yearAgo, t),
    trialBalance(companyId, `${t.slice(0, 4)}-01-01`, t),
    loadPlans(companyId),
    loadForecastInput(companyId),
  ]);
  const tao = input.settings.taoRate, hipa = input.settings.hipaRate;
  // v3.3.3 – TAO és HIPA a közös számolóval: a HIPA alapja nem az eredmény (nettó árbevétel − ELÁBÉ − anyagköltség),
  // településenként a saját mértékkel és mentességgel; a TAO-t az elhatárolt veszteség csökkenti.
  const tx = input.opening.tax;
  const hipaNow = tx && tx.hipaSites.length
    ? hipaTax(input.opening.ytdHipaBase - (tx.hipaDeduct ?? 0), tx.hipaSites).total
    : (input.opening.ytdHipaBase < (input.settings.hipaExemptBelow ?? 0) ? 0 : Math.round(Math.max(0, input.opening.ytdHipaBase) * hipa));

  // --- Mérleg (a könyvek szerint, mai nap) ------------------------------------------
  const assets = sumBy(all, (c) => /^[123]/.test(c));
  const liabilities = -sumBy(all, (c) => /^4[2-9]/.test(c));
  const bookEquity = assets - liabilities; // tartalmazza a még le nem zárt tárgyévi eredményt is
  const cash = sumBy(all, (c) => c.startsWith("38") && !c.startsWith("389"));
  const stockBook = sumBy(all, (c) => c.startsWith("26"));
  const receivables = sumBy(all, (c) => c.startsWith("31"));
  const payables = -sumBy(all, (c) => c.startsWith("45"));
  const memberLoans = -sumBy(all, (c) => c.startsWith("479"));
  const bankLoans = -sumBy(all, (c) => c.startsWith("44"));
  const vatPayable = -sumBy(all, (c) => c.startsWith("466") || c.startsWith("467") || c.startsWith("468"));

  // --- 1. Korrigált nettó eszközérték -------------------------------------------------
  const stock: StockRevaluation[] = plans.stock.map((s) => {
    const p = s.plan;
    const price = p?.salePrice && p?.saleDate ? Number(p.salePrice) : null;
    const plannedCosts = round2((p?.costs ?? []).reduce((a, c) => a + Number(c.net) + (c.deductible ? 0 : (Number(c.net) * c.vatRate) / 100), 0));
    const vat = price ? mv(price, s.marginBase) : 0;
    const netRealizable = price ? round2(price - vat - plannedCosts) : s.bookValue;
    return { label: vehicleLabel(s.vehicle), bookValue: s.bookValue, salePrice: price, marginVat: vat, plannedCosts: price ? plannedCosts : 0, netRealizable, uplift: round2(netRealizable - s.bookValue) };
  });
  const uplift = round2(stock.reduce((a, s) => a + s.uplift, 0));
  const ytdPreTax = -flowBy(ytd, (c) => c.startsWith("9")) - flowBy(ytd, (c) => c.startsWith("5") || c.startsWith("8"));
  const taoNow = taoCalc({ preTax: ytdPreTax + uplift - hipaNow, losses: tx?.losses ?? [], rate: tao });
  const taxBase = taoNow.base;
  const tax = Math.round(taoNow.tax + hipaNow);
  const navValue = round2(bookEquity + uplift - tax);

  // --- 2. Eredményszorzós -------------------------------------------------------------
  const from = opFirst > yearAgo ? opFirst : yearAgo;
  const months = Math.min(12, monthsBetween(from, t));
  const annualized = months < 11.5 && months > 0;
  const factor = annualized ? 12 / months : 1;
  const preTaxTtm = -flowBy(ttm, (c) => c.startsWith("9")) - flowBy(ttm, (c) => c.startsWith("5") || c.startsWith("8"));
  const depreciation = flowBy(ttm, (c) => c.startsWith("57"));
  const earnings = round2((preTaxTtm + depreciation) * factor);
  const multiple = opts.multiple ?? DEFAULT_VALUATION_MULTIPLE;
  const multValue = round2(multiple * Math.max(0, earnings) + cash - memberLoans - bankLoans);

  // --- 3. Előretekintő (Forecast) -----------------------------------------------------
  const r = opts.discountRate ?? DEFAULT_DISCOUNT_RATE;
  const monthly = Math.pow(1 + r, 1 / 12) - 1;
  const empty = input.plans.length === 0 && input.items.length === 0;
  // v5.1.3 – a folyó üzleti év végéig: könyv szerinti saját tőke (benne a tárgyévi, adózás előtti tényeredmény)
  // + az év hátralévő hónapjainak tervezett eredménye (diszkontálva) − a teljes évi HIPA és TAO (tény + terv alapján).
  let fwdMonths = 0;
  let fyEnd = "";
  const scenarios = Object.fromEntries(SCENARIOS.map((sc) => {
    const run = runForecast(input, sc, "month");
    const fy = run.years[0];
    fyEnd = fy?.payDate ? lastOfFy(fy.payDate) : `${t.slice(0, 4)}-12-31`;
    const rest = run.months.filter((m) => m.end <= fyEnd);
    fwdMonths = rest.length;
    const preTax = rest.reduce((a, m) => a + m.preTax, 0);
    const pvPre = rest.reduce((a, m, i) => a + m.preTax / Math.pow(1 + monthly, i + 1), 0);
    const taxes = (fy?.hipa ?? 0) + (fy?.tao ?? 0);
    const afterTax = preTax - taxes;
    const pv = pvPre - taxes;
    return [sc, { preTax: round2(preTax), afterTax: round2(afterTax), pv: round2(pv), value: round2(bookEquity + pv) }];
  })) as CompanyValue["forward"]["scenarios"];

  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const fyBase = runForecast(input, "base", "month").years[0];
  const fyTaxBase = (fyBase?.hipa ?? 0) + (fyBase?.tao ?? 0);
  return {
    asOf: t,
    rates: { tao, hipa },
    balance: { assets: round2(assets), liabilities: round2(liabilities), bookEquity: round2(bookEquity), cash: round2(cash), stockBook: round2(stockBook), receivables: round2(receivables), payables: round2(payables), memberLoans: round2(memberLoans), bankLoans: round2(bankLoans), vatPayable: round2(vatPayable) },
    nav: {
      stock, uplift, taxBase: round2(taxBase), tax, value: navValue,
      lines: [
        { label: "Eszközök összesen (könyv szerint)", amount: round2(assets), hint: "1–3. számlaosztály" },
        { label: "Kötelezettségek összesen", amount: -round2(liabilities), hint: "42–49. számlacsoport (tagi kölcsön, szállítók, ÁFA, adók …)" },
        { label: "Könyv szerinti saját tőke", amount: round2(bookEquity), hint: "a tárgyévi, még le nem zárt eredménnyel" },
        { label: "Készlet átértékelése várható nettó eladási értékre", amount: uplift, hint: "Forecast eladási ár − különbözeti ÁFA − hátralévő tervezett költség; terv nélkül könyv szerinti érték" },
        { label: `Becsült TAO (${pct(tao)}) + HIPA`, amount: -tax, hint: `HIPA ${hipaNow.toLocaleString("hu-HU")} Ft (telephelyek szerint, a HIPA-alapból) · TAO-alap: tárgyévi eredmény (${Math.round(ytdPreTax).toLocaleString("hu-HU")} Ft) + átértékelés − HIPA${taoNow.lossUsed ? ` − elhatárolt veszteség ${taoNow.lossUsed.toLocaleString("hu-HU")} Ft` : ""}` },
      ],
    },
    multiple: {
      from, months: Math.round(months * 10) / 10, annualized, preTax: round2(preTaxTtm), depreciation: round2(depreciation), earnings, multiple, value: multValue,
      lines: [
        { label: `Adózás előtti eredmény (${from} – ${t})`, amount: round2(preTaxTtm) },
        { label: "+ Értékcsökkenés (57x)", amount: round2(depreciation) },
        ...(annualized ? [{ label: `Évesítés (${Math.round(months * 10) / 10} hónap adatából × ${(12 / months).toFixed(2)})`, amount: round2(earnings - preTaxTtm - depreciation) }] : []),
        { label: "Éves működési eredmény", amount: earnings },
        { label: `× ${multiple} szorzó`, amount: round2(multiple * Math.max(0, earnings)), hint: earnings < 0 ? "negatív eredmény: 0-val számolva" : undefined },
        { label: "+ Pénzeszközök (pénztár + bank)", amount: round2(cash) },
        { label: "− Tagi kölcsön (479x)", amount: -round2(memberLoans) },
        ...(bankLoans ? [{ label: "− Hitelek (44x)", amount: -round2(bankLoans) }] : []),
      ],
    },
    forward: {
      discountRate: r, months: fwdMonths, empty, scenarios,
      lines: [
        { label: "Könyv szerinti saját tőke", amount: round2(bookEquity), hint: "nem a korrigált érték: a készlet eladásának haszna már a Forecast eredményében van" },
        { label: `+ Az üzleti év hátralévő ${fwdMonths} hónapjának tervezett eredménye (alap, ${fyEnd}-ig)`, amount: round2(scenarios.base.pv + fyTaxBase), hint: `diszkontráta ${pct(r)} / év` },
        { label: "− Az üzleti év TAO + HIPA (tény + terv)", amount: -round2(fyTaxBase), hint: "a saját tőkében a tárgyévi eredmény még adózás előtt szerepel" },
      ],
    },
  };
}

/** Szorzó és diszkontráta a cégbeállításokból (Cégérték oldal), alapértelmezés 3 és 15%. */
export async function valuationParamsFor(companyId: number) {
  const [c] = await db.select({ s: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, companyId));
  const m = Number(c?.s?.valuationMultiple), r = Number(c?.s?.valuationDiscountRate);
  return { multiple: m > 0 && m <= 20 ? m : DEFAULT_VALUATION_MULTIPLE, discountRate: r >= 0 && r <= 1 && c?.s?.valuationDiscountRate != null ? r : DEFAULT_DISCOUNT_RATE };
}
