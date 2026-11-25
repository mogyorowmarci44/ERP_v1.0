/**
 * EPR karton gépkocsinként + negyedéves összesítő (a különbözeti ÁFA karton mintájára).
 * A karton a nyilvántartási kötelezettséget (EPR-rendelet 26. §) és az OKIR negyedéves adatszolgáltatás
 * (KG:KGYF-NÉ) alátámasztását szolgálja: beszerzés (származás), első belföldi forgalomba hozatal, KF kód, tömeg, díj.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  eprDeadline, eprFee, eprKfCode, eprLiability, eprRate, quarterOf, quarterRange, rateTableFor,
  EPR_INVOICE_TEXT, type EprCategory, type EprDrive, type EprOrigin, type EprStatus, type Quarter,
} from "./epr";

const { vehicles, invoices, invoiceLines, vatCodes, partners, companies } = schema;

export type EprDoc = {
  invoiceId: number;
  date: string;
  number: string;
  partner: string;
  partnerCountry: string;
  partnerPrivate: boolean;
  partnerTax: string | null;
  description: string;
  vatCode: string;
  currency: string;
  grossHuf: number;
  note: string | null;
};

export type EprCard = {
  company: typeof companies.$inferSelect;
  vehicle: typeof vehicles.$inferSelect;
  purchases: EprDoc[];
  sales: EprDoc[];
  origin: EprOrigin | null;
  originSource: "override" | "invoice" | "none";
  category: EprCategory | null;
  drive: EprDrive | null;
  massKg: number | null;
  flat: boolean;
  status: EprStatus;
  placedOn: string | null; // forgalomba hozatal napja (első belföldi eladás teljesítése)
  quarter: Quarter | null;
  deadline: string | null;
  kfCode: string | null;
  rate: number | null;
  rateLabel: string | null;
  fee: number | null;
  checks: Array<{ ok: boolean; text: string }>;
};

async function vehicleDocs(companyId: number, vehicleIds: number[]) {
  if (!vehicleIds.length) return [];
  return db
    .select({
      vehicleId: invoiceLines.vehicleId, dir: invoices.direction, invoiceId: invoices.id, date: invoices.fulfillmentDate, number: invoices.invoiceNumber,
      note: invoices.note, currency: invoices.currency, description: invoiceLines.description, grossHuf: invoiceLines.grossHuf, vatCode: vatCodes.code, vatKind: vatCodes.kind,
      pName: partners.name, pCountry: partners.country, pPriv: partners.isPrivatePerson, pTax: partners.taxNumber,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
    .innerJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "posted"), inArray(invoiceLines.vehicleId, vehicleIds)))
    .orderBy(asc(invoices.fulfillmentDate), asc(invoices.id), asc(invoiceLines.position));
}
type DocRow = Awaited<ReturnType<typeof vehicleDocs>>[number];

const toDoc = (r: DocRow): EprDoc => ({
  invoiceId: r.invoiceId, date: r.date, number: r.number, partner: r.pName, partnerCountry: r.pCountry, partnerPrivate: r.pPriv, partnerTax: r.pTax,
  description: r.description, vatCode: r.vatCode, currency: r.currency, grossHuf: Number(r.grossHuf), note: r.note,
});

function build(company: EprCard["company"], vehicle: EprCard["vehicle"], rows: DocRow[]): EprCard {
  // Egy számla több sora is a gépkocsira mehet – bizonylatonként egy sor a kartonon.
  const uniq = (docs: EprDoc[]) => [...new Map(docs.map((d) => [d.invoiceId, d])).values()];
  const purchases = uniq(rows.filter((r) => r.dir === "in").map(toDoc));
  const sales = uniq(rows.filter((r) => r.dir === "out").map(toDoc));

  // Származás: kézi felülírás > az első beszerzési számla eladójának országa.
  const override = vehicle.eprOrigin === "import" || vehicle.eprOrigin === "domestic" ? (vehicle.eprOrigin as EprOrigin) : null;
  // Az autó tényleges beszerzése a különbözeti adózású (margin) beszerzési sor – nem az olajcsere, alkatrész vagy tankolás,
  // ami a vételnél korábbi dátumú is lehet. Ha nincs ilyen, a legkorábbi beszerzési bizonylat.
  const marginIds = new Set(rows.filter((r) => r.dir === "in" && r.vatKind === "margin").map((r) => r.invoiceId));
  const firstPurchase = purchases.find((p) => marginIds.has(p.invoiceId)) ?? purchases[0];
  const origin: EprOrigin | null = override ?? (firstPurchase ? (firstPurchase.partnerCountry === "HU" ? "domestic" : "import") : null);
  const originSource: EprCard["originSource"] = override ? "override" : firstPurchase ? "invoice" : "none";

  const category = (["M1", "N1", "3W"].includes(vehicle.eprCategory ?? "") ? vehicle.eprCategory : null) as EprCategory | null;
  const drive = (["ice", "hev", "phev", "bev"].includes(vehicle.eprDrive ?? "") ? vehicle.eprDrive : null) as EprDrive | null;
  const massKg = vehicle.eprMassKg ?? null;
  const flat = !!company.settings.eprFlatRate;

  const sale = sales[0] ?? null;
  const status = eprLiability({ origin, saleDate: sale?.date ?? null, buyerCountry: sale?.partnerCountry ?? null, category });
  const placedOn = status.liable ? sale!.date : null;
  const quarter = placedOn ? quarterOf(placedOn) : null;

  let kfCode: string | null = null, rate: number | null = null, rateLabel: string | null = null, fee: number | null = null;
  if (status.liable && category) {
    const d = drive ?? "ice";
    kfCode = eprKfCode({ category, drive: d, year: vehicle.year, flat, originDigit: company.settings.eprOriginDigit ?? null });
    rate = eprRate(placedOn!, category, d, flat);
    rateLabel = `${rateTableFor(placedOn!).label} · ${flat ? "díjátalány" : "J01, átalány nélkül"}`;
    fee = massKg ? eprFee(massKg, rate) : null;
  }

  const checks: EprCard["checks"] = [];
  checks.push({ ok: status.liable !== null, text: status.reason });
  if (status.liable) {
    if (!massKg) checks.push({ ok: false, text: "Hiányzik a tömeg (kg) – a díj nem számítható. Add meg a gépkocsinál a forgalmi engedély alapján." });
    if (!drive) checks.push({ ok: false, text: "Nincs megadva a hajtás – belső égésűként számolva." });
    // A cégek csak 1980 után gyártott autókkal kereskednek: évjárat nélkül 1980 utáni gyártásként kezeljük (nem hiba).
    if (!vehicle.year) checks.push({ ok: true, text: "Évjárat nincs megadva – 1980 utáni gyártásként kezelve (KF csoportkód 2x)." });
    if (!company.settings.eprOriginDigit) checks.push({ ok: false, text: "A KF kód 8. karaktere (származáskód) nincs beállítva – Beállítások › EPR." });
    if (!rateTableFor(placedOn!).verified) checks.push({ ok: false, text: "A forgalomba hozatal napjára érvényes díjtétel nincs ellenőrizve (2025. október 1. előtti tábla)." });
    if (!flat) checks.push({ ok: true, text: "Átalány nélkül: az akkumulátor, gumiabroncs és beépített elektromos eszközök EPR-díját külön KF kódon kell bevallani – ezt a karton nem számolja." });
    if (sale && !sale.partnerPrivate && !(sale.note ?? "").includes("kiterjesztett gyártói felelősségi díj"))
      checks.push({ ok: false, text: `Céges vevő: a számlán szerepelnie kell: „${EPR_INVOICE_TEXT}” (EPR-rendelet 21. § (2)).` });
  }
  if (sales.length > 1) checks.push({ ok: false, text: `${sales.length} vevőszámla tartozik a gépkocsihoz – az elsőt tekintjük forgalomba hozatalnak.` });
  if (originSource === "invoice" && firstPurchase.partnerCountry !== "HU")
    checks.push({ ok: true, text: `Származás a beszerzési számla eladójának országából (${firstPurchase.partnerCountry}).` });

  return {
    company, vehicle, purchases, sales, origin, originSource, category, drive, massKg, flat, status, placedOn, quarter,
    deadline: quarter ? eprDeadline(quarter) : null, kfCode, rate, rateLabel, fee, checks,
  };
}

export async function eprCard(companyId: number, vehicleId: number): Promise<EprCard | null> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const [vehicle] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId)));
  if (!company || !vehicle) return null;
  return build(company, vehicle, await vehicleDocs(companyId, [vehicleId]));
}

/** v4.5.2 – Több gépkocsi EPR kartonja egy lekérdezéssel (Forecast: nettó fedezet EPR-rel). */
export async function eprCards(companyId: number, vehicleIds: number[]): Promise<Map<number, EprCard>> {
  const out = new Map<number, EprCard>();
  if (!vehicleIds.length) return out;
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return out;
  const [vs, rows] = await Promise.all([
    db.select().from(vehicles).where(and(eq(vehicles.companyId, companyId), inArray(vehicles.id, vehicleIds))),
    vehicleDocs(companyId, vehicleIds),
  ]);
  for (const v of vs) out.set(v.id, build(company, v, rows.filter((r) => r.vehicleId === v.id)));
  return out;
}

export { eprEstimate } from "./epr";

export type EprSummaryRow = { kfCode: string; category: EprCategory; rate: number | null; count: number; massKg: number; fee: number; missingMass: number };
export type EprQuarter = {
  company: typeof companies.$inferSelect;
  quarter: Quarter;
  deadline: string;
  cards: EprCard[]; // kötelezett gépkocsik (forgalomba hozatal a negyedévben)
  undecided: EprCard[]; // a negyedévben eladott, de nem eldönthető
  summary: EprSummaryRow[];
  totals: { count: number; massKg: number; fee: number };
};

/** Negyedéves EPR összesítő: a negyedévben eladott gépkocsik közül a kötelezettek, KF kódonként. */
export async function eprQuarter(companyId: number, quarter: Quarter): Promise<EprQuarter> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const { from, to } = quarterRange(quarter);
  const all = await db.select().from(vehicles).where(eq(vehicles.companyId, companyId));
  const rows = await vehicleDocs(companyId, all.map((v) => v.id));
  const byVehicle = new Map<number, DocRow[]>();
  for (const r of rows) if (r.vehicleId) byVehicle.set(r.vehicleId, [...(byVehicle.get(r.vehicleId) ?? []), r]);

  const cards: EprCard[] = [];
  const undecided: EprCard[] = [];
  for (const v of all) {
    const vr = byVehicle.get(v.id) ?? [];
    const firstSale = vr.find((r) => r.dir === "out");
    if (!firstSale || firstSale.date < from || firstSale.date > to) continue;
    const c = build(company, v, vr);
    if (c.status.liable) cards.push(c);
    else if (c.status.liable === null) undecided.push(c);
  }
  cards.sort((a, b) => (a.placedOn ?? "").localeCompare(b.placedOn ?? ""));

  const map = new Map<string, EprSummaryRow>();
  for (const c of cards) {
    const k = c.kfCode!;
    const s = map.get(k) ?? { kfCode: k, category: c.category!, rate: c.rate, count: 0, massKg: 0, fee: 0, missingMass: 0 };
    s.count += 1;
    s.massKg += c.massKg ?? 0;
    s.fee += c.fee ?? 0;
    if (!c.massKg) s.missingMass += 1;
    if (s.rate !== c.rate) s.rate = null; // negyedéven belüli díjtétel-váltás
    map.set(k, s);
  }
  const summary = [...map.values()].sort((a, b) => a.kfCode.localeCompare(b.kfCode));
  return {
    company, quarter, deadline: eprDeadline(quarter), cards, undecided, summary,
    totals: { count: cards.length, massKg: summary.reduce((a, s) => a + s.massKg, 0), fee: summary.reduce((a, s) => a + s.fee, 0) },
  };
}
