import { describe, expect, it } from "vitest";
import { closeLagMonths, daysTo, lastClosedMonth, nextPayrollDeadline } from "../src/lib/office-calc";

describe("könyvelőirodai nézet (v6.9.0)", () => {
  it("járulékbevallás határideje", () => {
    expect(nextPayrollDeadline("2026-11-05")).toBe("2026-11-12");
    expect(nextPayrollDeadline("2026-11-12")).toBe("2026-11-12");
    expect(nextPayrollDeadline("2026-11-13")).toBe("2026-12-12");
    expect(nextPayrollDeadline("2026-12-20")).toBe("2027-01-12");
  });
  it("zárások", () => {
    expect(lastClosedMonth([{ year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2025, month: 12 }])).toBe("2026-10");
    expect(lastClosedMonth([])).toBeNull();
    expect(closeLagMonths("2026-10", "2026-11-27")).toBe(0);
    expect(closeLagMonths("2026-07", "2026-11-27")).toBe(3);
    expect(daysTo("2026-12-12", "2026-11-27")).toBe(15);
  });
});
