import { describe, it, expect } from "vitest";
import { computeLine, buildInvoicePosting, buildPaymentPosting, stornoLines, assertBalanced } from "@/lib/posting";
import { vatRateDate, parseMnbResponse } from "@/lib/fx";

const acc = { partnerAccountId: 311, inputVatId: 466, outputVatId: 467, inventoryId: 261, cogsId: 814 };
const sumBy = (ls: { accountId: number; debit: number; credit: number }[], id: number) =>
  ls.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0);

describe("vatRateDate (Áfa tv. 80. §, 63. §)", () => {
  const base = { issueDate: "2026-10-20", fulfillmentDate: "2026-10-15", periodic: false };
  it("általános: teljesítés napja", () => expect(vatRateDate({ ...base, vatKinds: ["normal"] }).date).toBe("2026-10-15"));
  it("időszakos: számla kelte", () => expect(vatRateDate({ ...base, periodic: true, vatKinds: ["normal"] }).date).toBe("2026-10-20"));
  it("KBB: számla kelte, ha a köv. hó 15. előtt", () => expect(vatRateDate({ ...base, vatKinds: ["eu_acquisition"] }).date).toBe("2026-10-20"));
  it("KBB: legkésőbb köv. hó 15.", () =>
    expect(vatRateDate({ issueDate: "2027-01-20", fulfillmentDate: "2026-12-02", periodic: false, vatKinds: ["eu_acquisition"] }).date).toBe("2027-01-15"));
});

describe("parseMnbResponse", () => {
  it("escape-elt SOAP válasz, unit=100 kezelése", () => {
    const xml = `<soap:Envelope><soap:Body><GetExchangeRatesResponse><GetExchangeRatesResult>&lt;MNBExchangeRates&gt;&lt;Day date="2026-11-06"&gt;&lt;Rate unit="1" curr="EUR"&gt;385,12&lt;/Rate&gt;&lt;Rate unit="100" curr="JPY"&gt;231,45&lt;/Rate&gt;&lt;/Day&gt;&lt;Day date="2026-11-09"&gt;&lt;Rate unit="1" curr="EUR"&gt;386,5&lt;/Rate&gt;&lt;/Day&gt;&lt;/MNBExchangeRates&gt;</GetExchangeRatesResult></GetExchangeRatesResponse></soap:Body></soap:Envelope>`;
    expect(parseMnbResponse(xml)).toEqual([
      { date: "2026-11-06", currency: "EUR", rate: 385.12 },
      { date: "2026-11-06", currency: "JPY", rate: 2.3145 },
      { date: "2026-11-09", currency: "EUR", rate: 386.5 },
    ]);
  });
});

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
  const acc455 = { partnerAccountId: 455, moneyAccountId: 384, fxGainId: 976, fxLossId: 876 };
  it("EUR szállító forintszámláról: ténylegesen terhelt Ft vs. MNB könyv szerinti érték → veszteség", () => {
    const r = buildPaymentPosting(
      { direction: "in", partnerId: 1, invoiceNumber: "X", currency: "EUR", amountFx: 1000, moneyHuf: 405000, partnerHuf: 400000, invoiceRate: 400 },
      acc455,
    );
    expect(r.fxDiff).toBe(-5000);
    expect(sumBy(r.lines, 876)).toBe(5000);
    expect(sumBy(r.lines, 455)).toBe(400000);
    expect(sumBy(r.lines, 384)).toBe(-405000);
  });

  it("vevő befizetés devizaszámlára MNB árfolyamon, teljes rendezés nyitott HUF egyenleggel", () => {
    const r = buildPaymentPosting(
      { direction: "out", partnerId: 1, invoiceNumber: "X", currency: "EUR", amountFx: 100, moneyHuf: 40100, moneyFx: { currency: "EUR", rate: 401 }, partnerHuf: 40001, invoiceRate: 400 },
      { partnerAccountId: 316, moneyAccountId: 3841, fxGainId: 976, fxLossId: 876 },
    );
    expect(sumBy(r.lines, 316)).toBe(-40001);
    expect(sumBy(r.lines, 976)).toBe(-99);
    expect(r.lines.find((l) => l.accountId === 3841)?.amountFx).toBe(100);
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

describe("nem levonható ÁFA", () => {
  it("a költség része, nincs 466 sor", () => {
    const r = buildInvoicePosting(
      { direction: "in", partnerId: 1, currency: "HUF", fxRate: 1, invoiceNumber: "NL-1",
        lines: [{ quantity: 1, unitPrice: 10000, vatRate: 27, vatKind: "non_deductible", description: "Alkatrész", accountId: 261, vatCodeId: 9, vehicleId: 3 }] },
      { ...acc, partnerAccountId: 454 },
    );
    expect(sumBy(r.lines, 261)).toBe(12700);
    expect(r.lines.find((l) => l.accountId === 466)).toBeUndefined();
    expect(sumBy(r.lines, 454)).toBe(-12700);
  });
});

describe("forintos kerekítés", () => {
  it("HUF számlán a végösszeg egész forint, nem marad fillér nyitva", () => {
    const a = computeLine({ quantity: 1, unitPrice: 106315, vatRate: 27, vatKind: "normal" }, "out", 1);
    expect(a.vatHuf).toBe(28705);
    expect(a.payableFx).toBe(135020);
  });
});
