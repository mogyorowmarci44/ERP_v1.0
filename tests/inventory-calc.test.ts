import { describe, expect, it } from "vitest";
import { balanceAt, cogsInPeriod, valueMoves, type Move } from "../src/lib/inventory-calc";

const m = (key: string, date: string, kind: Move["kind"], quantity: number, value?: number): Move => ({ key, itemId: 1, date, kind, quantity, value });

describe("készlet csúsztatott átlagáron (v6.3.0)", () => {
  it("bevételezés, átlagár, kiadás átlagáron", () => {
    const r = valueMoves([
      m("1", "2026-01-05", "in", 10, 10_000), // 1000 Ft/db
      m("2", "2026-01-10", "in", 10, 14_000), // 1400 Ft/db → átlag 1200
      m("3", "2026-01-20", "out", 5),
    ]);
    expect(r.moves[2].valueDelta).toBe(-6_000);
    expect(r.balance).toEqual({ qty: 15, value: 18_000, avg: 1200 });
    expect(cogsInPeriod(r.moves, "2026-01-01", "2026-01-31")).toBe(6_000);
  });

  it("a sorrend dátum szerinti, nem rögzítés szerinti (visszadátumozott beszerzés)", () => {
    const r = valueMoves([m("9", "2026-02-10", "out", 2), m("1", "2026-02-01", "in", 4, 4_000)]);
    expect(r.moves[0].kind).toBe("in");
    expect(r.balance).toEqual({ qty: 2, value: 2_000, avg: 1000 });
  });

  it("nyitó készlet, leltári hiány és többlet", () => {
    const r = valueMoves([
      m("1", "2026-01-01", "opening", 100, 50_000),
      m("2", "2026-03-31", "adjust", -4), // hiány az átlagáron
      m("3", "2026-03-31", "adjust", 2, 1_200), // többlet megadott értéken
    ]);
    expect(r.moves[1].valueDelta).toBe(-2_000);
    expect(r.balance.qty).toBe(98);
    expect(r.balance.value).toBe(49_200);
  });

  it("visszáru vevőtől (negatív kiadás) az átlagáron jön vissza; kiürülésnél nincs maradék", () => {
    const r = valueMoves([m("1", "2026-01-01", "in", 3, 1_000), m("2", "2026-01-02", "out", 3), m("3", "2026-01-03", "in", 3, 999.99), m("4", "2026-01-04", "out", 1), m("5", "2026-01-05", "out", -1)]);
    expect(r.moves[1].balanceValue).toBe(0);
    expect(r.balance.qty).toBe(3);
    expect(r.balance.value).toBe(999.99);
    expect(cogsInPeriod(r.moves, "2026-01-04", "2026-01-05")).toBe(0);
  });

  it("időpontra vett egyenleg", () => {
    const r = valueMoves([m("1", "2026-01-01", "in", 2, 2_000), m("2", "2026-02-01", "in", 2, 6_000)]);
    expect(balanceAt(r.moves, "2026-01-31")).toEqual({ qty: 2, value: 2_000, avg: 1000 });
    expect(balanceAt(r.moves, "2025-12-31").qty).toBe(0);
  });
});
