import { describe, expect, it } from "vitest";
import { eprDeadline, eprFee, eprKfCode, eprLiability, eprRate, quarterOf, quarterRange } from "@/lib/epr";

describe("EPR díjtétel", () => {
  it("2025. október 1-jétől 36 Ft/kg átalány nélkül, M1 belső égésű átalány 44,89", () => {
    expect(eprRate("2025-10-01", "M1", "ice", false)).toBe(36);
    expect(eprRate("2026-11-17", "M1", "ice", true)).toBe(44.89);
    expect(eprRate("2026-11-17", "N1", "bev", true)).toBe(54);
  });
  it("előtte a régi tábla", () => {
    expect(eprRate("2025-09-30", "M1", "ice", false)).toBe(21);
  });
  it("díj = tömeg × tétel, egész forintra", () => {
    expect(eprFee(1450, 36)).toBe(52200);
    expect(eprFee(1450, 44.89)).toBe(65091);
  });
});

describe("KF kód", () => {
  it("M1, 1980 után, átalány nélkül", () => {
    expect(eprKfCode({ category: "M1", drive: "ice", year: 2015, flat: false, originDigit: "5" })).toBe("15102015");
  });
  it("N1, átalány, tisztán elektromos; 1980 előtti veterán", () => {
    expect(eprKfCode({ category: "N1", drive: "bev", year: 2022, flat: true, originDigit: "5" })).toBe("15202515");
    expect(eprKfCode({ category: "M1", drive: "ice", year: 1972, flat: true, originDigit: "5" })).toBe("15101115");
  });
  it("hiányzó származáskód → ?", () => {
    expect(eprKfCode({ category: "M1", drive: "phev", year: 2020, flat: true, originDigit: null })).toBe("1510221?");
  });
});

describe("kötelezettség", () => {
  it("import + belföldi vevő → kötelezett", () => {
    expect(eprLiability({ origin: "import", saleDate: "2026-10-05", buyerCountry: "HU", category: "M1" }).liable).toBe(true);
  });
  it("belföldi beszerzés → nem", () => {
    expect(eprLiability({ origin: "domestic", saleDate: "2026-10-05", buyerCountry: "HU", category: "M1" }).liable).toBe(false);
  });
  it("import + külföldi vevő → nem", () => {
    expect(eprLiability({ origin: "import", saleDate: "2026-10-05", buyerCountry: "AT", category: "M1" }).liable).toBe(false);
  });
  it("hiányzó adat → nem eldönthető", () => {
    expect(eprLiability({ origin: null, saleDate: "2026-10-05", buyerCountry: "HU", category: "M1" }).liable).toBe(null);
    expect(eprLiability({ origin: "import", saleDate: "2026-10-05", buyerCountry: "HU", category: null }).liable).toBe(null);
  });
});

describe("negyedév", () => {
  it("határidő: a következő hónap 20-a", () => {
    expect(eprDeadline(quarterOf("2026-11-17"))).toBe("2027-01-20");
    expect(eprDeadline({ year: 2026, q: 3 })).toBe("2026-10-20");
  });
  it("tartomány", () => {
    expect(quarterRange({ year: 2026, q: 1 })).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(quarterRange({ year: 2024, q: 1 }).to).toBe("2024-03-31");
    expect(quarterRange({ year: 2026, q: 2 }).to).toBe("2026-06-30");
  });
});

import { eprEstimate, eprFee as fee_, eprRate as rate_ } from "@/lib/epr";

describe("v4.5.2 – várható EPR díj a Forecasthoz", () => {
  const card = (o: Partial<Parameters<typeof eprEstimate>[0]>) => ({ fee: null, origin: "import" as const, category: "M1" as const, drive: "ice" as const, massKg: 1200, flat: false, ...o });
  it("importautó: tömeg × az eladás napján érvényes díjtétel", () => {
    expect(eprEstimate(card({}), "2026-12-05")).toEqual({ fee: fee_(1200, rate_("2026-12-05", "M1", "ice", false)), warning: null });
  });
  it("belföldi beszerzés: 0", () => {
    expect(eprEstimate(card({ origin: "domestic" }), "2026-12-05").fee).toBe(0);
  });
  it("hiányzó tömeg: nincs díj, figyelmeztetés", () => {
    const e = eprEstimate(card({ massKg: null }), "2026-12-05");
    expect(e.fee).toBeNull();
    expect(e.warning).toMatch(/tömeg/);
  });
});
