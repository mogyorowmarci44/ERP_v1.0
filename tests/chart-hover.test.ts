import { describe, expect, it } from "vitest";
import { pickColumn } from "@/components/ChartHover";

describe("pickColumn", () => {
  const pts = [{ x: 100 }, { x: 200 }, { x: 300 }];
  it("a legközelebbi oszlopot választja, a szélein túl is", () => {
    expect(pickColumn(pts, 0)).toBe(0);
    expect(pickColumn(pts, 149)).toBe(0);
    expect(pickColumn(pts, 151)).toBe(1);
    expect(pickColumn(pts, 999)).toBe(2);
  });
  it("sávos oszlopnál (lépcsős vonal, oszlopdiagram) a sáv dönt", () => {
    const bands = [{ x: 100, band: { x0: 100, x1: 260 } }, { x: 260, band: { x0: 260, x1: 300 } }];
    expect(pickColumn(bands, 250)).toBe(0);
    expect(pickColumn(bands, 270)).toBe(1);
    expect(pickColumn(bands, 50)).toBe(0);
  });
});
