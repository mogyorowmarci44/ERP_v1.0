/** v6.12.0 – a bemutató cég tiszta segédfüggvényei. */
import { addDaysIso } from "@/lib/dates";

/** Magyar adószám érvényes ellenőrző számjeggyel (9-7-3-1 súlyozás). */
export function demoTaxNumber(base7: string, vat = "2", county = "02"): string {
  const w = [9, 7, 3, 1, 9, 7, 3];
  const s = base7.split("").reduce((a, d, i) => a + Number(d) * w[i], 0);
  return `${base7}${(10 - (s % 10)) % 10}-${vat}-${county}`;
}

/** A bemutató tervezett tételei – tiszta függvény (tesztelhető): a mai naphoz igazított dátumokkal. */
export function demoPlan(t: string) {
  const d = (days: number) => addDaysIso(t, -days);
  const out = [
    { n: 1, p: 0, days: 85, lines: [["Olajcsere, szűrők", 1, 38_000, "913"], ["Motorolaj 5W-30 (5 l)", 1, 22_000, "914"]], paid: true, method: "transfer" },
    { n: 2, p: 1, days: 78, lines: [["Fékbetét csere (első)", 1, 45_000, "913"], ["Fékbetét készlet", 1, 31_000, "914"]], paid: true, method: "transfer" },
    { n: 3, p: 4, days: 70, lines: [["Műszaki vizsgára felkészítés", 1, 28_000, "913"]], paid: true, method: "cash" },
    { n: 4, p: 2, days: 61, lines: [["Flottakarbantartás – 3 gépkocsi", 3, 42_000, "913"]], paid: true, method: "transfer" },
    { n: 5, p: 0, days: 49, lines: [["Vezérlés csere", 1, 120_000, "913"], ["Vezérműszíj készlet", 1, 68_000, "914"]], paid: true, method: "transfer" },
    { n: 6, p: 3, days: 40, lines: [["Klímatöltés", 2, 18_000, "913"]], paid: false, method: "transfer" },
    { n: 7, p: 1, days: 27, lines: [["Futómű-beállítás", 1, 24_000, "913"], ["Gumiszerelés", 4, 4_500, "913"]], paid: true, method: "transfer" },
    { n: 8, p: 2, days: 15, lines: [["Flottakarbantartás – 2 gépkocsi", 2, 42_000, "913"]], paid: false, method: "transfer" },
    { n: 9, p: 4, days: 6, lines: [["Diagnosztika", 1, 15_000, "913"]], paid: true, method: "card" },
    { n: 10, p: 0, days: 2, lines: [["Kuplungcsere", 1, 95_000, "913"], ["Kuplungszett", 1, 84_000, "914"]], paid: false, method: "transfer" },
  ].map((x) => ({ ...x, date: d(x.days), due: addDaysIso(d(x.days), 8) }));
  const inn = [
    ...[88, 58, 28].map((days, i) => ({ s: 0, no: `BER-${i + 1}`, days, lines: [["Műhely bérleti díja", 1, 350_000, "522"]], paid: days > 20, periodic: true })),
    { s: 1, no: "ALK-4471", days: 80, lines: [["Alkatrész beszerzés", 1, 160_000, "511"]], paid: true, periodic: false },
    { s: 1, no: "ALK-4630", days: 44, lines: [["Alkatrész beszerzés", 1, 142_000, "511"]], paid: true, periodic: false },
    { s: 1, no: "ALK-4802", days: 10, lines: [["Alkatrész beszerzés", 1, 98_000, "511"]], paid: false, periodic: false },
    ...[75, 45, 15].map((days, i) => ({ s: 2, no: `TEL-${i + 1}`, days, lines: [["Telefon és internet", 1, 12_000, "528"]], paid: true, periodic: true })),
    { s: 3, no: "KONYV-11", days: 30, lines: [["Könyvelési díj", 1, 60_000, "529"]], paid: true, periodic: true },
  ].map((x) => ({ ...x, date: d(x.days), due: addDaysIso(d(x.days), 15) }));
  return { capitalDate: d(95), out, inn };
}

