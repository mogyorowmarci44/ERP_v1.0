import { describe, it, expect } from "vitest";
import { proposeInvoice, proposeStatement, vatCodeFor, type ProposeCtx } from "@/lib/inbox/propose";
import type { ExtractedDoc } from "@/db/schema";

const ctx = (): ProposeCtx => ({
  company: { name: "MM CAR TRADE Kft.", taxNumber: "33100717-2-07" },
  partners: [
    { id: 1, name: "Használtautó.hu Kft.", taxNumber: null, isPrivatePerson: false, country: "HU" },
    { id: 2, name: "Bitu-express Kft.", taxNumber: "14770469-2-07", isPrivatePerson: false, country: "HU" },
    { id: 3, name: "Berkes Mónika", taxNumber: null, isPrivatePerson: true, country: "HU" },
  ],
  history: [
    { partnerId: 1, direction: "in", accountCode: "524", vatCode: "27", description: "Hirdetés 10 db-os csomag", hasVehicle: false, periodic: true },
    { partnerId: 2, direction: "in", accountCode: "261", vatCode: "TAH", description: "Honosítás hatósági díjai", hasVehicle: true, periodic: false },
    { partnerId: 2, direction: "in", accountCode: "261", vatCode: "27", description: "Honosítási eljárás előzetes átvizsgálás", hasVehicle: true, periodic: false },
  ],
  vehicles: [{ id: 10, make: "Mazda", model: "CX-5", plate: null, vin: "JMZKEK97600108406", status: "in_stock" }],
  existing: new Set(["in|1|P2026/25718", "out|*|MM-2026-1"]),
  vatCodes: new Set(["27", "18", "5", "AM", "TAH", "KÜL27", "FAD27"]),
  open: [
    { id: 50, direction: "in", partnerName: "Használtautó.hu Kft.", number: "P2026/30264", currency: "HUF", openFx: 74676, openHuf: 74676, dueDate: "2026-11-18" },
    { id: 51, direction: "in", partnerName: "AUTO1 European Cars B.V.", number: "90042601326027", currency: "EUR", openFx: 2725, openHuf: 1_004_000, dueDate: null },
  ],
  moneyMoves: new Set(["384|2026-10-15|74676"]),
});

describe("beérkező bizonylat – számla-javaslat", () => {
  it("ismert szállító: a korábbi könyvelés szerint (524, 27%, időszakos) és automatikusan könyvelhető", () => {
    const x: ExtractedDoc = {
      docType: "invoice", direction: "in", seller: { name: "Használtautó.hu Kft." }, invoiceNumber: "P2026/34000", issueDate: "2026-12-01", fulfillmentDate: "2026-12-16", dueDate: "2026-12-16",
      paymentMethod: "transfer", currency: "HUF", lines: [{ description: "Hirdetés 10db-os csomag", net: 58800, vatRate: 27, vat: 15876, gross: 74676 }], totals: { net: 58800, vat: 15876, gross: 74676 },
    };
    const p = proposeInvoice(ctx(), x, "2026-12-20");
    expect(p.issues).toEqual([]);
    expect(p.invoice!.partner.id).toBe(1);
    expect(p.invoice!.lines[0]).toMatchObject({ accountCode: "524", vatCode: "27", unitPrice: 58800 });
    expect(p.invoice!.periodic).toBe(true);
    expect(p.invoice!.payNow).toBeNull();
  });

  it("már könyvelt számla → duplikáció", () => {
    const x: ExtractedDoc = { docType: "invoice", direction: "in", seller: { name: "Használtautó.hu Kft" }, invoiceNumber: "P2026/25718", issueDate: "2026-10-01", lines: [{ description: "x", net: 1 }] };
    expect(proposeInvoice(ctx(), x, "2026-12-20").issues[0]).toMatch(/Már könyvelve/);
  });

  it("honosítás autóhoz: alvázszám alapján a meglévő gépkocsira, készpénzes → azonnal kiegyenlítve", () => {
    const x: ExtractedDoc = {
      docType: "invoice", direction: "in", seller: { name: "Bitu-express Kft", taxNumber: "14770469-2-07" }, invoiceNumber: "SZA02000/2026", issueDate: "2026-11-02", fulfillmentDate: "2026-11-02",
      paymentMethod: "cash", currency: "HUF", vehicle: { vin: "JMZKEK97600108406" },
      lines: [{ description: "Honosítás hatósági díjai", net: 37800, vatType: "AHK" }, { description: "Honosítási eljárás előzetes átvizsgálás", net: 20758, vatRate: 27, vat: 5605 }],
    };
    const p = proposeInvoice(ctx(), x, "2026-11-10");
    expect(p.issues).toEqual([]);
    expect(p.invoice!.lines.map((l) => [l.accountCode, l.vatCode, l.vehicleId])).toEqual([["261", "TAH", 10], ["261", "27", 10]]);
    expect(p.invoice!.payNow).toEqual({ date: "2026-11-02", accountCode: "381" });
  });

  it("adásvételi magánszemélytől: új gépkocsi, különbözeti beszerzés 261-re, készpénz", () => {
    const x: ExtractedDoc = {
      docType: "sale_contract", seller: { name: "Kiss Péter", privatePerson: true }, buyer: { name: "MM CAR TRADE Kft.", taxNumber: "33100717-2-07" },
      fulfillmentDate: "2026-11-05", vehicle: { make: "Fiat", model: "Punto", plate: "ABC-123", vin: "ZFA19900000311300" },
      lines: [{ description: "Fiat Punto ABC-123 vételár", net: 550000 }], totals: { gross: 550000 },
    };
    const p = proposeInvoice(ctx(), x, "2026-11-10");
    expect(p.issues).toEqual([]);
    expect(p.invoice!.lines[0]).toMatchObject({ accountCode: "261", vatCode: "KÜL27", newVehicle: true, unitPrice: 550000 });
    expect(p.invoice!.invoiceNumber).toBe("AV-2026-11-05-ABC123");
    expect(p.invoice!.payNow?.accountCode).toBe("381");
    expect(p.invoice!.partner).toMatchObject({ id: null, privatePerson: true });
  });

  it("új szállító ismeretlen költséggel → jóváhagyásra (529 csak javaslat)", () => {
    const x: ExtractedDoc = { docType: "invoice", seller: { name: "Valami Bt.", taxNumber: "12345678-2-13" }, invoiceNumber: "A-1", issueDate: "2026-11-01", lines: [{ description: "Tanácsadás", net: 10000, vatRate: 27, vat: 2700 }] };
    const p = proposeInvoice(ctx(), x, "2026-11-10");
    expect(p.issues.some((i) => i.startsWith("Új szállító"))).toBe(true);
    expect(p.invoice!.lines[0].accountCode).toBe("529");
  });

  it("díjbekérő nem könyvelendő", () => {
    expect(proposeInvoice(ctx(), { docType: "proforma" }, "2026-11-10").kind).toBe("none");
  });

  it("ÁFA-kód leképezés", () => {
    expect(vatCodeFor("K.AFA", null)).toBe("KÜL27");
    expect(vatCodeFor("AHK", null)).toBe("TAH");
    expect(vatCodeFor("I", null)).toBe("FAD27");
    expect(vatCodeFor("M", null)).toBe("KÜL27");
    expect(vatCodeFor(null, 27)).toBe("27");
    expect(vatCodeFor("AAM", 0)).toBe("AM");
  });
});

describe("beérkező bizonylat – bankkivonat párosítás", () => {
  it("számlaszám a közleményben, bankköltség, már könyvelt tétel, készpénzbefizetés, devizás számla forintból", () => {
    const x: ExtractedDoc = {
      docType: "bank_statement", statement: {
        currency: "HUF", opening: 1_000_000, closing: 1_000_000 - 74676 - 74676 - 557 + 200000 - 1_010_000,
        transactions: [
          { date: "2026-11-18", amount: -74676, counterparty: "Használtautó.hu Kft", reference: "P2026/30264" },
          { date: "2026-10-15", amount: -74676, counterparty: "Használtautó.hu Kft", reference: "P2026/25718" },
          { date: "2026-11-06", amount: -557, description: "PÉNZFORGALMI JUTALÉK" },
          { date: "2026-11-07", amount: 200000, description: "PÉNZTÁRI KÉSZPÉNZBEFIZETÉS" },
          { date: "2026-11-06", amount: -1_010_000, counterparty: "AUTO1 EasyPay BV", description: "DEVIZA ÁTUTALÁS 90042601326027", fxAmount: 2725, fxCurrency: "EUR" },
        ],
      },
    };
    const p = proposeStatement(ctx(), x);
    const a = p.statement!.rows.map((r) => [r.action, r.invoiceId ?? r.accountCode ?? null]);
    expect(a).toEqual([["pay_invoice", 50], ["skip", null], ["entry", "532"], ["transfer", "381"], ["pay_invoice", 51]]);
    expect(p.issues).toEqual([]);
  });
});
