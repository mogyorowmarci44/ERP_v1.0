/**
 * Eredmény-Sankey: Árbevétel (+ egyéb bevételek) → Összes bevétel → költségcsoportok → adózott eredmény.
 * Szerveren renderelt SVG, függőség nélkül. A szalagok szélessége arányos az összeggel; a csomópontok
 * közvetlenül címkézettek (név, összeg, árbevétel-arány), részletek a szalagok fölé húzva (title).
 */
import { fmtHuf } from "@/lib/money";
import { SankeyChart } from "./SankeyChart";
import type { Statement } from "@/lib/statements";
import type { SankeyDetail } from "@/lib/sankey-detail";

export type Role = "revenue" | "cost" | "profit" | "loss";
/** parent: kibontható részletező csomópontnál a szülő (csak a szülő kibontásakor látszik). */
export type Node = { id: string; label: string; col: number; role: Role; value: number; parent?: string };
export type Link = { from: string; to: string; value: number; role: Role };
export type SankeyModel = { nodes: Node[]; links: Link[]; revenue: number; result: number; skipped: string[] };

/** A P&L sorokból (egy oszlop vagy az összesen) a Sankey hálózat. */
export function sankeyModel(pnl: Statement, colIndex: number | "total", detail?: SankeyDetail): SankeyModel {
  const v = (key: string) => {
    const r = pnl.rows.find((x) => x.key === key);
    if (!r) return 0;
    const x = colIndex === "total" ? r.total ?? 0 : r.values[colIndex] ?? 0;
    return Math.round(x);
  };
  const pos = (x: number) => Math.max(0, x);
  const skipped: string[] = [];
  const keep = (key: string, label: string) => {
    const x = v(key);
    if (x < 0) skipped.push(`${label}: ${fmtHuf(x)} Ft`);
    return pos(x);
  };

  const sources = [
    { id: "I", label: "Árbevétel", value: keep("I", "Árbevétel") },
    { id: "II", label: "Aktivált saját teljesítmény", value: keep("II", "Aktivált saját teljesítmény") },
    { id: "III", label: "Egyéb bevételek", value: keep("III", "Egyéb bevételek") },
    { id: "VIII", label: "Pénzügyi bevételek", value: keep("VIII", "Pénzügyi bevételek") },
  ];
  const material = [
    { id: "IV8", label: "ELÁBÉ", value: keep("IV8", "ELÁBÉ") },
    { id: "IV5", label: "Anyagköltség", value: keep("IV5", "Anyagköltség") },
    { id: "IV6", label: "Igénybe vett szolgáltatások", value: keep("IV6", "Igénybe vett szolgáltatások") },
    { id: "IV7", label: "Egyéb szolgáltatások", value: keep("IV7", "Egyéb szolgáltatások") },
    { id: "IV9", label: "Közvetített szolgáltatások", value: keep("IV9", "Közvetített szolgáltatások") },
  ];
  const materialTotal = material.reduce((s, x) => s + x.value, 0);
  const costs = [
    { id: "IV", label: "Anyagjellegű ráfordítások", value: materialTotal },
    { id: "V", label: "Személyi jellegű ráfordítások", value: keep("V", "Személyi jellegű ráfordítások") },
    { id: "VI", label: "Értékcsökkenés", value: keep("VI", "Értékcsökkenés") },
    { id: "VII", label: "Egyéb ráfordítások", value: keep("VII", "Egyéb ráfordítások") },
    { id: "IX", label: "Pénzügyi ráfordítások", value: keep("IX", "Pénzügyi ráfordítások") },
  ];
  const tax = keep("X", "Társasági adó");
  const inflow = sources.reduce((s, x) => s + x.value, 0);
  const outflow = costs.reduce((s, x) => s + x.value, 0) + tax;
  const result = inflow - outflow; // adózott eredmény (a kihagyott negatív tételek nélkül)
  const preTax = result + tax;

  const nodes: Node[] = [];
  const links: Link[] = [];
  const add = (n: Node) => n.value > 0 && nodes.push(n);
  for (const s of sources) add({ ...s, col: 0, role: "revenue" });
  if (result < 0) add({ id: "LOSS", label: "Veszteség", col: 0, role: "loss", value: -result });
  const total = inflow + Math.max(0, -result);
  add({ id: "TOT", label: "Összes bevétel", col: 1, role: "revenue", value: inflow });
  if (result < 0) nodes[nodes.length - 1].label = "Összes bevétel + veszteség";
  if (result < 0) nodes[nodes.length - 1].value = total;

  for (const s of sources) if (s.value > 0) links.push({ from: s.id, to: "TOT", value: s.value, role: "revenue" });
  if (result < 0) links.push({ from: "LOSS", to: "TOT", value: -result, role: "loss" });

  for (const c of costs) {
    add({ ...c, col: 2, role: "cost" });
    if (c.value > 0) links.push({ from: "TOT", to: c.id, value: c.value, role: "cost" });
  }
  for (const m of material) {
    add({ ...m, col: 3, role: "cost" });
    if (m.value > 0) links.push({ from: "IV", to: m.id, value: m.value, role: "cost" });
  }
  // Kibontható részletek: a költségcsomópontok alatt (főkönyvi számla / gépkocsi / partner) – csak kattintásra látszanak
  const addDetail = (parentId: string) => {
    const parent = nodes.find((n) => n.id === parentId);
    const items = detail?.[parentId];
    if (!parent || !items?.length || parent.value <= 0) return;
    const sum = items.reduce((s, x) => s + x.value, 0);
    const f = sum > 0 ? parent.value / sum : 0; // összegre igazítás (kerekítés, negatív sorok)
    for (const it of items) {
      const val = Math.round(it.value * f);
      if (val <= 0) continue;
      const id = `${parentId}:${it.key}`;
      nodes.push({ id, label: it.label, col: parent.col + 1, role: "cost", value: val, parent: parentId });
      links.push({ from: parentId, to: id, value: val, role: "cost" });
    }
  };
  if (result >= 0) {
    add({ id: "C", label: "Adózás előtti eredmény", col: 2, role: "profit", value: preTax });
    if (preTax > 0) links.push({ from: "TOT", to: "C", value: preTax, role: "profit" });
    add({ id: "X", label: "Társasági adó", col: 3, role: "cost", value: tax });
    if (tax > 0) links.push({ from: "C", to: "X", value: tax, role: "cost" });
    add({ id: "D", label: "Adózott eredmény", col: 3, role: "profit", value: result });
    if (result > 0) links.push({ from: "C", to: "D", value: result, role: "profit" });
  } else {
    add({ id: "X", label: "Társasági adó", col: 2, role: "cost", value: tax });
    if (tax > 0) links.push({ from: "TOT", to: "X", value: tax, role: "cost" });
  }
  for (const id of ["IV5", "IV6", "IV7", "IV8", "IV9", "V", "VI", "VII", "IX"]) addDetail(id);
  return { nodes, links, revenue: v("I"), result, skipped };
}

/** Megjelenítés: interaktív (kattintás = kibontás, dupla kattintás = visszazárás). */
export function Sankey({ model, title }: { model: SankeyModel; title: string }) {
  return <SankeyChart model={model} title={title} />;
}
