/**
 * EPR (kiterjesztett gyártói felelősség) – gépjármű termékáram, tiszta számítási logika.
 *
 * Jogszabályok: 80/2023. (III. 14.) Korm. rendelet (EPR-rendelet), 8/2023. (VI. 2.) EM rendelet (díjtételek).
 * - Kötelezett: aki a gépjárművet Magyarországon ELSŐKÉNT forgalomba hozza (első belföldi tulajdon-átruházás).
 *   Használtautó-kereskedőnél: külföldről behozott autó belföldi eladása. Belföldön vett autó → már forgalomba hozták.
 *   Külföldre (export / Közösségen belüli) eladott autó → nincs belföldi forgalomba hozatal.
 * - Hatály: M1, N1 és háromkerekű (motoros tricikli kivételével) gépjármű.
 * - Díj: Ft/kg × tömeg. Választható díjátalány (egész naptári évre), ami a tartozékok, alkotórészek
 *   (akkumulátor, gumi, elektromos eszközök) és a csomagolás díját is tartalmazza. Átalány nélkül azokat külön kell bevallani.
 * - Adatszolgáltatás: negyedévente, a tárgynegyedévet követő hónap 20-áig (OKIR, KG:KGYF-NÉ). A díjat a MOHU számlázza.
 *
 * ⚠ DRAFT: a díjtáblák és a KF-kód 5–8. karaktere a nyilvános forrásokból összerakott állapot – élesítés előtt
 *   a hatályos 80/2023. 1. melléklet 2.4.5 / 2.5 / 2.6 pontjával és a 8/2023. EM 1–2. mellékletével egyeztetendő.
 */

export type EprCategory = "M1" | "N1" | "3W";
export type EprDrive = "ice" | "hev" | "phev" | "bev"; // belső égésű | részben el. (nem tölthető) | részben el. (tölthető) | tisztán elektromos
export type EprOrigin = "import" | "domestic";

export const EPR_CATEGORY_LABEL: Record<EprCategory, string> = {
  M1: "M1 – személygépkocsi",
  N1: "N1 – áruszállító ≤ 3,5 t",
  "3W": "háromkerekű gépjármű (nem motoros tricikli)",
};
export const EPR_DRIVE_LABEL: Record<EprDrive, string> = {
  ice: "belső égésű",
  hev: "részben elektromos, nem tölthető (HEV)",
  phev: "részben elektromos, tölthető (PHEV)",
  bev: "tisztán elektromos (BEV)",
};

type FlatTable = Record<EprCategory, Record<EprDrive, number>>;
export type EprRateTable = { from: string; label: string; itemized: number; flat: FlatTable; verified: boolean };

/** Díjtáblák érvényesség szerint (a forgalomba hozatal napja dönt). Ft/kg, a gyártó által fizetendő teljes díj (E oszlop). */
export const EPR_RATE_TABLES: EprRateTable[] = [
  {
    from: "2023-07-01",
    label: "8/2023. EM – 2025. szeptember 30-ig",
    itemized: 21,
    flat: {
      M1: { ice: 29.07, hev: 31.25, phev: 37.79, bev: 51.21 },
      N1: { ice: 27.15, hev: 30.86, phev: 30.86, bev: 38.36 },
      "3W": { ice: 37.18, hev: 48.08, phev: 48.08, bev: 48.08 },
    },
    verified: false, // a 2024-es egységes szöveg szerinti értékek; 2023 H2-ben eltérhettek
  },
  {
    from: "2025-10-01",
    label: "8/2023. EM – 2025. október 1-jétől",
    itemized: 36,
    flat: {
      M1: { ice: 44.89, hev: 46.92, phev: 53, bev: 65.35 },
      N1: { ice: 43.57, hev: 47.05, phev: 47.05, bev: 54 },
      "3W": { ice: 53.87, hev: 64.02, phev: 64.02, bev: 64.02 },
    },
    verified: true,
  },
];

export function rateTableFor(date: string): EprRateTable {
  const t = [...EPR_RATE_TABLES].reverse().find((r) => r.from <= date);
  return t ?? EPR_RATE_TABLES[0];
}

/** Ft/kg díjtétel. Átalány nélkül egységes J01 díjkód. */
export function eprRate(date: string, category: EprCategory, drive: EprDrive, flat: boolean): number {
  const t = rateTableFor(date);
  return flat ? t.flat[category][drive] : t.itemized;
}

const ANYAGARAM: Record<EprCategory, string> = { M1: "10", N1: "20", "3W": "30" };

/**
 * Csoportkód (5–6. karakter): 1980 előtt gyártott „1x”, utána „2x”; x = 0 átalány nélkül,
 * átalánynál 1 belső égésű, 2 M1 tölthető hibrid, 3 M1 nem tölthető hibrid, 4 N1/háromkerekű részben el., 5 tisztán el.
 * (A 435/2023. Korm. rendelettel bevezetett bontás; az 5-ös kód következtetett – ellenőrizendő.)
 */
export function eprGroupCode(year: number | null, flat: boolean, category: EprCategory, drive: EprDrive): string {
  const decade = year !== null && year < 1980 ? "1" : "2";
  if (!flat) return decade + "0";
  let x = "1";
  if (drive === "bev") x = "5";
  else if (drive === "phev" || drive === "hev") x = category === "M1" ? (drive === "phev" ? "2" : "3") : "4";
  return decade + x;
}

/**
 * 8 jegyű KF kód: 15 (gépjármű) + anyagáram + csoport + 7. kötelezettség (1 = kollektív teljesítés) + 8. származás.
 * A származáskódot a cég beállításaiból kapjuk; ha nincs megadva, „?” kerül a helyére.
 */
export function eprKfCode(args: { category: EprCategory; drive: EprDrive; year: number | null; flat: boolean; originDigit: string | null }): string {
  return "15" + ANYAGARAM[args.category] + eprGroupCode(args.year, args.flat, args.category, args.drive) + "1" + (args.originDigit?.trim() || "?");
}

export function eprFee(massKg: number, rate: number): number {
  return Math.round(massKg * rate);
}

export type Quarter = { year: number; q: 1 | 2 | 3 | 4 };
export function quarterOf(date: string): Quarter {
  const m = Number(date.slice(5, 7));
  return { year: Number(date.slice(0, 4)), q: (Math.floor((m - 1) / 3) + 1) as Quarter["q"] };
}
export function quarterRange({ year, q }: Quarter): { from: string; to: string } {
  const m1 = (q - 1) * 3 + 1;
  const m3 = m1 + 2;
  const last = new Date(Date.UTC(year, m3, 0)).getUTCDate();
  return { from: `${year}-${String(m1).padStart(2, "0")}-01`, to: `${year}-${String(m3).padStart(2, "0")}-${last}` };
}
/** Adatszolgáltatási határidő: a tárgynegyedévet követő hónap 20-a. */
export function eprDeadline({ year, q }: Quarter): string {
  return q === 4 ? `${year + 1}-01-20` : `${year}-${String(q * 3 + 1).padStart(2, "0")}-20`;
}
export const quarterLabel = ({ year, q }: Quarter) => `${year}. ${q}. negyedév`;

/** Kötelezettség eldöntése a beszerzés és az első eladás alapján. */
export type EprStatus =
  | { liable: true; reason: string }
  | { liable: false; reason: string }
  | { liable: null; reason: string }; // nem eldönthető (hiányzó adat)

export function eprLiability(args: { origin: EprOrigin | null; saleDate: string | null; buyerCountry: string | null; category: EprCategory | null }): EprStatus {
  if (args.category === null) return { liable: null, reason: "Nincs megadva a járműkategória (M1 / N1 / háromkerekű)." };
  if (args.origin === "domestic") return { liable: false, reason: "Belföldön beszerzett gépjármű – a belföldi forgalomba hozatal már korábban megtörtént." };
  if (args.origin === null) return { liable: null, reason: "A beszerzés származása nem állapítható meg (nincs beszerzési számla, és kézzel sincs megadva)." };
  if (!args.saleDate) return { liable: null, reason: "Külföldről behozott – még nincs eladva; a kötelezettség az első belföldi eladáskor keletkezik." };
  if (args.buyerCountry && args.buyerCountry !== "HU") return { liable: false, reason: `Külföldi vevő (${args.buyerCountry}) – a gépjármű nem kerül belföldi forgalomba.` };
  return { liable: true, reason: "Külföldről behozott gépjármű első belföldi tulajdon-átruházása – első belföldi forgalomba hozatal." };
}

/** Számlán kötelező szöveg (EPR-rendelet 21. § (2)) – kiskereskedelmi értékesítés kivételével. */
export const EPR_INVOICE_TEXT = "A kiterjesztett gyártói felelősségi díj megfizetése az eladót terheli.";
