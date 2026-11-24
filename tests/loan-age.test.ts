import { describe, expect, it } from "vitest";
import { loanAge } from "@/lib/loan-age";

describe("v4.4.0 – tagi kölcsön: hány napja járt le", () => {
  const t = "2026-11-24";
  it("lejárt: napok és fokozat", () => {
    expect(loanAge("2026-11-17", "Lejárt", t)).toMatchObject({ days: 7, level: "fresh", label: "lejárt · 7 napja" });
    expect(loanAge("2026-10-02", "Lejárt", t)).toMatchObject({ days: 53, level: "late" });
    expect(loanAge("2025-08-31", "Lejárt", t)).toMatchObject({ days: 450, level: "old" });
  });
  it("hamarosan lejár: hány nap múlva", () => {
    expect(loanAge("2026-12-13", "Hamarosan lejár", t)).toMatchObject({ kind: "soon", days: 19, label: "19 nap múlva jár le" });
  });
  it("nyitott / rendezett / lejárat nélkül: nincs jelvény", () => {
    expect(loanAge("2027-06-01", "Nyitott", t)).toBeNull();
    expect(loanAge("2025-01-01", "Rendezve", t)).toBeNull();
    expect(loanAge(null, "Lejárt", t)).toBeNull();
  });
});
