import { describe, expect, it } from "vitest";
import { inlineParts, isNumCell, parseBlocks, parseSections, sectionsToText } from "@/lib/annual-text";
import { buildBalanceSheet } from "@/lib/statements";

describe("kiegészítő melléklet jelölés", () => {
  const text = `## 1. A vállalkozás bemutatása\n\nElső bekezdés\nfolytatás.\n\n- egy\n- kettő\n\n## 3.4 Mutatók\n\n| Mutató | 2025 |\n|---|---|\n| Saját tőke aránya | 40,8% |\n| **Összesen** | **1 234** |`;
  it("fejezetekre bont és visszaír", () => {
    const s = parseSections(text);
    expect(s.map((x) => [x.no, x.title])).toEqual([["1.", "A vállalkozás bemutatása"], ["3.4", "Mutatók"]]);
    expect(parseSections(sectionsToText(s))).toEqual(s);
  });
  it("blokkok: bekezdés, felsorolás, táblázat fejléccel", () => {
    const [a, b] = parseSections(text);
    expect(parseBlocks(a.body)).toEqual([{ t: "p", text: "Első bekezdés folytatás." }, { t: "ul", items: ["egy", "kettő"] }]);
    const t = parseBlocks(b.body)[0];
    expect(t).toEqual({ t: "table", head: ["Mutató", "2025"], rows: [["Saját tőke aránya", "40,8%"], ["**Összesen**", "**1 234**"]] });
  });
  it("félkövér és számcella", () => {
    expect(inlineParts("a **b** c")).toEqual([{ b: false, s: "a " }, { b: true, s: "b" }, { b: false, s: " c" }]);
    expect(isNumCell("-36 388")).toBe(true);
    expect(isNumCell("12,5%")).toBe(true);
    expect(isNumCell("H-01")).toBe(false);
  });
});

describe("mérleg – ÁFA nettósítás", () => {
  it("a 466 és 467 egyenlege egy adónemként nettóz", () => {
    const rows = [
      { code: "384", date: "2025-06-01", amount: 1000 },
      { code: "466", date: "2025-06-01", amount: 200 },
      { code: "467", date: "2025-06-01", amount: -700 },
      { code: "411", date: "2025-06-01", amount: -500 },
    ];
    const bs = buildBalanceSheet(rows, [{ key: "a", label: "2025", start: "2025-01-01", end: "2025-12-31" }], 1, "2025-01-01", { netVat: true });
    const v = (k: string) => bs.rows.find((r) => r.key === k)!.values[1];
    expect(v("BII")).toBe(0);
    expect(v("FIII")).toBe(500);
    expect(v("ASSETS")).toBe(1000);
    expect(bs.checkOk).toBe(true);
  });
});
