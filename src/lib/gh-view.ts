/** v2.0 – Vendégház nézetek: időszak-választás, összehasonlítás, formázás. */
import { addDays, daysBetween, periodKey, periodKeys, periodRange, prevPeriod, type Day, type Gran } from "./gh-calc";

export const GRAN_LABEL: Record<Gran, string> = { week: "Heti", month: "Havi", quarter: "Negyedéves", year: "Éves" };

export function parseGran(s: string | undefined, allowed: Gran[], def: Gran): Gran {
  return allowed.includes(s as Gran) ? (s as Gran) : def;
}

/** A szálláshely-tevékenység első napja (első szállásdíj / vendégéjszaka). */
export function accommodationStart(days: Day[]): string | null {
  for (const d of days) {
    const v = d.v;
    if ((v.rev_airbnb ?? 0) + (v.rev_booking ?? 0) + (v.rev_direct ?? 0) > 0 || (v.n_airbnb ?? 0) + (v.n_booking ?? 0) + (v.n_direct ?? 0) > 0) return d.date;
  }
  return null;
}

/** Értékesíthető napok száma a tartományban (a tevékenység kezdete és a mai nap között). */
export function availableDays(from: string, to: string, start: string | null, asOf: string): number {
  if (!start) return 0;
  const a = from < start ? start : from;
  const b = to > asOf ? asOf : to;
  return b < a ? 0 : daysBetween(a, b) + 1;
}

/** Tavalyi azonos időszak kulcsa. */
export function lastYearKey(key: string, g: Gran): string {
  const y = Number(key.slice(0, 4)) - 1;
  if (g === "year") return String(y);
  if (g === "month" || g === "quarter") return `${y}${key.slice(4)}`;
  const w = Number(key.slice(6));
  const k = `${y}-W${String(w).padStart(2, "0")}`;
  return periodKey(periodRange(k, "week").from, "week") === k ? k : `${y}-W52`;
}

/** Időszak, és az előző / tavalyi összevetés azonos hosszúságú (a folyamatban lévőnél a mai napig tartó) tartománnyal. */
export function comparison(key: string, g: Gran, asOf: string) {
  const r = periodRange(key, g);
  const to = r.to > asOf ? asOf : r.to;
  const len = Math.max(0, daysBetween(r.from, to));
  const pr = periodRange(prevPeriod(key, g), g);
  const ly = periodRange(lastYearKey(key, g), g);
  return {
    cur: { from: r.from, to },
    prev: { from: pr.from, to: addDays(pr.from, len) > pr.to ? pr.to : addDays(pr.from, len) },
    ly: { from: ly.from, to: addDays(ly.from, len) > ly.to ? ly.to : addDays(ly.from, len) },
    partial: r.to > asOf,
    fullTo: r.to,
  };
}

/** A P&L / CF táblázat oszlopai: hét → egy negyedév hetei, hónap → egy év hónapjai, év → minden év. */
export function tableScope(g: Gran, scope: string | undefined, asOf: string, first: string) {
  const y0 = Number(first.slice(0, 4)), y1 = Number(asOf.slice(0, 4));
  if (g === "year") {
    const from = `${y0}-01-01`, to = `${y1}-12-31`;
    return { keys: periodKeys(from, to, "year"), from, to, label: `${y0}–${y1}`, scope: "", prev: null, next: null };
  }
  if (g === "week") {
    const q = scope && /^\d{4}-Q[1-4]$/.test(scope) ? scope : periodKey(asOf, "quarter");
    const r = periodRange(q, "quarter");
    const keys = periodKeys(r.from, r.to, "week");
    const from = periodRange(keys[0], "week").from, to = periodRange(keys[keys.length - 1], "week").to;
    const prev = periodKey(addDays(r.from, -1), "quarter"), next = periodKey(addDays(r.to, 1), "quarter");
    return { keys, from, to, label: `${q.slice(0, 4)}. ${q.slice(-1)}. negyedév`, scope: q, prev: prev >= periodKey(first, "quarter") ? prev : null, next: next <= periodKey(asOf, "quarter") ? next : null };
  }
  const y = scope && /^\d{4}$/.test(scope) ? Number(scope) : y1;
  const from = `${y}-01-01`, to = `${y}-12-31`;
  return { keys: periodKeys(from, to, g), from, to, label: String(y), scope: String(y), prev: y > y0 ? String(y - 1) : null, next: y < y1 ? String(y + 1) : null };
}

export function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  return `${(x * 100).toFixed(digits).replace(".", ",")}%`;
}

export function fmtNum(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  return x.toLocaleString("hu-HU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Változás: relatív (%) pénzösszegeknél, százalékpont arányoknál. */
export function delta(cur: number | null, prev: number | null, kind: "rel" | "pp"): { text: string; dir: "up" | "down" | "flat" } | null {
  if (cur === null || prev === null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (kind === "pp") {
    const d = (cur - prev) * 100;
    if (Math.abs(d) < 0.05) return { text: "±0 pp", dir: "flat" };
    return { text: `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1).replace(".", ",")} pp`, dir: d > 0 ? "up" : "down" };
  }
  if (Math.abs(prev) < 1) return null;
  const d = (cur - prev) / Math.abs(prev);
  if (Math.abs(d) < 0.0005) return { text: "±0%", dir: "flat" };
  return { text: `${d > 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(0)}%`, dir: d > 0 ? "up" : "down" };
}
