import { describe, expect, it } from "vitest";
import { depreciationPlan, accDepAccount, isAssetAccount, monthEndOf } from "../src/lib/asset-plan";

const base = { salvage: 0, taxRatePct: null, method: "linear", disposedOn: null, openingAccumulated: 0, openingTaxAccumulated: 0 };

describe("depreciationPlan", () => {
  it("MacBook: 3 év, napi arányosítás, pontosan a bekerülési értékig", () => {
    const p = depreciationPlan({ ...base, activationDate: "2026-10-28", cost: 236220, usefulLifeMonths: 36 });
    expect(p[0].period).toBe("2026-10");
    expect(p[0].amount).toBe(862); // 4 nap / 1096 nap
    expect(p[1].amount).toBeGreaterThan(6400);
    expect(p[1].amount).toBeLessThan(6700);
    expect(p.at(-1)!.period).toBe("2029-10");
    expect(p.reduce((s, r) => s + r.amount, 0)).toBe(236220);
    expect(p.every((r) => r.amount === r.taxAmount)).toBe(true);
  });

  it("maradványérték nélkül nem ír le többet, maradvánnyal annyival kevesebbet", () => {
    const p = depreciationPlan({ ...base, activationDate: "2026-01-01", cost: 1_200_000, salvage: 200_000, usefulLifeMonths: 60 });
    expect(p.reduce((s, r) => s + r.amount, 0)).toBe(1_000_000);
    expect(p).toHaveLength(60);
  });

  it("eltérő adótörvényi kulcs: 33%/év, a bekerülési értékig", () => {
    const p = depreciationPlan({ ...base, activationDate: "2026-01-01", cost: 300_000, usefulLifeMonths: 60, taxRatePct: 33 });
    expect(p.reduce((s, r) => s + r.taxAmount, 0)).toBe(300_000);
    expect(p.reduce((s, r) => s + r.amount, 0)).toBe(300_000);
    const y1 = p.filter((r) => r.period.startsWith("2026-"));
    expect(y1.reduce((s, r) => s + r.taxAmount, 0)).toBe(99_000);
    expect(Math.abs(y1.reduce((s, r) => s + r.amount, 0) - 60_000)).toBeLessThan(50); // 365/1826 nap (szökőév)
  });

  it("kisértékű: egy összegben az aktiválás hónapjában", () => {
    expect(depreciationPlan({ ...base, method: "lowvalue", activationDate: "2026-03-13", cost: 21295, usefulLifeMonths: 36 })).toEqual([
      { period: "2026-03", amount: 21295, taxAmount: 21295, cumAmount: 21295, cumTax: 21295 },
    ]);
  });

  it("nyitó ÉCS-t beszámítja (nem számol el kétszer)", () => {
    const full = depreciationPlan({ ...base, activationDate: "2025-01-01", cost: 120_000 * 3, usefulLifeMonths: 36 });
    const opened = depreciationPlan({ ...base, activationDate: "2025-01-01", cost: 120_000 * 3, usefulLifeMonths: 36, openingAccumulated: 120_000 });
    expect(opened.reduce((s, r) => s + r.amount, 0)).toBe(240_000);
    expect(opened.filter((r) => r.period.startsWith("2025-")).every((r) => r.amount === 0)).toBe(true);
    expect(full.reduce((s, r) => s + r.amount, 0)).toBe(360_000);
  });

  it("kivezetéskor a kivezetés napjáig számol", () => {
    const p = depreciationPlan({ ...base, activationDate: "2026-01-01", cost: 365_000, usefulLifeMonths: 12, disposedOn: "2026-06-30" });
    expect(p.at(-1)!.period).toBe("2026-06");
    expect(p.reduce((s, r) => s + r.amount, 0)).toBe(181_000);
  });
});

describe("segédek", () => {
  it("halmozott ÉCS számla és eszközszámla felismerés", () => {
    expect(accDepAccount("143")).toBe("149");
    expect(accDepAccount("115")).toBe("119");
    expect(isAssetAccount("141")).toBe(true);
    expect(isAssetAccount("149")).toBe(false);
    expect(isAssetAccount("121")).toBe(false);
    expect(monthEndOf("2028-02")).toBe("2028-02-29");
  });
});
