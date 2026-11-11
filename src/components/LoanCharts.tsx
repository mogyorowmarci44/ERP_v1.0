/** Tagi kölcsön grafikonok: tartozás alakulása (lépcsős vonal, időarányos) és lejárati ütemezés (oszlop). */
import { fmtShort, niceTicks } from "./Forecast";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

const HU_MONTH = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
const t = (d: string) => Date.parse(d + "T00:00:00Z");

export function LoanBalanceChart({ points, until }: { points: Array<{ date: string; value: number }>; until: string }) {
  if (!points.length) return null;
  const W = 760, H = 220, L = 58, R = 84, T = 14, B = 26;
  const t0 = t(points[0].date), t1 = Math.max(t(until), t(points[points.length - 1].date) + 86400000);
  const x = (d: string) => L + ((t(d) - t0) / (t1 - t0)) * (W - L - R);
  const vals = points.map((p) => p.value);
  let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  if (max === min) max = min + 1;
  max += (max - min) * 0.08;
  const y = (v: number) => T + ((max - v) * (H - T - B)) / (max - min);
  const ticks = niceTicks(min, max, 4);
  // lépcsős út: az egyenleg a következő mozgásig változatlan
  let d = `M${x(points[0].date)},${y(points[0].value)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(points[i].date)} V${y(points[i].value)}`;
  d += ` H${W - R}`;
  // havi tengelycímkék (legfeljebb ~8)
  const months: string[] = [];
  const s = new Date(t0), e = new Date(t1);
  for (let m = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1)); m <= e; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) months.push(m.toISOString().slice(0, 10));
  const every = Math.ceil(months.length / 8);
  const last = points[points.length - 1];
  return (
    <figure className="sc-chart">
      <figcaption className="muted">Tagok felé fennálló tartozás alakulása (Ft)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tagi kölcsön egyenleg időben" style={{ width: "100%", height: "auto", display: "block" }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "ml-zero" : "sc-grid"} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="ml-axis">{fmtShort(v)}</text>
          </g>
        ))}
        {months.map((m, i) => i % every === 0 && (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="ml-axis">{m.slice(5, 7) === "01" ? m.slice(0, 4) : HU_MONTH[Number(m.slice(5, 7)) - 1]}</text>
        ))}
        <path d={d} className="ml-line" />
        {points.map((p, i) => {
          const x1 = x(p.date), x2 = i + 1 < points.length ? x(points[i + 1].date) : W - R;
          return (
            <g key={p.date}>
              <rect x={x1} y={T} width={Math.max(2, x2 - x1)} height={H - T - B} className="ml-hit"><title>{`${fmtDate(p.date)}: ${fmtHuf(p.value)} Ft`}</title></rect>
              <circle cx={x1} cy={y(p.value)} r={3} className="ml-dot" pointerEvents="none" />
            </g>
          );
        })}
        <text x={W - R + 6} y={y(last.value) + 4} className="ml-last">{fmtShort(last.value)}</text>
      </svg>
    </figure>
  );
}

export function MaturityChart({ ladder }: { ladder: Array<{ month: string; amount: number }> }) {
  if (!ladder.length) return null;
  const W = 760, H = 200, L = 58, R = 12, T = 18, B = 28;
  const max = Math.max(...ladder.map((l) => l.amount)) * 1.12;
  const y = (v: number) => T + ((max - v) * (H - T - B)) / max;
  const slot = (W - L - R) / ladder.length;
  const bw = Math.min(46, slot * 0.6);
  const label = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `${m.slice(0, 4)}. ${HU_MONTH[Number(m.slice(5)) - 1]}` : m);
  return (
    <figure className="sc-chart">
      <figcaption className="muted">Nyitott kölcsönök a lejárat hónapja szerint (Ft)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lejárati ütemezés" style={{ width: "100%", height: "auto", display: "block" }}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="sc-grid" />
        {ladder.map((l, i) => {
          const cx = L + slot * i + slot / 2;
          const over = l.month === "lejárt";
          return (
            <g key={l.month}>
              <path d={`M${cx - bw / 2},${y(0)} V${y(l.amount) + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${y(0)} Z`} className={over ? "lc-bar over" : "lc-bar"}><title>{`${label(l.month)}: ${fmtHuf(l.amount)} Ft`}</title></path>
              <text x={cx} y={y(l.amount) - 5} textAnchor="middle" className="ml-axis lc-val">{fmtShort(l.amount)}</text>
              <text x={cx} y={H - 9} textAnchor="middle" className={over ? "ml-axis lc-over" : "ml-axis"}>{over ? "⚠ lejárt" : label(l.month)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
