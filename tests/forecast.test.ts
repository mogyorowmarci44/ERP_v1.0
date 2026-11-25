import { describe, it, expect } from "vitest";
import { runForecast, calibrate, vatDueDate, applyScope, periodList, DEFAULT_FORECAST_SETTINGS, normalizeSettings, type FcOpening, type FcPlan, type FcItem, type FcMonth } from "@/lib/forecast";

const opening: FcOpening = {
  asOf: "2026-11-10", cash: 1_000_000, bank: 500_000, vatPayable: 0, fiscalYearStartMonth: 1, vatPeriod: "monthly", ytdPreTax: 0, ytdHipaBase: 0,
};
const settings = normalizeSettings({ ...DEFAULT_FORECAST_SETTINGS, horizonMonths: 12 });

const stockPlan: FcPlan = {
  id: 1, label: "Lancer", stock: { bookValue: 1_900_000, marginBase: 1_850_000 },
  sale: { date: "2026-12-05", price: 2_350_000, payment: "bank" }, costs: [],
};

describe("forecast – különbözeti ÁFA és eredmény", () => {
  it("autónként (eladási ár − beszerzési ár) × 27/127, ELÁBÉ = könyv szerinti érték", () => {
    const r = runForecast({ opening, plans: [stockPlan], items: [], settings }, "base");
    const s = r.sales[0];
    expect(s.marginVat).toBe(Math.round((500_000 * 27) / 127)); // 106 299
    expect(s.netRevenue).toBe(2_350_000 - 106_299);
    expect(s.cogs).toBe(1_900_000);
    const dec = r.months.find((m) => m.month === "2026-12")!;
    expect(dec.revenue).toBe(2_243_701);
    expect(dec.grossMargin).toBe(343_701);
    expect(dec.carsSold).toBe(1);
    // ÁFA befizetés január 20-án
    const jan = r.months.find((m) => m.month === "2027-01")!;
    expect(jan.vatPaid).toBe(106_299);
  });

  it("negatív különbözetnél az ÁFA 0, és nem csökkenti más autó ÁFA-ját", () => {
    const loss: FcPlan = { id: 2, label: "Veszteséges", stock: { bookValue: 1_000_000, marginBase: 1_000_000 }, sale: { date: "2026-12-10", price: 900_000, payment: "cash" }, costs: [] };
    const r = runForecast({ opening, plans: [stockPlan, loss], items: [], settings }, "base");
    expect(r.sales.find((s) => s.planId === 2)!.marginVat).toBe(0);
    expect(r.months.find((m) => m.month === "2026-12")!.marginVat).toBe(106_299);
  });

  it("rosszabb forgatókönyv: −5% ár, +30 nap csúszás → januári eladás, kevesebb ÁFA", () => {
    const r = runForecast({ opening, plans: [stockPlan], items: [], settings }, "pessimistic");
    const s = r.sales[0];
    expect(s.salePrice).toBe(Math.round(2_350_000 * 0.95));
    expect(s.saleDate).toBe("2027-01-04");
    expect(s.marginVat).toBe(Math.round(((2_232_500 - 1_850_000) * 27) / 127));
    expect(r.months.find((m) => m.month === "2027-01")!.carsSold).toBe(1);
  });

  it("tervezett beszerzés + aktivált költség: ELÁBÉ-ba kerül, a levonható ÁFA csökkenti a befizetést", () => {
    const plan: FcPlan = {
      id: 3, label: "Új Colt", purchase: { date: "2026-11-20", price: 800_000, payment: "cash" },
      sale: { date: "2027-01-15", price: 1_200_000, payment: "cash" },
      costs: [{ description: "Fényezés", date: "2026-12-01", net: 100_000, vatRate: 27, deductible: true, capitalize: true, payment: "cash" }],
    };
    const r = runForecast({ opening, plans: [plan], items: [], settings }, "base");
    const s = r.sales[0];
    expect(s.cogs).toBe(900_000);
    expect(s.marginVat).toBe(Math.round((400_000 * 27) / 127));
    expect(r.months.find((m) => m.month === "2026-12")!.inputVat).toBe(27_000);
    const nov = r.months.find((m) => m.month === "2026-11")!;
    expect(nov.endCash).toBe(200_000);
  });

  it("ismétlődő költség havonta, ÁFA-val; a pénzáramlás jelzi a mínuszt", () => {
    const items: FcItem[] = [{ id: 1, category: "expense", description: "Könyvelés", accountCode: "529", net: 50_000, vatRate: 27, deductible: true, frequency: "monthly", startDate: "2026-11-15", payment: "bank" }];
    const r = runForecast({ opening: { ...opening, bank: 100_000 }, plans: [], items, settings }, "base");
    expect(r.months[0].fixedCosts).toBe(50_000);
    expect(r.months[0].inputVat).toBe(13_500);
    expect(r.months[1].endBank).toBe(100_000 - 2 * 63_500);
    expect(r.warnings.some((w) => w.includes("bankszámla mínuszba"))).toBe(true);
  });

  it("éves TAO + HIPA becslés a tény + terv eredményből, befizetés május 31-én", () => {
    const r = runForecast({ opening: { ...opening, ytdPreTax: 1_000_000, ytdHipaBase: 3_000_000 }, plans: [stockPlan], items: [], settings }, "base");
    const y = r.years.find((x) => x.year === "2026")!;
    const hipa = Math.round((3_000_000 + 343_701) * 0.02);
    expect(y.hipa).toBe(hipa);
    expect(y.preTax).toBe(1_000_000 + 343_701 - hipa);
    expect(y.tao).toBe(Math.round(y.preTax * 0.09));
    expect(y.payDate).toBe("2027-05-31");
    expect(r.months.find((m) => m.month === "2027-05")!.taxPaid).toBe(y.tao + y.hipa);
  });
});

describe("forecast – HIPA-mentesség", () => {
  it("a mentességi határ (alap: 2,5 M Ft) alatti adóalapnál nincs HIPA", () => {
    const r = runForecast({ opening: { ...opening, ytdPreTax: -2_000_000, ytdHipaBase: 1_500_000 }, plans: [stockPlan], items: [], settings }, "base");
    const y = r.years.find((x) => x.year === "2026")!;
    expect(y.hipaBase).toBe(1_843_701);
    expect(y.hipaExempt).toBe(true);
    expect(y.hipa).toBe(0);
  });
  it("veszteség mellett is van HIPA, ha az adóalap a határ felett van (az alap nem az eredmény)", () => {
    const r = runForecast({ opening: { ...opening, ytdPreTax: -2_000_000, ytdHipaBase: 4_000_000 }, plans: [stockPlan], items: [], settings }, "base");
    const y = r.years.find((x) => x.year === "2026")!;
    expect(y.preTax).toBeLessThan(0);
    expect(y.hipa).toBe(Math.round((4_000_000 + 343_701) * 0.02));
    expect(y.tao).toBe(0);
  });
  it("0 = nincs mentesség", () => {
    const s0 = normalizeSettings({ ...settings, hipaExemptBelow: 0 });
    const r = runForecast({ opening: { ...opening, ytdHipaBase: 100_000 }, plans: [stockPlan], items: [], settings: s0 }, "base");
    expect(r.years.find((x) => x.year === "2026")!.hipa).toBe(Math.round((100_000 + 343_701) * 0.02));
  });
});

describe("forecast – TAO és HIPA a közös számolóval", () => {
  it("telephely-szabály és elhatárolt veszteség", () => {
    const tax = { hipaSites: [{ name: "Mór", role: "seat" as const, share: 1, rule: { name: "Mór", rate: 0.02, exemptBelow: 2_500_000, exemptInclusive: false } }], losses: [{ year: "2025", amount: 10_000_000 }] };
    const r = runForecast({ opening: { ...opening, ytdPreTax: 2_000_000, ytdHipaBase: 2_000_000, tax }, plans: [stockPlan], items: [], settings }, "base");
    const y = r.years.find((x) => x.year === "2026")!;
    expect(y.hipa).toBe(0); // 2 343 701 < 2,5 M → mentes
    expect(y.preTax).toBe(2_343_701);
    expect(y.tao).toBe(Math.round(Math.round(2_343_701 * 0.5) * 0.09)); // a veszteség az alap felét viszi
  });
});

describe("forecast – nyitott tételek", () => {
  it("a nyitott szállítói számla esedékességkor csökkenti a bankot, a lejárt ma", () => {
    const r = runForecast({ opening: { ...opening, openItems: [
      { date: "2026-11-18", amount: -74_676, channel: "bank", label: "Szállító" },
      { date: "2026-10-01", amount: 100_000, channel: "bank", label: "Vevő (lejárt)" },
    ] }, plans: [], items: [], settings }, "base");
    expect(r.months[0].endBank).toBe(500_000 - 74_676 + 100_000);
  });
});

describe("forecast – heti / havi / negyedéves bontás", () => {
  it("az összesítések bontástól függetlenek, a kulcsok helyesek", () => {
    const items: FcItem[] = [{ id: 1, category: "expense", description: "Könyvelés", net: 50_000, vatRate: 27, deductible: true, frequency: "monthly", startDate: "2026-11-15", payment: "bank" }];
    const inp = { opening, plans: [stockPlan], items, settings };
    const m = runForecast(inp, "base", "month"), w = runForecast(inp, "base", "week"), q = runForecast(inp, "base", "quarter");
    for (const r of [w, q]) {
      expect(r.totals.preTax).toBe(m.totals.preTax);
      expect(r.totals.endBank).toBe(m.totals.endBank);
      expect(r.totals.minTotal).toBe(m.totals.minTotal);
    }
    expect(q.months[0].month).toBe("2026-Q4");
    expect(q.months.length).toBe(5); // 2026 Q4 … 2027 Q4 (a horizont okt. végéig tart)
    expect(w.months[0].month).toBe("2026-11-09"); // a 2026.11.10-i hét hétfője
    expect(w.months.find((x) => x.carsSold === 1)!.month).toBe("2026-11-30"); // 12.05. eladás → a nov. 30-i héten
  });
});

describe("forecast – tény + terv hatókör", () => {
  it("a folyó hónap tény + terv, a korábbi hónapok tény, az összesítés a kettő összege", () => {
    const r = runForecast({ opening, plans: [stockPlan], items: [], settings }, "base", "month");
    const actual: FcMonth[] = periodList("2026-01-01", "2026-11-10", "month").map((p) => ({
      month: p.key, label: p.label, start: p.start, end: p.end, kind: "actual", revenue: 100, cogs: 60, grossMargin: 40, vehicleCosts: 0, fixedCosts: 10, preTax: 30,
      salesGross: 0, carsSold: 1, marginVat: 5, inputVat: 2, vatBalance: 3, vatPaid: 0, taxPaid: 0, cashIn: 0, cashOut: 0, endCash: 1_000_000, endBank: 500_000,
      minCash: 900_000, minBank: 400_000, minCashDate: p.start, minBankDate: p.start, minTotal: 1_300_000, minTotalDate: p.start,
    }));
    const s = applyScope(r, actual, { from: "2026-01-01", to: "2026-12-31" });
    expect(s.months.length).toBe(12);
    expect(s.months[0].kind).toBe("actual");
    expect(s.months[10].kind).toBe("mixed");
    expect(s.months[11].kind).toBe("forecast");
    expect(s.months[10].carsSold).toBe(1); // a novemberi tény
    expect(s.totals.preTax).toBe(11 * 30 + r.months.filter((m) => m.start <= "2026-12-31").reduce((a, m) => a + m.preTax, 0));
    expect(s.totals.carsSold).toBe(11 + 1);
  });
});

describe("forecast – segédek", () => {
  it("ÁFA esedékesség", () => {
    expect(vatDueDate("2026-11-10", "monthly")).toBe("2026-12-20");
    expect(vatDueDate("2026-11-10", "quarterly")).toBe("2027-01-20");
    expect(vatDueDate("2026-11-10", "yearly")).toBe("2027-02-25");
  });
  it("kalibrálás: kevés adatnál nem változtat, elég adatnál negyedek alapján", () => {
    expect(calibrate([{ holdingDays: 30, markup: 1.2 }], settings).used).toBe(false);
    const h = Array.from({ length: 20 }, (_, i) => ({ holdingDays: 10 + i * 5, markup: 1.05 + i * 0.01 }));
    const c = calibrate(h, settings);
    expect(c.used).toBe(true);
    expect(c.settings.pessimistic.priceAdj).toBeLessThan(0);
    expect(c.settings.pessimistic.dateShiftDays).toBeGreaterThan(0);
    expect(c.settings.optimistic.priceAdj).toBeGreaterThan(0);
    expect(c.settings.optimistic.dateShiftDays).toBeLessThan(0);
  });
});

describe("forecast – fizetés napja (bér, járulék)", () => {
  it("payDate: köv. hónap adott napja, hónap végére igazítva", async () => {
    const { payDate } = await import("@/lib/forecast");
    expect(payDate("2026-11-30", 10)).toBe("2026-12-10");
    expect(payDate("2026-12-31", 12)).toBe("2027-01-12");
    expect(payDate("2026-01-31", 31)).toBe("2026-02-28");
    expect(payDate("2026-11-20", null)).toBe("2026-11-20");
  });
  it("a költség a tárgyhónapban, a pénz a következő hónapban mozdul", () => {
    const wage: FcItem = { id: 9, category: "expense", description: "bér", net: 300_000, vatRate: 0, deductible: true, frequency: "once", startDate: "2026-11-30", payment: "bank", payDay: 10 };
    const r = runForecast({ opening, plans: [], items: [wage], settings }, "base");
    const nov = r.months.find((m: FcMonth) => m.month === "2026-11")!;
    const dec = r.months.find((m: FcMonth) => m.month === "2026-12")!;
    expect(nov.fixedCosts).toBe(300_000);
    expect(nov.cashOut).toBe(0);
    expect(dec.cashOut).toBe(300_000);
  });
});

describe("v4.5.2 – EPR díj a nettó fedezetben", () => {
  it("az EPR díj csökkenti a nettó fedezetet és az eredményt, a HIPA-alapot nem; befizetés a negyedévet követő hó 20-án", () => {
    const base = runForecast({ opening, plans: [stockPlan], items: [], settings }, "base");
    const r = runForecast({ opening, plans: [{ ...stockPlan, epr: 60_000 }], items: [], settings }, "base");
    const s = r.sales[0];
    expect(s.epr).toBe(60_000);
    expect(s.grossMargin).toBe(343_701);
    expect(s.netMargin).toBe(283_701);
    const dec = r.months.find((m) => m.month === "2026-12")!;
    expect(dec.vehicleCosts).toBe(60_000);
    expect(dec.preTax).toBe(base.months.find((m) => m.month === "2026-12")!.preTax - 60_000);
    expect(r.years[0].hipaBase).toBe(base.years[0].hipaBase);
    // 2026. Q4 → 2027-01-20, bankból
    const jan = r.months.find((m) => m.month === "2027-01")!;
    const janBase = base.months.find((m) => m.month === "2027-01")!;
    expect(jan.endBank).toBe(janBase.endBank - 60_000);
    expect(dec.endBank).toBe(base.months.find((m) => m.month === "2026-12")!.endBank);
  });

  it("EPR nélkül (belföldi autó) a nettó fedezet = bruttó fedezet", () => {
    const r = runForecast({ opening, plans: [stockPlan], items: [], settings }, "base");
    expect(r.sales[0].epr).toBe(0);
    expect(r.sales[0].netMargin).toBe(r.sales[0].grossMargin);
  });
});
