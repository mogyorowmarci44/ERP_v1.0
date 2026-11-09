import { describe, it, expect } from "vitest";
import { buckets, buildPnl, buildBalanceSheet, buildCashFlow, type DailyRow } from "@/lib/statements";

describe("buckets", () => {
  it("heti bontás hétfő–vasárnap, a tartományra vágva", () => {
    const b = buckets("2026-11-04", "2026-11-20", "week"); // szerda
    expect(b.map((x) => [x.start, x.end])).toEqual([
      ["2026-11-04", "2026-11-08"],
      ["2026-11-09", "2026-11-15"],
      ["2026-11-16", "2026-11-20"],
    ]);
  });
  it("negyedéves és havi címkék", () => {
    expect(buckets("2026-01-01", "2026-12-31", "quarter").map((x) => x.label)).toEqual(["2026. I. n.év", "2026. II. n.év", "2026. III. n.év", "2026. IV. n.év"]);
    expect(buckets("2026-02-10", "2026-03-31", "month").map((x) => [x.start, x.end, x.label])).toEqual([
      ["2026-02-10", "2026-02-28", "2026. febr."],
      ["2026-03-01", "2026-03-31", "2026. márc."],
    ]);
  });
});

// Mini főkönyv: tőke 3M, autó vétel 2,5M, fényezés 300e+ÁFA (szállító nyitva), eladás különbözetivel 3,135M
const rows: DailyRow[] = [
  { code: "384", date: "2026-01-05", amount: 3_000_000 }, { code: "411", date: "2026-01-05", amount: -3_000_000 },
  { code: "261", date: "2026-01-10", amount: 2_500_000 }, { code: "384", date: "2026-01-10", amount: -2_500_000 },
  { code: "261", date: "2026-02-03", amount: 300_000 }, { code: "466", date: "2026-02-03", amount: 81_000 }, { code: "454", date: "2026-02-03", amount: -381_000 },
  { code: "384", date: "2026-04-20", amount: 3_135_000 }, { code: "911", date: "2026-04-20", amount: -3_000_000 }, { code: "467", date: "2026-04-20", amount: -135_000 },
  { code: "814", date: "2026-04-20", amount: 2_800_000 }, { code: "261", date: "2026-04-20", amount: -2_800_000 },
  // előző évi (le nem zárt) eredmény: 50e bevétel
  { code: "384", date: "2025-06-01", amount: 50_000 }, { code: "969", date: "2025-06-01", amount: -50_000 },
];
const cols = buckets("2026-01-01", "2026-06-30", "quarter");

describe("buildPnl", () => {
  it("árbevétel, ELÁBÉ, eredmény negyedévente", () => {
    const p = buildPnl(rows, cols);
    const r = (k: string) => p.rows.find((x) => x.key === k)!;
    expect(r("I").values).toEqual([0, 3_000_000]);
    expect(r("IV8").values).toEqual([0, 2_800_000]);
    expect(r("D").total).toBe(200_000);
    expect(p.checkOk).toBe(true);
  });
});

describe("buildBalanceSheet", () => {
  it("egyensúlyban, előző évi eredmény eredménytartalékban, tárgyévi adózott eredményben", () => {
    const b = buildBalanceSheet(rows, cols, 1, "2026-01-01");
    const r = (k: string) => b.rows.find((x) => x.key === k)!;
    expect(b.checkOk).toBe(true);
    expect(b.columnLabels[0]).toBe("Nyitó");
    expect(r("DIV").values).toEqual([0, 50_000, 50_000]);
    expect(r("DVII").values).toEqual([50_000, 0, 200_000]);
    expect(r("BI").values).toEqual([0, 2_800_000, 0]);
    // 466 tartozik és 467 követel csoportonként: 81e követelés, 135e kötelezettség
    expect(r("BII").values[2]).toBe(81_000);
    expect(r("ASSETS").values[2]).toBe(3_685_000 + 81_000);
  });
});

describe("buildCashFlow", () => {
  it("indirekt CF egyezik a pénzeszköz-változással, nincs nem besorolt sor", () => {
    const c = buildCashFlow(rows, cols);
    const r = (k: string) => c.rows.find((x) => x.key === k)!;
    expect(r("IV").values).toEqual([500_000, 3_135_000]);
    expect(r("OP").values[0] + r("INV").values[0] + r("FIN").values[0]).toBe(500_000);
    expect(r("fin1").values[0]).toBe(3_000_000);
    expect(c.rows.find((x) => x.key === "other")).toBeUndefined();
    expect(r("open").values[0]).toBe(50_000);
  });
});
