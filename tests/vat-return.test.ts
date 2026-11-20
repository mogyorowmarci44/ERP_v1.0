import { describe, expect, it } from "vitest";
import { parseAnyk, buildAnykXml } from "@/lib/anyk";
import { buildVatSheets, computeVatReturn, fieldOf, marginBase, rowsFromFields, selfRevisionSurcharge, surchargeBase, type VatLine } from "@/lib/vat-return";

const L = (x: Partial<VatLine>): VatLine => ({
  direction: "in", kind: "normal", rate: 27, net: 0, vat: 0, gross: 0, marginPurchase: null,
  invoiceNumber: "X", fulfillmentDate: "2026-09-10", partnerName: "Partner Kft.", partnerTax: "12345678-2-42", ...x,
});

// 2026. szeptember (a PezCar könyvelése szerint): két autó különbözeti adózással + 27%-os beszerzések
const SEPT: VatLine[] = [
  L({ direction: "out", kind: "margin", net: 931263, vat: 68737, gross: 1000000, marginPurchase: 676682.1, invoiceNumber: "2203393", partnerName: "Magánszemély", partnerTax: null }),
  L({ direction: "out", kind: "margin", net: 1379921, vat: 170079, gross: 1550000, marginPurchase: 750000, invoiceNumber: "2203394", partnerName: "Magánszemély", partnerTax: null }),
  L({ net: 68067, vat: 18378, invoiceNumber: "6TM6-015690", partnerName: "Bárdi Autó Zrt.", partnerTax: "12229132" }),
  L({ net: 1161, vat: 313, invoiceNumber: "6TM6-015691", partnerName: "Bárdi Autó Zrt.", partnerTax: "12229132" }),
  L({ net: 86980, vat: 23485, invoiceNumber: "E-1", partnerName: "B-Konvoj Kft.", partnerTax: "11111111-2-11" }),
  L({ kind: "non_deductible", net: 330486, vat: 89233, invoiceNumber: "NL-1" }),
  L({ kind: "out_of_scope", rate: 0, net: 445860, vat: 0, invoiceNumber: "TAH-1" }),
  L({ kind: "margin", net: 1439519, vat: 0, gross: 1439519, invoiceNumber: "AUTO-BE", partnerTax: null }),
];

describe("különbözeti adózás", () => {
  it("adóalap = (bruttó − beszerzési ár) adó nélkül; negatív árrés 0", () => {
    expect(marginBase({ gross: 1000000, vat: 68737, marginPurchase: 676682.1, rate: 27 })).toBeCloseTo(254580.9, 1);
    expect(marginBase({ gross: 180000, vat: 0, marginPurchase: 290000, rate: 27 })).toBe(0);
  });
});

describe("bevallás sorai az ERP-ből", () => {
  const c = computeVatReturn(SEPT, 0);
  it("a különbözeti adó a 09. sorba, kiemelve az 50. sorban – nem a 07-be", () => {
    expect(c.rows["09"]).toEqual({ b: 885, c: 239 });
    expect(c.rows["50"]).toEqual({ b: 885, c: 239 });
    expect(c.rows["07"]).toBeUndefined();
  });
  it("levonható 27% a 66. sorba; nem levonható, TAH, autó-beszerzés kimarad", () => {
    expect(c.rows["66"]).toEqual({ b: 156, c: 42 });
    expect(c.rows["76"]).toEqual({ b: 156, c: 42 });
  });
  it("36., 83., 84. sor", () => {
    expect(c.rows["36"]).toEqual({ b: 885, c: 239 });
    expect(c.rows["83"]?.c).toBe(197);
    expect(c.rows["84"]?.c).toBe(197);
    expect(c.rows["86"]).toBeUndefined();
  });
  it("előző időszakról áthozott követelés", () => {
    const x = computeVatReturn(SEPT, 250);
    expect(x.rows["82"]?.c).toBe(250);
    expect(x.rows["83"]?.c).toBe(-53);
    expect(x.rows["86"]?.c).toBe(53);
    expect(x.rows["84"]).toBeUndefined();
  });
  it("M-lap partnerenként, számlánként forintban; 105. sor összesítő", () => {
    expect(Object.fromEntries(c.partners.map((p) => [p.tax8, p.invoices.length]))).toEqual({ "12229132": 2, "11111111": 1 });
    const b = c.partners.find((p) => p.tax8 === "12229132")!;
    expect(b.invoices[0]).toEqual({ number: "6TM6-015690", date: "2026-09-10", base: 68067, vat: 18378, deducted: 18378 });
    expect(c.rows["105"]).toMatchObject({ b: 2, c: 3 });
  });
  it("adószám nélküli levonható számla → figyelmeztetés", () => {
    const x = computeVatReturn([L({ net: 1000, vat: 270, partnerTax: null, partnerName: "Valaki Bt." })], 0);
    expect(x.partners).toEqual([]);
    expect(x.warnings.join(" ")).toMatch(/adószám nélküli/);
  });
});

describe("önellenőrzési pótlék", () => {
  it("alapkamat/365 naponta, a határidőt követő naptól; kamatváltozásnál szakaszolva", () => {
    // 100 000 Ft, 2026-08-20 határidő → 08-21..08-25 (5 nap, 5,75%) + 08-26..08-31 (6 nap, 5,5%)
    const s = selfRevisionSurcharge(100000, "2026-08-20", "2026-08-31", false);
    expect(s.days).toBe(11);
    expect(s.parts.map((p) => [p.days, p.pct])).toEqual([[5, 5.75], [6, 5.5]]);
    expect(s.amount).toBe(Math.round(15.753 * 5 + 15.068 * 6));
  });
  it("ismételt önellenőrzés: másfélszeres", () => {
    const a = selfRevisionSurcharge(100000, "2026-09-21", "2026-11-20", false).amount;
    const b = selfRevisionSurcharge(100000, "2026-09-21", "2026-11-20", true).amount;
    expect(b).toBeGreaterThan(a * 1.49);
    expect(b).toBeLessThan(a * 1.51);
  });
  it("határidő előtt nincs pótlék", () => {
    expect(selfRevisionSurcharge(100000, "2026-11-20", "2026-11-20", false).amount).toBe(0);
  });
  it("pótlékalap: befizetendő növekedése; átvihetőből befizetendő; göngyölítés korlátja", () => {
    expect(surchargeBase({ "36": { b: 0, c: 100 }, "76": { b: 0, c: 30 }, "84": { b: null, c: 70 } }, { "36": { b: 0, c: 150 }, "76": { b: 0, c: 30 }, "84": { b: null, c: 120 } }).base).toBe(50);
    expect(surchargeBase({ "36": { b: 0, c: 10 }, "76": { b: 0, c: 24 }, "86": { b: null, c: 14 } }, { "36": { b: 0, c: 117 }, "76": { b: 0, c: 11 }, "84": { b: null, c: 106 } }).base).toBe(120);
    // csak az áthozott követelés csökkent (előző hónap miatt) → nincs saját pótlékalap
    const g = surchargeBase({ "36": { b: 0, c: 100 }, "76": { b: 0, c: 30 }, "82": { b: null, c: 50 }, "84": { b: null, c: 20 } }, { "36": { b: 0, c: 100 }, "76": { b: 0, c: 30 }, "82": { b: null, c: 10 }, "84": { b: null, c: 60 } });
    expect(g).toMatchObject({ base: 0, rule: 40, chainReduced: true, increase: 40 });
  });
});

describe("ÁNYK-lapok", () => {
  const base: Record<string, string> = {
    "0_0A0001E001A": "32811902207", "0_0A0001E007A": "Teszt Kft.", "0_0A0001E008A": "Ügyintéző", "0_0A0001F005A": "", "0_0A0001F006A": "H",
    "0_0A0001G001A": "11600006", "0_0A0001I001A": "Mór", "0_0B0001C0007BA": "884", "0_0B0001C0007CA": "239", "0_0D0001D0084CA": "178", "0_29999": "számított",
  };
  const c = computeVatReturn(SEPT, 0);
  const prev = rowsFromFields({ ...base, "0_0B0001C0036BA": "884", "0_0B0001C0036CA": "239", "0_0C0001C0066BA": "225", "0_0C0001C0066CA": "61", "0_0D0001C0076BA": "225", "0_0D0001C0076CA": "61", "0_0D0001D0083CA": "178" });
  it("beadott sorok visszaolvasása", () => {
    expect(prev["07"]).toEqual({ b: 884, c: 239 });
    expect(prev["84"]).toEqual({ b: null, c: 178 });
  });
  const sheets = buildVatSheets({
    form: "2665", from: "2026-09-01", to: "2026-09-30", taxNumber: "32811902-2-07", taxpayerName: "Teszt Kft.", baseFields: base, computed: c,
    selfRevision: { prev, repeated: false, baseK: 19, surchargeK: 0, increaseK: 19, decreaseK: 0, chainReduced: false }, signDate: "2026-11-20",
  });
  const f = sheets[0].fields;
  it("fejadatok az előző bevallásból, a régi sorok és számított mezők nélkül", () => {
    expect(f["0_0A0001E008A"]).toBe("Ügyintéző");
    expect(f["0_0A0001G001A"]).toBe("11600006");
    expect(f["0_0B0001C0007BA"]).toBeUndefined();
    expect(f["0_29999"]).toBeUndefined();
    expect(f["0_0A0001I002A"]).toBe("20261120");
  });
  it("önellenőrzés: jelleg O, 04. lap, 82–86 b = beadott, c = helyes", () => {
    expect(f["0_0A0001F005A"]).toBe("O");
    expect(f["0_0A0001F015A"]).toBe("1");
    expect(f[fieldOf("09", "B")]).toBe("885");
    expect(f[fieldOf("50", "C")]).toBe("239");
    expect(f[fieldOf("84", "B")]).toBe("178");
    expect(f[fieldOf("84", "C")]).toBe("197");
    expect(f["0_0J0001D0001CA"]).toBe("19");
    expect(f["0_0J0001D0003CA"]).toBe("19");
    expect(f["0_0J0001C001A"]).toBeUndefined();
  });
  it("M-lapok partnerenként; az XML visszaolvasható", () => {
    const m = sheets.filter((s) => s.id === "2665M");
    expect(m).toHaveLength(2);
    const b = m.find((s) => s.fields["0_0A0001C005A"] === "12229132")!.fields;
    expect(b["0_0BXXXXC0001AA"]).toBe("6TM6-015690");
    expect(b["0_0BXXXXC0001CA"]).toBe("68067");
    expect(b["0_0BXXXXC0037DA"]).toBe("18691");
    expect(b["0_0A0001E0004BA"]).toBe("2");
    expect(f["0_0A0001F021A"]).toBe("2");
    const back = parseAnyk(buildAnykXml({ taxNumber: "32811902207", taxpayerName: "Teszt Kft.", from: "2026-09-01", to: "2026-09-30", sheets }));
    expect(back.sheets.map((s) => s.id)).toEqual(["2665A", "2665M", "2665M"]);
  });
});

describe("részben levonható számla az M-lapon", () => {
  it("a számla teljes áfája megy az M-lapra, a levont rész az f3 oszlopba", () => {
    const c = computeVatReturn([
      L({ net: 25179, vat: 6798, invoiceNumber: "SZF000371/2026", partnerName: "Filep István E.V", partnerTax: "46178718" }),
      L({ kind: "non_deductible", net: 25179, vat: 6799, invoiceNumber: "SZF000371/2026", partnerName: "Filep István E.V", partnerTax: "46178718" }),
    ], 0);
    expect(c.partners[0].invoices[0]).toEqual({ number: "SZF000371/2026", date: "2026-09-10", base: 50358, vat: 13597, deducted: 6798 });
    expect(c.rows["66"]).toEqual({ b: 25, c: 7 });
    const sh = buildVatSheets({ form: "2665", from: "2026-10-01", to: "2026-10-31", taxNumber: "32811902207", taxpayerName: "X", baseFields: null, computed: c, selfRevision: null, signDate: "2026-11-20" });
    const m = sh[1].fields;
    expect(m["0_0BXXXXC0001DA"]).toBe("13597");
    expect(m["0_0BXXXXC0001HA"]).toBe("6798");
    expect(m["0_0A0001E0004GA"]).toBe("7");
  });
});
