import { describe, expect, it } from "vitest";
import { calcPayroll, defaultParams, prorateOf, type Employment } from "../src/lib/payroll-calc";

const p = defaultParams(2026);
const emp = (x: Partial<Employment>): Employment => ({ kind: "full", monthlyWage: 0, dailyWage: 0, guaranteedMin: false, startDate: "2026-01-01", endDate: null, ...x });

describe("calcPayroll 2026", () => {
  it("minimálbér, teljes munkaidő: nettó 214 662", () => {
    const r = calcPayroll(emp({ monthlyWage: 322_800 }), {}, p, "2026-11");
    expect([r.szja, r.tb, r.net, r.szocho]).toEqual([48_420, 59_718, 214_662, 41_964]);
  });
  it("6 és 4 órás arányos minimálbér", () => {
    // a hivatalos tájékoztató 160 997-et ír (a 8 órás nettó 75%-a); soronkénti kerekítéssel 44 789 TB → 160 996
    expect(calcPayroll(emp({ kind: "part6", monthlyWage: 242_100 }), {}, p, "2026-11").net).toBe(160_996);
    expect(calcPayroll(emp({ kind: "part4", monthlyWage: 161_400 }), {}, p, "2026-11").net).toBe(107_331);
    expect(calcPayroll(emp({ kind: "part4", monthlyWage: 150_000 }), {}, p, "2026-11").warnings.join()).toMatch(/minimálbérnél/);
  });
  it("túlóra 50% és 100%", () => {
    const r = calcPayroll(emp({ monthlyWage: 400_000 }), { otHours50: 10 }, p, "2026-11");
    expect(r.overtimePay).toBe(34_483);
    expect(r.gross).toBe(434_483);
    expect(calcPayroll(emp({ monthlyWage: 348_000 }), { otHours100: 5 }, p, "2026-11").overtimePay).toBe(20_000);
  });
  it("társas vállalkozó jövedelem nélkül: minimum járulék a cégnél", () => {
    const r = calcPayroll(emp({ kind: "member" }), {}, p, "2026-11");
    expect([r.gross, r.tb, r.tbCompany, r.szocho, r.employerCost]).toEqual([0, 0, 59_718, 41_964, 101_682]);
    const g = calcPayroll(emp({ kind: "member", guaranteedMin: true }), {}, p, "2026-11");
    expect([g.tbCompany, g.szocho]).toEqual([69_042, 48_516]);
    const y25 = calcPayroll(emp({ kind: "member", startDate: "2025-07-01" }), {}, defaultParams(2025), "2025-08");
    expect([y25.tbCompany, y25.szocho]).toEqual([53_798, 42_530]);
  });
  it("hó közbeni belépés arányosít", () => {
    expect(prorateOf({ startDate: "2026-11-16", endDate: null }, "2026-11")).toBe(0.5);
    expect(calcPayroll(emp({ kind: "member", startDate: "2026-11-16" }), {}, p, "2026-11").tbCompany).toBe(29_859);
  });
  it("alkalmi munka: napi közteher a minimálbér 1%-a, 100-ra kerekítve", () => {
    const r = calcPayroll(emp({ kind: "efo_casual", dailyWage: 15_000 }), { efoDays: 8 }, p, "2026-11", { szepUsed: 0, efoDays: 115, overtimeHours: 0 });
    expect([r.gross, r.net, r.efoTax, r.employerCost]).toEqual([120_000, 120_000, 25_600, 145_600]);
    expect(r.warnings.join()).toMatch(/120 napos/);
    expect(calcPayroll(emp({ kind: "efo_seasonal", dailyWage: 15_000 }), { efoDays: 2 }, p, "2026-11").efoTax).toBe(3_200);
  });
  it("SZÉP: kereten belül 28%, felette 33,04%", () => {
    const r = calcPayroll(emp({ monthlyWage: 400_000 }), { benefits: [{ kind: "szep", amount: 100_000 }] }, p, "2026-11", { szepUsed: 400_000, efoDays: 0, overtimeHours: 0 });
    expect(r.benefitSzja + r.benefitSzocho).toBe(14_000 + 16_520);
    expect(r.warnings.join()).toMatch(/SZÉP/);
  });
});
