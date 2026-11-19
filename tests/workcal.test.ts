import { describe, expect, it } from "vitest";
import { dayInfo, easter, workdaysIn } from "../src/lib/workcal";
import { attendanceOf, calcPayroll, defaultParams, type Employment } from "../src/lib/payroll-calc";

describe("munkaidőnaptár", () => {
  it("húsvét és mozgó ünnepek", () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easter(2025).toISOString().slice(0, 10)).toBe("2025-04-20");
    expect(dayInfo("2026-04-03").label).toBe("Nagypéntek");
    expect(dayInfo("2026-04-06").type).toBe("holiday");
    expect(dayInfo("2026-05-25").label).toBe("Pünkösdhétfő");
  });
  it("2026 áthelyezések és a szenteste-módosítás", () => {
    expect(dayInfo("2026-01-10").type).toBe("work");
    expect(dayInfo("2026-01-02").type).toBe("rest");
    expect(dayInfo("2026-08-08").type).toBe("work");
    expect(dayInfo("2026-08-21").type).toBe("rest");
    expect(dayInfo("2026-12-12").type).toBe("rest"); // elmaradt ledolgozós szombat
    expect(dayInfo("2026-12-24")).toMatchObject({ type: "holiday", label: "Szenteste" });
    expect(dayInfo("2025-12-24")).toMatchObject({ type: "rest", label: "Áthelyezett pihenőnap" });
    expect(dayInfo("2025-12-13").type).toBe("work");
  });
  it("munkanapok száma", () => {
    expect(workdaysIn("2026-11")).toBe(21);
    expect(workdaysIn("2026-12")).toBe(21);
    expect(workdaysIn("2026-01")).toBe(21); // jan. 1–2. pihenő, jan. 10. munkanap
    expect(workdaysIn("2026-11", "2026-11-16")).toBe(11);
  });
});

const p = defaultParams(2026);
const emp = (x: Partial<Employment>): Employment => ({ kind: "full", monthlyWage: 0, dailyWage: 0, guaranteedMin: false, startDate: "2026-01-01", endDate: null, ...x });

describe("jelenléti naptár a bérben", () => {
  it("naptár nélkül változatlan", () => {
    const r = calcPayroll(emp({ monthlyWage: 322_800 }), { days: {} }, p, "2026-11");
    expect([r.gross, r.net, r.attendance]).toEqual([322_800, 214_662, null]);
  });
  it("szabadság: nincs levonás", () => {
    const r = calcPayroll(emp({ monthlyWage: 348_000 }), { days: { "2": "SZ", "3": "SZ" } }, p, "2026-11");
    expect(r.gross).toBe(348_000);
    expect(r.attendance).toMatchObject({ workdays: 21, worked: 19, leave: 2 });
  });
  it("betegszabadság 70%, táppénz és fizetés nélküli: levonás", () => {
    // órabér 348 000 / 174 = 2 000, napi bér 16 000
    const r = calcPayroll(emp({ monthlyWage: 348_000 }), { days: { "2": "B", "3": "B", "4": "T", "5": "F" } }, p, "2026-11");
    expect(r.absenceDeduction).toBe(64_000);
    expect(r.sickPay).toBe(22_400);
    expect(r.gross).toBe(348_000 - 64_000 + 22_400);
  });
  it("pihenőnapi és munkaszüneti napi munka", () => {
    // nov. 7. szombat (alap + 100%), nov. 1. vasárnapra eső ünnep → hétvégi: alap + 100%
    const r = calcPayroll(emp({ monthlyWage: 348_000 }), { days: { "7": "M", "1": "M" } }, p, "2026-11");
    expect(r.overtimePay).toBe(2 * 8 * 2_000 * 2);
    // dec. 24. csütörtök (munkanapra eső ünnep): csak a 100% pótlék
    expect(calcPayroll(emp({ monthlyWage: 348_000 }), { days: { "24": "M" } }, p, "2026-12").overtimePay).toBe(16_000);
  });
  it("15 nap feletti betegszabadság figyelmeztet", () => {
    const r = calcPayroll(emp({ monthlyWage: 348_000 }), { days: { "2": "B" } }, p, "2026-11", { szepUsed: 0, efoDays: 0, overtimeHours: 0, sickDays: 15 });
    expect(r.warnings.join()).toMatch(/táppénz/);
  });
  it("EFO: a napok száma a naptárból", () => {
    const e = emp({ kind: "efo_casual", dailyWage: 20_000 });
    const r = calcPayroll(e, { efoDays: 9, days: { "2": "M", "3": "M", "7": "M" } }, p, "2026-11");
    expect([r.gross, r.attendance?.efoDays]).toEqual([60_000, 3]);
  });
  it("hó közbeni belépés: csak a jogviszony napjai", () => {
    const a = attendanceOf(emp({ startDate: "2026-11-16" }), "2026-11", { "2": "B", "17": "SZ" });
    expect(a).toMatchObject({ workdays: 11, leave: 1, sick: 0 });
  });
});
