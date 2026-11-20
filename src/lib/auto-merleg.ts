/**
 * v3.4.0 – AutóMérleg: egy autó adatai a számolóhoz – különbözeti karton (beszerzés, költségek, eladás),
 * EPR-lap (díj), Forecast-terv (tervezett költségek, ár, dátum), hasonló eladott autók (medián fedezet, állásidő).
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { marginCard } from "./margin-card";
import { eprCard } from "./epr-card";
import { eprFee, eprRate, type EprCategory, type EprDrive } from "./epr";
import { companyKpis } from "./kpi";
import { today } from "./dates";
import type { MerlegCost, MerlegInput } from "./auto-merleg-calc";

const { forecastPlans, forecastPlanCosts } = schema;

export const HOLDING_DEFAULT = { ratePct: 8, fixPerDay: 250 };

const median = (xs: number[]): number | null => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
/** Ugyanaz a csoportosítás, mint a KPI-Dashboardon: márka + a modell első szava. */
const groupKey = (make: string, model: string) => {
  const m = (model.split(/\s+/)[0] ?? "").replace(/['’]/g, "").toLowerCase();
  return `${make} ${m.charAt(0).toUpperCase()}${m.slice(1)}`;
};
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Hasonló eladott autók: azonos márka + modell; ha 3-nál kevesebb, azonos márka; ha az is kevés, a cég összes eladott autója. */
async function peersFor(companyId: number, vehicleId: number, make: string, model: string): Promise<MerlegInput["peers"]> {
  const rows = (await db.execute(sql`
    with sale as (
      select il.vehicle_id, max(i.fulfillment_date) d, sum(il.net_huf) net
      from invoice_lines il join invoices i on i.id = il.invoice_id
      where i.company_id = ${companyId} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null group by il.vehicle_id),
    gl as (
      select jl.vehicle_id, sum(case when a.code like '814%' then jl.debit - jl.credit else 0 end) cogs,
        sum(case when a.code like '26%' then jl.debit else 0 end) cost_in, min(case when a.code like '26%' and jl.debit > 0 then e.date end) first_in
      from journal_lines jl join accounts a on a.id = jl.account_id join journal_entries e on e.id = jl.entry_id
      where jl.company_id = ${companyId} and jl.vehicle_id is not null group by jl.vehicle_id)
    select v.id, v.make, v.model, coalesce(v.purchase_date, g.first_in)::text pd, s.d::text sd, s.net::float8 net, coalesce(nullif(g.cogs, 0), g.cost_in, 0)::float8 cost
    from vehicles v join sale s on s.vehicle_id = v.id left join gl g on g.vehicle_id = v.id
    where v.company_id = ${companyId} and v.status = 'sold' and v.id <> ${vehicleId}`)) as unknown as Array<{ id: number; make: string; model: string; pd: string | null; sd: string; net: number; cost: number }>;
  const cars = rows.map((r) => ({ group: groupKey(r.make, r.model), make: r.make, f2: Number(r.net) - Number(r.cost), days: r.pd ? days(r.pd, r.sd) : null }));
  const key = groupKey(make, model);
  let set = cars.filter((c) => c.group === key), label = key;
  if (set.length < 3) { set = cars.filter((c) => c.make === make); label = `${make} (minden modell)`; }
  if (set.length < 3) { set = cars; label = "a cég összes eladott autója"; }
  return { label, count: set.length, medF2: median(set.map((c) => c.f2)), medDays: median(set.map((c) => c.days).filter((d): d is number => d != null)) };
}

export type MerlegMeta = {
  vehicleId: number; title: string; year: number | null; plate: string | null; vin: string | null; status: string;
  seller: string | null; vatTreatment: "margin" | "normal"; purchaseDate: string | null; saleDate: string | null; buyer: string | null;
  hasMarginCard: boolean; eprNote: string | null; checks: Array<{ ok: boolean; text: string }>;
};

export async function loadAutoMerleg(companyId: number, vehicleId: number): Promise<{ input: MerlegInput; meta: MerlegMeta } | null> {
  const [card, epr] = await Promise.all([marginCard(companyId, vehicleId), eprCard(companyId, vehicleId)]);
  if (!card) return null;
  const v = card.vehicle;
  const t = today();
  const normal = v.vatTreatment === "normal";

  // költségek: a gépkocsihoz rendelt, nem különbözeti beszerzési sorok és a 261-re aktivált kézi tételek (nettó)
  let other = card.otherCosts.map((c) => ({ label: c.description || c.partner, date: c.date, gross: c.grossHuf, amount: c.netHuf }));
  // normál ÁFÁ-s autónál a legnagyobb beszerzési tétel maga az autó (bruttó)
  let buy = card.marginBase;
  if (normal && other.length) {
    const top = other.reduce((a, b) => (b.gross > a.gross ? b : a));
    buy = top.gross;
    other = other.filter((c) => c !== top);
  }
  const costs: MerlegCost[] = other.map(({ label, date, amount }) => ({ label, date, amount }));

  // EPR: a kötelezettség az eladáskor dől el; készleten lévő importautónál becslés a mai díjtétellel
  const eprBooked = costs.some((c) => /\bepr\b|kiterjesztett gyártói/i.test(c.label));
  let eprFeeVal: number | null = null, eprNote: string | null = null;
  if (!eprBooked && epr) {
    if (epr.fee != null) { eprFeeVal = epr.fee; eprNote = `EPR díj: ${epr.massKg} kg × ${epr.rate} Ft/kg (${epr.rateLabel})`; }
    else if (!card.sales.length && epr.origin === "import" && epr.category && epr.massKg) {
      const r = eprRate(t, epr.category as EprCategory, (epr.drive ?? "ice") as EprDrive, epr.flat);
      eprFeeVal = eprFee(epr.massKg, r);
      eprNote = `EPR díj (becslés, eladáskor esedékes): ${epr.massKg} kg × ${r} Ft/kg`;
    } else if (epr.origin === "import" && !epr.massKg) eprNote = "Importautó, de hiányzik a tömeg – az EPR díj nem számolható (EPR-lap).";
  } else if (eprBooked) eprNote = "Az EPR díj a gépkocsihoz könyvelve, a költségek között szerepel.";

  // Forecast-terv az autóhoz
  const [plan] = await db.select().from(forecastPlans).where(and(eq(forecastPlans.companyId, companyId), eq(forecastPlans.vehicleId, vehicleId)));
  const planCosts = plan ? await db.select().from(forecastPlanCosts).where(eq(forecastPlanCosts.planId, plan.id)) : [];

  const [k, peers] = await Promise.all([companyKpis(companyId).catch(() => null), peersFor(companyId, vehicleId, v.make, v.model)]);
  const s = card.company.settings;
  const sale = card.sale && card.sales.length ? { date: card.sales[card.sales.length - 1].date, gross: card.sale.gross, vat: card.sale.vatBooked } : null;
  const purchaseDate = v.purchaseDate ?? card.purchases[0]?.date ?? card.otherCosts[0]?.date ?? null;

  return {
    input: {
      today: t, buyMode: normal ? "normal" : "margin", sellMode: normal ? "normal" : "margin", buy, purchaseDate, costs,
      epr: eprFeeVal, sale,
      plan: plan ? { price: plan.salePrice != null ? Number(plan.salePrice) : null, date: plan.saleDate, costs: planCosts.map((c) => ({ label: c.description, date: c.date, amount: Number(c.net) })) } : null,
      holding: { ratePct: s.holdingRatePct ?? HOLDING_DEFAULT.ratePct, fixPerDay: s.holdingFixPerDay ?? HOLDING_DEFAULT.fixPerDay },
      target: k?.margin.soldCount ? k.margin.medF2 : null,
      peers,
    },
    meta: {
      vehicleId, title: `${v.make} ${v.model}`.trim(), year: v.year, plate: v.plate, vin: v.vin, status: v.status,
      seller: card.purchases[0]?.partner ?? null, vatTreatment: v.vatTreatment, purchaseDate, saleDate: sale?.date ?? null,
      buyer: card.sales[0]?.partner ?? null, hasMarginCard: !normal, eprNote, checks: card.checks,
    },
  };
}
