import { describe, expect, it } from "vitest";
import { gapTone, salesGap } from "@/lib/sales-gap";

describe("Eladások közti szünet", () => {
  it("a működés kezdetétől számol, egy nap több eladása egy napnak számít", () => {
    const g = salesGap(["2025-07-11", "2025-07-21", "2025-07-21", "2025-08-20", "2025-06-15"], "2025-07-01", "2025-08-25");
    expect(g.lastSale).toBe("2025-08-20");
    expect(g.daysSince).toBe(5);
    expect(g.gapCount).toBe(3); // 07-01→07-11 (10), 07-11→07-21 (10), 07-21→08-20 (30)
    expect(g.median).toBe(10);
    expect(g.worst).toEqual({ days: 30, from: "2025-07-21", to: "2025-08-20", ongoing: false });
  });
  it("ha a mostani szünet a leghosszabb, az a rekord (folyamatban)", () => {
    const g = salesGap(["2025-07-11", "2025-07-21"], "2025-07-01", "2025-09-01");
    expect(g.daysSince).toBe(42);
    expect(g.worst).toEqual({ days: 42, from: "2025-07-21", to: "2025-09-01", ongoing: true });
  });
  it("eladás nélkül a működés kezdetétől", () => {
    const g = salesGap([], "2026-08-01", "2026-08-11");
    expect(g.daysSince).toBe(10);
    expect(g.median).toBeNull();
    expect(g.tone.kind).toBe("none");
  });
});

describe("Szín a mediánhoz képest", () => {
  it("0 nap a legzöldebb, 0,75× alatt zöld", () => {
    expect(gapTone(0, 20)).toEqual({ kind: "pos", strength: 1 });
    expect(gapTone(10, 20).kind).toBe("pos");
  });
  it("medián ±25% sárga", () => {
    expect(gapTone(15, 20).kind).toBe("warn");
    expect(gapTone(25, 20).kind).toBe("warn");
  });
  it("+25% felett egyre pirosabb, 2,5× mediánnál a legpirosabb", () => {
    const a = gapTone(30, 20), b = gapTone(50, 20), c = gapTone(80, 20);
    expect(a.kind).toBe("neg");
    expect(b.strength).toBeGreaterThan(a.strength);
    expect(b.strength).toBe(1);
    expect(c.strength).toBe(1);
  });
});
