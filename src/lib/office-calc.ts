/** v6.9.0 – Könyvelőirodai nézet: tiszta segédfüggvények. */

/** A következő járulékbevallási (havi bevallás) határidő: a tárgyhót követő hónap 12-e. */
export function nextPayrollDeadline(t: string): string {
  const [y, m, d] = t.split("-").map(Number);
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-12`;
  if (d <= 12) return iso(y, m);
  return m === 12 ? iso(y + 1, 1) : iso(y, m + 1);
}

/** A legkésőbbi zárolt hónap (ÉÉÉÉ-HH), vagy null. */
export function lastClosedMonth(locks: { year: number; month: number }[]): string | null {
  if (!locks.length) return null;
  const k = Math.max(...locks.map((l) => l.year * 12 + (l.month - 1)));
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

/** Hány nap van a határidőig (negatív: lejárt). */
export const daysTo = (date: string, t: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 86_400_000);

/** Hány hónappal van lemaradva a zárás az előző hónaphoz képest (0 = az előző hónap is zárolva). */
export function closeLagMonths(lockedThrough: string | null, t: string): number | null {
  if (!lockedThrough) return null;
  const [y, m] = t.split("-").map(Number);
  const prev = y * 12 + (m - 1) - 1;
  const [ly, lm] = lockedThrough.split("-").map(Number);
  return Math.max(0, prev - (ly * 12 + (lm - 1)));
}
