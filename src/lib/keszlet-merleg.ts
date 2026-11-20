/**
 * v3.5.0 – KészletMérleg adatai: a készleten lévő, illetve az időszakban eladott autók AutóMérleg-bemenetei,
 * a közös adatokat (célfedezet, tartási költség, eladott autók) egyszer betöltve. Excel-export is.
 */
import "server-only";
import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadAutoMerleg, merlegContext } from "./auto-merleg";
import { RED_DAYS_DEFAULT, soldView, stockView, type KmCar, type KmGroupBy } from "./keszlet-merleg-calc";
import { brandWorkbook, d, finish, HUF, palette, sheet, type Col } from "./invoice-export";
import { normalizeTheme } from "./themes";
import { today } from "./dates";

const groupKey = (make: string, model: string) => {
  const m = (model.split(/\s+/)[0] ?? "").replace(/['’]/g, "").toLowerCase();
  return `${make} ${m.charAt(0).toUpperCase()}${m.slice(1)}`;
};

/** Párhuzamosan, de legfeljebb `n` egyszerre – hogy az adatbázis-kapcsolatokat ne terhelje túl. */
async function mapLimit<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

async function buildCars(companyId: number, ids: number[]): Promise<KmCar[]> {
  if (!ids.length) return [];
  const ctx = await merlegContext(companyId);
  const vs = await db.select().from(schema.vehicles).where(and(eq(schema.vehicles.companyId, companyId), inArray(schema.vehicles.id, ids)));
  const byId = new Map(vs.map((v) => [v.id, v]));
  const res = await mapLimit(ids, 6, async (id) => {
    const m = await loadAutoMerleg(companyId, id, ctx);
    const v = byId.get(id);
    if (!m || !v) return null;
    return { id, title: m.meta.title + (m.meta.year ? ` ${m.meta.year}` : ""), plate: m.meta.plate, input: m.input, saleDate: m.meta.saleDate, origin: m.meta.origin, group: groupKey(v.make, v.model) } satisfies KmCar;
  });
  return res.filter((x): x is KmCar => !!x);
}

export async function loadStockCars(companyId: number) {
  const ids = (await db.select({ id: schema.vehicles.id }).from(schema.vehicles)
    .where(and(eq(schema.vehicles.companyId, companyId), inArray(schema.vehicles.status, ["in_stock", "reserved"])))).map((r) => r.id);
  return buildCars(companyId, ids);
}

/** Az időszakban eladott autók (az utolsó vevőszámla teljesítési napja szerint). */
export async function loadSoldCars(companyId: number, from: string, to: string) {
  const rows = (await db.execute(sql`
    select il.vehicle_id id, max(i.fulfillment_date)::text d from invoice_lines il join invoices i on i.id = il.invoice_id
    where i.company_id = ${companyId} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null
    group by il.vehicle_id having max(i.fulfillment_date) between ${from}::date and ${to}::date`)) as unknown as Array<{ id: number }>;
  return buildCars(companyId, rows.map((r) => Number(r.id)));
}

export async function redDaysOf(companyId: number) {
  const [c] = await db.select({ s: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, companyId));
  return c?.s.merlegRedDays ?? RED_DAYS_DEFAULT;
}

const STATUS_HU = { red: "Beavatkozni", yellow: "Cél alatt", green: "Rendben" } as const;

export async function buildKeszletMerlegWorkbook(companyId: number, opts: { from: string; to: string; groupBy: KmGroupBy }) {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const [stockCars, soldCars, redDays] = await Promise.all([loadStockCars(companyId), loadSoldCars(companyId, opts.from, opts.to), redDaysOf(companyId)]);
  const st = stockView(stockCars, redDays), so = soldView(soldCars, opts.groupBy);
  const pal = palette(normalizeTheme(company.theme).accent);
  const wb = new ExcelJS.Workbook();
  brandWorkbook(wb);

  const sc: Col[] = [
    { header: "Autó", key: "car", width: 30 }, { header: "Rendszám", key: "plate", width: 11 }, { header: "Állapot", key: "status", width: 13 },
    { header: "Napok", key: "days", width: 7 }, { header: "Ár (Ft)", key: "price", width: 13, fmt: HUF }, { header: "Ár forrása", key: "src", width: 12 },
    { header: "Nullszaldó (Ft)", key: "floor", width: 14, fmt: HUF }, { header: "Cél (Ft)", key: "goal", width: 13, fmt: HUF },
    { header: "Nap a nullszaldóig", key: "toFloor", width: 10 }, { header: "Lekötött pénz (Ft)", key: "capital", width: 15, fmt: HUF },
    { header: "Tartási költség eddig (Ft)", key: "hold", width: 15, fmt: HUF }, { header: "Várható nettó fedezet (Ft)", key: "f2", width: 16, fmt: HUF },
  ];
  const ws1 = sheet(wb, "Készlet", "KészletMérleg – készlet (élő számok)", sc, { company: company.name, period: `állapot: ${today()}`, pal });
  for (const x of st.rows) ws1.addRow({ car: x.title, plate: x.plate ?? "", status: STATUS_HU[x.status], days: x.r.days, price: Math.round(x.r.price), src: x.r.priceSource === "plan" ? "Forecast" : "ÁrSugó", floor: Math.round(x.r.floor), goal: Math.round(x.r.goal), toFloor: x.r.daysToFloor, capital: Math.round(x.r.capital), hold: Math.round(x.r.holding), f2: Math.round(x.r.f2) });
  finish(ws1, pal, sc);

  const oc: Col[] = [
    { header: "Autó", key: "car", width: 30 }, { header: "Rendszám", key: "plate", width: 11 }, { header: "Eladás", key: "sale", width: 11, date: true },
    { header: "Állásidő (nap)", key: "days", width: 9 }, { header: "Eladási ár (Ft)", key: "price", width: 14, fmt: HUF }, { header: "ÁFA (Ft)", key: "vat", width: 12, fmt: HUF },
    { header: "Bruttó fedezet (Ft)", key: "f1", width: 15, fmt: HUF }, { header: "Költségek + EPR (Ft)", key: "costs", width: 15, fmt: HUF },
    { header: "Nettó fedezet (Ft)", key: "f2", width: 15, fmt: HUF }, { header: "Fedezet %", key: "pct", width: 9, fmt: "0.0%" }, { header: "Napi fedezet (Ft)", key: "perDay", width: 12, fmt: HUF },
    { header: "Terv: nettó fedezet (Ft)", key: "plan", width: 15, fmt: HUF }, { header: "Eltérés a tervtől (Ft)", key: "diff", width: 15, fmt: HUF },
  ];
  const ws2 = sheet(wb, "Eladott", "KészletMérleg – eladott autók", oc, { company: company.name, period: `${opts.from} – ${opts.to}`, pal });
  for (const x of so.rows) {
    const net = x.r.rows.find((r) => r.label === "Nettó fedezet");
    ws2.addRow({ car: x.title, plate: x.plate ?? "", sale: d(x.saleDate), days: x.r.days, price: Math.round(x.r.price), vat: Math.round(x.r.vat), f1: Math.round(x.r.f1), costs: Math.round(x.r.costTotal + x.r.epr), f2: Math.round(x.r.f2), pct: x.r.f2Pct, perDay: x.r.perDayMargin == null ? null : Math.round(x.r.perDayMargin), plan: net?.plan ?? null, diff: net?.diff ?? null });
  }
  finish(ws2, pal, oc);
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer };
}
