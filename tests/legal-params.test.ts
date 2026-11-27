import { describe, expect, it } from "vitest";
import { history, payrollParamsAt, resolveAt } from "../src/lib/legal-params-calc";

describe("jogszabályi paraméterek (v6.4.0)", () => {
  it("beépített történet: 2025 és 2026 minimálbér, TAO", () => {
    expect(resolveAt(history("payroll.minWage", []), "2025-06-30")?.value).toBe(290_800);
    expect(resolveAt(history("payroll.minWage", []), "2026-01-31")?.value).toBe(322_800);
    expect(resolveAt(history("tax.tao", []), "2026-12-31")?.value).toBe(9);
  });

  it("üzemeltetői érték dátumtól hatályos, azonos dátumnál felülír", () => {
    const op = [
      { key: "payroll.minWage", validFrom: "2027-01-01", value: 350_000, note: "rendelet" },
      { key: "payroll.szochoPct", validFrom: "2026-01-01", value: 12.5 },
    ];
    expect(resolveAt(history("payroll.minWage", op), "2026-12-31")?.value).toBe(322_800);
    expect(resolveAt(history("payroll.minWage", op), "2027-01-31")).toMatchObject({ value: 350_000, source: "operator" });
    expect(resolveAt(history("payroll.szochoPct", op), "2026-03-31")).toMatchObject({ value: 12.5, source: "operator" });
  });

  it("a legkorábbi hatálybalépés előtti napra a legkorábbi érték", () => {
    expect(resolveAt(history("payroll.minWage", []), "2020-01-01")?.value).toBe(290_800);
  });

  it("bérparaméter-objektum egy napra, cégenkénti költségszámlával", () => {
    const p = payrollParamsAt("2026-02-28", [{ key: "payroll.tbPct", validFrom: "2026-02-01", value: 19 }], "552");
    expect(p.tbPct).toBe(19);
    expect(p.minWage).toBe(322_800);
    expect(p.memberTbAccount).toBe("552");
  });
});
