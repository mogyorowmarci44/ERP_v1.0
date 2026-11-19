import { describe, expect, it } from "vitest";
import { arsugo, pricePoint, roundUpTo99k } from "@/lib/arsugo";

describe("ÁrSugó – kerekítés", () => {
  it("felfelé a következő, ezresekben 99-re végződő árra", () => {
    expect(roundUpTo99k(4_083_450)).toBe(4_099_000);
    expect(roundUpTo99k(4_099_000)).toBe(4_099_000);
    expect(roundUpTo99k(4_099_001)).toBe(4_199_000);
    expect(roundUpTo99k(950)).toBe(99_000);
  });
});

describe("ÁrSugó – különbözeti vétel és eladás (alapeset)", () => {
  const r = arsugo({ buy: 3_000_000, buyMode: "margin", sellMode: "margin", costs: 400_000, target: 300_000 });
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
  it("hirdetési = cél + 5%, 99-re kerekítve", () => {
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
