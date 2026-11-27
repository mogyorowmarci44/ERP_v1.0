/**
 * v3.3.3 – TAO és HIPA: üzleti évenkénti adatok a főkönyvből (tény), a cég telephelyei és az elhatárolt veszteség.
 * A Forecast (forecast-data) és az Évzárás › TAO és HIPA oldal is ezt használja.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { today } from "./dates";
import { hipaBase, hipaTax, taoSeries, type HipaBase, type HipaSiteCalc, type LossEntry, type TaoResult } from "./corp-tax";
import { resolveHipaSites, type HipaSite } from "./hipa-rules";
import type { HipaRule } from "./corp-tax";
import { operatorParams } from "@/lib/legal-params";
import { history, resolveAt } from "@/lib/legal-params-calc";

const { accounts, journalLines, journalEntries, companies } = schema;

export type FyFigures = {
  fy: string; from: string; to: string; closed: boolean;
  revenue: number; cogs: number; mediated: number; materials: number;
  preTax: number; taoBooked: number; taxes867: number;
};

const pad = (n: number) => String(n).padStart(2, "0");
export function fyRange(fy: string, startMonth: number): { from: string; to: string } {
  const y = Number(fy);
  const from = `${y}-${pad(startMonth)}-01`;
  const end = new Date(Date.UTC(y + 1, startMonth - 1, 0)).toISOString().slice(0, 10);
  return { from, to: end };
}
export function fyOf(date: string, startMonth: number): string {
  const [y, m] = date.split("-").map(Number);
  return String(m >= startMonth ? y : y - 1);
}

async function flows(companyId: number, from: string, to: string) {
  const rows = await db
    .select({ code: accounts.code, type: accounts.type, bal: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::float8` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.companyId, companyId), sql`${journalEntries.date} >= ${from}`, sql`${journalEntries.date} <= ${to}`))
    .groupBy(accounts.code, accounts.type);
  return rows.map((r) => ({ code: r.code, type: r.type, bal: Number(r.bal) }));
}

/** Egy üzleti év tényadatai a főkönyvből (`to` legfeljebb ma). */
export async function fyFigures(companyId: number, fy: string, startMonth: number): Promise<FyFigures> {
  const { from, to } = fyRange(fy, startMonth);
  const t = today();
  const rows = await flows(companyId, from, to < t ? to : t);
  let revenue = 0, cogs = 0, mediated = 0, materials = 0, preTax = 0, taoBooked = 0, taxes867 = 0;
  for (const r of rows) {
    if ((r.type === "revenue" || r.type === "expense") && !r.code.startsWith("89")) preTax -= r.bal;
    if (/^9[123]/.test(r.code)) revenue -= r.bal;
    if (/^(811|814)/.test(r.code)) cogs += r.bal;
    if (r.code.startsWith("815")) mediated += r.bal;
    if (r.code.startsWith("51")) materials += r.bal;
    if (r.code.startsWith("891")) taoBooked += r.bal;
    if (r.code.startsWith("867")) taxes867 += r.bal;
  }
  return { fy, from, to, closed: to < t, revenue, cogs, mediated, materials, preTax, taoBooked, taxes867 };
}

/** Üzleti évek az első könyvelés évétől a folyó évig. */
export async function companyFiscalYears(companyId: number, startMonth: number): Promise<string[]> {
  const [r] = await db.select({ d: sql<string | null>`min(${journalEntries.date})::text` }).from(journalEntries).where(eq(journalEntries.companyId, companyId));
  const cur = fyOf(today(), startMonth);
  const first = r?.d ? fyOf(r.d, startMonth) : cur;
  const out: string[] = [];
  for (let y = Number(first); y <= Number(cur); y++) out.push(String(y));
  return out;
}

export type TaxCompany = Omit<typeof companies.$inferSelect, "logoData">;

export type TaxYearRow = {
  fig: FyFigures;
  adj: { taoIncrease: number; taoDecrease: number; hipaSubcontract: number; hipaRnd: number };
  hipa: HipaBase & { lines: ReturnType<typeof hipaTax>["lines"]; tax: number };
  /** A TAO-alaphoz használt eredmény: folyó évben a becsült HIPA-val csökkentve (még nincs lekönyvelve). */
  preTaxForTao: number;
  tao: TaoResult;
  /** Folyó (nyitott) év: becslés. */
  estimate: boolean;
};

export type CompanyTax = {
  sites: (HipaSite & { rule: HipaRule | null })[];
  siteCalc: HipaSiteCalc[];
  sitesFromAddress: boolean;
  storeInfo: { fetchedAt: string; source: string; count: number } | null;
  years: TaxYearRow[];
  openingLosses: LossEntry[];
};

/**
 * Évenkénti TAO + HIPA a tényadatokból. `override` a folyó év eredményét/HIPA-alap összetevőit cserélheti
 * (tény + terv nézethez a Forecastból).
 */
export async function companyTax(company: TaxCompany, override?: { fy: string; preTaxAdd: number; revenueAdd: number; cogsAdd: number; materialsAdd: number }): Promise<CompanyTax> {
  const startMonth = company.fiscalYearStartMonth;
  const [{ sites, calc, fromAddress, store }, fys, op] = await Promise.all([resolveHipaSites(company), companyFiscalYears(company.id, startMonth), operatorParams()]);
  // v6.4.0 – a TAO-kulcs évenként a központi jogszabályi paraméterből (az üzleti év utolsó napján hatályos)
  const taoHist = history("tax.tao", op);
  const taoRateFor = (fy: string) => (resolveAt(taoHist, `${fy.slice(0, 4)}-12-31`)?.value ?? 9) / 100;
  const figs = await Promise.all(fys.map((fy) => fyFigures(company.id, fy, startMonth)));
  const adjAll = company.settings.taxAdjustments ?? {};
  const openingLosses = (company.settings.openingLosses ?? []).filter((l) => l.amount > 0);
  const pre = figs.map((f) => {
    const a = adjAll[f.fy] ?? {};
    const adj = { taoIncrease: a.taoIncrease ?? 0, taoDecrease: a.taoDecrease ?? 0, hipaSubcontract: a.hipaSubcontract ?? 0, hipaRnd: a.hipaRnd ?? 0 };
    const o = override && override.fy === f.fy ? override : null;
    const fig = o ? { ...f, revenue: f.revenue + o.revenueAdd, cogs: f.cogs + o.cogsAdd, materials: f.materials + o.materialsAdd, preTax: f.preTax + o.preTaxAdd } : f;
    const hb = hipaBase({ revenue: fig.revenue, cogs: fig.cogs, mediated: fig.mediated, materials: fig.materials, subcontract: adj.hipaSubcontract, rnd: adj.hipaRnd });
    const ht = hipaTax(hb.base, calc);
    const estimate = !f.closed;
    // lezárt évben a HIPA már ráfordításként (867) benne van az eredményben; a folyó évben még nincs lekönyvelve
    const preTaxForTao = estimate ? fig.preTax - ht.total : fig.preTax;
    return { fig, adj, hipa: { ...hb, lines: ht.lines, tax: ht.total }, preTaxForTao, estimate };
  });
  // a nyitó (ERP előtti) veszteségeket az első év elé tesszük, hogy a sorozat továbbvigye őket
  const series = taoSeries(
    [...openingLosses.map((l) => ({ year: l.year, preTax: -l.amount })), ...pre.map((p) => ({ year: p.fig.fy, preTax: p.preTaxForTao, increases: p.adj.taoIncrease, decreases: p.adj.taoDecrease }))],
    taoRateFor,
  ).slice(openingLosses.length);
  return {
    sites, siteCalc: calc, sitesFromAddress: fromAddress,
    storeInfo: store ? { fetchedAt: store.fetchedAt, source: store.source, count: Object.keys(store.rules).length } : null,
    years: pre.map((p, i) => ({ ...p, tao: series[i] })),
    openingLosses,
  };
}

/** A folyó üzleti év előtt felhalmozott, még felhasználható veszteség (a Forecasthoz). */
export async function lossPoolForCurrentYear(company: TaxCompany): Promise<{ losses: LossEntry[]; siteCalc: HipaSiteCalc[] }> {
  const t = await companyTax(company);
  const cur = fyOf(today(), company.fiscalYearStartMonth);
  const idx = t.years.findIndex((y) => y.fig.fy === cur);
  const before = idx > 0 ? t.years[idx - 1].tao.lossesAfter : idx === 0 ? t.openingLosses : [];
  return { losses: before, siteCalc: t.siteCalc };
}
