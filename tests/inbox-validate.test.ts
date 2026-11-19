import { describe, expect, it } from "vitest";
import type { ExtractedDoc } from "@/db/schema";
import { bankMatch, huTaxNumberProblem, isPaperDoc, nextFilingNo, validateExtracted } from "@/lib/inbox/validate";

const doc = (o: Partial<ExtractedDoc> = {}): ExtractedDoc => ({
  docType: "invoice", direction: "in",
  seller: { name: "Magyar Telekom Nyrt.", taxNumber: "10773381-2-44" },
  invoiceNumber: "A-1", issueDate: "2026-11-10", fulfillmentDate: "2026-11-10", currency: "HUF",
  lines: [{ description: "Előfizetés", net: 10000, vatRate: 27, vat: 2700, gross: 12700 }],
  totals: { net: 10000, vat: 2700, gross: 12700 },
  ...o,
});
const ctx = { today: "2026-11-19" };

describe("magyar adószám", () => {
  it("elfogadja az érvényeset", () => {
    expect(huTaxNumberProblem("10773381-2-44")).toBeNull();
    expect(huTaxNumberProblem("10625790-4-44")).toBeNull();
    expect(huTaxNumberProblem("HU10773381")).toBeNull();
  });
  it("kiszűri a CDV-hibát (egy elolvasott számjegy)", () => {
    expect(huTaxNumberProblem("10778381-2-44")).toMatch(/ellenőrző számjegy/);
  });
  it("kiszűri a rossz ÁFA- és megyekódot", () => {
    expect(huTaxNumberProblem("10773381-7-44")).toMatch(/ÁFA-kód/);
    expect(huTaxNumberProblem("10773381-2-45")).toMatch(/területi/);
  });
  it("a külföldi közösségi adószámot nem ellenőrzi", () => {
    expect(huTaxNumberProblem("DE123456789")).toBeNull();
  });
});

describe("validateExtracted", () => {
  it("rendben lévő számlán nincs probléma", () => {
    expect(validateExtracted(doc(), ctx)).toEqual([]);
  });
  it("ÁFA ≠ nettó × kulcs", () => {
    const x = doc({ lines: [{ description: "Alkatrész", net: 10000, vatRate: 27, vat: 2200, gross: 12200 }], totals: { net: 10000, vat: 2200, gross: 12200 } });
    expect(validateExtracted(x, ctx).some((i) => i.startsWith("ÁFA-ellenőrzés"))).toBe(true);
  });
  it("kerekítési eltérésre nem riaszt", () => {
    const x = doc({ lines: [{ description: "x", net: 3333, vatRate: 27, vat: 900, gross: 4233 }], totals: { net: 3333, vat: 900, gross: 4233 } });
    expect(validateExtracted(x, ctx)).toEqual([]);
  });
  it("különbözeti tételnél nincs ÁFA-matek", () => {
    const x = doc({ lines: [{ description: "Suzuki", net: 1500000, vatType: "KÜL", gross: 1500000 }], totals: { net: 1500000, vat: 0, gross: 1500000 } });
    expect(validateExtracted(x, ctx)).toEqual([]);
  });
  it("jövőbeli és gyanúsan régi dátum", () => {
    expect(validateExtracted(doc({ issueDate: "2026-12-30", fulfillmentDate: "2026-12-30" }), ctx).join(" ")).toMatch(/jövőbeli/);
    expect(validateExtracted(doc({ issueDate: "2020-11-10", fulfillmentDate: "2020-11-10" }), ctx).join(" ")).toMatch(/egy éves/);
  });
  it("lezárt hónap és bevallott ÁFA-időszak", () => {
    expect(validateExtracted(doc(), { ...ctx, lockedMonths: new Set(["2026-11"]) }).join(" ")).toMatch(/le van zárva/);
    expect(validateExtracted(doc({ issueDate: "2026-10-05", fulfillmentDate: "2026-10-05" }), { ...ctx, vatClosedUntil: "2026-10-31" }).join(" ")).toMatch(/be van vallva/);
  });
  it("magánszemély eladónál nem kér adószámot", () => {
    expect(validateExtracted(doc({ docType: "sale_contract", seller: { name: "Kiss Péter", privatePerson: true, taxNumber: "8412345678" } }), ctx)).toEqual([]);
  });
});

describe("iktatószám, papír, bank", () => {
  it("folyamatos sorszám évenként", () => {
    expect(nextFilingNo(2026, [])).toBe("P-2026-0001");
    expect(nextFilingNo(2026, ["P-2026-0009", null, "P-2025-0120", "P-2026-0010"])).toBe("P-2026-0011");
  });
  it("papír felismerése", () => {
    expect(isPaperDoc("image/jpeg", null)).toBe(true);
    expect(isPaperDoc("application/pdf", doc({ method: "ocr" }))).toBe(true);
    expect(isPaperDoc("application/pdf", doc({ method: "text" }))).toBe(false);
  });
  it("egyértelmű banki egyezés", () => {
    const rows = [{ date: "2026-11-12", amount: -12700, text: "TELEKOM" }, { date: "2026-11-12", amount: -5000, text: "x" }];
    expect(bankMatch(doc(), rows)?.text).toBe("TELEKOM");
    expect(bankMatch(doc(), [...rows, { date: "2026-11-13", amount: -12700, text: "másik" }])).toBeNull();
  });
});

describe("pecsét a digitális példányon", () => {
  it("PNG-ből és PDF-ből pecsételt PDF lesz, WEBP-nél null", async () => {
    const { stampDocument } = await import("@/lib/inbox/stamp");
    const { PDFDocument } = await import("pdf-lib");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const s = { filingNo: "P-2026-0007", binder: "2026-11 / 7. tétel" };
    const out = await stampDocument(png, "image/png", "szamla.png", s);
    expect(out).not.toBeNull();
    const pdf = await PDFDocument.load(out!);
    expect(pdf.getPageCount()).toBe(1);
    const again = await stampDocument(Buffer.from(out!).toString("base64"), "application/pdf", "x.pdf", s);
    expect(again).not.toBeNull();
    expect(await stampDocument(png, "image/webp", "x.webp", s)).toBeNull();
  });
});
