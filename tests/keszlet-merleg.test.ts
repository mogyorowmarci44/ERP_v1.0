import { describe, expect, it } from "vitest";
import { soldView, stockView, type KmCar } from "@/lib/keszlet-merleg-calc";
import type { MerlegInput } from "@/lib/auto-merleg-calc";

const base = (o: Partial<MerlegInput>): MerlegInput => ({
  today: "2026-11-20", buyMode: "margin", sellMode: "margin", buy: 3_000_000, purchaseDate: "2026-10-01",
  costs: [{ label: "Fényezés", date: null, amount: 300_000 }], epr: null, sale: null, plan: null,
  holding: { ratePct: 8, fixPerDay: 250 }, target: 300_000, peers: { label: "x", count: 0, medF2: null, medDays: null }, ...o,
});
const car = (id: number, o: Partial<MerlegInput>, extra: Partial<KmCar> = {}): KmCar => ({ id, title: `Autó ${id}`, plate: null, input: base(o), saleDate: o.sale?.date ?? null, origin: "import", group: "Suzuki Swift", ...extra });

describe("KészletMérleg – készlet", () => {
  it("piros / sárga / zöld besorolás", () => {
    const v = stockView([
      car(1, { plan: { price: 3_300_000, date: null, costs: [] } }), // nullszaldó (~3,39 M) alatt → piros
      car(2, { plan: { price: 3_600_000, date: null, costs: [] } }), // nullszaldó fölött, cél (~3,79 M) alatt → sárga
      car(3, { plan: { price: 4_200_000, date: null, costs: [] } }), // cél fölött → zöld
    ]);
    expect(v.red.map((x) => x.id)).toEqual([1]);
    expect(v.yellow.map((x) => x.id)).toEqual([2]);
    expect(v.green.map((x) => x.id)).toEqual([3]);
    expect(v.totals.count).toBe(3);
    expect(v.totals.capital).toBe(3 * 3_300_000);
  });
  it("a nullszaldó közelében (redDays napon belül) is piros", () => {
    const v = stockView([car(1, { plan: { price: 3_420_000, date: null, costs: [] } })], 60);
    expect(v.rows[0].status).toBe("red");
  });
});

describe("KészletMérleg – eladott", () => {
  const sold = [
    car(1, { sale: { date: "2026-11-01", gross: 3_900_000, vat: 191_339 }, plan: { price: 4_000_000, date: null, costs: [{ label: "x", date: null, amount: 250_000 }] } }),
    car(2, { sale: { date: "2026-10-15", gross: 3_700_000, vat: 148_819 } }, { origin: "domestic", group: "Toyota Yaris" }),
  ];
  const v = soldView(sold, "origin");
  it("összesen, medián, rangsor", () => {
    expect(v.totals.count).toBe(2);
    expect(v.totals.f2).toBeCloseTo(v.rows.reduce((a, x) => a + x.r.f2, 0), 6);
    expect(v.top[0].r.perDayMargin!).toBeGreaterThanOrEqual(v.top[1].r.perDayMargin!);
  });
  it("„Hová folyt el”: terv + költségeltérés + áreltérés = tény (csak tervvel bíró autók)", () => {
    expect(v.leak.cars).toBe(1);
    expect(v.leak.without).toBe(1);
    expect(v.leak.costEffect).toBe(-50_000);
    expect(v.leak.planF2 + v.leak.costEffect + v.leak.priceEffect).toBeCloseTo(v.leak.actualF2, 6);
    expect(v.leak.priceEffect).toBeLessThan(0);
  });
  it("csoportosítás import / belföld", () => {
    expect(v.groups.map((g) => g.key).sort()).toEqual(["Belföld", "Import"]);
  });
});
