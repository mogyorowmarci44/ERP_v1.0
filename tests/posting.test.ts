import { describe, it, expect } from "vitest";
import { computeLine, buildInvoicePosting, buildPaymentPosting, stornoLines, assertBalanced } from "@/lib/posting";

const acc = { partnerAccountId: 311, inputVatId: 466, outputVatId: 467, inventoryId: 261, cogsId: 814 };
const sumBy = (ls: { accountId: number; debit: number; credit: number }[], id: number) =>
  ls.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0);

describe("computeLine", () => {
  it("normál 27% HUF", () => {
    const a = computeLine({ quantity: 1, unitPrice: 100000, vatRate: 27, vatKind: "normal" }, "in", 1);
    expect(a).toMatchObject({ netHuf: 100000, vatHuf: 27000, grossHuf: 127000, payableHuf: 127000 });
  });

  it("különbözeti értékesítés: árrés ÁFA = árrés × 27/127", () => {
    // Beszerzés 3 000 000, eladás 3 635 000 bruttó → árrés 635 000 → ÁFA 135 000
    const a = computeLine({ quantity: 1, unitPrice: 3_635_000, vatRate: 27, vatKind: "margin", marginPurchaseHuf: 3_000_000 }, "out", 1);
    expect(a.vatHuf).toBe(135000);
    expect(a.netHuf).toBe(3_500_000);
    expect(a.grossHuf).toBe(3_635_000);
  });

  it("különbözeti értékesítés negatív árréssel: ÁFA 0", () => {
    const a = computeLine({ quantity: 1, unitPrice: 2_800_000, vatRate: 27, vatKind: "margin", marginPurchaseHuf: 3_000_000 }, "out", 1);
    expect(a.vatHuf).toBe(0);
    expect(a.netHuf).toBe(2_800_000);
  });

  it("különbözeti értékesítés beszerzési ár nélkül hibát dob", () => {
    expect(() => computeLine({ quantity: 1, unitPrice: 1, vatRate: 27, vatKind: "margin" }, "out", 1)).toThrow();
  });

  it("devizás normál számla tényleges árfolyamon", () => {
    const a = computeLine({ quantity: 2, unitPrice: 1000, vatRate: 27, vatKind: "normal" }, "in", 395.12);
    expect(a.netFx).toBe(2000);
    expect(a.vatFx).toBe(540);
    expect(a.netHuf).toBe(790240);
    expect(a.vatHuf).toBe(213365); // 540 × 395,12 = 213 364,8
  });

  it("Közösségen belüli beszerzés: önadózás, partner felé nettó", () => {
    const a = computeLine({ quantity: 1, unitPrice: 10000, vatRate: 27, vatKind: "eu_acquisition" }, "in", 400);
    expect(a.payableHuf).toBe(4_000_000);
    expect(a.vatHuf).toBe(1_080_000);
  });
});

describe("buildInvoicePosting", () => {
  it("szállítói számla javításra gépkocsira aktiválva", () => {
    const r = buildInvoicePosting(
      {
        direction: "in",
        partnerId: 1,
        currency: "HUF",
        fxRate: 1,
        invoiceNumber: "F-1",
        lines: [{ quantity: 1, unitPrice: 200000, vatRate: 27, vatKind: "normal", description: "Fényezés", accountId: 261, vatCodeId: 1, vehicleId: 7 }],
      },
      { ...acc, partnerAccountId: 454 },
    );
    expect(sumBy(r.lines, 261)).toBe(200000);
    expect(sumBy(r.lines, 466)).toBe(54000);
    expect(sumBy(r.lines, 454)).toBe(-254000);
    expect(r.lines.find((l) => l.accountId === 261)?.vehicleId).toBe(7);
  });

  it("különbözeti gépkocsi eladás ELÁBÉ kivezetéssel", () => {
    const r = buildInvoicePosting(
      {
        direction: "out",
        partnerId: 2,
        currency: "HUF",
        fxRate: 1,
        invoiceNumber: "V-1",
        lines: [{ quantity: 1, unitPrice: 3_635_000, vatRate: 27, vatKind: "margin", marginPurchaseHuf: 3_000_000, description: "VW Golf", accountId: 911, vatCodeId: 2, vehicleId: 7 }],
      },
      acc,
      new Map([[7, 3_200_000]]),
    );
    expect(sumBy(r.lines, 311)).toBe(3_635_000);
    expect(sumBy(r.lines, 911)).toBe(-3_500_000);
    expect(sumBy(r.lines, 467)).toBe(-135_000);
    expect(sumBy(r.lines, 814)).toBe(3_200_000);
    expect(sumBy(r.lines, 261)).toBe(-3_200_000);
  });

  it("fordított adózás: T 466 / K 467, szállító nettó", () => {
    const r = buildInvoicePosting(
      {
        direction: "in",
        partnerId: 3,
        currency: "EUR",
        fxRate: 400,
        invoiceNumber: "DE-9",
        lines: [{ quantity: 1, unitPrice: 5000, vatRate: 27, vatKind: "eu_acquisition", description: "Alkatrész", accountId: 261, vatCodeId: 3 }],
      },
      { ...acc, partnerAccountId: 455 },
    );
    expect(sumBy(r.lines, 455)).toBe(-2_000_000);
    expect(sumBy(r.lines, 466)).toBe(540_000);
    expect(sumBy(r.lines, 467)).toBe(-540_000);
  });
});

describe("buildPaymentPosting", () => {
  it("EUR szállítói kifizetés magasabb banki árfolyamon → árfolyamveszteség", () => {
    const r = buildPaymentPosting(
      { direction: "in", partnerId: 1, invoiceNumber: "X", currency: "EUR", amountFx: 1000, payRate: 405, invoiceRate: 400 },
      { partnerAccountId: 455, moneyAccountId: 384, fxGainId: 976, fxLossId: 876 },
    );
    expect(r.fxDiff).toBe(-5000);
    expect(sumBy(r.lines, 876)).toBe(5000);
    expect(sumBy(r.lines, 455)).toBe(400000);
    expect(sumBy(r.lines, 384)).toBe(-405000);
  });

  it("vevő befizetés teljes rendezéskor a nyitott HUF egyenleget vezeti ki", () => {
    const r = buildPaymentPosting(
      { direction: "out", partnerId: 1, invoiceNumber: "X", currency: "EUR", amountFx: 100, payRate: 401, invoiceRate: 400, remainingHufIfSettles: 40001 },
      { partnerAccountId: 316, moneyAccountId: 384, fxGainId: 976, fxLossId: 876 },
    );
    expect(sumBy(r.lines, 316)).toBe(-40001);
    expect(sumBy(r.lines, 976)).toBe(-99);
  });
});

describe("storno", () => {
  it("negatív összegű, egyensúlyban marad", () => {
    const lines = [
      { accountId: 1, debit: 100, credit: 0 },
      { accountId: 2, debit: 0, credit: 100 },
    ];
    const s = stornoLines(lines);
    expect(s[0].debit).toBe(-100);
    expect(() => assertBalanced(s)).not.toThrow();
  });
});
