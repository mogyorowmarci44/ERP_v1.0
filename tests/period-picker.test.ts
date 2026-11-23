import { describe, expect, it } from "vitest";
import { addMonths, alignedUnit, endOf, isoWeek, monthMatrix, presets, rangeFromClicks, rangeLabel, shiftRange, startOf, unitCount } from "@/lib/period-picker";
import { buckets } from "@/lib/statements";

describe("egységhatárok", () => {
  it("startOf / endOf", () => {
    expect(startOf("week", "2026-11-23")).toBe("2026-11-23"); // hétfő
    expect(endOf("week", "2026-11-25")).toBe("2026-11-29");
    expect(startOf("quarter", "2026-11-23")).toBe("2026-10-01");
    expect(endOf("quarter", "2026-02-10")).toBe("2026-03-31");
    expect(endOf("month", "2028-02-03")).toBe("2028-02-29");
    expect(endOf("year", "2026-05-05")).toBe("2026-12-31");
  });
  it("addMonths hónapvég-vágással", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -2)).toBe("2025-11-15");
  });
  it("ISO hét", () => {
    expect(isoWeek("2026-11-23")).toEqual({ year: 2026, week: 48 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
  });
  it("unitCount / alignedUnit", () => {
    expect(unitCount("month", "2026-01-01", "2026-11-23")).toBe(11);
    expect(unitCount("quarter", "2025-12-01", "2026-01-01")).toBe(2);
    expect(unitCount("week", "2026-11-25", "2026-12-01")).toBe(2);
    expect(alignedUnit("2026-01-01", "2026-03-31")).toBe("quarter");
    expect(alignedUnit("2026-01-01", "2026-12-31")).toBe("year");
    expect(alignedUnit("2026-01-05", "2026-01-20")).toBe("day");
  });
});

describe("léptetés", () => {
  it("egész negyedév → következő negyedév", () => {
    expect(shiftRange("2026-01-01", "2026-03-31", 1)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });
  it("egész hónap visszafelé, rövidebb hónapra", () => {
    expect(shiftRange("2026-03-01", "2026-03-31", -1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("tetszőleges napok → azonos hosszal", () => {
    expect(shiftRange("2026-11-10", "2026-11-16", 1)).toEqual({ from: "2026-11-17", to: "2026-11-23" });
  });
  it("havi nézet, folyó hónap közepéig tartó tartomány hónapokban lép", () => {
    expect(shiftRange("2026-11-01", "2026-11-23", -1, "month")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("címkék, mátrix, kattintás", () => {
  it("rangeLabel", () => {
    expect(rangeLabel("month", "2026-01-01", "2026-11-30")).toBe("2026. jan. – nov.");
    expect(rangeLabel("month", "2025-07-01", "2026-06-30")).toBe("2025. júl. – 2026. jún.");
    expect(rangeLabel("quarter", "2026-01-01", "2026-12-31")).toBe("2026. I.–IV. n.év");
    expect(rangeLabel("week", "2026-11-02", "2026-11-29")).toBe("2026. 45.–48. hét");
    expect(rangeLabel("year", "2025-01-01", "2026-12-31")).toBe("2025 – 2026");
    expect(rangeLabel("day", "2026-11-23", "2026-11-23")).toBe("2026. nov. 23.");
    expect(rangeLabel("month", "2026-01-15", "2026-02-10")).toBe("2026. jan. 15. – febr. 10.");
  });
  it("monthMatrix hétfővel kezd, teljes heteket ad", () => {
    const m = monthMatrix(2026, 11);
    expect(m[0][0]).toBe("2026-10-26");
    expect(m[m.length - 1][0]).toBe("2026-11-30"); // nov. 30. hétfő → 6. sor
  });
  it("rangeFromClicks rendez és kerekít", () => {
    expect(rangeFromClicks("month", "2026-05-10", "2026-02-03")).toEqual({ from: "2026-02-01", to: "2026-05-31" });
    expect(rangeFromClicks("week", "2026-11-25", "2026-11-25")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  });
  it("presetek a bontáshoz", () => {
    const p = presets("month", "2026-11-23");
    expect(p.find((x) => x.key === "month3")).toMatchObject({ from: "2026-09-01", to: "2026-11-30" });
    expect(presets("day", "2026-11-23").find((x) => x.key === "m-1")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(presets("year", "2026-11-23").find((x) => x.key === "year3")).toMatchObject({ from: "2024-01-01", to: "2026-12-31" });
  });
});

describe("éves bontás a kimutatásokban", () => {
  it("buckets year", () => {
    expect(buckets("2025-07-01", "2026-11-23", "year").map((b) => [b.label, b.start, b.end])).toEqual([
      ["2025", "2025-07-01", "2025-12-31"],
      ["2026", "2026-01-01", "2026-11-23"],
    ]);
  });
});
