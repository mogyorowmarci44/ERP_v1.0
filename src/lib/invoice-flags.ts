/** Számla-ellenőrzés – tiszta (adatbázis nélküli) részek: típusok, ujjlenyomat, jelzések. */
import { createHash } from "node:crypto";
import type { schema } from "@/db";

type InvoiceRow = (typeof schema.invoices)["$inferSelect"];
export type FlagLevel = "warn" | "info";
export type Flag = { code: string; level: FlagLevel; text: string };

export type AuditLine = {
  position: number;
  description: string;
  accountCode: string;
  accountName: string;
  vatCode: string;
  vatKind: string;
  vatRate: number;
  vehicle: string | null;
  vehicleId: number | null;
  quantity: number;
  unitPrice: number;
  netHuf: number;
  vatHuf: number;
  grossHuf: number;
  marginPurchaseHuf: number | null;
};
export type AuditPayment = { id: number; date: string; accountCode: string; amountFx: number; amountHuf: number; partnerHuf: number; fxRate: number; entryId: number | null; reversed: boolean };
export type AuditInvoice = {
  inv: InvoiceRow;
  partnerName: string;
  partnerTax: string | null;
  partnerPrivate: boolean;
  lines: AuditLine[];
  payments: AuditPayment[];
  paidFx: number;
  openFx: number;
  openHuf: number;
  flags: Flag[];
  check: { checked: boolean; stale: boolean; at: Date | null; by: string | null; note: string | null; docUrl: string | null };
  fingerprint: string;
};

export const CASH_LIMIT = 1_500_000;
const ASSUMED = /FELTÉTELEZETT|PLACEHOLDER/i;

export function fingerprintOf(a: Pick<AuditInvoice, "inv" | "lines" | "payments">) {
  const live = a.payments.filter((p) => !p.reversed).map((p) => `${p.id}:${p.amountHuf}`).sort();
  const s = [a.inv.status, a.inv.journalEntryId, a.inv.grossHuf, a.inv.vatHuf, a.inv.fulfillmentDate, a.inv.partnerId,
    a.lines.map((l) => `${l.accountCode}/${l.vatCode}/${l.netHuf}/${l.vatHuf}/${l.vehicleId ?? ""}`).join(";"), live.join(";")].join("|");
  return createHash("sha1").update(s).digest("hex");
}

export function flagsFor(a: AuditInvoice, t: string): Flag[] {
  const f: Flag[] = [];
  const { inv } = a;
  if (inv.status === "draft") f.push({ code: "draft", level: "warn", text: "Piszkozat – nincs lekönyvelve" });
  if (inv.status === "cancelled") f.push({ code: "cancelled", level: "info", text: "Sztornózott" });
  if (inv.status === "posted") {
    const due = inv.dueDate ?? inv.issueDate;
    if (a.openFx > 5 && due < t) f.push({ code: "overdue", level: "warn", text: `Lejárt (${due}), nyitott ${fmt(a.openHuf)} Ft` });
    else if (Math.abs(a.openFx) > 0.004 && Math.abs(a.openFx) <= 5) f.push({ code: "rounding", level: "warn", text: `Kerekítési maradék: ${a.openFx.toLocaleString("hu-HU")} ${inv.currency}` });
    if (a.openFx < -0.5) f.push({ code: "overpaid", level: "warn", text: `Túlfizetés: ${fmt(-a.openHuf)} Ft` });
  }
  for (const l of a.lines) {
    if (l.accountCode.startsWith("261") && !l.vehicleId) f.push({ code: "no_vehicle", level: "warn", text: `Készletre (261) könyvelt tétel gépkocsi nélkül: ${l.description}` });
    if (inv.direction === "out" && l.vatKind === "margin" && !(l.marginPurchaseHuf && l.marginPurchaseHuf > 0))
      f.push({ code: "no_margin_base", level: "warn", text: `Különbözeti eladás beszerzési ár nélkül – az ÁFA a teljes árból számolódott (${l.description})` });
    if (inv.direction === "out" && l.vatKind === "margin" && l.marginPurchaseHuf && l.grossHuf < l.marginPurchaseHuf)
      f.push({ code: "margin_loss", level: "info", text: `Beszerzési ár alatti eladás (${fmt(l.grossHuf)} < ${fmt(l.marginPurchaseHuf)} Ft) – különbözeti ÁFA 0` });
  }
  if (ASSUMED.test(inv.note ?? "") || a.lines.some((l) => ASSUMED.test(l.description)))
    f.push({ code: "assumed", level: "warn", text: "Feltételezett / ideiglenes adat (a megjegyzés vagy a tétel szerint)" });
  if (!a.check.docUrl && inv.status === "posted") f.push({ code: "no_doc", level: "info", text: "Nincs hivatkozás az eredeti bizonylatra" });
  if (a.check.stale) f.push({ code: "stale", level: "warn", text: "Az ellenőrzés óta módosult (új kifizetés, sztornó vagy módosítás)" });
  return f;
}
const fmt = (x: number) => Math.round(x).toLocaleString("hu-HU");
