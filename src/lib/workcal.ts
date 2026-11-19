/**
 * Magyar munkaidőnaptár (általános munkarend, H–P): munkaszüneti napok (Mt. 102. §) és az évenkénti
 * munkanap-áthelyezések (NGM-rendeletek). Tiszta függvények – a kliens (jelenléti naptár) is használja.
 *
 * Az áthelyezéseket évente fel kell venni a SWAPS-ba, amint megjelenik a rendelet.
 * 2026. november 14-től december 24. is munkaszüneti nap (2026. évi LXXII. törvény), a 2026. december 12-i
 * ledolgozós szombat elmaradt.
 */

export type DayType = "work" | "rest" | "holiday";
export type CalDay = { date: string; day: number; dow: number; type: DayType; label?: string };

/** Munkanap-áthelyezések: work = áthelyezett munkanap (szombat), rest = áthelyezett pihenőnap. */
export const SWAPS: Record<number, { work: string[]; rest: string[]; source: string }> = {
  2025: { work: ["2025-05-17", "2025-10-18", "2025-12-13"], rest: ["2025-05-02", "2025-10-24", "2025-12-24"], source: "11/2024. (IV. 8.) NGM rendelet" },
  2026: { work: ["2026-01-10", "2026-08-08"], rest: ["2026-01-02", "2026-08-21"], source: "10/2025. (IV. 30.) NGM rendelet, a dec. 12-i munkanap a 2026. novemberi módosítással elmaradt" },
};
export const hasSwapData = (year: number) => year in SWAPS;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Húsvétvasárnap (Gergely-naptár, anonim algoritmus). */
export function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

const holidayCache = new Map<number, Map<string, string>>();
/** Munkaszüneti napok egy évben: dátum → megnevezés. */
export function holidays(y: number): Map<string, string> {
  const hit = holidayCache.get(y);
  if (hit) return hit;
  const e = easter(y);
  const m = new Map<string, string>([
    [`${y}-01-01`, "Újév"],
    [`${y}-03-15`, "Nemzeti ünnep"],
    [`${y}-05-01`, "A munka ünnepe"],
    [`${y}-08-20`, "Államalapítás ünnepe"],
    [`${y}-10-23`, "Nemzeti ünnep"],
    [`${y}-11-01`, "Mindenszentek"],
    [`${y}-12-25`, "Karácsony"],
    [`${y}-12-26`, "Karácsony másnapja"],
  ]);
  if (y >= 2017) m.set(iso(addDays(e, -2)), "Nagypéntek");
  m.set(iso(e), "Húsvét");
  m.set(iso(addDays(e, 1)), "Húsvéthétfő");
  m.set(iso(addDays(e, 49)), "Pünkösd");
  m.set(iso(addDays(e, 50)), "Pünkösdhétfő");
  if (y >= 2026) m.set(`${y}-12-24`, "Szenteste");
  holidayCache.set(y, m);
  return m;
}

/** Egy nap besorolása az általános munkarendben. */
export function dayInfo(date: string): CalDay {
  const y = Number(date.slice(0, 4));
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = hétfő … 6 = vasárnap
  const base = { date, day: d.getUTCDate(), dow };
  const hol = holidays(y).get(date);
  if (hol) return { ...base, type: "holiday", label: hol };
  const sw = SWAPS[y];
  if (sw?.work.includes(date)) return { ...base, type: "work", label: "Áthelyezett munkanap" };
  if (sw?.rest.includes(date)) return { ...base, type: "rest", label: "Áthelyezett pihenőnap" };
  return { ...base, type: dow >= 5 ? "rest" : "work" };
}

/** A hónap napjai (period = YYYY-MM). */
export function monthDays(period: string): CalDay[] {
  const [y, m] = period.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => dayInfo(`${period}-${String(i + 1).padStart(2, "0")}`));
}

/** Munkanapok száma a hónapban (opcionálisan csak a [from, to] közé esők). */
export function workdaysIn(period: string, from?: string, to?: string | null) {
  return monthDays(period).filter((d) => d.type === "work" && (!from || d.date >= from) && (!to || d.date <= to)).length;
}
