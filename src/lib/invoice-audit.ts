/**
 * Számlánkénti ellenőrzés: tételek, könyvelés, kifizetések, automatikus jelzések és a kézi „Ellenőrizve” állapot.
 * Ugyanez az adat szolgálja ki a számlalistát, a számla oldalát és a nyomtatható Excel exportot.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { round2 } from "./money";
import { today } from "./dates";
import { CASH_LIMIT, fingerprintOf, flagsFor, type AuditInvoice, type AuditLine, type AuditPayment } from "./invoice-flags";
export * from "./invoice-flags";

const { invoices, invoiceLines, partners, accounts, vatCodes, vehicles, payments, journalEntries, invoiceChecks, users } = schema;

/** Számlák ellenőrzési adatai (időszak, irány, vagy konkrét azonosítók szerint). */
export async function invoiceAudit(companyId: number, opts: { from?: string; to?: string; dir?: "in" | "out"; ids?: number[] }): Promise<AuditInvoice[]> {
  const conds = [eq(invoices.companyId, companyId)];
  if (opts.from) conds.push(gte(invoices.fulfillmentDate, opts.from));
  if (opts.to) conds.push(lte(invoices.fulfillmentDate, opts.to));
  if (opts.dir) conds.push(eq(invoices.direction, opts.dir));
  if (opts.ids) {
    if (!opts.ids.length) return [];
    conds.push(inArray(invoices.id, opts.ids));
  }
  const head = await db
    .select({ inv: invoices, pName: partners.name, pTax: partners.taxNumber, pPrivate: partners.isPrivatePerson })
    .from(invoices)
    .innerJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(...conds))
    .orderBy(asc(invoices.fulfillmentDate), asc(invoices.id));
  if (!head.length) return [];
  const ids = head.map((h) => h.inv.id);
  const [lineRows, payRows, checkRows] = await Promise.all([
    db
      .select({ l: invoiceLines, code: accounts.code, aName: accounts.name, vCode: vatCodes.code, vKind: vatCodes.kind, vRate: vatCodes.rate, make: vehicles.make, model: vehicles.model, plate: vehicles.plate, vin: vehicles.vin })
      .from(invoiceLines)
      .innerJoin(accounts, eq(accounts.id, invoiceLines.accountId))
      .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
      .leftJoin(vehicles, eq(vehicles.id, invoiceLines.vehicleId))
      .where(inArray(invoiceLines.invoiceId, ids))
      .orderBy(asc(invoiceLines.invoiceId), asc(invoiceLines.position)),
    db
      .select({ p: payments, code: accounts.code, reversed: journalEntries.reversedById })
      .from(payments)
      .innerJoin(accounts, eq(accounts.id, payments.moneyAccountId))
      .leftJoin(journalEntries, eq(journalEntries.id, payments.journalEntryId))
      .where(inArray(payments.invoiceId, ids))
      .orderBy(asc(payments.date), asc(payments.id)),
    db
      .select({ c: invoiceChecks, userName: users.name })
      .from(invoiceChecks)
      .leftJoin(users, eq(users.id, invoiceChecks.checkedBy))
      .where(inArray(invoiceChecks.invoiceId, ids)),
  ]);
  const t = today();
  const out: AuditInvoice[] = head.map((h) => {
    const lines: AuditLine[] = lineRows.filter((r) => r.l.invoiceId === h.inv.id).map((r) => ({
      position: r.l.position, description: r.l.description, accountCode: r.code, accountName: r.aName, vatCode: r.vCode, vatKind: r.vKind, vatRate: Number(r.vRate),
      vehicle: r.make ? `${r.make} ${r.model}${r.plate || r.vin ? ` ${r.plate || r.vin}` : ""}` : null, vehicleVin: r.vin ?? null, vehicleId: r.l.vehicleId,
      quantity: Number(r.l.quantity), unitPrice: Number(r.l.unitPrice), netHuf: Number(r.l.netHuf), vatHuf: Number(r.l.vatHuf), grossHuf: Number(r.l.grossHuf),
      marginPurchaseHuf: r.l.marginPurchaseHuf === null ? null : Number(r.l.marginPurchaseHuf),
    }));
    const pays: AuditPayment[] = payRows.filter((r) => r.p.invoiceId === h.inv.id).map((r) => ({
      id: r.p.id, date: r.p.date, accountCode: r.code, amountFx: Number(r.p.amountFx), amountHuf: Number(r.p.amountHuf), partnerHuf: Number(r.p.partnerHuf),
      fxRate: Number(r.p.fxRate), entryId: r.p.journalEntryId, reversed: r.reversed !== null && r.reversed !== undefined,
    }));
    const paidFx = round2(pays.filter((p) => !p.reversed).reduce((s, p) => s + p.amountFx, 0));
    const grossFx = Number(h.inv.grossFx);
    const openFx = h.inv.status === "posted" ? round2(grossFx - paidFx) : 0;
    const openHuf = grossFx ? round2((Number(h.inv.grossHuf) * openFx) / grossFx) : 0;
    const c = checkRows.find((x) => x.c.invoiceId === h.inv.id);
    const a: AuditInvoice = {
      inv: h.inv, partnerName: h.pName, partnerTax: h.pTax, partnerPrivate: h.pPrivate, lines, payments: pays, paidFx, openFx, openHuf, flags: [],
      check: { checked: false, stale: false, at: c?.c.checkedAt ?? null, by: c?.userName ?? null, note: c?.c.note ?? null, docUrl: c?.c.docUrl ?? null },
      fingerprint: "",
    };
    a.fingerprint = fingerprintOf(a);
    if (c?.c.checkedAt) {
      a.check.checked = c.c.fingerprint === a.fingerprint;
      a.check.stale = !a.check.checked;
    }
    a.flags = flagsFor(a, t);
    return a;
  });
  // Készpénzkorlát vállalkozások között (havi 1,5 M Ft partnerenként)
  const cashByPartnerMonth = new Map<string, number>();
  for (const a of out) {
    if (a.partnerPrivate || !a.partnerTax) continue;
    for (const p of a.payments) if (!p.reversed && p.accountCode.startsWith("381")) {
      const k = `${a.inv.partnerId}|${p.date.slice(0, 7)}`;
      cashByPartnerMonth.set(k, (cashByPartnerMonth.get(k) ?? 0) + p.amountHuf);
    }
  }
  for (const a of out) {
    const months = new Set(a.payments.filter((p) => !p.reversed && p.accountCode.startsWith("381")).map((p) => p.date.slice(0, 7)));
    for (const m of months) {
      const sum = cashByPartnerMonth.get(`${a.inv.partnerId}|${m}`) ?? 0;
      if (sum > CASH_LIMIT) a.flags.push({ code: "cash_limit", level: "warn", text: `Készpénzes fizetés ${m}-ban ezzel a vállalkozással ${Math.round(sum).toLocaleString("hu-HU")} Ft (havi korlát 1,5 M Ft)` });
    }
  }
  return out;
}

