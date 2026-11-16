"use client";
/**
 * Interaktív eredmény-Sankey. Alapból a tömör nézet látszik; egy kibontható csomópontra kattintva megjelennek
 * a részletei (főkönyvi számla / gépkocsi / partner), dupla kattintással visszazárul.
 */
import { useMemo, useState } from "react";
import { fmtHuf } from "@/lib/money";
import type { Node, Role, SankeyModel } from "./Sankey";

const NODE_W = 14;
const PAD = 12;
const MIN_SLOT = 30; // két címkesor helye a kis csomópontoknál
const BASE_H = 520;
/** Oszlop-elrendezés: 4 oszlopig az eredeti, utána oszloponként 210 px-szel szélesebb. */
function layout(cols: number) {
  if (cols <= 4) return { W: 1120, X: [200, 440, 690, 910] };
  const step = 210;
  return { W: 200 + step * (cols - 1) + 270, X: Array.from({ length: cols }, (_, i) => 190 + step * i) };
}

export function SankeyChart({ model, title }: { model: SankeyModel; title: string }) {
  const { revenue, result } = model;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const hasChildren = useMemo(() => new Set(model.nodes.filter((n) => n.parent).map((n) => n.parent!)), [model]);

  // Látható csomópontok: alapnézet + azok a részletek, amelyeknek minden őse ki van nyitva
  const byIdAll = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model]);
  const shown = (n: Node): boolean => !n.parent || (open.has(n.parent) && shown(byIdAll.get(n.parent)!));
  const visible = model.nodes.filter(shown);
  const ids = new Set(visible.map((n) => n.id));
  const links = model.links.filter((l) => ids.has(l.from) && ids.has(l.to));

  const expand = (n: Node) => {
    if (!hasChildren.has(n.id) || open.has(n.id)) return;
    setOpen((s) => new Set(s).add(n.id));
  };
  // Dupla kattintás: a kinyitott csomópontot (vagy a részlet szülőjét) zárja vissza
  const collapse = (n: Node) => {
    const target = open.has(n.id) ? n.id : n.parent && open.has(n.parent) ? n.parent : null;
    if (!target) return;
    setOpen((s) => {
      const x = new Set(s);
      x.delete(target);
      return x;
    });
  };

  if (visible.length < 2) return <div className="card muted">Ebben az időszakban nincs bevétel vagy költség.</div>;

  const colCount = Math.max(4, Math.max(...visible.map((n) => n.col)) + 1);
  const { W, X: COL_X } = layout(colCount);

  // Oszloponkénti sorrend: a gyerekek a szülőjük mellé kerülnek
  const cols: Node[][] = [];
  for (let c = 0; c < colCount; c++) {
    const inCol = visible.filter((n) => n.col === c);
    if (c === 0) { cols.push(inCol); continue; }
    const prev = cols[c - 1];
    const rank = (n: Node) => {
      const src = links.find((l) => l.to === n.id)?.from;
      const i = prev.findIndex((p) => p.id === src);
      return i < 0 ? prev.length : i;
    };
    cols.push(inCol.map((n, i) => ({ n, i, r: rank(n) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.n));
  }
  const H = Math.max(BASE_H, ...cols.map((c) => c.length * (MIN_SLOT + PAD) + 200));
  const k = Math.min(...cols.filter((c) => c.length).map((c) => (H - PAD * (c.length - 1) - MIN_SLOT * c.length) / c.reduce((s, n) => s + n.value, 0)));
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
  // A szalagok kiindulási sorrendje a célcsomópontok sorrendjét kövesse (ne keresztezzék egymást)
  const order = new Map(cols.flat().map((n, i) => [n.id, i]));
  const sorted = [...links].sort((a, b) => (order.get(a.from)! - order.get(b.from)!) || (order.get(a.to)! - order.get(b.to)!));

  const color: Record<Role, string> = { revenue: "var(--sk-rev)", cost: "var(--sk-cost)", profit: "var(--sk-profit)", loss: "var(--sk-loss)" };
  const pctFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1, useGrouping: "always" });
  const share = (x: number) => `${pctFmt.format((x / revenue) * 100)}%`;
  const pct = (x: number) => (revenue > 0 ? ` (${share(x)})` : "");
  const ratio = (x: number) => (revenue > 0 ? `${share(x)} az árbevételből` : "");
  const byId = new Map(visible.map((n) => [n.id, n]));

  const paths = sorted.map((l, i) => {
    const a = geom.get(l.from)!;
    const b = geom.get(l.to)!;
    const h = l.value * k;
    const x0 = a.x + NODE_W, x1 = b.x, y0 = a.outY, y1 = b.inY;
    a.outY += h;
    b.inY += h;
    const xm = (x0 + x1) / 2;
    const d = `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z`;
    return (
      <path key={i} d={d} className="sk-link" fill={color[l.role]}>
        <title>{`${byId.get(l.from)!.label} → ${byId.get(l.to)!.label}: ${fmtHuf(l.value)} Ft${revenue > 0 ? ` (${ratio(l.value)})` : ""}`}</title>
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
      <div style={{ overflowX: W > 1120 ? "auto" : undefined }}>
      {/* széles (sokszintű) nézetben nem zsugorodik: vízszintesen görgethető, a betűméret marad */}
      <svg viewBox={`0 -8 ${W} ${H + 16}`} role="img" aria-label={`${title}: bevételek és ráfordítások megoszlása`} style={W > 1120 ? { width: W, height: "auto", maxWidth: "none" } : { width: "100%", height: "auto" }}>
        {paths}
        {cols.flat().map((n) => {
          const g = geom.get(n.id)!;
          const left = n.col === 0;
          const tx = left ? g.x - 8 : g.x + NODE_W + 8;
          const ty = g.y + Math.max(g.h, MIN_SLOT - 6) / 2;
          const can = hasChildren.has(n.id);
          const isOpen = open.has(n.id);
          const max = n.col === colCount - 1 ? 34 : 26;
          const label = n.col >= 3 && n.label.length > max ? `${n.label.slice(0, max - 1)}…` : n.label;
          return (
            <g
              key={n.id}
              className={can || n.parent ? "sk-click" : undefined}
              onClick={() => expand(n)}
              onDoubleClick={() => collapse(n)}
            >
              <rect x={g.x} y={g.y} width={NODE_W} height={g.h} rx={3} fill={color[n.role]} className="sk-node">
                <title>{`${n.label}: ${fmtHuf(n.value)} Ft${revenue > 0 ? ` (${ratio(n.value)})` : ""}${can ? (isOpen ? " – dupla kattintás: visszazárás" : " – kattintás: kibontás") : ""}`}</title>
              </rect>
              <text x={tx} y={ty - 2} textAnchor={left ? "end" : "start"} className="sk-label">
                {can && <tspan className="sk-toggle">{isOpen ? "▾ " : "▸ "}</tspan>}
                {label}
              </text>
              <text x={tx} y={ty + 13} textAnchor={left ? "end" : "start"} className="sk-value">
                {fmtHuf(n.value)} Ft{pct(n.value)}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      <p className="muted no-print" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
        A ▸ jelű csomópontra kattintva kibontod (főkönyvi számla → szállító → számla; ELÁBÉ: autó → szállító → számla), dupla kattintással visszazárod.
      </p>
    </figure>
  );
}
