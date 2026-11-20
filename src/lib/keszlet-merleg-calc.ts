/**
 * v3.5.0 – KészletMérleg: az összes autó AutóMérlege egy helyen (tiszta számoló – tesztelhető).
 * Ugyanazzal a számolóval fut végig minden autón, mint az AutóMérleg, így a számok egyeznek az autók lapjával.
 *
 * Készlet: állapot autónként – piros („beavatkozni”): az ár a nullszaldó alatt van, vagy `redDays` napon belül eléri;
 *   sárga: nyereséges, de a cél alatt; zöld: a cél fölött. Összesen: lekötött pénz, napi tartási költség, várható nettó fedezet.
 * Eladott: bruttó / nettó fedezet összesen és medián, napi fedezet, legjobb / leggyengébb 5, pontdiagram,
 *   „Hová folyt el a fedezet?” (a Forecast-tervvel rendelkező autók): tervezett nettó fedezet → költségeltérés → áreltérés → tényleges.
 */
import { autoMerleg, type AutoMerleg, type MerlegInput } from "./auto-merleg-calc";

export const RED_DAYS_DEFAULT = 20;
export type KmCar = { id: number; title: string; plate: string | null; input: MerlegInput; saleDate: string | null; origin: "import" | "domestic" | null; group: string };
export type KmStatus = "red" | "yellow" | "green";

const median = (xs: number[]): number | null => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function statusOf(r: AutoMerleg, redDays: number): KmStatus {
  if (r.price < r.floor || (r.daysToFloor != null && r.daysToFloor < redDays)) return "red";
  if (r.price < r.goal) return "yellow";
  return "green";
}

export function stockView(cars: KmCar[], redDays = RED_DAYS_DEFAULT) {
  const rows = cars.map((c) => { const r = autoMerleg(c.input); return { ...c, r, status: statusOf(r, redDays) }; })
    .sort((a, b) => (b.r.days ?? 0) - (a.r.days ?? 0));
  const by = (s: KmStatus) => rows.filter((x) => x.status === s);
  return {
    rows, red: by("red"), yellow: by("yellow"), green: by("green"),
    totals: {
      count: rows.length,
      capital: sum(rows.map((x) => x.r.capital)),
      holdingPerDay: sum(rows.map((x) => x.r.holdingPerDay)),
      holding: sum(rows.map((x) => x.r.holding)),
      f2: sum(rows.map((x) => x.r.f2)),
      f3: sum(rows.map((x) => x.r.f3)),
    },
  };
}

export type KmGroupBy = "none" | "model" | "origin" | "month";

export function soldView(cars: KmCar[], groupBy: KmGroupBy = "none") {
  const rows = cars.map((c) => ({ ...c, r: autoMerleg(c.input) }));
  const f2s = rows.map((x) => x.r.f2);
  const revenue = sum(rows.map((x) => x.r.price));
  const ranked = rows.filter((x) => x.r.perDayMargin != null).sort((a, b) => b.r.perDayMargin! - a.r.perDayMargin!);

  // Hová folyt el: csak a Forecast-tervvel (tervezett árral) rendelkező autók
  const planned = rows.filter((x) => x.input.plan?.price != null);
  let planF2 = 0, costEffect = 0, priceEffect = 0, actualF2 = 0;
  for (const x of planned) {
    const net = x.r.rows.find((row) => row.label === "Nettó fedezet");
    const costs = x.r.rows.find((row) => row.label === "Költségek");
    if (!net || net.plan == null) continue;
    const ce = costs && costs.plan != null ? -(costs.actual - costs.plan) : 0;
    planF2 += net.plan; actualF2 += net.actual; costEffect += ce; priceEffect += net.actual - net.plan - ce;
  }

  const keyOf = (x: (typeof rows)[number]) =>
    groupBy === "model" ? x.group : groupBy === "origin" ? (x.origin === "import" ? "Import" : x.origin === "domestic" ? "Belföld" : "Ismeretlen") : groupBy === "month" ? (x.saleDate ?? "").slice(0, 7) : "";
  const groups = groupBy === "none" ? [] : [...rows.reduce((m, x) => m.set(keyOf(x), [...(m.get(keyOf(x)) ?? []), x]), new Map<string, typeof rows>()).entries()]
    .map(([key, xs]) => ({
      key, count: xs.length, f1: sum(xs.map((x) => x.r.f1)), f2: sum(xs.map((x) => x.r.f2)),
      medF2: median(xs.map((x) => x.r.f2)), medDays: median(xs.map((x) => x.r.days ?? NaN)), medPerDay: median(xs.map((x) => x.r.perDayMargin ?? NaN)),
      pct: sum(xs.map((x) => x.r.price)) ? sum(xs.map((x) => x.r.f2)) / sum(xs.map((x) => x.r.price)) : 0,
    }))
    .sort((a, b) => (groupBy === "month" ? b.key.localeCompare(a.key) : b.count - a.count || b.f2 - a.f2));

  return {
    rows: [...rows].sort((a, b) => (b.saleDate ?? "").localeCompare(a.saleDate ?? "")),
    totals: {
      count: rows.length, revenue, f1: sum(rows.map((x) => x.r.f1)), f2: sum(f2s), pct: revenue ? sum(f2s) / revenue : 0,
      medF2: median(f2s), medDays: median(rows.map((x) => x.r.days ?? NaN)), medPerDay: median(rows.map((x) => x.r.perDayMargin ?? NaN)),
    },
    top: ranked.slice(0, 5), bottom: ranked.slice(-5).reverse(),
    scatter: rows.filter((x) => x.r.days != null).map((x) => ({ id: x.id, title: x.title, days: x.r.days!, f2: x.r.f2 })),
    leak: { cars: planned.length, without: rows.length - planned.length, planF2, costEffect, priceEffect, actualF2 },
    groups,
  };
}
