/**
 * Eredmény-Sankey: Árbevétel (+ egyéb bevételek) → Összes bevétel → költségcsoportok → adózott eredmény.
 * Szerveren renderelt SVG, függőség nélkül. A szalagok szélessége arányos az összeggel; a csomópontok
 * közvetlenül címkézettek (név, összeg, árbevétel-arány), részletek a szalagok fölé húzva (title).
 */
import { fmtHuf } from "@/lib/money";
import type { Statement } from "@/lib/statements";

type Role = "revenue" | "cost" | "profit" | "loss";
type Node = { id: string; label: string; col: number; role: Role; value: number };
type Link = { from: string; to: string; value: number; role: Role };

/** A P&L sorokból (egy oszlop vagy az összesen) a Sankey hálózat. */
export function sankeyModel(pnl: Statement, colIndex: number | "total") {
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
  return { nodes, links, revenue: v("I"), result, skipped };
}

const W = 1120;
const H = 520;
const NODE_W = 14;
const PAD = 12;
const MIN_SLOT = 30; // két címkesor helye a kis csomópontoknál
const COL_X = [200, 440, 690, 910];

export function Sankey({ model, title }: { model: ReturnType<typeof sankeyModel>; title: string }) {
  const { nodes, links, revenue, result } = model;
  if (nodes.length < 2) return <div className="card muted">Ebben az időszakban nincs bevétel vagy költség.</div>;

  // Lépték: minden oszlop férjen el, a kis csomópontoknak is legyen helye a címkéhez
  const cols = [0, 1, 2, 3].map((c) => nodes.filter((n) => n.col === c));
  const k = Math.min(
    ...cols.filter((c) => c.length).map((c) => (H - PAD * (c.length - 1) - MIN_SLOT * c.length) / c.reduce((s, n) => s + n.value, 0)),
  );
  const geom = new Map<string, { x: number; y: number; h: number; outY: number; inY: number }>();
  for (const c of cols) {
    const heights = c.map((n) => Math.max(1, n.value * k));
    const used = heights.reduce((s, h) => s + Math.max(h, MIN_SLOT), 0) + PAD * (c.length - 1);
    let y = Math.max(0, (H - used) / 2);
    c.forEach((n, i) => {
      geom.set(n.id, { x: COL_X[n.col], y, h: heights[i], outY: y, inY: y });
      y += Math.max(heights[i], MIN_SLOT) + PAD;
    });
  }

  const color: Record<Role, string> = { revenue: "var(--sk-rev)", cost: "var(--sk-cost)", profit: "var(--sk-profit)", loss: "var(--sk-loss)" };
  const pctFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 });
  const share = (x: number) => `${pctFmt.format((x / revenue) * 100)}%`;
  const pct = (x: number) => (revenue > 0 ? ` (${share(x)})` : "");
  const ratio = (x: number) => (revenue > 0 ? `${share(x)} az árbevételből` : "");

  const paths = links.map((l, i) => {
    const a = geom.get(l.from)!;
    const b = geom.get(l.to)!;
    const h = l.value * k;
    const x0 = a.x + NODE_W;
    const x1 = b.x;
    const y0 = a.outY;
    const y1 = b.inY;
    a.outY += h;
    b.inY += h;
    const xm = (x0 + x1) / 2;
    const d = `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z`;
    const from = nodes.find((n) => n.id === l.from)!.label;
    const to = nodes.find((n) => n.id === l.to)!.label;
    return (
      <path key={i} d={d} className="sk-link" fill={color[l.role]}>
        <title>{`${from} → ${to}: ${fmtHuf(l.value)} Ft${revenue > 0 ? ` (${ratio(l.value)})` : ""}`}</title>
      </path>
    );
  });

  return (
    <figure className="sankey card" style={{ margin: 0 }}>
      <figcaption className="sk-head">
        <span>{title}</span>
        <span className={result < 0 ? "neg" : "pos"}>
          {result < 0 ? "Veszteség" : "Adózott eredmény"}: {fmtHuf(result)} Ft{revenue > 0 ? ` (${ratio(result)})` : ""}
        </span>
      </figcaption>
      <svg viewBox={`0 -8 ${W} ${H + 16}`} role="img" aria-label={`${title}: bevételek és ráfordítások megoszlása`} style={{ width: "100%", height: "auto" }}>
        {paths}
        {nodes.map((n) => {
          const g = geom.get(n.id)!;
          const left = n.col === 0;
          const tx = left ? g.x - 8 : g.x + NODE_W + 8;
          const ty = g.y + Math.max(g.h, MIN_SLOT - 6) / 2;
          return (
            <g key={n.id}>
              <rect x={g.x} y={g.y} width={NODE_W} height={g.h} rx={3} fill={color[n.role]} className="sk-node">
                <title>{`${n.label}: ${fmtHuf(n.value)} Ft${revenue > 0 ? ` (${ratio(n.value)})` : ""}`}</title>
              </rect>
              <text x={tx} y={ty - 2} textAnchor={left ? "end" : "start"} className="sk-label">{n.label}</text>
              <text x={tx} y={ty + 13} textAnchor={left ? "end" : "start"} className="sk-value">
                {fmtHuf(n.value)} Ft{pct(n.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
