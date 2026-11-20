/**
 * v3.7.1 – M-lap ellenőrzés: a beadott ÁFA-bevallások M-lapjain szereplő számlák összevetése az ERP könyvelésével, és az
 * ERP M-lapjaihoz hiányzó adatok (partner-adószám) kigyűjtése. A NAV szerint az M-lapon a számla sorszámának
 * karakterre egyeznie kell az eredeti számlával – az eltéréseket itt lehet egy helyen átnézni.
 * A összevetés tiszta függvény (compareMSheets) – tesztelhető.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isVatForm, periodOf } from "./anyk";

const s = schema;

import { compareMSheets, type ErpInvoice, type SubmittedRow } from "./mlap-compare";
export { compareMSheets, type ErpInvoice, type SubmittedRow, type CheckIssue } from "./mlap-compare";

/** A mérvadó (beküldöttnek jelölt, ennek híján legutolsó) bevallás-változatok M-lapjainak számlái. */
export async function submittedMRows(companyId: number): Promise<SubmittedRow[]> {
  const filings = (await db.select().from(s.taxFilings).where(eq(s.taxFilings.companyId, companyId))).filter((f) => isVatForm(f.form));
  const byPeriod = new Map<string, typeof filings>();
  for (const f of filings) byPeriod.set(periodOf(f.periodFrom), [...(byPeriod.get(periodOf(f.periodFrom)) ?? []), f]);
  const out: SubmittedRow[] = [];
  for (const [period, list] of byPeriod) {
    const sorted = [...list].sort((a, b) => +(a.savedAt ?? 0) - +(b.savedAt ?? 0));
    const base = sorted.filter((v) => v.submitted).at(-1) ?? sorted.at(-1)!;
    for (const sh of base.sheets) {
      if (!sh.id.endsWith("M")) continue;
      const tax8 = (sh.fields["0_0A0001C005A"] ?? "").replace(/\D/g, "");
      const partnerName = sh.fields["0_0A0001C006A"] || sh.fields["0_0BXXXXB005A"] || "";
      for (const [k, v] of Object.entries(sh.fields)) {
        const m = k.match(/^(\d+_0B(?:XXXX|\d{4}))C(\d{4})AA$/);
        if (!m || !v || m[2] === "0037") continue;
        const p = `${m[1]}C${m[2]}`;
        const d = sh.fields[`${p}BA`];
        out.push({
          period, number: v.trim(), date: d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
          base: Number(sh.fields[`${p}CA`] ?? 0), vat: Number(sh.fields[`${p}DA`] ?? 0), tax8, partnerName,
        });
      }
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period) || a.number.localeCompare(b.number));
}

/** Az ERP könyvelt szállítói számlái számlánként összesítve (adóalap, áfa, ebből levonható). */
export async function erpInInvoices(companyId: number): Promise<ErpInvoice[]> {
  const rows = await db
    .select({ id: s.invoices.id, number: s.invoices.invoiceNumber, date: s.invoices.fulfillmentDate, partnerId: s.partners.id, partnerName: s.partners.name, tax: s.partners.taxNumber, kind: s.vatCodes.kind, net: s.invoiceLines.netHuf, vat: s.invoiceLines.vatHuf })
    .from(s.invoiceLines)
    .innerJoin(s.invoices, eq(s.invoices.id, s.invoiceLines.invoiceId))
    .innerJoin(s.vatCodes, eq(s.vatCodes.id, s.invoiceLines.vatCodeId))
    .innerJoin(s.partners, eq(s.partners.id, s.invoices.partnerId))
    .where(and(eq(s.invoices.companyId, companyId), eq(s.invoices.status, "posted"), eq(s.invoices.direction, "in")));
  const m = new Map<number, ErpInvoice>();
  for (const r of rows) {
    const e = m.get(r.id) ?? { id: r.id, number: r.number ?? "", date: r.date, partnerId: r.partnerId, partnerName: r.partnerName, tax8: (r.tax ?? "").replace(/\D/g, "").slice(0, 8) || null, base: 0, vat: 0, deductibleVat: 0, kinds: [] };
    e.base += Number(r.net); e.vat += Number(r.vat);
    if (r.kind === "normal") e.deductibleVat += Number(r.vat);
    if (!e.kinds.includes(r.kind)) e.kinds.push(r.kind);
    m.set(r.id, e);
  }
  return [...m.values()];
}

/** Partnerek levonható áfával, adószám nélkül – ezek számlái nem kerülhetnek M-lapra. */
export async function partnersMissingTax(companyId: number) {
  const inv = await erpInInvoices(companyId);
  const by = new Map<number, { partnerId: number; name: string; invoices: number; vat: number }>();
  for (const e of inv) {
    if (e.tax8 || e.deductibleVat < 0.5) continue;
    const x = by.get(e.partnerId) ?? { partnerId: e.partnerId, name: e.partnerName, invoices: 0, vat: 0 };
    x.invoices++; x.vat += e.deductibleVat;
    by.set(e.partnerId, x);
  }
  return [...by.values()].sort((a, b) => b.vat - a.vat);
}

export async function mSheetCheck(companyId: number) {
  const [submitted, erp, missingTax] = await Promise.all([submittedMRows(companyId), erpInInvoices(companyId), partnersMissingTax(companyId)]);
  const issues = compareMSheets(submitted, erp);
  return { submittedCount: submitted.length, issues, missingTax };
}
