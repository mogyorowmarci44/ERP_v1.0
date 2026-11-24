"use client";
/**
 * v4.0.0 – Közös hover-réteg az idősoros diagramokhoz.
 *
 * A diagram (szerveroldali SVG) változatlanul rajzolódik; köré kerül ez a réteg, amely a diagram BÁRMELY pontja fölött
 * a legközelebbi oszlopra (időpontra) ugrik: szaggatott függőleges vonal, kiemelt pontok / oszlopsáv, és egy kártya az
 * adott időpont összes értékével. Egér, érintés (koppintás / húzás) és billentyűzet (← →, Esc) is működik.
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type HoverRow = { label: string; value: string; color?: string; tone?: "neg" | "pos" | "muted"; /** behúzott al-sor (pl. az előző sor részlete) */ sub?: boolean };
export type HoverCol = {
  /** Az oszlop közepe a diagram viewBox-koordinátáiban. */
  x: number;
  title: string;
  rows: HoverRow[];
  /** Kiemelt pontok (pl. a vonalak értéke ennél az időpontnál). */
  marks?: Array<{ y: number; color?: string; neg?: boolean }>;
  /** Kiemelt sáv (oszlopdiagram, lépcsős vonal szakasza). Ha van, a kurzor a sávon belül ezt az oszlopot választja. */
  band?: { x0: number; x1: number };
};

/** Melyik oszlop tartozik a viewBox-beli `sx` vízszintes helyhez: a sávon belüli, különben a legközelebbi. */
export function pickColumn(cols: Array<Pick<HoverCol, "x" | "band">>, sx: number): number {
  const inBand = cols.findIndex((c) => c.band && sx >= c.band.x0 && sx < c.band.x1);
  if (inBand >= 0) return inBand;
  let best = 0;
  for (let i = 1; i < cols.length; i++) if (Math.abs(cols[i].x - sx) < Math.abs(cols[best].x - sx)) best = i;
  return best;
}

/** A tooltip-kártya (a Sankey is ezt használja). */
export const ChartTip = forwardRef<HTMLDivElement, { title: string; rows: HoverRow[]; style?: CSSProperties }>(function ChartTip({ title, rows, style }, ref) {
  return (
    <div ref={ref} className="ch-tip no-print" role="status" style={style}>
      <strong>{title}</strong>
      {rows.map((r, i) => (
        <div key={i} className={r.sub ? "ch-row ch-sub" : "ch-row"}>
          <span>{r.color ? <i style={{ background: r.color }} /> : null}{r.label}</span>
          <span className={r.tone ? `ch-${r.tone}` : undefined}>{r.value}</span>
        </div>
      ))}
    </div>
  );
});

export function ChartHover({
  width, height, top, bottom, cols, label, crosshair = true, children,
}: {
  width: number; height: number; top: number; bottom: number; cols: HoverCol[]; label: string; crosshair?: boolean; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const [boxW, setBoxW] = useState(0);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipW, setTipW] = useState(0);

  const pick = useCallback((clientX: number) => {
    const el = box.current;
    if (!el || !cols.length) return;
    const r = el.getBoundingClientRect();
    setBoxW(r.width);
    setIdx(pickColumn(cols, ((clientX - r.left) * width) / r.width));
  }, [cols, width]);

  // érintésnél a kártya a felengedés után is látszik; máshová koppintva tűnik el
  useEffect(() => {
    if (idx === null) return;
    const off = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setIdx(null); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [idx]);

  const c = idx !== null ? cols[idx] : null;
  const px = c ? (c.x / width) * boxW : 0;
  // a kártya a kurzor felőli oldalra kerül, de sosem lóg ki a diagram dobozából (keskeny képernyőn sem)
  useLayoutEffect(() => { if (tipRef.current) setTipW(tipRef.current.offsetWidth); }, [idx]);
  const want = px > boxW / 2 ? px - 12 - tipW : px + 12;
  const tipStyle: CSSProperties | undefined = c ? { left: Math.max(0, Math.min(want, boxW - tipW)), top: 6 } : undefined;

  return (
    <div
      ref={box}
      className="ch"
      tabIndex={0}
      aria-label={`${label} – a nyilakkal léptethető`}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setIdx(null); }}
      onKeyDown={(e) => {
        if (!cols.length) return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          setBoxW(box.current?.getBoundingClientRect().width ?? 0);
          setIdx((i) => (i === null ? (e.key === "ArrowRight" ? 0 : cols.length - 1) : Math.max(0, Math.min(cols.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))));
        } else if (e.key === "Escape") setIdx(null);
      }}
      onBlur={() => setIdx(null)}
    >
      {children}
      {c ? (
        <svg className="ch-layer no-print" viewBox={`0 0 ${width} ${height}`} aria-hidden>
          {c.band ? <rect className="ch-band" x={c.band.x0} y={top} width={Math.max(1, c.band.x1 - c.band.x0)} height={height - top - bottom} /> : null}
          {crosshair ? <line className="ch-cross" x1={c.x} x2={c.x} y1={top} y2={height - bottom} vectorEffect="non-scaling-stroke" /> : null}
          {c.marks?.map((m, i) => (
            <circle key={i} cx={c.x} cy={m.y} r={4.5} className={m.neg ? "ch-mark neg" : "ch-mark"} style={m.color && !m.neg ? { fill: m.color } : undefined} />
          ))}
        </svg>
      ) : null}
      {c ? <ChartTip ref={tipRef} title={c.title} rows={c.rows} style={tipStyle} /> : null}
    </div>
  );
}
