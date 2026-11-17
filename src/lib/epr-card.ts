/**
 * EPR karton gépkocsinként + negyedéves összesítő (a különbözeti ÁFA karton mintájára).
 * A karton a nyilvántartási kötelezettséget (EPR-rendelet 26. §) és az OKIR negyedéves adatszolgáltatás
 * (KG:KGYF-NÉ) alátámasztását szolgálja: beszerzés (származás), első belföldi forgalomba hozatal, KF kód, tömeg, díj.
 */
import { and, asc, between, eq, ilike, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  eprDeadline, eprFee, eprKfCode, eprLiability, eprRate, quarterOf, quarterRange, rateTableFor,
  EPR_INVOICE_TEXT, EPR_EXPENSE_ACCOUNT, EPR_PARTNER_HINT, type EprCategory, type EprDrive, type EprOrigin, type EprStatus, type Quarter,
} from "./epr";

const { vehicles, invoices, invoiceLines, vatCodes, partners, companies, accounts } = schema;

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
      note: invoices.note, currency: invoices.currency, description: invoiceLines.description, grossHuf: invoiceLines.grossHuf, vatCode: vatCodes.code,
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
  const firstPurchase = purchases[0];
  const origin: EprOrigin | null = override ?? (firstPurchase ? (firstPurchase.partnerCountry === "HU" ? "domestic" : "import") : null);
  const originSource: EprCard["originSource"] = override ? "override" : firstPurchase ? "invoice" : "none";

  const category = (["M1", "N1", "3W"].includes(vehicle.eprCategory ?? "") ? vehicle.eprCategory : null) as EprCategory | null;
  const drive = (["ice", "hev", "phev", "bev"].includes(vehicle.eprDrive ?? "") ? vehicle.eprDrive : null) as EprDrive | null;
  const massKg = vehicle.eprMassKg ?? null;
  const flat = true; // a cégek díjátalányt fizetnek

  const sale = sales[0] ?? null;
  const status = eprLiability({ origin, saleDate: sale?.date ?? null, buyerCountry: sale?.partnerCountry ?? null, category });
  const placedOn = status.liable ? sale!.date : null;
  const quarter = placedOn ? quarterOf(placedOn) : null;

  let kfCode: string | null = null, rate: number | null = null, rateLabel: string | null = null, fee: number | null = null;
  if (status.liable && category) {
    const d = drive ?? "ice";
    kfCode = eprKfCode({ category, drive: d, year: vehicle.year, flat });
    rate = eprRate(placedOn!, category, d, flat);
    rateLabel = `${rateTableFor(placedOn!).label} · díjátalány`;
    fee = massKg ? eprFee(massKg, rate) : null;
  }

  const checks: EprCard["checks"] = [];
  checks.push({ ok: status.liable !== null, text: status.reason });
  if (status.liable) {
    if (!massKg) checks.push({ ok: false, text: "Hiányzik a tömeg (kg) – a díj nem számítható. Add meg a gépkocsinál (forgalmi engedély G rovat, saját tömeg)." });
    if (!drive) checks.push({ ok: false, text: "Nincs megadva a hajtás – belső égésűként számolva." });
    if (!vehicle.year) checks.push({ ok: false, text: "Nincs évjárat – a KF csoportkód 1980 utáni gyártást feltételez." });
    if (!rateTableFor(placedOn!).verified) checks.push({ ok: false, text: "A forgalomba hozatal napjára érvényes díjtétel nincs ellenőrizve (2025. október 1. előtti tábla)." });
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

export type EprSummaryRow = { kfCode: string; category: EprCategory; rate: number | null; count: number; massKg: number; fee: number; missingMass: number };
export type EprQuarter = {
  company: typeof companies.$inferSelect;
  quarter: Quarter;
  deadline: string;
  cards: EprCard[]; // kötelezett gépkocsik (forgalomba hozatal a negyedévben)
  undecided: EprCard[]; // a negyedévben eladott, de nem eldönthető
  summary: EprSummaryRow[];
  totals: { count: number; massKg: number; fee: number };
  /** Könyvelt MOHU-számlák (869-es sor) a negyedév elejétől a határidő utáni 90. napig – egyeztetéshez. */
  mohu: { invoiceId: number; number: string; date: string; partner: string; netHuf: number }[];
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
  const deadline = eprDeadline(quarter);
  const until = new Date(Date.parse(deadline + "T00:00:00Z") + 90 * 86400000).toISOString().slice(0, 10);
  const mohuRows = await db
    .select({ invoiceId: invoices.id, number: invoices.invoiceNumber, date: invoices.fulfillmentDate, partner: partners.name, net: invoiceLines.netHuf })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(partners, eq(partners.id, invoices.partnerId))
    .innerJoin(accounts, eq(accounts.id, invoiceLines.accountId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.direction, "in"), eq(invoices.status, "posted"), eq(accounts.code, EPR_EXPENSE_ACCOUNT),
      ilike(partners.name, `%${EPR_PARTNER_HINT}%`), between(invoices.fulfillmentDate, from, until)));
  const mohu = [...mohuRows.reduce((m, r) => {
    const x = m.get(r.invoiceId) ?? { invoiceId: r.invoiceId, number: r.number, date: r.date, partner: r.partner, netHuf: 0 };
    x.netHuf += Number(r.net);
    return m.set(r.invoiceId, x);
  }, new Map<number, EprQuarter["mohu"][number]>()).values()];
  return {
    company, quarter, deadline, cards, undecided, summary, mohu,
    totals: { count: cards.length, massKg: summary.reduce((a, s) => a + s.massKg, 0), fee: summary.reduce((a, s) => a + s.fee, 0) },
  };
}
