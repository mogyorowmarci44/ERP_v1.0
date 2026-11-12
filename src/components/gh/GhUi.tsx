/** v2.0 – Vendégház elemzés: közös UI elemek (szerver komponensek). */
import Link from "next/link";
import { fmtHuf } from "@/lib/money";
import { PNL_INCLUDE_LABEL, type PnlTaxInclude } from "@/lib/entity";
import { delta } from "@/lib/gh-view";
import { setPnlTaxIncludeAction } from "@/app/c/[cid]/actions";

export function Seg({ items }: { items: Array<{ href: string; label: string; on: boolean }> }) {
  return (
    <div className="segmented" role="tablist">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.on ? "on" : ""} role="tab" aria-selected={i.on}>{i.label}</Link>
      ))}
    </div>
  );
}

export function ScopeNav({ prev, next, label }: { prev: string | null; next: string | null; label: string }) {
  return (
    <div className="scope">
      {prev ? <Link href={prev} aria-label="Előző">‹</Link> : <span className="dis">‹</span>}
      <strong>{label}</strong>
      {next ? <Link href={next} aria-label="Következő">›</Link> : <span className="dis">›</span>}
    </div>
  );
}

/** TFH / IFA beszámítása az eredménybe (szolgáltató / közvetlen / mindkettő / egyik sem). */
export function IncludeToggle({ cid, inc, back }: { cid: number; inc: PnlTaxInclude; back: string }) {
  return (
    <form action={setPnlTaxIncludeAction} className="row" style={{ gap: 8 }}>
      <input type="hidden" name="cid" value={cid} />
      <input type="hidden" name="back" value={back} />
      <span className="muted" style={{ fontSize: 13 }}>TFH és IFA az eredményben:</span>
      <div className="segmented">
        {(Object.keys(PNL_INCLUDE_LABEL) as PnlTaxInclude[]).map((k) => (
          <button key={k} name="include" value={k} className={inc === k ? "on" : ""} aria-pressed={inc === k}>{PNL_INCLUDE_LABEL[k]}</button>
        ))}
      </div>
    </form>
  );
}

export function Delta({ label, cur, prev, kind, invert }: { label: string; cur: number | null; prev: number | null; kind: "rel" | "pp"; invert?: boolean }) {
  const d = delta(cur, prev, kind);
  if (!d) return <span>{label}: –</span>;
  const good = d.dir === "flat" ? "" : (d.dir === "up") !== !!invert ? "up" : "down";
  return <span>{label}: <b className={good}>{d.text}</b></span>;
}

export function Kpi({
  label,
  value,
  unit,
  cur,
  prev,
  ly,
  kind = "rel",
  invert,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  cur?: number | null;
  prev?: number | null;
  ly?: number | null;
  kind?: "rel" | "pp";
  invert?: boolean;
  hint?: string;
}) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}{unit ? <small>{unit}</small> : null}</div>
      {cur !== undefined ? (
        <div className="deltas">
          <Delta label="előző" cur={cur ?? null} prev={prev ?? null} kind={kind} invert={invert} />
          <Delta label="tavaly" cur={cur ?? null} prev={ly ?? null} kind={kind} invert={invert} />
        </div>
      ) : null}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Meter({ pct, label }: { pct: number; label: string }) {
  const w = Math.max(0, Math.min(100, pct * 100));
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

export type StRow = {
  label: string;
  values: Array<number | null>;
  total?: number | null;
  kind?: "line" | "sub" | "total" | "head" | "kpi";
  fmt?: (x: number | null) => string;
  indent?: boolean;
};

/** Kimutatás táblázat: sorok × időszakok (+ összesen). */
export function StatementTable({ cols, rows, totalLabel = "Összesen" }: { cols: Array<{ key: string; label: string; partial?: boolean }>; rows: StRow[]; totalLabel?: string | null }) {
  // üres csoportfejlécek elhagyása (amelyik után rögtön újabb fejléc vagy összesítő jön)
  rows = rows.filter((r, i) => r.kind !== "head" || (rows[i + 1] !== undefined && !["head", "sub", "total"].includes(rows[i + 1].kind ?? "")));
  const f = (r: StRow, x: number | null | undefined) => (x === null || x === undefined ? "" : r.fmt ? r.fmt(x) : fmtHuf(x));
  return (
    <div className="table-wrap">
      <table className="statement">
        <thead>
          <tr>
            <th>Megnevezés</th>
            {cols.map((c) => <th key={c.key} className="num">{c.label}{c.partial ? "*" : ""}</th>)}
            {totalLabel ? <th className="num col-total">{totalLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) =>
            r.kind === "head" ? (
              <tr key={i} className="sub"><td colSpan={cols.length + 2}><strong>{r.label}</strong></td></tr>
            ) : (
              <tr key={i} className={r.kind === "sub" ? "k-subtotal" : r.kind === "total" ? "k-total" : r.kind === "kpi" ? "sub" : ""}>
                <td className={r.indent ? "indent-1" : ""}>{r.label}</td>
                {r.values.map((v, j) => <td key={j} className={`num${v !== null && v < 0 && r.kind !== "kpi" ? " neg" : ""}`}>{f(r, v)}</td>)}
                {totalLabel ? <td className="num col-total">{f(r, r.total)}</td> : null}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export type Series = { name: string; color: string; points: Array<{ label: string; value: number }> };

/** Egyszerű vonaldiagram (egy y-tengely), opcionális szaggatott célvonallal, pontonkénti tooltippel. */
export function LineChart({ series, base, baseLabel, title, height = 220 }: { series: Series[]; base?: number; baseLabel?: string; title: string; height?: number }) {
  const W = 760, H = height, L = 64, R = 16, T = 14, B = 26;
  const n = Math.max(...series.map((s) => s.points.length));
  if (!n) return null;
  const vals = series.flatMap((s) => s.points.map((p) => p.value)).concat(base !== undefined ? [base] : []);
  let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  if (max === min) max = min + 1;
  // „szép” osztásköz: 1, 2, 2,5, 5 × 10^k
  const raw = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks = Math.round((max - min) / step);
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + ((max - v) * (H - T - B)) / (max - min);
  const labels = series[0].points.map((p) => p.label);
  const every = Math.ceil(n / 8);
  const fmtAxis = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(Math.abs(v) % 1e6 ? 1 : 0).replace(".", ",")} M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)} e` : String(Math.round(v)));
  const colW = (W - L - R) / Math.max(1, n - 1);
  return (
    <figure style={{ margin: 0 }}>
      {series.length > 1 || base !== undefined ? (
        <div className="legend" style={{ marginBottom: 6 }}>
          {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
          {base !== undefined ? <span><i style={{ background: "transparent", border: "1.5px dashed var(--muted)" }} />{baseLabel}</span> : null}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: "100%", height: "auto", display: "block" }}>
        {Array.from({ length: ticks + 1 }, (_, i) => min + i * step).map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="lc-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="lc-axis">{fmtAxis(v)}</text>
          </g>
        ))}
        {base !== undefined ? <line x1={L} x2={W - R} y1={y(base)} y2={y(base)} className="lc-base" /> : null}
        {series.map((s) => (
          <path key={s.name} className="lc-line" stroke={s.color} d={s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")} />
        ))}
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return last ? <circle key={s.name} cx={x(s.points.length - 1)} cy={y(last.value)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
        })}
        {labels.map((lb, i) => (
          <g key={i}>
            <rect x={x(i) - colW / 2} y={T} width={Math.max(colW, 4)} height={H - T - B} className="lc-hit">
              <title>{`${lb}\n${series.map((s) => `${s.name}: ${fmtHuf(s.points[i]?.value ?? 0)} Ft`).join("\n")}`}</title>
            </rect>
            {(i % every === 0 && n - 1 - i >= every) || i === n - 1 ? <text x={x(i)} y={H - 7} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="lc-axis">{lb}</text> : null}
          </g>
        ))}
      </svg>
    </figure>
  );
}
