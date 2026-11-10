/** Tervezés – közös UI elemek: fülek, forgatókönyv-kapcsoló, három forgatókönyves pénzgörbe. */
import Link from "next/link";
import { fmtHuf } from "@/lib/money";
import { SCENARIO_LABEL, SCENARIOS, type Scenario } from "@/lib/forecast";

const TABS = [
  ["", "Kimutatás"],
  ["stock", "Készlet és eladások"],
  ["costs", "Költségek"],
  ["settings", "Forgatókönyvek"],
] as const;

export function ForecastTabs({ cid, active }: { cid: number; active: (typeof TABS)[number][0] }) {
  return (
    <nav className="tabs no-print" aria-label="Tervezés">
      {TABS.map(([k, label]) => (
        <Link key={k} href={`/c/${cid}/forecast${k ? `/${k}` : ""}`} className={k === active ? "on" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

export function ScenarioSwitch({ href, active }: { href: (sc: Scenario) => string; active: Scenario | "compare" }) {
  return (
    <div className="segmented no-print" role="tablist" aria-label="Forgatókönyv">
      {SCENARIOS.map((s) => (
        <Link key={s} href={href(s)} role="tab" aria-selected={s === active} className={`sc-${s}${s === active ? " on" : ""}`}>
          <span className="sc-dot" aria-hidden />{SCENARIO_LABEL[s]}
        </Link>
      ))}
    </div>
  );
}

/** Pénzeszközök (pénztár + bank) hó végi egyenlege a három forgatókönyvben: vonalak, közvetlen címkék, hover tooltip. */
export function ScenarioChart({ series }: { series: Array<{ scenario: Scenario; points: Array<{ label: string; value: number; min: number }> }> }) {
  const W = 760, H = 230, L = 64, R = 96, T = 14, B = 26;
  const all = series.flatMap((s) => s.points.flatMap((p) => [p.value, p.min]));
  if (!all.length) return null;
  let min = Math.min(0, ...all), max = Math.max(0, ...all);
  if (max === min) max = min + 1;
  const pad = (max - min) * 0.08;
  min -= min < 0 ? pad : 0;
  max += pad;
  const n = series[0].points.length;
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + ((max - v) * (H - T - B)) / (max - min);
  const ticks = niceTicks(min, max, 4);
  const step = (W - L - R) / Math.max(1, n - 1);
  const labelEvery = Math.ceil(n / 8);
  // közvetlen címkék ütközés nélkül
  const ends = series.map((s) => ({ sc: s.scenario, v: s.points[n - 1].value, yy: y(s.points[n - 1].value) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
  return (
    <figure className="sc-chart">
      <figcaption className="muted">Pénztár + bank hó végi egyenlege (Ft)</figcaption>
      <div className="sc-legend">
        {series.map((s) => <span key={s.scenario} className={`sc-${s.scenario}`}><span className="sc-dot" aria-hidden />{SCENARIO_LABEL[s.scenario]}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pénzeszközök egyenlege forgatókönyvenként" style={{ width: "100%", height: "auto", display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? "ml-zero" : "sc-grid"} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ml-axis">{fmtShort(t)}</text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.scenario} className={`sc-line sc-${s.scenario}`} d={s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")} />
        ))}
        {series.map((s) => s.points.map((p, i) => p.min < 0 && <circle key={`${s.scenario}${i}`} cx={x(i)} cy={y(p.value)} r={4} className="ml-neg" />))}
        {series[0].points.map((p, i) => (
          <g key={i} className="sc-hover">
            <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} className="sc-cross" />
            <rect x={x(i) - step / 2} y={T} width={Math.max(step, 8)} height={H - T - B} className="ml-hit">
              <title>{`${p.label}\n${series.map((s) => `${SCENARIO_LABEL[s.scenario]}: ${fmtHuf(s.points[i].value)} Ft (legalacsonyabb ${fmtHuf(s.points[i].min)})`).join("\n")}`}</title>
            </rect>
            {i % labelEvery === 0 && <text x={x(i)} y={H - 7} textAnchor="middle" className="ml-axis">{p.label}</text>}
          </g>
        ))}
        {ends.map((e) => (
          <text key={e.sc} x={W - R + 8} y={e.yy + 4} className="sc-end">{SCENARIO_LABEL[e.sc]} {fmtShort(e.v)}</text>
        ))}
      </svg>
    </figure>
  );
}

function niceTicks(min: number, max: number, count: number) {
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const stepv = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 1) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / stepv) * stepv; v <= max; v += stepv) out.push(Math.round(v));
  return out;
}
export function fmtShort(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("hu-HU", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `${Math.round(v / 1e3).toLocaleString("hu-HU")} e`;
  return String(Math.round(v));
}
