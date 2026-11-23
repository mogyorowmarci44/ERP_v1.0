import { describe, expect, it } from "vitest";
import { round2, roundCash5 } from "@/lib/money";
import { computeLine } from "@/lib/posting";

describe("v3.9.6 – kerekítés", () => {
  it("round2: fél fillértől felfelé, előjel-szimmetrikusan, nagy összegeknél is", () => {
    expect(round2(9_944_590.995)).toBe(9_944_591);
    expect(round2(5_218_639.435)).toBe(5_218_639.44);
    expect(round2(-5_218_639.435)).toBe(-5_218_639.44);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    for (let i = 0; i < 20_000; i++) {
      const c = Math.floor(Math.random() * 1e10);
      expect(round2((c + 0.5) / 100)).toBe((c + 1) / 100);
      expect(round2(-(c + 0.5) / 100)).toBe(-(c + 1) / 100);
    }
  });
  it("roundCash5: 1–2 le, 3–7 → 5, 8–9 fel", () => {
    expect([12_701, 12_702, 12_703, 12_707, 12_708].map(roundCash5)).toEqual([12_700, 12_700, 12_705, 12_705, 12_710]);
    expect(roundCash5(-12_703)).toBe(-12_705);
  });
  it("önadózás: a sor bruttója a partner felé fizetendő (= nettó), az ÁFA külön", () => {
    const a = computeLine({ quantity: 1, unitPrice: 100_000, vatRate: 27, vatKind: "reverse_charge" }, "in", 1);
    expect(a).toMatchObject({ netHuf: 100_000, vatHuf: 27_000, grossHuf: 100_000, payableHuf: 100_000 });
    const b = computeLine({ quantity: 1, unitPrice: 100_000, vatRate: 27, vatKind: "normal" }, "in", 1);
    expect(b.grossHuf).toBe(127_000);
  });
});
