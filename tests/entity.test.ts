import { describe, it, expect } from "vitest";
import { buildInvoicePosting } from "@/lib/posting";
import {
  PRIVATE_COA,
  PRIVATE_SETTINGS,
  PRIVATE_VAT_CODES,
  compareSzjaMethods,
  flatRateSchedule,
  lineDefaults,
  noInputVatDeduction,
  revenueAndCosts,
  taxProfileFromForm,
  vatExemptThreshold,
} from "@/lib/entity";
import { categorize } from "@/lib/cash-category";

const acc = { partnerAccountId: 455, inputVatId: 466, outputVatId: 467, inventoryId: 211, cogsId: 869 };
const sumBy = (ls: { accountId: number; debit: number; credit: number }[], id: number) =>
  ls.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0);

describe("v2.0 – magánszemély számlatükör", () => {
  it("a beállításokban hivatkozott összes számla létezik és könyvelhető", () => {
    const codes = new Set(PRIVATE_COA.map((r) => r[0]));
    for (const k of ["receivableDomestic", "receivableForeign", "payableDomestic", "payableForeign", "inputVat", "outputVat", "vatSettlement", "inventoryGoods", "cogs", "fxGain", "fxLoss", "roundingAccount"] as const) {
      expect(codes.has(PRIVATE_SETTINGS[k]), `${k}=${PRIVATE_SETTINGS[k]}`).toBe(true);
    }
    // az új sor alapértelmezései is léteznek
    const d = lineDefaults({ entityType: "private_taxpayer", taxProfile: null });
    expect(codes.has(d.outAcc) && codes.has(d.inAcc)).toBe(true);
    const vc = new Set(PRIVATE_VAT_CODES.map((v) => v.code));
    expect(vc.has(d.outVat) && vc.has(d.inVat)).toBe(true);
  });
  it("nincs duplikált számlaszám", () => {
    expect(new Set(PRIVATE_COA.map((r) => r[0])).size).toBe(PRIVATE_COA.length);
  });
  it("társaságnál a régi alapértelmezés marad", () => {
    expect(lineDefaults({ entityType: "company" })).toEqual({ outVat: "27", inVat: "27", outAcc: "913", inAcc: "523" });
    expect(noInputVatDeduction({ entityType: "company" })).toBe(false);
  });
});

describe("v2.0 – alanyi ÁFA-mentes könyvelés", () => {
  it("Airbnb jutalék fordított adózással: T 521 bruttó / K 467 ÁFA / K 455 nettó – nincs 466", () => {
    const r = buildInvoicePosting(
      {
        direction: "in", partnerId: 1, currency: "HUF", fxRate: 1, invoiceNumber: "AIRBNB-1",
        lines: [{ description: "Host service fee", quantity: 1, unitPrice: 10_000, vatRate: 27, vatKind: "reverse_charge", accountId: 521, vatCodeId: 5 }],
      },
      { ...acc, noInputVatDeduction: true },
    );
    expect(sumBy(r.lines, 521)).toBe(12_700);
    expect(sumBy(r.lines, 467)).toBe(-2_700);
    expect(sumBy(r.lines, 455)).toBe(-10_000);
    expect(sumBy(r.lines, 466)).toBe(0);
  });
  it("belföldi 27%-os beszerzés: az ÁFA a költség része", () => {
    const r = buildInvoicePosting(
      {
        direction: "in", partnerId: 1, currency: "HUF", fxRate: 1, invoiceNumber: "E-1",
        lines: [{ description: "Villany", quantity: 1, unitPrice: 20_000, vatRate: 27, vatKind: "normal", accountId: 522, vatCodeId: 1 }],
      },
      { ...acc, partnerAccountId: 454, noInputVatDeduction: true },
    );
    expect(sumBy(r.lines, 522)).toBe(25_400);
    expect(sumBy(r.lines, 466)).toBe(0);
    expect(sumBy(r.lines, 454)).toBe(-25_400);
  });
  it("flag nélkül a fordított adózás változatlan (T 466 / K 467)", () => {
    const r = buildInvoicePosting(
      {
        direction: "in", partnerId: 1, currency: "HUF", fxRate: 1, invoiceNumber: "X",
        lines: [{ description: "fee", quantity: 1, unitPrice: 10_000, vatRate: 27, vatKind: "reverse_charge", accountId: 521, vatCodeId: 5 }],
      },
      acc,
    );
    expect(sumBy(r.lines, 466)).toBe(2_700);
    expect(sumBy(r.lines, 521)).toBe(10_000);
  });
});

describe("v2.0 – adószámítás", () => {
  it("alanyi mentesség értékhatára", () => {
    expect(vatExemptThreshold(2025)).toBe(18_000_000);
    expect(vatExemptThreshold(2026)).toBe(20_000_000);
    expect(vatExemptThreshold(2027)).toBe(22_000_000);
    expect(vatExemptThreshold(2030)).toBe(24_000_000);
  });
  it("tételes átalányadó: 1 szoba × 38 400 Ft, negyedévente 9 600 Ft, a negyedévet követő hó 12-éig", () => {
    const s = flatRateSchedule(1, 38_400, 2026);
    expect(s.annual).toBe(38_400);
    expect(s.installments.map((i) => [i.due, i.amount])).toEqual([
      ["2026-04-12", 9_600], ["2026-07-12", 9_600], ["2026-10-12", 9_600], ["2027-01-12", 9_600],
    ]);
  });
  it("módszer-összehasonlítás", () => {
    const [flat, ratio, itemized] = compareSzjaMethods({ revenue: 2_000_000, costs: 600_000, rooms: 1, flatRatePerRoom: 38_400 });
    expect(flat.total).toBe(38_400);
    expect(ratio.income).toBe(1_800_000);
    expect(ratio.szja).toBe(270_000);
    expect(ratio.szocho).toBe(Math.round(1_800_000 * 0.89 * 0.13));
    expect(itemized.income).toBe(1_400_000);
  });
  it("bevétel/költség: kamat és nem realizált árfolyamveszteség nélkül", () => {
    const r = revenueAndCosts([
      { code: "911", periodDebit: 0, periodCredit: 500_000 },
      { code: "913", periodDebit: 0, periodCredit: 100_000 },
      { code: "972", periodDebit: 0, periodCredit: 1_000 },
      { code: "521", periodDebit: 75_000, periodCredit: 0 },
      { code: "877", periodDebit: 3_000, periodCredit: 0 },
      { code: "9", periodDebit: 0, periodCredit: 999 },
    ]);
    expect(r).toEqual({ revenue: 600_000, costs: 75_000 });
  });
  it("profil űrlapból", () => {
    const fd = new FormData();
    fd.set("szjaMethod", "flat_rate_room");
    fd.set("vatExemptField", "1");
    fd.set("vatExempt", "on");
    fd.set("rooms", "1");
    fd.set("beds", "4");
    fd.set("settlement", "Szigetvár");
    fd.set("ntakId", "MA22050104");
    fd.set("flatRatePerRoom", "38400");
    fd.set("channels", "Airbnb, Instagram, saját weboldal");
    expect(taxProfileFromForm(fd)).toMatchObject({ vatExempt: true, rooms: 1, beds: 4, settlement: "Szigetvár", ntakId: "MA22050104", channels: ["Airbnb", "Instagram", "saját weboldal"] });
    const off = new FormData();
    off.set("vatExemptField", "1");
    off.set("rooms", "1");
    expect(taxProfileFromForm(off).vatExempt).toBe(false);
  });
});

describe("v2.0 – pénzforgalmi kategóriák", () => {
  it("ellenszámla szerint", () => {
    expect(categorize(["316"])).toBe("revenue");
    expect(categorize(["455"])).toBe("expense");
    expect(categorize(["4192"])).toBe("private");
    expect(categorize(["463"])).toBe("tax");
    expect(categorize(["389"])).toBe("transfer");
    expect(categorize([])).toBe("transfer");
  });
});
