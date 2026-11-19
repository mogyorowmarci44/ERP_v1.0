/**
 * ÁrSugó – árajánló gépkocsikhoz. A felhasználó a beszerzési árat és a tervezett költségeket adja meg,
 * minden más számolt: padló ár (0 fedezet), cél ár (célfedezettel), hirdetési ár (cél + alkuráhagyás, 99-re kerekítve).
 *
 * ÁFA-módok (alapértelmezés mindkét oldalon a különbözeti):
 * - vétel különbözeti: a beszerzési ár egésze a bekerülés része, nincs levonható ÁFA;
 * - vétel normál ÁFA: a beírt ár bruttó, a 27% ÁFA levonható → a bekerülés a nettó;
 * - eladás különbözeti: ÁFA = (bruttó eladási ár − beszerzési ár) × 27/127, negatív különbözetnél 0;
 * - eladás normál ÁFA: ÁFA = bruttó eladási ár × 27/127.
 * Levont ÁFÁ-jú (normál) vétel után különbözeti eladás nem lehetséges → normál ÁFÁ-val számol, és jelzi.
 *
 * A költségek nettóban értendők (az ÁFÁ-juk levonható). A fedezet = nettó árbevétel − teljes bekerülés
 * (ugyanaz, mint a KPI-Dashboard „Fedezet II”-je).
 */

export type VatMode = "margin" | "normal";

export const VAT_RATE = 0.27;
/** Alkuráhagyás a cél ár fölött. */
export const HAGGLE = 0.05;
/** Célfedezet, ha még nincs eladott autó: a bekerülés ennyi százaléka. */
export const FALLBACK_TARGET_PCT = 0.1;

const K = 1 + VAT_RATE; // 1,27

export type ArsugoInput = {
  /** Beszerzési ár (különbözeti vételnél a kifizetett ár, normál ÁFÁ-s vételnél a bruttó számlaérték). */
  buy: number;
  buyMode: VatMode;
  sellMode: VatMode;
  /** Tervezett költségek összesen, nettó. */
  costs: number;
  /** Célfedezet Ft-ban (az eladott autók mediánja); null → a bekerülés 10%-a. */
  target: number | null;
};

export type PricePoint = { price: number; vat: number; netRevenue: number; margin: number; marginPct: number };

export type ArsugoResult = {
  /** Normál vétel + különbözeti eladás kérés → normál eladásra váltva. */
  invalidCombo: boolean;
  sellMode: VatMode;
  /** Beszerzés a bekerülésben (normál vételnél nettó). */
  buyBase: number;
  /** Levonható beszerzési ÁFA (különbözeti vételnél 0). */
  buyVat: number;
  totalCost: number;
  target: number;
  targetFromHistory: boolean;
  floor: PricePoint;
  goal: PricePoint;
  /** Cél + alkuráhagyás, kerekítés előtt. */
  goalWithHaggle: number;
  ask: PricePoint;
};

/** Felfelé kerekítés a legközelebbi, ezresekben 99-re végződő árra (pl. 4 083 450 → 4 099 000). */
export function roundUpTo99k(x: number): number {
  let k = Math.ceil(x / 1000 - 1e-9);
  while (((k % 100) + 100) % 100 !== 99) k++;
  return k * 1000;
}

export function arsugo(input: ArsugoInput): ArsugoResult {
  const buy = Math.max(0, input.buy || 0);
  const costs = Math.max(0, input.costs || 0);
  const invalidCombo = input.buyMode === "normal" && input.sellMode === "margin";
  const sellMode: VatMode = invalidCombo ? "normal" : input.sellMode;
  const buyBase = input.buyMode === "normal" ? buy / K : buy;
  const totalCost = buyBase + costs;
  const targetFromHistory = input.target != null && Number.isFinite(input.target);
  const target = targetFromHistory ? (input.target as number) : totalCost * FALLBACK_TARGET_PCT;

  const at = (price: number) => pricePoint({ price, buy, buyBase, costs, sellMode });
  const priceFor = (f: number) => (sellMode === "margin" ? buy + (costs + f) * K : (buyBase + costs + f) * K);

  // egész forintra felfelé, hogy a padló ár se csússzon veszteségbe
  const floor = at(Math.ceil(priceFor(0) - 1e-6));
  const goal = at(Math.ceil(priceFor(target) - 1e-6));
  const goalWithHaggle = goal.price * (1 + HAGGLE);
  const ask = at(roundUpTo99k(goalWithHaggle));
  return { invalidCombo, sellMode, buyBase, buyVat: buy - buyBase, totalCost, target, targetFromHistory, floor, goal, goalWithHaggle, ask };
}

/** Egy tetszőleges (bruttó) eladási árhoz tartozó ÁFA és fedezet – a próbaár csúszkához is. */
export function pricePoint(p: { price: number; buy: number; buyBase: number; costs: number; sellMode: VatMode }): PricePoint {
  const vat = p.sellMode === "margin" ? (Math.max(0, p.price - p.buy) * VAT_RATE) / K : (p.price * VAT_RATE) / K;
  const netRevenue = p.price - vat;
  const margin = netRevenue - p.buyBase - p.costs;
  return { price: p.price, vat, netRevenue, margin, marginPct: p.price > 0 ? margin / p.price : 0 };
}
