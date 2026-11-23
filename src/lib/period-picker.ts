/**
 * v3.9.1 – Dinamikus időszakválasztó: tiszta dátumlogika (UTC, ISO „YYYY-MM-DD”).
 * Egység: nap / hét (hétfő–vasárnap) / hónap / negyedév / év.
 */

export type PickUnit = "day" | "week" | "month" | "quarter" | "year";

const DAY = 86400000;
const ms = (d: string) => Date.parse(d + "T00:00:00Z");
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

export const HU_MONTH_SHORT = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
export const HU_MONTH = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
export const ROMAN_Q = ["I.", "II.", "III.", "IV."];
export const HU_DOW = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = hétfő … 6 = vasárnap */
export const dowMon = (d: string) => (new Date(ms(d)).getUTCDay() + 6) % 7;

export function addMonths(d: string, n: number): string {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n;
  const ny = y + Math.floor(m / 12), nm = ((m % 12) + 12) % 12 + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(Number(d.slice(8, 10)), daysInMonth(ny, nm)))}`;
}

export function startOf(u: PickUnit, d: string): string {
  if (u === "day") return d;
  if (u === "week") return addDays(d, -dowMon(d));
  if (u === "month") return `${d.slice(0, 8)}01`;
  if (u === "quarter") return `${d.slice(0, 5)}${pad(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1)}-01`;
  return `${d.slice(0, 4)}-01-01`;
}

export function endOf(u: PickUnit, d: string): string {
  if (u === "day") return d;
  if (u === "week") return addDays(startOf("week", d), 6);
  if (u === "month") return `${d.slice(0, 8)}${pad(daysInMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7))))}`;
  if (u === "quarter") return endOf("month", addMonths(startOf("quarter", d), 2));
  return `${d.slice(0, 4)}-12-31`;
}

/** Egység léptetése (a kezdőnaphoz igazítva). */
export function addUnits(u: PickUnit, d: string, n: number): string {
  if (u === "day") return addDays(d, n);
  if (u === "week") return addDays(d, 7 * n);
  if (u === "month") return addMonths(d, n);
  if (u === "quarter") return addMonths(d, 3 * n);
  return addMonths(d, 12 * n);
}

/** Hány egységet fed le a [from, to] tartomány (a szélső részidőszakokkal együtt). */
export function unitCount(u: PickUnit, from: string, to: string): number {
  if (from > to) return 0;
  if (u === "day") return daysBetween(from, to) + 1;
  if (u === "week") return daysBetween(startOf("week", from), startOf("week", to)) / 7 + 1;
  const mi = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  if (u === "month") return mi(to) - mi(from) + 1;
  if (u === "quarter") return Math.floor(mi(to) / 3) - Math.floor(mi(from) / 3) + 1;
  return Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1;
}

/** A tartomány a legnagyobb olyan egységre, amelynek határaira pontosan illeszkedik (léptetéshez). */
export function alignedUnit(from: string, to: string): PickUnit {
  for (const u of ["year", "quarter", "month", "week"] as PickUnit[]) if (startOf(u, from) === from && endOf(u, to) === to) return u;
  return "day";
}

/**
 * ‹ / › léptetés: a tartományt saját hosszával tolja el. Egész hónap / negyedév / év tartomány
 * egész egységekben lép (pl. jan.–márc. → ápr.–jún.), egyébként napokban. A `unit` a nézet bontása.
 */
export function shiftRange(from: string, to: string, dir: 1 | -1, unit: PickUnit = "day"): { from: string; to: string } {
  const a = alignedUnit(from, unit === "day" ? to : endOf(unit, to));
  if (a !== "day") {
    const n = unitCount(a, from, to) * dir;
    const f = addUnits(a, startOf(a, from), n);
    return { from: f, to: endOf(a, addUnits(a, startOf(a, to), n)) };
  }
  const n = (daysBetween(from, to) + 1) * dir;
  return { from: addDays(from, n), to: addDays(to, n) };
}

/** Egy egység rövid magyar címkéje. */
export function unitLabel(u: PickUnit, d: string): string {
  const y = d.slice(0, 4), m = Number(d.slice(5, 7));
  if (u === "day") return `${y}. ${HU_MONTH_SHORT[m - 1]} ${Number(d.slice(8, 10))}.`;
  if (u === "week") return `${isoWeek(d).year}. ${isoWeek(d).week}. hét`;
  if (u === "month") return `${y}. ${HU_MONTH_SHORT[m - 1]}`;
  if (u === "quarter") return `${y}. ${ROMAN_Q[Math.floor((m - 1) / 3)]} n.év`;
  return y;
}

/** Tartomány címke a választott bontásban (ha a kezdőnap nem egységhatár, napra). */
export function rangeLabel(u: PickUnit, from: string, to: string): string {
  if (!from || !to) return "–";
  const unit: PickUnit = u !== "day" && startOf(u, from) === from ? u : "day";
  if (unit === "week") {
    const a = isoWeek(from), b = isoWeek(to);
    if (a.year === b.year && a.week === b.week) return `${a.year}. ${a.week}. hét`;
    if (a.year === b.year) return `${a.year}. ${a.week}.–${b.week}. hét`;
    return `${a.year}. ${a.week}. hét – ${b.year}. ${b.week}. hét`;
  }
  const a = unitLabel(unit, from), b = unitLabel(unit, to);
  if (a === b) return a;
  if (unit === "year") return `${a} – ${b}`;
  if (unit === "quarter" && from.slice(0, 4) === to.slice(0, 4)) return `${a.slice(0, -5)}–${b.slice(6)}`;
  // azonos év: a második részből az év elhagyható („2026. ” = 6 karakter)
  return from.slice(0, 4) === to.slice(0, 4) ? `${a} – ${b.slice(6)}` : `${a} – ${b}`;
}

export function isoWeek(d: string): { year: number; week: number } {
  const thu = addDays(d, 3 - dowMon(d));
  const y = Number(thu.slice(0, 4));
  return { year: y, week: Math.floor(daysBetween(`${y}-01-01`, thu) / 7) + 1 };
}

/** Havi naptár-mátrix: hétfővel kezdődő hetek, mindegyikben 7 ISO dátum. */
export function monthMatrix(y: number, m: number): string[][] {
  const first = `${y}-${pad(m)}-01`;
  let cur = startOf("week", first);
  const last = endOf("month", first);
  const out: string[][] = [];
  while (cur <= last) {
    out.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
    cur = addDays(cur, 7);
  }
  return out;
}

export type Preset = { key: string; label: string; from: string; to: string };

/** Gyorsválasztók a bontáshoz illeszkedve. `t` = mai nap. */
export function presets(u: PickUnit, t: string): Preset[] {
  const P = (key: string, label: string, from: string, to: string): Preset => ({ key, label, from, to });
  const lastN = (unit: PickUnit, n: number, label: string) => P(`${unit}${n}`, label, addUnits(unit, startOf(unit, t), -(n - 1)), endOf(unit, t));
  const prev = (unit: PickUnit) => addUnits(unit, startOf(unit, t), -1);
  const thisW = P("w0", "Ez a hét", startOf("week", t), endOf("week", t));
  const prevW = P("w-1", "Előző hét", prev("week"), endOf("week", prev("week")));
  const thisM = P("m0", "Ez a hónap", startOf("month", t), endOf("month", t));
  const prevM = P("m-1", "Előző hónap", prev("month"), endOf("month", prev("month")));
  const thisQ = P("q0", "Ez a negyedév", startOf("quarter", t), endOf("quarter", t));
  const prevQ = P("q-1", "Előző negyedév", prev("quarter"), endOf("quarter", prev("quarter")));
  const ytd = P("ytd", "Év elejétől máig", startOf("year", t), t);
  const thisY = P("y0", "Idei év", startOf("year", t), endOf("year", t));
  const prevY = P("y-1", "Tavaly", prev("year"), endOf("year", prev("year")));
  switch (u) {
    case "day":
      return [P("d0", "Ma", t, t), P("d-1", "Tegnap", addDays(t, -1), addDays(t, -1)), P("d7", "Elmúlt 7 nap", addDays(t, -6), t), P("d30", "Elmúlt 30 nap", addDays(t, -29), t),
        thisW, prevW, thisM, prevM, thisQ, prevQ, ytd, prevY, P("d365", "Elmúlt 12 hónap", addDays(addMonths(t, -12), 1), t)];
    case "week":
      return [thisW, prevW, lastN("week", 4, "Elmúlt 4 hét"), lastN("week", 8, "Elmúlt 8 hét"), lastN("week", 13, "Elmúlt 13 hét"), lastN("week", 26, "Elmúlt 26 hét"), thisQ, prevQ];
    case "month":
      return [thisM, prevM, lastN("month", 3, "Elmúlt 3 hónap"), lastN("month", 6, "Elmúlt 6 hónap"), lastN("month", 12, "Elmúlt 12 hónap"), thisY, prevY, lastN("month", 24, "Elmúlt 24 hónap")];
    case "quarter":
      return [thisQ, prevQ, lastN("quarter", 4, "Elmúlt 4 negyedév"), lastN("quarter", 8, "Elmúlt 8 negyedév"), thisY, prevY];
    case "year":
      return [thisY, prevY, lastN("year", 2, "Elmúlt 2 év"), lastN("year", 3, "Elmúlt 3 év"), lastN("year", 5, "Elmúlt 5 év")];
  }
}

/** Két kattintás egységei → rendezett, egység-határokra kerekített tartomány. */
export function rangeFromClicks(u: PickUnit, a: string, b: string): { from: string; to: string } {
  const [x, y] = a <= b ? [a, b] : [b, a];
  return { from: startOf(u, x), to: endOf(u, y) };
}

/** Bontásváltáskor: a tartomány az új egység határaira kerekítve, ha legfeljebb `max` egység; különben null. */
export function snapRange(u: PickUnit, from: string, to: string, max: number): { from: string; to: string } | null {
  const r = { from: startOf(u, from), to: u === "day" ? to : endOf(u, to) };
  return unitCount(u, r.from, r.to) <= max ? r : null;
}

/** Egy időszak URL-kulcsa (a vendégház nézetek formátuma): „2026”, „2026-11”, „2026-Q4”, „2026-W48”, nap: ISO. */
export function periodParam(u: PickUnit, d: string): string {
  if (u === "year") return d.slice(0, 4);
  if (u === "month") return d.slice(0, 7);
  if (u === "quarter") return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  if (u === "week") {
    const w = isoWeek(d);
    return `${w.year}-W${pad(w.week)}`;
  }
  return d;
}
