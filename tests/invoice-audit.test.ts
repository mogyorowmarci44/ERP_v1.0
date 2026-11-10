import { describe, it, expect } from "vitest";
import { flagsFor, fingerprintOf, type AuditInvoice } from "@/lib/invoice-flags";

const base = (): AuditInvoice => ({
  inv: { id: 1, companyId: 1, direction: "out", partnerId: 1, invoiceNumber: "MM-1", issueDate: "2026-10-01", fulfillmentDate: "2026-10-01", dueDate: "2026-10-10",
    paymentMethod: "transfer", currency: "HUF", exchangeRate: 1, rateDate: null, rateSource: "MNB", periodic: false, netHuf: 787402, vatHuf: 212598, grossHuf: 1000000,
    grossFx: 1000000, status: "posted", journalEntryId: 5, note: null, createdAt: new Date() },
  partnerName: "Vevő", partnerTax: null, partnerPrivate: true,
  lines: [{ position: 1, description: "Colt", accountCode: "911", accountName: "", vatCode: "KÜL27", vatKind: "margin", vatRate: 27, vehicle: "Colt", vehicleId: 3, quantity: 1,
    unitPrice: 1000000, netHuf: 787402, vatHuf: 212598, grossHuf: 1000000, marginPurchaseHuf: null }],
  payments: [], paidFx: 0, openFx: 1000000, openHuf: 1000000, flags: [],
  check: { checked: false, stale: false, at: null, by: null, note: null, docUrl: null }, fingerprint: "",
});

describe("számla-ellenőrzés jelzései", () => {
  it("lejárt nyitott számla, beszerzési ár nélküli különbözeti eladás, hiányzó bizonylat", () => {
    const codes = flagsFor(base(), "2026-11-10").map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["overdue", "no_margin_base", "no_doc"]));
  });
  it("kerekítési maradék és feltételezett adat", () => {
    const a = base();
    a.openFx = 2; a.openHuf = 2; a.inv.note = "Gépkocsi hozzárendelés FELTÉTELEZETT";
    a.lines[0].marginPurchaseHuf = 680000;
    const codes = flagsFor(a, "2026-11-10").map((f) => f.code);
    expect(codes).toContain("rounding");
    expect(codes).toContain("assumed");
    expect(codes).not.toContain("no_margin_base");
  });
  it("az ujjlenyomat változik új kifizetésnél", () => {
    const a = base();
    const f1 = fingerprintOf(a);
    a.payments.push({ id: 9, date: "2026-10-05", accountCode: "384", amountFx: 1000000, amountHuf: 1000000, partnerHuf: 1000000, fxRate: 1, entryId: 7, reversed: false });
    expect(fingerprintOf(a)).not.toBe(f1);
  });
});
