/**
 * Különbözeti ÁFA karton (Áfa tv. 210–219. §, tételes módszer) gépkocsinként:
 * beszerzés (különbözeti adóalaphoz számító beszerzési ár), eladás, különbözet, ÁFA, adóalap,
 * valamint tájékoztatásul a különbözetbe nem számító, a bekerülési értéket növelő tételek és a könyv szerinti eredmény.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { round2 } from "./money";

const { vehicles, invoices, invoiceLines, vatCodes, partners, accounts, journalLines, journalEntries, forecastPlans, companies } = schema;

export type CardDoc = {
  invoiceId: number | null;
  date: string;
  partner: string;
  partnerTax: string | null;
  partnerPrivate: boolean;
  partnerAddress: string | null;
  number: string;
  description: string;
  vatCode: string;
  vatKind: string;
  currency: string;
  amountFx: number | null;
  rate: number | null;
  grossHuf: number;
  netHuf: number;
  vatHuf: number;
  marginPurchaseHuf: number | null;
};
export type MarginCard = {
  company: typeof companies.$inferSelect;
  vehicle: typeof vehicles.$inferSelect;
  purchases: CardDoc[]; // különbözeti adóalapba számító beszerzés
  otherCosts: CardDoc[]; // bekerülési értéket növelő egyéb tételek (nem része a különbözetnek)
  sales: CardDoc[];
  marginBase: number; // beszerzési ár (a különbözet alapja)
  marginBaseSource: "override" | "invoices";
  sale: { gross: number; margin: number; vatBooked: number; vatComputed: number; taxBase: number; netRevenue: number } | null;
  cogs: number;
  bookValue: number;
  profit: number | null;
  plan: { price: number; date: string | null } | null;
  checks: Array<{ ok: boolean; text: string }>;
};

const MARGIN_BASE_KINDS = ["margin"];

export async function marginCard(companyId: number, vehicleId: number): Promise<MarginCard | null> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const [vehicle] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId)));
  if (!vehicle) return null;

  const rows = await db
    .select({ l: invoiceLines, i: invoices, vCode: vatCodes.code, vKind: vatCodes.kind, pName: partners.name, pTax: partners.taxNumber, pPriv: partners.isPrivatePerson, pAddr: partners.address, acc: accounts.code })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
    .innerJoin(partners, eq(partners.id, invoices.partnerId))
    .innerJoin(accounts, eq(accounts.id, invoiceLines.accountId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "posted"), eq(invoiceLines.vehicleId, vehicleId)))
    .orderBy(asc(invoices.fulfillmentDate), asc(invoices.id), asc(invoiceLines.position));
  const doc = (r: (typeof rows)[number]): CardDoc => ({
    invoiceId: r.i.id, date: r.i.fulfillmentDate, partner: r.pName, partnerTax: r.pTax, partnerPrivate: r.pPriv, partnerAddress: r.pAddr,
    number: r.i.invoiceNumber, description: r.l.description, vatCode: r.vCode, vatKind: r.vKind, currency: r.i.currency,
    amountFx: r.i.currency !== "HUF" ? round2(Number(r.l.unitPrice) * Number(r.l.quantity)) : null, rate: r.i.currency !== "HUF" ? Number(r.i.exchangeRate) : null,
    grossHuf: Number(r.l.grossHuf), netHuf: Number(r.l.netHuf), vatHuf: Number(r.l.vatHuf), marginPurchaseHuf: r.l.marginPurchaseHuf === null ? null : Number(r.l.marginPurchaseHuf),
  });
  const ins = rows.filter((r) => r.i.direction === "in");
  const purchases = ins.filter((r) => MARGIN_BASE_KINDS.includes(r.vKind)).map(doc);
  const otherCosts = ins.filter((r) => !MARGIN_BASE_KINDS.includes(r.vKind)).map(doc);
  const sales = rows.filter((r) => r.i.direction === "out").map(doc);

  // Számla nélküli, a gépkocsira aktivált tételek (vegyes tétel a 261-en)
  const manual = await db
    .select({ l: journalLines, e: journalEntries, acc: accounts.code })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.companyId, companyId), eq(journalLines.vehicleId, vehicleId), eq(journalEntries.sourceType, "manual")));
  for (const m of manual.filter((x) => x.acc.startsWith("261") && Number(x.l.debit) > 0)) {
    otherCosts.push({ invoiceId: null, date: m.e.date, partner: "–", partnerTax: null, partnerPrivate: false, partnerAddress: null, number: m.e.number, description: m.e.description,
      vatCode: "–", vatKind: "manual", currency: "HUF", amountFx: null, rate: null, grossHuf: Number(m.l.debit), netHuf: Number(m.l.debit), vatHuf: 0, marginPurchaseHuf: null });
  }

  // Könyv szerinti értékek
  const sums = await db
    .select({ code: accounts.code, d: journalLines.debit, c: journalLines.credit })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.companyId, companyId), eq(journalLines.vehicleId, vehicleId), inArray(accounts.code, ["261", "814"])));
  const bal = (code: string) => round2(sums.filter((s) => s.code === code).reduce((a, s) => a + Number(s.d) - Number(s.c), 0));
  const cogs = bal("814");
  const bookValue = bal("261");

  const override = vehicle.purchasePrice !== null && vehicle.purchasePrice !== undefined;
  const marginBase = override ? Number(vehicle.purchasePrice) : round2(purchases.reduce((a, p) => a + p.grossHuf, 0));
  const checks: MarginCard["checks"] = [];
  let sale: MarginCard["sale"] = null;
  if (sales.length) {
    const gross = round2(sales.reduce((a, s) => a + s.grossHuf, 0));
    const vatBooked = round2(sales.reduce((a, s) => a + s.vatHuf, 0));
    const bookedBase = sales[0].marginPurchaseHuf ?? marginBase;
    const margin = round2(gross - bookedBase);
    const vatComputed = Math.max(0, Math.round((margin * 27) / 127));
    sale = { gross, margin, vatBooked, vatComputed, taxBase: round2(Math.max(0, margin) - vatComputed), netRevenue: round2(gross - vatBooked) };
    checks.push({ ok: Math.abs(vatComputed - vatBooked) < 1, text: Math.abs(vatComputed - vatBooked) < 1 ? "A könyvelt különbözeti ÁFA egyezik a számítottal." : `A könyvelt ÁFA (${vatBooked}) eltér a számítottól (${vatComputed}).` });
    if (sales[0].marginPurchaseHuf !== null && Math.abs(sales[0].marginPurchaseHuf - marginBase) >= 1)
      checks.push({ ok: false, text: `Az eladáskor használt beszerzési ár (${sales[0].marginPurchaseHuf}) eltér a jelenlegitől (${marginBase}) – utólag módosult a beszerzés.` });
    if (margin < 0) checks.push({ ok: true, text: "Negatív különbözet: az ÁFA 0, és nem csökkenti más gépkocsi különbözetét." });
    if (Math.abs(bookValue) >= 1) checks.push({ ok: false, text: `A készletszámlán (261) ${bookValue} Ft maradt a gépkocsin – utólagos költség vagy hiányzó kivezetés.` });
  }
  if (!purchases.length && !override) checks.push({ ok: false, text: "Nincs különbözeti beszerzési bizonylat – a beszerzési ár 0, az ÁFA a teljes eladási árból számolódik." });
  if (purchases.some((p) => !p.partnerTax && !p.partnerPrivate)) checks.push({ ok: false, text: "A beszerzés eladójának nincs adószáma, és nincs magánszemélyként jelölve." });

  const [plan] = await db.select().from(forecastPlans).where(eq(forecastPlans.vehicleId, vehicleId));
  return {
    company, vehicle, purchases, otherCosts, sales, marginBase, marginBaseSource: override ? "override" : "invoices", sale, cogs, bookValue,
    profit: sale ? round2(sale.netRevenue - cogs) : null,
    plan: plan?.salePrice ? { price: Number(plan.salePrice), date: plan.saleDate } : null,
    checks,
  };
}

/** Egy időszakban eladott gépkocsik azonosítói (a kartonok tömeges nyomtatásához). */
export async function soldVehicleIds(companyId: number, from: string, to: string) {
  const rows = await db
    .selectDistinct({ id: invoiceLines.vehicleId, d: invoices.fulfillmentDate })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.direction, "out"), eq(invoices.status, "posted"), eq(vatCodes.kind, "margin")))
    .orderBy(asc(invoices.fulfillmentDate));
  return [...new Set(rows.filter((r) => r.id && r.d >= from && r.d <= to).map((r) => r.id!))];
}
