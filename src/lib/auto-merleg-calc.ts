/**
 * v3.4.0 – AutóMérleg: egy autó teljes mérlege (tiszta számoló, adatbázis nélkül – tesztelhető).
 *
 * Készleten lévő autó (élő számok): a mai költségekből + a tartási költségből (lekötött pénz %/év + fix Ft/nap)
 *   számolt nullszaldó és cél ár – a nullszaldó naponta a tartási költség × 1,27-tel kúszik feljebb (különbözeti ÁFA);
 *   figyelmeztet, ha a hirdetési / tervezett ár a cél alá csúszott, és megmondja, hány nap múlva éri el a nullszaldót.
 * Eladott autó (lezárt elszámolás): Fedezet I = nettó árbevétel − beszerzés; Fedezet II = Fedezet I − költségek − EPR;
 *   napi fedezet = Fedezet II ÷ állásnapok. A tartási költség becslés (nem könyvelt): a Fedezet II-t nem csökkenti.
 * Az árak az ÁrSugó számolójával (különbözeti / normál ÁFA, 49/99 ezres kerekítés).
 */
import { arsugo, pricePoint, type VatMode } from "./arsugo";

export type MerlegCost = { label: string; date: string | null; amount: number };
export type MerlegInput = {
  today: string;
  buyMode: VatMode;
  sellMode: VatMode;
  /** Beszerzési ár (különbözeti: a különbözet alapja; normál: bruttó). */
  buy: number;
  purchaseDate: string | null;
  costs: MerlegCost[];
  /** EPR-díj (fix, ÁFA-t nem csökkentő); null = nincs / nem kötelezett. */
  epr: number | null;
  sale: { date: string; gross: number; vat: number } | null;
  plan: { price: number | null; date: string | null; costs: MerlegCost[] } | null;
  holding: { ratePct: number; fixPerDay: number };
  /** Célfedezet (az eladott autók medián Fedezet II-je; null → az ÁrSugó 10%-os tartaléka). */
  target: number | null;
  peers: { label: string; count: number; medF2: number | null; medDays: number | null };
};

export type MerlegRow = { label: string; plan: number | null; actual: number; diff: number | null; good: boolean | null; unit: "Ft" | "nap" };

const r0 = (x: number) => Math.round(x);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
export const holdingPerDay = (capital: number, h: MerlegInput["holding"]) => r0((Math.max(0, capital) * h.ratePct) / 100 / 365 + h.fixPerDay);

export function autoMerleg(i: MerlegInput) {
  const sold = !!i.sale;
  const end = i.sale?.date ?? i.today;
  const days = i.purchaseDate ? Math.max(0, daysBetween(i.purchaseDate, end)) : null;
  const costTotal = r0(i.costs.reduce((a, c) => a + c.amount, 0));
  const epr = i.epr ?? 0;
  const ar = arsugo({ buy: i.buy, buyMode: i.buyMode, sellMode: i.sellMode, costs: costTotal, fixed: epr, target: i.target });
  const capital = ar.buyBase + costTotal + epr;
  const perDay = holdingPerDay(capital, i.holding);
  const holding = days != null ? perDay * days : 0;

  // élő árak: készleten a tartási költséggel együtt
  const live = arsugo({ buy: i.buy, buyMode: i.buyMode, sellMode: ar.sellMode, costs: costTotal + (sold ? 0 : holding), fixed: epr, target: i.target });
  // a tartási költség minden forintja 1,27 Ft-tal emeli a nullszaldót (különbözeti és normál ÁFA mellett is)
  const creep = perDay * 1.27;
  const price = sold ? i.sale!.gross : i.plan?.price ?? live.ask.price;
  const priceSource: "sale" | "plan" | "arsugo" = sold ? "sale" : i.plan?.price ? "plan" : "arsugo";
  const pp = pricePoint({ price, buy: i.buy, buyBase: ar.buyBase, costs: costTotal + epr, sellMode: ar.sellMode });
  const vat = sold ? i.sale!.vat : pp.vat;
  const netRevenue = price - vat;
  const f1 = netRevenue - ar.buyBase;
  const f2 = f1 - costTotal - epr;
  const f3 = f2 - holding;
  const f2Pct = price > 0 ? f2 / price : 0;
  const perDayMargin = days ? f2 / days : null;
  const warn = !sold && price < live.goal.price;
  const daysToFloor = !sold && creep > 0 ? Math.max(0, Math.floor((price - live.floor.price) / creep)) : null;

  // vízesés: miből áll az ár
  const water: { label: string; amount: number; kind: "buy" | "cost" | "epr" | "hold" | "vat" | "margin" | "loss" }[] = [
    { label: i.buyMode === "normal" ? "Beszerzés (nettó)" : "Beszerzés", amount: ar.buyBase, kind: "buy" },
    ...i.costs.map((c) => ({ label: c.label, amount: c.amount, kind: "cost" as const })),
    ...(epr ? [{ label: "EPR díj", amount: epr, kind: "epr" as const }] : []),
    ...(!sold && holding ? [{ label: `Tartási költség (${days} nap)`, amount: holding, kind: "hold" as const }] : []),
    { label: ar.sellMode === "margin" ? "Különbözeti ÁFA" : "ÁFA", amount: vat, kind: "vat" },
  ];
  const rest = sold ? f2 : f3;
  water.push({ label: rest >= 0 ? (sold ? "Fedezet II" : "Várható fedezet") : "Veszteség", amount: Math.abs(rest), kind: rest >= 0 ? "margin" : "loss" });

  // terv kontra tény
  const plan = i.plan;
  const planCosts = plan ? r0(plan.costs.reduce((a, c) => a + c.amount, 0)) : null;
  const planPrice = plan?.price ?? null;
  const planPP = planPrice != null ? pricePoint({ price: planPrice, buy: i.buy, buyBase: ar.buyBase, costs: (planCosts ?? 0) + epr, sellMode: ar.sellMode }) : null;
  const planDays = plan?.date && i.purchaseDate ? daysBetween(i.purchaseDate, plan.date) : i.peers.medDays;
  const row = (label: string, p: number | null, a: number, lowIsGood: boolean, unit: "Ft" | "nap" = "Ft"): MerlegRow => {
    const diff = p == null ? null : r0(a - p);
    return { label, plan: p == null ? null : r0(p), actual: r0(a), diff, good: diff == null || diff === 0 ? null : lowIsGood ? diff < 0 : diff > 0, unit };
  };
  const rows: MerlegRow[] = [
    row("Beszerzési ár", i.buy, i.buy, true),
    row("Költségek", planCosts, costTotal, true),
    ...(epr ? [row("EPR díj", epr, epr, true)] : []),
    row(sold ? "Eladási ár" : priceSource === "plan" ? "Tervezett eladási ár" : "Javasolt hirdetési ár (ÁrSugó)", planPrice, price, false),
    row(ar.sellMode === "margin" ? "Különbözeti ÁFA" : "ÁFA", planPP?.vat ?? null, vat, true),
    row(sold ? "Fedezet II" : "Várható fedezet II", planPP?.margin ?? null, f2, false),
  ];
  const daysRow = days != null ? row(plan?.date ? "Állásidő (terv: tervezett eladás napja)" : "Állásidő (terv: hasonló autók mediánja)", planDays ?? null, days, true, "nap") : null;

  const why: string[] = [];
  const ft = (n: number) => `${Math.round(Math.abs(n)).toLocaleString("hu-HU")} Ft`;
  if (planCosts != null && costTotal !== planCosts) why.push(costTotal > planCosts ? `A költségek ${ft(costTotal - planCosts)}-tal többek a tervezettnél.` : `A költségek ${ft(planCosts - costTotal)}-tal kevesebbek a tervezettnél.`);
  if (planPrice != null && price !== planPrice) why.push(`${sold ? "Az eladási ár" : "Az ár"} ${ft(price - planPrice)}-tal a tervezett ${price > planPrice ? "fölött" : "alatt"} van.`);
  if (days != null && planDays != null && days !== planDays) why.push(days > planDays ? `Az autó ${days - planDays} nappal tovább ${sold ? "állt" : "áll"}, mint ${plan?.date ? "tervezted" : "a hasonló autók mediánja"}${sold ? "." : `; a nullszaldó naponta ${ft(creep)}-tal emelkedik.`}` : `Az autó ${planDays - days} nappal gyorsabban ${sold ? "kelt el" : "halad"}, mint ${plan?.date ? "tervezted" : "a hasonló autók mediánja"}.`);
  if (!plan) why.push("Az autóhoz nincs terv a Forecastban – a terv oszlop ezért üres (állásidőnél a hasonló autók mediánja).");
  if (i.peers.medF2 != null && sold) why.push(f2 >= i.peers.medF2 ? `A fedezet ${ft(f2 - i.peers.medF2)}-tal jobb a hasonló autók mediánjánál.` : `A fedezet ${ft(i.peers.medF2 - f2)}-tal elmarad a hasonló autók mediánjától.`);

  return {
    sold, days, price, priceSource, vat, netRevenue, f1, f2, f3, f2Pct, perDayMargin,
    costTotal, epr, capital, holding, holdingPerDay: perDay, creep,
    buyBase: ar.buyBase, sellMode: ar.sellMode, invalidCombo: ar.invalidCombo,
    floor: live.floor.price, goal: live.goal.price, ask: live.ask.price, buyCover: live.buyCover, target: live.target, targetFromHistory: live.targetFromHistory,
    warn, daysToFloor, water, rows, daysRow, why,
    vsPeersMargin: i.peers.medF2 != null ? f2 - i.peers.medF2 : null,
    vsPeersDays: i.peers.medDays != null && days != null ? days - i.peers.medDays : null,
  };
}
export type AutoMerleg = ReturnType<typeof autoMerleg>;
