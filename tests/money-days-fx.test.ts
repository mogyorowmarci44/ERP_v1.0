import { describe, expect, it } from "vitest";
import { netFxOf, shortFx, type MoneyDay } from "@/components/MoneyDays";

const line = (debit: number, credit: number, fx: number) => ({ id: 1, entryId: 1, number: "PE-1", text: "", partner: null, debit, credit, balance: 0, amountFx: fx });
describe("v4.3.1 – EUR-pénztár naptár devizában", () => {
  it("a nap nettó mozgása euróban, előjelesen", () => {
    const d: MoneyDay = { date: "2026-11-02", open: 0, inflow: 400_000, outflow: 120_000, close: 280_000, lines: [line(400_000, 0, 1000), line(0, 120_000, 300)] };
    expect(netFxOf(d)).toBe(700);
  });
  it("rövid forma: €, ezres e", () => {
    expect(shortFx(700, "EUR").replace(/ /g, " ")).toBe("+700 €");
    expect(shortFx(-1250, "EUR").replace(/ /g, " ")).toBe("−1,3 e €");
    expect(shortFx(12_400, "EUR").replace(/ /g, " ")).toBe("+12 e €");
  });
});
