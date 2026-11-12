import { describe, expect, it } from "vitest";
import {
  Daily,
  addTaxes,
  bookingCode,
  breakEven,
  cfKey,
  constantRate,
  discountFactor,
  groupBy,
  isoWeek,
  kpis,
  nightsOf,
  paybackFlows,
  paybackSummary,
  periodKey,
  periodKeys,
  periodRange,
  pnlKey,
  pnlOf,
  prevPeriod,
  spread,
  sumRange,
} from "@/lib/gh-calc";

describe("időszakok", () => {
  it("ISO hét", () => {
    expect(isoWeek("2026-11-12")).toEqual({ year: 2026, week: 46 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
  });
  it("kulcsok és tartományok", () => {
    expect(periodKey("2026-11-12", "quarter")).toBe("2026-Q4");
    expect(periodRange("2026-W46", "week")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(periodRange("2025-W01", "week")).toEqual({ from: "2024-12-30", to: "2025-01-05" });
    expect(periodRange("2024-02", "month").to).toBe("2024-02-29");
    expect(periodRange("2026-Q1", "quarter")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(periodKeys("2026-01-15", "2026-04-02", "month")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(prevPeriod("2026-01", "month")).toBe("2025-12");
    expect(prevPeriod("2026-W01", "week")).toBe("2025-W52");
  });
});

describe("számlák és szövegek", () => {
  it("P&L és CF kategóriák", () => {
    expect(pnlKey("914")).toBe("rev_airbnb");
    expect(pnlKey("925")).toBe("rev_other");
    expect(pnlKey("977")).toBeNull();
    expect(pnlKey("5221")).toBe("c_firewood");
    expect(pnlKey("5222")).toBe("c_utilities");
    expect(pnlKey("514")).toBe("c_repair");
    expect(pnlKey("869")).toBe("c_other");
    expect(cfKey("1221")).toBe("inv_property");
    expect(cfKey("4631")).toBe("tax_paid");
  });
  it("szétosztás: tartózkodás, havi összesítő, egyszeri tétel", () => {
    expect(spread("2023-01-21", "Szállásdíj – X (2023-01-20–2023-01-22, 2 éj) [HMAAAA]")).toEqual({ from: "2023-01-20", days: 2, exact: true });
    expect(spread("2022-09-30", "Takarítás 2022. 09. havi díj")).toEqual({ from: "2022-09-01", days: 30, exact: false });
    expect(spread("2026-11-12", "Tűzifa 2026. 11.")).toEqual({ from: "2026-11-12", days: 1, exact: false });
    expect(spread("2024-12-01", "Villamosenergia 2024-11-02 – 2024-12-01")).toEqual({ from: "2024-11-02", days: 29, exact: true });
  });
  it("foglaláskód", () => {
    expect(bookingCode("Takarítási díj – X [HMHKN8S25A]")).toBe("HMHKN8S25A");
    expect(bookingCode("Airbnb szolgáltatási díj – foglalás HMHKN8S25A")).toBe("HMHKN8S25A");
    expect(bookingCode("Szállásdíj – Y (2026-01-01–2026-01-03, 2 éj) [KZ-20260101-AB12]")).toBe("KZ-20260101-AB12");
  });
  it("éjszakák", () => {
    expect(nightsOf("911", "Szállásdíj – X (2023-01-20–2023-01-23, 3 éj)", 1)).toEqual({ nights: 3, exact: true });
    expect(nightsOf("913", "közvetlen, 2023. 01. hó (2 éj, kb. × 24 000 Ft)", 47000)).toEqual({ nights: 2, exact: false });
    expect(nightsOf("912", "Booking havi nettó", 72000)).toEqual({ nights: 3, exact: false });
    expect(nightsOf("914", "Takarítási díj", 3000).nights).toBe(0);
    expect(nightsOf("911", "módosítás (2023-01-20–2023-01-23)", -500).nights).toBe(0);
  });
});

describe("eredmény, mutatók, adók", () => {
  it("P&L és mutatók", () => {
    const r = { rev_airbnb: 100000, rev_direct: 50000, c_commission: 15000, c_cleaning: 20000, c_utilities: 10000, c_marketing: 5000, n_airbnb: 4, n_direct: 2, t_flat: 3200, t_tfh_p: 4000, t_tfh_d: 2000 };
    const p = pnlOf(r, "platform");
    expect(p.netRevenue).toBe(135000);
    expect(p.contribution).toBe(115000);
    expect(p.operating).toBe(100000);
    expect(p.taxes).toBe(7200);
    expect(p.result).toBe(92800);
    const k = kpis(r, 30, "none");
    expect(k.occupancy).toBeCloseTo(0.2);
    expect(k.adr).toBe(25000);
    expect(k.revpar).toBe(5000);
    expect(k.commissionPct).toBe(0.15);
    expect(k.roas).toBe(10);
    const be = breakEven(k, 1);
    expect(be.fixedPerMonth).toBe(18200);
    expect(be.nightsPerMonth).toBeCloseTo(18200 / ((135000 - 20000) / 6));
  });
  it("számított adók: TFH felfüggesztés, tételes adó esedékessége", () => {
    const d = new Daily();
    d.add("2022-11-10", "rev_airbnb", 10000); // felfüggesztett hónap
    d.add("2023-05-10", "rev_direct", 10000);
    addTaxes(d, d.days(), { flatAnnual: 36500, ifaPerNight: null, ifaAvgGuests: null, activityStart: "2023-01-01", asOf: "2024-03-01" });
    const all = sumRange(d.days(), "2000-01-01", "2030-01-01");
    expect(all.t_tfh_p ?? 0).toBe(0);
    expect(all.t_tfh_d).toBe(400);
    expect(all.cf_t_tfh_d).toBe(-400); // 2024-02-25-én esedékes
    expect(sumRange(d.days(), "2023-04-12", "2023-04-12").cf_t_flat).toBeCloseTo(-9000, 0);
    expect(all.t_flat).toBeCloseTo(36500 + (61 * 36500) / 366, 0); // 2024 szökőév
  });
  it("csoportosítás", () => {
    const d = new Daily();
    d.addSpread("2026-01-30", 4, "rev_direct", 400);
    const g = groupBy(d.days(), "month", "2026-01-01", "2026-02-28");
    expect(g.get("2026-01")?.rev_direct).toBe(200);
    expect(g.get("2026-02")?.rev_direct).toBe(200);
  });
});

describe("megtérülés", () => {
  it("diszkontált összegzés és előrejelzés", () => {
    expect(discountFactor("2020-01-01", "2021-01-01", 0.1)).toBeCloseTo(1 / 1.1, 2);
    const d = new Daily();
    for (let m = 1; m <= 12; m++) d.add(`2025-${String(m).padStart(2, "0")}-15`, "cf_rev_direct", 100000);
    const df = constantRate("2025-01-01", 0);
    const f = paybackFlows(d.days(), "both", "2025-01-01", df);
    const s = paybackSummary(f, 2400000, df, "2025-12-31");
    expect(s.cumNominal).toBe(1200000);
    expect(s.recoveredPct).toBe(0.5);
    expect(s.projectedNominal).toBe("2026-12-31");
    const s2 = paybackSummary(f, 1000000, df, "2025-12-31");
    expect(s2.reachedDiscounted).toBe("2025-10-15");
  });
});

describe("KSH-infláció", () => {
  it("árszint-deflátor és előrejelzés", async () => {
    const { makeCpiDeflator, cumulativeInflation } = await import("@/lib/cpi");
    const df = makeCpiDeflator("2021-09-01");
    expect(df("2021-09-20")).toBe(1);
    expect(df("2021-10-15")).toBeCloseTo(1 / 1.011, 6);
    // 2022 teljes éve: dec./dec. ≈ 24,6%
    expect(cumulativeInflation("2021-12", "2022-12")).toBeCloseTo(0.246, 2);
    // előrejelzett hónap: 2027 havi szorzója (1,031)^(1/12)
    const a = makeCpiDeflator("2026-12-01")("2027-12-01");
    expect(1 / a).toBeCloseTo(1.031, 3);
  });
});

describe("ingatlan értékbecslés", () => {
  it("súlyozott terület, módszerek, IRR", async () => {
    const { valuate, weightedArea, irr, hpiFactorSince } = await import("@/lib/valuation");
    const p = { floorM2: 36, galleryM2: 12, terraceM2: 30, priceM2: 300000, capRate: 0.1 };
    expect(weightedArea(p)).toBe(52);
    expect(hpiFactorSince("2021-09-01")).toBeCloseTo(1.9283, 3);
    const v = valuate(p, 1_000_000, 10_000_000, "2021-09-01");
    expect(v.comparable).toBe(15_600_000);
    expect(v.income).toBe(10_000_000);
    expect(v.indexed).toBeCloseTo(19_283_000, -3);
    expect(v.value).toBeCloseTo(0.4 * 15.6e6 + 0.4 * 10e6 + 0.2 * 19.283e6, -3);
    expect(irr([{ date: "2020-01-01", amount: -100 }, { date: "2021-01-01", amount: 110 }])).toBeCloseTo(0.1, 2);
  });
});
