/** Egy pénzszámla egyenleg-idősora: vékony vonal, nulla-vonal, utolsó érték címkéje, pontonkénti tooltip. */
import { fmtHuf } from "@/lib/money";

export function MiniLine({ points, title }: { points: Array<{ label: string; value: number; sub?: string }>; title: string }) {
  const W = 560, H = 150, L = 8, R = 92, T = 12, B = 22;
  if (points.length === 0) return null;
  const vals = points.map((p) => p.value);
  let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  if (max === min) max = min + 1;
  const pad = (max - min) * 0.08;
  min -= min < 0 ? pad : 0;
  max += pad;
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + ((max - v) * (H - T - B)) / (max - min);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const step = (W - L - R) / Math.max(1, points.length - 1);
  const labelEvery = Math.ceil(points.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} egyenlege időszakonként`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="ml-zero" />
      <path d={d} className="ml-line" />
      {points.map((p, i) => (
        <g key={i}>
          {p.value < 0 && <circle cx={x(i)} cy={y(p.value)} r={4} className="ml-neg" />}
          <rect x={x(i) - step / 2} y={T} width={Math.max(step, 6)} height={H - T - B} className="ml-hit">
            <title>{`${p.label}: ${fmtHuf(p.value)} Ft${p.sub ? `\n${p.sub}` : ""}`}</title>
          </rect>
          {i % labelEvery === 0 && (
            <text x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="ml-axis">{p.label}</text>
          )}
        </g>
      ))}
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={4} className="ml-dot" />
      <text x={x(points.length - 1) + 8} y={y(last.value) + 4} className={`ml-last${last.value < 0 ? " neg" : ""}`}>{fmtHuf(last.value)} Ft</text>
    </svg>
  );
}
