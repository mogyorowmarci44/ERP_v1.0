import { describe, expect, it } from "vitest";
import { autoMerleg, holdingPerDay, type MerlegInput } from "@/lib/auto-merleg-calc";

const base: MerlegInput = {
  today: "2026-11-20", buyMode: "margin", sellMode: "margin", buy: 2_900_000, purchaseDate: "2026-09-02",
  costs: [{ label: "Fényezés", date: "2026-09-10", amount: 220_000 }, { label: "Szerviz", date: "2026-09-14", amount: 85_000 }, { label: "Gumi", date: "2026-09-16", amount: 60_000 }],
  epr: 36_720, sale: null,
  plan: { price: 3_699_000, date: "2026-10-15", costs: [{ label: "Fényezés", date: null, amount: 200_000 }, { label: "Szerviz", date: null, amount: 80_000 }, { label: "Gumi", date: null, amount: 20_000 }] },
  holding: { ratePct: 8, fixPerDay: 250 }, target: 300_000,
  peers: { label: "Suzuki Swift", count: 5, medF2: 260_000, medDays: 41 },
};

describe("AutóMérleg – eladott autó (lezárt elszámolás)", () => {
  const r = autoMerleg({ ...base, sale: { date: "2026-10-28", gross: 3_690_000, vat: 167_953 } });
  it("Bruttó és nettó fedezet, napi fedezet", () => {
    expect(r.days).toBe(56);
    expect(r.f1).toBe(3_690_000 - 167_953 - 2_900_000);
    expect(r.f2).toBe(r.f1 - 365_000 - 36_720);
    expect(r.perDayMargin).toBeCloseTo(r.f2 / 56, 6);
  });
  it("a tartási költség becslés: a nettó fedezetet nem csökkenti", () => {
    expect(r.holding).toBe(holdingPerDay(2_900_000 + 365_000 + 36_720, base.holding) * 56);
    expect(r.f3).toBe(r.f2 - r.holding);
    expect(r.water.at(-1)).toMatchObject({ label: "Nettó fedezet", amount: r.f2 });
  });
  it("terv kontra tény és magyarázat", () => {
    const costs = r.rows.find((x) => x.label === "Költségek")!;
    expect(costs).toMatchObject({ plan: 300_000, actual: 365_000, diff: 65_000, good: false });
    expect(r.daysRow).toMatchObject({ plan: 43, actual: 56, diff: 13 });
    expect(r.why.some((w) => w.includes("65"))).toBe(true);
  });
});

describe("AutóMérleg – készleten (élő számok)", () => {
  const r = autoMerleg(base);
  it("a nullszaldó a tartási költséggel nő, és naponta 1,27 × napi költséggel kúszik", () => {
    const perDay = holdingPerDay(2_900_000 + 365_000 + 36_720, base.holding);
    expect(r.days).toBe(79);
    expect(r.holding).toBe(perDay * 79);
    expect(r.floor).toBe(Math.ceil(2_900_000 + (365_000 + 36_720 + perDay * 79) * 1.27 - 1e-6));
    expect(r.creep).toBeCloseTo(perDay * 1.27, 6);
  });
  it("a tervezett ár a cél alatt → figyelmeztetés, napok a nullszaldóig", () => {
    expect(r.priceSource).toBe("plan");
    expect(r.price).toBe(3_699_000);
    expect(r.warn).toBe(true);
    expect(r.daysToFloor).toBe(Math.floor((3_699_000 - r.floor) / r.creep));
  });
  it("terv nélkül az ÁrSugó javasolt ára, az állásidő terve a medián", () => {
    const n = autoMerleg({ ...base, plan: null });
    expect(n.priceSource).toBe("arsugo");
    expect(n.price).toBe(n.ask);
    expect(n.daysRow).toMatchObject({ plan: 41 });
  });
});
