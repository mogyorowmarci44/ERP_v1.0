import { describe, expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {}, schema: {} }));
import { sankeyModel } from "@/components/Sankey";
import type { Statement } from "@/lib/statements";

const row = (key: string, v: number) => ({ key, label: key, kind: "line" as const, values: [v], total: v });
const pnl: Statement = { title: "", columns: [], columnLabels: [], hasTotal: true, checkOk: true, rows: [row("I", 1000), row("IV8", 600), row("IV5", 100), row("IV6", 50)] };

describe("Sankey részletező", () => {
  it("az ELÁBÉ gépkocsinként, az anyag és szolgáltatás számlánként egy szinttel lejjebb, összegre igazítva", () => {
    const m = sankeyModel(pnl, "total", {
      IV8: [{ key: "v1", label: "Lancer", value: 400 }, { key: "v2", label: "Colt", value: 200 }],
      IV5: [{ key: "511", label: "511 Vásárolt anyag", value: 70 }, { key: "512", label: "512 Üzemanyag", value: 30 }],
      IV6: [{ key: "524", label: "524 Hirdetés", value: 50 }],
    });
    const col4 = m.nodes.filter((n) => n.col === 4);
    expect(col4.map((n) => n.id).sort()).toEqual(["IV5:511", "IV5:512", "IV6:524", "IV8:v1", "IV8:v2"]);
    // a részletek csak kibontásra látszanak: mind szülőhöz kötöttek
    expect(col4.every((n) => n.parent && n.id.startsWith(`${n.parent}:`))).toBe(true);
    expect(m.nodes.filter((n) => !n.parent).some((n) => n.col === 4)).toBe(false);
    expect(m.links.filter((l) => l.from === "IV8").reduce((s, l) => s + l.value, 0)).toBe(600);
  });
  it("személyi jellegű ráfordítás is kibontható (a következő oszlopba)", () => {
    const p2: Statement = { ...pnl, rows: [...pnl.rows, row("V", 200)] };
    const m = sankeyModel(p2, "total", { V: [{ key: "541", label: "541 Bérköltség", value: 160 }, { key: "561", label: "561 Szocho", value: 40 }] });
    expect(m.nodes.filter((n) => n.parent === "V").map((n) => n.col)).toEqual([3, 3]);
  });
  it("részletező nélkül változatlan (4 oszlop)", () => {
    expect(sankeyModel(pnl, "total").nodes.some((n) => n.col === 4)).toBe(false);
  });
});
