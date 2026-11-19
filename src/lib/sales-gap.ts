/**
 * „N nap az előző eladás óta” – a kezdőlap csempéje.
 * A számláló a működés kezdetétől indul (cégbeállítás: operationStart, pl. PezCar 2025-07-01): az első szünet
 * a működés kezdetétől az első eladásig tart, utána két egymást követő eladási nap között.
 * Egy napon több eladás egy eladási napnak számít. A medián a lezárt szünetekből számol.
 *
 * Szín a mediánhoz képest (arány = mostani szünet / medián):
 *  - < 0,75 → zöld (0 nap a legzöldebb, 0,75 felé halványul)
 *  - 0,75 – 1,25 → sárga (medián ±25%)
 *  - > 1,25 → piros, egyre erősebb (2,5× mediánnál a legpirosabb)
 */

export type GapTone = { kind: "pos" | "warn" | "neg" | "none"; strength: number };
export type SalesGap = {
  daysSince: number | null;
  lastSale: string | null;
  median: number | null;
  gapCount: number;
  worst: { days: number; from: string; to: string; ongoing: boolean } | null;
  tone: GapTone;
};

const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

const median = (xs: number[]): number | null => {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function gapTone(daysSince: number | null, med: number | null): GapTone {
  if (daysSince == null || med == null || med <= 0) return { kind: "none", strength: 0 };
  const r = daysSince / med;
  if (r < 0.75) return { kind: "pos", strength: 1 - r / 0.75 }; // 0 nap → 1 (legzöldebb)
  if (r <= 1.25) return { kind: "warn", strength: 0.5 };
  return { kind: "neg", strength: Math.min(1, (r - 1.25) / 1.25) }; // 2,5× mediánnál 1
}

export function salesGap(saleDates: string[], start: string | null, today: string): SalesGap {
  const sales = [...new Set(saleDates.filter((d) => d && d <= today && (!start || d >= start)))].sort();
  const points = start && (!sales.length || start < sales[0]) ? [start, ...sales] : sales;
  const gaps: { days: number; from: string; to: string }[] = [];
  for (let i = 1; i < points.length; i++) gaps.push({ days: days(points[i - 1], points[i]), from: points[i - 1], to: points[i] });
  const lastSale = sales.length ? sales[sales.length - 1] : null;
  const ref = lastSale ?? start;
  const daysSince = ref ? days(ref, today) : null;
  const med = median(gaps.map((g) => g.days));

  let worst: SalesGap["worst"] = null;
  for (const g of gaps) if (!worst || g.days > worst.days) worst = { ...g, ongoing: false };
  if (ref && daysSince != null && (!worst || daysSince > worst.days)) worst = { days: daysSince, from: ref, to: today, ongoing: true };

  return { daysSince, lastSale, median: med, gapCount: gaps.length, worst, tone: gapTone(daysSince, med) };
}
