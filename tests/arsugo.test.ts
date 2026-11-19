import { describe, expect, it } from "vitest";
import { arsugo, pricePoint, roundTo49or99k } from "@/lib/arsugo";

describe("ÁrSugó – kerekítés", () => {
  it("a legközelebbi, ezresekben 49-re vagy 99-re végződő árra, le vagy fel", () => {
    expect(roundTo49or99k(4_083_450)).toBe(4_099_000);
    expect(roundTo49or99k(3_600_450)).toBe(3_599_000);
    expect(roundTo49or99k(4_060_000)).toBe(4_049_000);
    expect(roundTo49or99k(4_049_000)).toBe(4_049_000);
    expect(roundTo49or99k(4_074_000)).toBe(4_099_000); // döntetlen → fel
  });
  it("a hirdetési ár nem kerülhet a padló alá", () => {
    const r = arsugo({ buy: 1_000, buyMode: "margin", sellMode: "margin", costs: 0, target: 0 });
    expect(r.ask.price).toBeGreaterThanOrEqual(r.floor.price);
    expect(r.ask.price).toBe(49_000);
  });
});

describe("ÁrSugó – különbözeti vétel és eladás (alapeset)", () => {
  const r = arsugo({ buy: 3_000_000, buyMode: "margin", sellMode: "margin", costs: 400_000, target: 300_000 });
  it("a piros zóna határa a beszerzési ár", () => {
    expect(r.buyCover).toBe(3_000_000);
  });
  it("padló = beszerzés + költség × 1,27, ott a fedezet 0", () => {
    expect(r.floor.price).toBe(3_508_000);
    expect(r.floor.vat).toBeCloseTo(108_000, 6);
    expect(r.floor.margin).toBeCloseTo(0, 6);
  });
  it("cél = beszerzés + (költség + célfedezet) × 1,27", () => {
    expect(r.goal.price).toBe(3_889_000);
    expect(r.goal.vat).toBeCloseTo(189_000, 6);
    expect(r.goal.margin).toBeCloseTo(300_000, 6);
  });
  it("hirdetési = cél + 5%, a legközelebbi …49 / …99 ezresre kerekítve", () => {
    expect(r.ask.price).toBe(4_099_000);
    expect(r.ask.margin).toBeGreaterThan(r.goal.margin);
  });
  it("negatív különbözetnél nincs ÁFA", () => {
    const p = pricePoint({ price: 2_900_000, buy: 3_000_000, buyBase: 3_000_000, costs: 0, sellMode: "margin" });
    expect(p.vat).toBe(0);
    expect(p.margin).toBe(-100_000);
  });
});

describe("ÁrSugó – normál ÁFA", () => {
  it("normál vétel: a bruttó árból levonható az ÁFA, normál eladás a nettóra 27%", () => {
    const r = arsugo({ buy: 2_540_000, buyMode: "normal", sellMode: "normal", costs: 400_000, target: 300_000 });
    expect(r.buyBase).toBeCloseTo(2_000_000, 6);
    expect(r.buyVat).toBeCloseTo(540_000, 6);
    expect(r.floor.price).toBe(3_048_000);
    expect(r.goal.price).toBe(3_429_000);
    expect(r.goal.margin).toBeCloseTo(300_000, 6);
    expect(r.buyCover).toBe(2_540_000);
  });
  it("különbözeti vétel, normál eladás: a teljes beszerzési ár bekerülés", () => {
    const r = arsugo({ buy: 3_000_000, buyMode: "margin", sellMode: "normal", costs: 400_000, target: 300_000 });
    expect(r.goal.price).toBe(4_699_000);
    expect(r.goal.margin).toBeCloseTo(300_000, 6);
  });
  it("normál vétel után nem lehet különbözeti eladás → normál ÁFÁ-val számol", () => {
    const r = arsugo({ buy: 2_540_000, buyMode: "normal", sellMode: "margin", costs: 0, target: 100_000 });
    expect(r.invalidCombo).toBe(true);
    expect(r.sellMode).toBe("normal");
  });
});

describe("ÁrSugó – célfedezet", () => {
  it("eladott autók nélkül a bekerülés 10%-a", () => {
    const r = arsugo({ buy: 3_000_000, buyMode: "margin", sellMode: "margin", costs: 400_000, target: null });
    expect(r.targetFromHistory).toBe(false);
    expect(r.target).toBe(340_000);
    expect(r.goal.margin).toBeCloseTo(340_000, 6);
  });
});

describe("ÁrSugó – EPR", () => {
  it("az EPR-díj a bekerülést növeli, a különbözeti ÁFA alapját nem", () => {
    const a = arsugo({ buy: 3_000_000, buyMode: "margin", sellMode: "margin", costs: 400_000, target: 300_000 });
    const b = arsugo({ buy: 3_000_000, buyMode: "margin", sellMode: "margin", costs: 400_000, fixed: 52_200, target: 300_000 });
    expect(b.totalCost - a.totalCost).toBe(52_200);
    expect(b.floor.margin).toBeCloseTo(0, 6);
    expect(b.goal.margin).toBeCloseTo(300_000, 6);
    expect(b.buyCover).toBe(3_000_000);
  });
});
