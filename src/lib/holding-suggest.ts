/**
 * v3.5.1 – Tartási költség javaslat a könyvelésből (AutóMérleg › Tartási költség › „Javaslat a könyvelésből”).
 *
 * Fix napi költség (Ft/nap/autó) = az elmúlt 12 hónap (ill. a működés kezdete óta) telephely-jellegű költségei
 *   – 522 bérleti díjak, 524 hirdetés, reklám, 533 biztosítási díjak; az autóhoz rendelt tételek nélkül –
 *   ÷ (átlagos készlet darabszám × napok).
 * Lekötött pénz (%/év) = a pénz költsége + árvesztés:
 *   – a pénz költsége: a 872 fizetendő kamatok évesítve ÷ az átlagosan lekötött készletérték, de legalább a
 *     pénz alternatív hozama (OPPORTUNITY_PCT – jegybanki alapkamat közelítés);
 *   – árvesztés: a Forecast-tervvel eladott autóknál a tervezett ártól való elmaradás napi üteme évesítve (medián);
 *     3 ilyen autó alatt óvatos ráhagyás (SLIP_DEFAULT_PCT).
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { companyKpis } from "./kpi";

/** A pénz alternatív hozama – a jegybanki alapkamat közelítése (legutóbb ellenőrizve: 6,50%, 2025. december). */
export const OPPORTUNITY_PCT = 6.5;
export const SLIP_DEFAULT_PCT = 3;
const FIXED_ACCOUNTS = [
  { code: "522", label: "Bérleti díjak (telephely)" },
  { code: "524", label: "Hirdetés, reklám" },
  { code: "533", label: "Biztosítási díjak" },
];

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : null; };
const round1 = (x: number) => Math.round(x * 10) / 10;

export type HoldingSuggestion = {
  from: string; to: string; days: number; avgStock: number;
  parts: { code: string; label: string; amount: number }[]; fixedTotal: number; fixPerDay: number;
  interest: number; avgCapital: number; financingPct: number | null; opportunityPct: number; moneyPct: number;
  slipPct: number; slipCars: number; slipFromData: boolean;
  ratePct: number;
};

export async function holdingSuggestion(companyId: number): Promise<HoldingSuggestion | { error: string }> {
  const k = await companyKpis(companyId).catch(() => null);
  if (!k) return { error: "Nincs még elég könyvelés a javaslathoz." };
  const from = k.from, to = k.asOf, n = days(from, to);
  const avgStock = k.turnover.avgStockCount;

  const rows = (await db.execute(sql`
    select left(a.code, 3) code, coalesce(sum(jl.debit - jl.credit), 0)::float8 v
    from journal_lines jl join accounts a on a.id = jl.account_id join journal_entries e on e.id = jl.entry_id
    where jl.company_id = ${companyId} and e.date between ${from}::date and ${to}::date and jl.vehicle_id is null
      and (a.code like '522%' or a.code like '524%' or a.code like '533%' or a.code like '872%')
    group by left(a.code, 3)`)) as unknown as Array<{ code: string; v: number }>;
  const flow = (c: string) => Number(rows.find((r) => r.code === c)?.v ?? 0);
  const parts = FIXED_ACCOUNTS.map((p) => ({ ...p, amount: Math.round(flow(p.code)) }));
  const fixedTotal = parts.reduce((a, p) => a + p.amount, 0);
  const fixPerDay = avgStock > 0 ? Math.round(fixedTotal / (avgStock * n) / 10) * 10 : 0;

  const interest = Math.round(flow("872"));
  const avgCapital = k.money.avgCapital;
  const financingPct = interest > 0 && avgCapital > 0 ? ((interest * 365) / n / avgCapital) * 100 : null;
  const moneyPct = Math.max(financingPct ?? 0, OPPORTUNITY_PCT);

  // árvesztés: Forecast-tervvel eladott autók – (tervezett ár − eladási ár) / tervezett ár, napra vetítve, évesítve
  const slips = (await db.execute(sql`
    with sale as (
      select il.vehicle_id, max(i.fulfillment_date) d, sum(il.gross_huf) gross
      from invoice_lines il join invoices i on i.id = il.invoice_id
      where i.company_id = ${companyId} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null group by il.vehicle_id)
    select p.sale_price::float8 plan, s.gross::float8 gross, (s.d - coalesce(v.purchase_date, s.d - 30))::int days
    from forecast_plans p join vehicles v on v.id = p.vehicle_id join sale s on s.vehicle_id = v.id
    where p.company_id = ${companyId} and p.sale_price is not null and s.d between ${from}::date and ${to}::date`)) as unknown as Array<{ plan: number; gross: number; days: number }>;
  const perDay = slips.filter((s) => s.plan > 0 && s.days > 0).map((s) => Math.max(0, (s.plan - s.gross) / s.plan) / s.days);
  const slipFromData = perDay.length >= 3;
  const slipPct = slipFromData ? Math.min(30, (median(perDay)! * 365) * 100) : SLIP_DEFAULT_PCT;

  return {
    from, to, days: n, avgStock, parts, fixedTotal, fixPerDay, interest, avgCapital,
    financingPct: financingPct == null ? null : round1(financingPct), opportunityPct: OPPORTUNITY_PCT, moneyPct: round1(moneyPct),
    slipPct: round1(slipPct), slipCars: perDay.length, slipFromData, ratePct: round1(moneyPct + slipPct),
  };
}
