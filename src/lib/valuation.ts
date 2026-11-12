/**
 * v2.0 – Vendégház: ingatlan piaci értékének becslése és a teljes (piaci értékkel számolt) hozam.
 *
 * Három módszer, súlyozva:
 *  1. Összehasonlító (piaci) – súlyozott alapterület × helyi fajlagos ár (Szigetvár, felújított zártkerti / hétvégi házak).
 *  2. Hozamszámítás – utolsó 12 hónap működési pénzárama (NOI, jövedelemadó nélkül) / tőkésítési ráta.
 *  3. Indexált vételár – a vételár az MNB-lakásárindex (vidéki városok) változásával.
 */
import { daysBetween } from "./gh-calc";

/**
 * MNB nominális lakásárindex, vidéki városok – szintek (2021. III. n.év = 100), az MNB negyedéves tájékoztatói alapján:
 * éves változás III. negyedévenként 2022: +22,7%, 2023: +5,5%, 2024: +12,3%, 2025: +21,5%;
 * negyedéves változás 2025. IV.: +5,3%, 2026. I.: +4,3%, 2026. II.: −0,6%.
 */
export const HPI_CITIES: Array<[string, number]> = [
  ["2021-Q3", 100],
  ["2022-Q3", 122.7],
  ["2023-Q3", 129.45],
  ["2024-Q3", 145.37],
  ["2025-Q3", 176.63],
  ["2025-Q4", 185.99],
  ["2026-Q1", 193.99],
  ["2026-Q2", 192.83],
];
export const HPI_LAST = HPI_CITIES[HPI_CITIES.length - 1][0];
export const HPI_SOURCE = "MNB lakásárindex, vidéki városok (nominális), utolsó adat: 2026. II. negyedév";

const qNum = (k: string) => Number(k.slice(0, 4)) * 4 + Number(k.slice(-1)) - 1;
const qKey = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

/** Árindex-szint egy negyedévre (a horgonypontok között mértani interpolációval, a végeken rögzítve). */
export function hpiLevel(quarter: string): number {
  const q = qNum(quarter);
  const pts = HPI_CITIES.map(([k, v]) => [qNum(k), v] as const);
  if (q <= pts[0][0]) return pts[0][1];
  if (q >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    const [q1, v1] = pts[i];
    const [q0, v0] = pts[i - 1];
    if (q <= q1) return v0 * Math.pow(v1 / v0, (q - q0) / (q1 - q0));
  }
  return pts[pts.length - 1][1];
}

export function hpiFactorSince(date: string): number {
  return hpiLevel(HPI_LAST) / hpiLevel(qKey(date));
}

export type PropertyInfo = {
  address?: string | null;
  hrsz?: string | null;
  plotM2?: number | null;
  floorM2?: number | null;
  galleryM2?: number | null;
  terraceM2?: number | null;
  /** Fajlagos ár a súlyozott alapterületre (Ft/m²). */
  priceM2?: number | null;
  /** Tőkésítési ráta (pl. 0.09). */
  capRate?: number | null;
  /** Berendezések, dézsa stb. jelenlegi értéke (Ft), a fajlagos áron felül. */
  equipmentValue?: number | null;
  /** Melyik becslés legyen az eladási ár a „mi lenne, ha eladnám” számításban. */
  method?: SaleMethod | null;
  /** Ingatlan-nyilvántartás szerint lakóingatlan (5 év után adómentes) vagy egyéb (15 éves sáv). */
  kind?: "residential" | "other" | null;
  /** Ingatlanközvetítő díja a vételár %-ában (ÁFA nélkül). */
  agentPct?: number | null;
  /** Egyéb eladási költség (ügyvéd, energetikai tanúsítvány, hirdetés), Ft. */
  otherSaleCosts?: number | null;
  /** Számlával igazolt értéknövelő beruházások (csökkentik az adóalapot), Ft. */
  improvements?: number | null;
};

export type SaleMethod = "blend" | "comparable" | "income" | "indexed";
export const SALE_METHOD_LABEL: Record<SaleMethod, string> = {
  blend: "Súlyozott (mindhárom)",
  comparable: "Összehasonlító",
  income: "Hozamszámítás",
  indexed: "Indexált vételár",
};

export const SALE_DEFAULTS = { agentPct: 0.03, agentVat: 0.27, otherSaleCosts: 150_000, kind: "residential" as const };
export const SALE_SZJA = 0.15;

/**
 * Ingatlaneladás SZJA-köteles hányada (Szja tv. 62. §): lakóingatlannál a szerzés éve és a következő év 100%,
 * a 2. évben 90%, a 3. évben 60%, a 4. évben 30%, az 5. évtől 0%. Egyéb ingatlannál az 5. évig 100%,
 * a 6. évtől évente 10 százalékponttal csökken, a 15. évtől 0%.
 */
export function taxableShare(kind: "residential" | "other", acqDate: string, saleDate: string): number {
  const diff = Number(saleDate.slice(0, 4)) - Number(acqDate.slice(0, 4));
  if (kind === "residential") return diff <= 1 ? 1 : diff === 2 ? 0.9 : diff === 3 ? 0.6 : diff === 4 ? 0.3 : 0;
  if (diff <= 5) return 1;
  return Math.max(0, 1 - (diff - 5) * 0.1);
}

export type SaleOutcome = {
  price: number;
  agentFee: number;
  otherCosts: number;
  income: number;
  share: number;
  taxBase: number;
  szja: number;
  net: number;
};

/** Eladás: ár − közvetítői díj (+ÁFA) − egyéb költség − SZJA = nettó eladási bevétel. */
export function saleOutcome(p: PropertyInfo, price: number, costBasis: number, acqDate: string, saleDate: string): SaleOutcome {
  const agentFee = price * (p.agentPct ?? SALE_DEFAULTS.agentPct) * (1 + SALE_DEFAULTS.agentVat);
  const otherCosts = p.otherSaleCosts ?? SALE_DEFAULTS.otherSaleCosts;
  const income = Math.max(0, price - agentFee - otherCosts - costBasis - (p.improvements ?? 0));
  const share = taxableShare(p.kind ?? SALE_DEFAULTS.kind, acqDate, saleDate);
  const taxBase = income * share;
  const szja = Math.round(taxBase * SALE_SZJA);
  return { price, agentFee, otherCosts, income, share, taxBase, szja, net: price - agentFee - otherCosts - szja };
}

export function chosenValue(v: { comparable: number | null; income: number | null; indexed: number | null; value: number }, m: SaleMethod | null | undefined): number {
  const x = m && m !== "blend" ? v[m] : null;
  return x ?? v.value;
}

export const PROPERTY_DEFAULTS = { priceM2: 320_000, capRate: 0.09 };
export const GALLERY_WEIGHT = 0.5;
export const TERRACE_WEIGHT = 1 / 3;
export const METHOD_WEIGHTS = { comparable: 0.4, income: 0.4, indexed: 0.2 };

export function weightedArea(p: PropertyInfo): number {
  return (p.floorM2 ?? 0) + GALLERY_WEIGHT * (p.galleryM2 ?? 0) + TERRACE_WEIGHT * (p.terraceM2 ?? 0);
}

export type Valuation = {
  area: number;
  comparable: number | null;
  income: number | null;
  indexed: number | null;
  value: number;
  low: number;
  high: number;
  noi: number;
  hpiFactor: number;
};

/**
 * Becsült piaci érték. noi = utolsó 12 hónap működési pénzárama jövedelemadó (tételes adó) nélkül;
 * purchase = vételár (illeték nélkül), purchaseDate = vásárlás napja.
 */
export function valuate(p: PropertyInfo, noi: number, purchase: number, purchaseDate: string): Valuation {
  const area = weightedArea(p);
  const priceM2 = p.priceM2 ?? PROPERTY_DEFAULTS.priceM2;
  const cap = p.capRate ?? PROPERTY_DEFAULTS.capRate;
  const equip = p.equipmentValue ?? 0;
  const comparable = area > 0 ? area * priceM2 + equip : null;
  const income = noi > 0 && cap > 0 ? noi / cap : null;
  const hpiFactor = hpiFactorSince(purchaseDate);
  const indexed = purchase > 0 ? purchase * hpiFactor : null;
  const parts: Array<[number | null, number]> = [
    [comparable, METHOD_WEIGHTS.comparable],
    [income, METHOD_WEIGHTS.income],
    [indexed, METHOD_WEIGHTS.indexed],
  ];
  const used = parts.filter(([v]) => v !== null) as Array<[number, number]>;
  const w = used.reduce((a, [, x]) => a + x, 0);
  const value = w ? used.reduce((a, [v, x]) => a + v * x, 0) / w : 0;
  const vals = used.map(([v]) => v);
  return { area, comparable, income, indexed, value, low: vals.length ? Math.min(...vals) : 0, high: vals.length ? Math.max(...vals) : 0, noi, hpiFactor };
}

/** Belső megtérülési ráta (éves), napi pontosságú pénzáramokra, felezéses kereséssel. */
export function irr(flows: Array<{ date: string; amount: number }>): number | null {
  if (flows.length < 2) return null;
  const t0 = flows[0].date;
  const npv = (r: number) => flows.reduce((a, f) => a + f.amount / Math.pow(1 + r, daysBetween(t0, f.date) / 365.25), 0);
  let lo = -0.99, hi = 1;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 0.5) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

