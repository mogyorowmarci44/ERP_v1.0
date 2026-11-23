"use client";

/**
 * v3.9.1 – Dinamikus időszakválasztó. A bontáshoz (nap / hét / hónap / negyedév / év) illeszkedő
 * naptárat mutat: két kattintás (kezdő és záró egység) vagy egy gyorsválasztó, és már frissül is.
 * ‹ / › a teljes tartományt lépteti a saját hosszával.
 *
 * Űrlapon belül a `from` / `to` rejtett mezőket tölti és elküldi az űrlapot (így a többi szűrő megmarad);
 * űrlapon kívül az URL `from` / `to` paraméterét cseréli.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  HU_DOW, HU_MONTH, HU_MONTH_SHORT, ROMAN_Q, addMonths, addUnits, endOf, periodParam, isoWeek, monthMatrix, presets, rangeFromClicks, rangeLabel, shiftRange, startOf, unitCount,
  type PickUnit,
} from "@/lib/period-picker";

const COLS_HU: Record<PickUnit, string> = { day: "nap", week: "hét", month: "hónap", quarter: "negyedév", year: "év" };
const SINGLE_HU: Record<PickUnit, string> = { day: "napot", week: "hetet", month: "hónapot", quarter: "negyedévet", year: "évet" };
const ONTO_HU: Record<PickUnit, string> = { day: "napra", week: "hétre", month: "hónapra", quarter: "negyedévre", year: "évre" };

export function PeriodPicker(props: {
  unit: PickUnit;
  from: string;
  to: string;
  /** Mai nap (szerverről, Budapest szerint), hogy ne legyen eltérés a kliens órájától. */
  today: string;
  label?: string;
  fromName?: string;
  toName?: string;
  /** Oszlopkorlát (pl. kimutatásoknál 92) – túllépéskor figyelmeztet. */
  maxUnits?: number;
  /**
   * Egyetlen időszak választása (pl. vendégház nézetek): egy kattintás, és az URL `param` paramétere
   * az időszak kulcsa lesz („2026”, „2026-11”, „2026-Q4”, „2026-W48”). Ilyenkor nincs gyorsválasztó.
   */
  single?: { param: string };
  /** Választható tartomány (single módban a korlátozáshoz). */
  min?: string;
  max?: string;
  /** Saját címke a gombon (pl. „2026. 48. hét (11.23.–11.29.)”). */
  display?: string;
}) {
  const { unit, today } = props;
  const fromName = props.fromName ?? "from";
  const toName = props.toName ?? "to";
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const fIn = useRef<HTMLInputElement>(null);
  const tIn = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState({ from: props.from, to: props.to });
  const [pick, setPick] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => panelAnchor(unit, props.to || today));

  useEffect(() => setSel({ from: props.from, to: props.to }), [props.from, props.to]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (pick ? setPick(null) : close());
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });

  const close = () => {
    setOpen(false);
    setPick(null);
    setHover(null);
  };

  const apply = (from: string, to: string) => {
    setSel({ from, to });
    close();
    if (props.single) {
      const q = new URLSearchParams(window.location.search);
      q.set(props.single.param, periodParam(unit, from));
      router.push(`${window.location.pathname}?${q}`);
      return;
    }
    const form = box.current?.closest("form");
    if (form && fIn.current && tIn.current) {
      fIn.current.value = from;
      tIn.current.value = to;
      form.requestSubmit();
      return;
    }
    const q = new URLSearchParams(window.location.search);
    q.set(fromName, from);
    q.set(toName, to);
    router.push(`${window.location.pathname}?${q}`);
  };

  const clickCell = (d: string) => {
    const s = startOf(unit, d);
    if (props.single) {
      apply(s, endOf(unit, s));
      return;
    }
    if (!pick) {
      setPick(s);
      setHover(s);
      return;
    }
    const r = rangeFromClicks(unit, pick, s);
    apply(r.from, r.to);
  };

  /** A kijelölés (folyamatban lévő kattintásnál az előnézet). */
  const shown = pick ? rangeFromClicks(unit, pick, hover ?? pick) : sel;
  const cellState = (d: string) => {
    const s = startOf(unit, d);
    const a = startOf(unit, shown.from), b = startOf(unit, shown.to);
    const cls = [];
    if (s >= a && s <= b) cls.push("in");
    if (s === a) cls.push("start");
    if (s === b) cls.push("end");
    if (s > today) cls.push("fut");
    if (s === startOf(unit, today)) cls.push("now");
    return cls.join(" ");
  };
  const outside = (d: string) => (!!props.max && startOf(unit, d) > props.max) || (!!props.min && endOf(unit, d) < props.min);
  const cellProps = (d: string) => ({
    type: "button" as const,
    disabled: outside(d),
    className: `pp-cell ${cellState(d)}`,
    onClick: () => clickCell(d),
    onMouseEnter: () => pick && setHover(startOf(unit, d)),
  });

  const count = unitCount(unit, shown.from, shown.to);
  const tooMany = props.maxUnits !== undefined && count > props.maxUnits;
  const ps = useMemo(() => presets(unit, today), [unit, today]);
  const step = unit === "day" || unit === "week" ? "month" : unit === "year" ? "decade" : "year";
  const nav = (dir: 1 | -1) => setView((v) => (step === "month" ? addMonths(v, dir) : step === "year" ? addMonths(v, 12 * dir) : addMonths(v, 120 * dir)));

  const shiftTo = (dir: 1 | -1) => {
    if (props.single) {
      const f = addUnits(unit, startOf(unit, sel.from), dir);
      return { from: f, to: endOf(unit, f) };
    }
    return shiftRange(sel.from, sel.to, dir, unit);
  };
  const canShift = (dir: 1 | -1) => {
    const r = shiftTo(dir);
    return !(props.max && r.from > props.max) && !(props.min && r.to < props.min);
  };
  const shift = (dir: 1 | -1) => {
    const r = shiftTo(dir);
    apply(r.from, r.to);
  };

  return (
    <div className={`pp${props.single ? " single" : ""}`} ref={box}>
      {props.label && <span className="pp-label">{props.label}</span>}
      {!props.single && <input ref={fIn} type="hidden" name={fromName} defaultValue={sel.from} key={`f${sel.from}`} />}
      {!props.single && <input ref={tIn} type="hidden" name={toName} defaultValue={sel.to} key={`t${sel.to}`} />}
      <div className="pp-bar">
        <button type="button" className="pp-step" onClick={() => shift(-1)} disabled={!canShift(-1)} aria-label="Előző időszak" title="Előző időszak"><ChevronLeft size={16} /></button>
        <button type="button" className={`pp-trigger${open ? " on" : ""}`} onClick={() => (open ? close() : (setView(panelAnchor(unit, sel.to || today)), setOpen(true)))} aria-expanded={open} aria-haspopup="dialog">
          <CalendarDays size={15} />
          <span>{props.display ?? rangeLabel(unit, sel.from, sel.to)}</span>
        </button>
        <button type="button" className="pp-step" onClick={() => shift(1)} disabled={!canShift(1)} aria-label="Következő időszak" title="Következő időszak"><ChevronRight size={16} /></button>
      </div>

      {open && (
        <div className="pp-pop" role="dialog" aria-label="Időszak választása">
          {!props.single && <div className="pp-presets">
            {ps.map((p) => (
              <button key={p.key} type="button" className={p.from === sel.from && p.to === sel.to ? "on" : undefined} onClick={() => apply(p.from, p.to)}>{p.label}</button>
            ))}
          </div>}
          <div className="pp-main">
            <div className="pp-nav">
              <button type="button" onClick={() => nav(-1)} aria-label="Vissza"><ChevronLeft size={16} /></button>
              <span className="muted">{props.single ? `Válassz ${SINGLE_HU[unit]}` : pick ? `Most kattints a záró ${ONTO_HU[unit]}` : `Kattints a kezdő, majd a záró ${ONTO_HU[unit]}`}</span>
              <button type="button" onClick={() => nav(1)} aria-label="Előre"><ChevronRight size={16} /></button>
            </div>
            <div className={`pp-panels u-${unit}`}>
              {(unit === "day" || unit === "week") &&
                [addMonths(view, -1), view].map((m) => (
                  <MonthPanel key={m} month={m} unit={unit} cellProps={cellProps} onTitle={props.single ? undefined : () => apply(startOf("month", m), endOf("month", m))} />
                ))}
              {unit === "month" &&
                [addMonths(view, -12), view].map((y) => (
                  <div key={y} className="pp-panel">
                    <button type="button" className="pp-title" disabled={!!props.single} onClick={() => apply(startOf("year", y), endOf("year", y))} title="Egész év">{y.slice(0, 4)}</button>
                    <div className="pp-grid g3">
                      {HU_MONTH_SHORT.map((n, i) => {
                        const d = `${y.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`;
                        return <button key={d} {...cellProps(d)}>{n.replace(".", "")}</button>;
                      })}
                    </div>
                  </div>
                ))}
              {unit === "quarter" &&
                [addMonths(view, -24), addMonths(view, -12), view].map((y) => (
                  <div key={y} className="pp-panel">
                    <button type="button" className="pp-title" disabled={!!props.single} onClick={() => apply(startOf("year", y), endOf("year", y))} title="Egész év">{y.slice(0, 4)}</button>
                    <div className="pp-grid g2">
                      {ROMAN_Q.map((q, i) => {
                        const d = `${y.slice(0, 4)}-${String(i * 3 + 1).padStart(2, "0")}-01`;
                        return <button key={d} {...cellProps(d)}>{q} n.év</button>;
                      })}
                    </div>
                  </div>
                ))}
              {unit === "year" && (
                <div className="pp-panel">
                  <div className="pp-grid g4">
                    {Array.from({ length: 12 }, (_, i) => `${Number(view.slice(0, 4)) - 9 + i}-01-01`).map((d) => (
                      <button key={d} {...cellProps(d)}>{d.slice(0, 4)}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="pp-foot">
              {props.single ? (
                <button type="button" onClick={() => apply(startOf(unit, props.max && props.max < today ? props.max : today), endOf(unit, today))}>Aktuális</button>
              ) : (
                <span>
                  <strong>{rangeLabel(unit, shown.from, shown.to)}</strong>
                  <span className={tooMany ? "neg" : "muted"}> · {count} {COLS_HU[unit]}{tooMany ? ` – legfeljebb ${props.maxUnits} fér el` : ""}</span>
                </span>
              )}
              {pick ? <button type="button" onClick={() => setPick(null)}>Mégse</button> : <button type="button" onClick={close}>Bezár</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A jobb oldali (utolsó) panel kezdőnapja. */
function panelAnchor(unit: PickUnit, d: string): string {
  if (unit === "day" || unit === "week") return startOf("month", d);
  return startOf("year", d);
}

function MonthPanel({ month, unit, cellProps, onTitle }: {
  month: string;
  unit: PickUnit;
  cellProps: (d: string) => React.ButtonHTMLAttributes<HTMLButtonElement> & { type: "button" };
  onTitle?: () => void;
}) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const rows = monthMatrix(y, m);
  return (
    <div className="pp-panel">
      <button type="button" className="pp-title" onClick={onTitle} disabled={!onTitle} title={onTitle ? "Egész hónap" : undefined}>{y}. {HU_MONTH[m - 1]}</button>
      <table className={`pp-cal${unit === "week" ? " weeks" : ""}`}>
        <thead>
          <tr>{unit === "week" && <th className="wk">hét</th>}{HU_DOW.map((d) => <th key={d}>{d}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              {unit === "week" && <td className="wk">{isoWeek(r[0]).week}.</td>}
              {r.map((d) => {
                const other = d.slice(5, 7) !== month.slice(5, 7);
                if (other && unit === "day") return <td key={d} />;
                return (
                  <td key={d}>
                    <button {...cellProps(d)} className={`${cellProps(d).className}${other ? " other" : ""}`}>{Number(d.slice(8, 10))}</button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
