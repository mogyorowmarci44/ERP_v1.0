/**
 * v3.3.3 – TAO és HIPA közös számoló (tiszta függvények, adatbázis nélkül).
 * Ezt használja az Évzárás › TAO és HIPA oldal, a Forecast és a Cégérték.
 *
 * HIPA (Htv. 39. §): vállalkozási szintű adóalap = nettó árbevétel − ELÁBÉ − közvetített szolgáltatások
 *   − anyagköltség − alvállalkozói teljesítések (− K+F közvetlen költség). 500 M Ft nettó árbevétel felett az ELÁBÉ +
 *   közvetített szolgáltatás együtt csak sávosan vonható le (Htv. 39. § (4)).
 *   Az alapot a székhely és a telephelyek települései között kell megosztani (Htv. 3. melléklet); mindegyik település
 *   a saját mértékével és mentességével számol. A rendeleti mentesség (Htv. 39/C. § (2)) a vállalkozási szintű adóalaphoz
 *   kötött (legfeljebb 2,5 M Ft).
 * TAO (Tao. tv.): adóalap = adózás előtti eredmény + növelő − csökkentő tételek; az elhatárolt veszteség az adóalap
 *   (a veszteségleírás előtti) 50%-áig használható fel, a keletkezését követő 5 adóévben (2015 utáni veszteség). Kulcs: 9%.
 */

export const TAO_RATE = 0.09;
export const LOSS_USE_CAP = 0.5;
export const LOSS_CARRY_YEARS = 5;
/** Htv. 39/C. § (2): az önkormányzat ennél magasabb mentességi határt nem állapíthat meg. */
export const HIPA_EXEMPT_MAX = 2_500_000;
export const HIPA_RATE_MAX = 0.02;

const r0 = (x: number) => Math.round(x);

// --- HIPA ----------------------------------------------------------------------------

export type HipaBaseInput = {
  /** Nettó árbevétel (91–93). */
  revenue: number;
  /** Eladott áruk beszerzési értéke (811, 814). */
  cogs: number;
  /** Közvetített szolgáltatások értéke (815). */
  mediated: number;
  /** Anyagköltség (51). */
  materials: number;
  /** Alvállalkozói teljesítések értéke (kézzel megadható). */
  subcontract?: number;
  /** Alapkutatás, alkalmazott kutatás, kísérleti fejlesztés közvetlen költsége. */
  rnd?: number;
};

/** A 500 M Ft feletti árbevételnél levonható ELÁBÉ + közvetített szolgáltatás felső határa (sávosan). */
export function cogsDeductionCap(revenue: number): number | null {
  if (revenue <= 500_000_000) return null;
  const band = (lo: number, hi: number) => Math.max(0, Math.min(revenue, hi) - lo);
  return band(0, 500_000_000) + band(500_000_000, 20_000_000_000) * 0.85 + band(20_000_000_000, 80_000_000_000) * 0.75 + band(80_000_000_000, Infinity) * 0.7;
}

export type HipaBase = { revenue: number; cogsMediated: number; cogsCap: number | null; cogsDeducted: number; materials: number; subcontract: number; rnd: number; base: number };

export function hipaBase(i: HipaBaseInput): HipaBase {
  const cogsMediated = (i.cogs || 0) + (i.mediated || 0);
  const cap = cogsDeductionCap(i.revenue);
  const cogsDeducted = cap == null ? cogsMediated : Math.min(cogsMediated, cap);
  const subcontract = i.subcontract || 0, rnd = i.rnd || 0, materials = i.materials || 0;
  return { revenue: i.revenue, cogsMediated, cogsCap: cap, cogsDeducted, materials, subcontract, rnd, base: r0(i.revenue - cogsDeducted - materials - subcontract - rnd) };
}

/** Egy település szabálya (a Kincstár HAKKA adataiból vagy kézzel). */
export type HipaRule = {
  /** Település / önkormányzat neve. */
  name: string;
  /** Állandó jellegű iparűzési tevékenység adómértéke (pl. 0.02). */
  rate: number;
  /** Rendeleti mentesség határa (vállalkozási szintű adóalap); null = nincs. */
  exemptBelow: number | null;
  /** true: „nem haladja meg” (≤ határ mentes); false: „nem éri el” (< határ mentes). */
  exemptInclusive: boolean;
  /** Egyéb kedvezmények, megjegyzések (szöveg). */
  notes?: string[];
  /** Honnan: „Kincstár (HAKKA) 2026-11” / „beépített” / „kézi”. */
  source?: string;
};

export type HipaSiteCalc = { name: string; role: "seat" | "site"; share: number; rule: HipaRule | null };
export type HipaSiteLine = { name: string; role: "seat" | "site"; share: number; base: number; rate: number; exempt: boolean; exemptReason: string | null; tax: number; ruleSource: string | null };

export function isHipaExempt(base: number, rule: Pick<HipaRule, "exemptBelow" | "exemptInclusive"> | null): boolean {
  if (!rule || rule.exemptBelow == null) return false;
  return rule.exemptInclusive ? base <= rule.exemptBelow : base < rule.exemptBelow;
}

/**
 * HIPA településenként. `base` a vállalkozási szintű adóalap; a megosztás arányai (share) összege 1 legyen
 * – ha nem, arányosan normalizáljuk. Szabály nélküli településre a törvényi maximum (2%) mentesség nélkül.
 */
export function hipaTax(base: number, sites: HipaSiteCalc[]): { lines: HipaSiteLine[]; total: number } {
  const list = sites.length ? sites : [];
  const sum = list.reduce((a, s) => a + Math.max(0, s.share), 0) || 1;
  const lines = list.map((s) => {
    const share = Math.max(0, s.share) / sum;
    const siteBase = r0(Math.max(0, base) * share);
    const rate = s.rule?.rate ?? HIPA_RATE_MAX;
    const exempt = isHipaExempt(base, s.rule);
    const exemptReason = exempt && s.rule?.exemptBelow != null
      ? `vállalkozási szintű adóalap ${s.rule.exemptInclusive ? "nem haladja meg" : "nem éri el"} a ${s.rule.exemptBelow.toLocaleString("hu-HU")} Ft-ot`
      : null;
    return { name: s.name, role: s.role, share, base: siteBase, rate, exempt, exemptReason, tax: exempt ? 0 : r0(siteBase * rate), ruleSource: s.rule?.source ?? null };
  });
  return { lines, total: lines.reduce((a, l) => a + l.tax, 0) };
}

// --- TAO -----------------------------------------------------------------------------

export type LossEntry = { year: string; amount: number };

export type TaoInput = {
  preTax: number;
  increases?: number;
  decreases?: number;
  /** Felhasználható elhatárolt veszteségek (a keletkezés évével, pozitív összeggel), legrégebbi elöl. */
  losses?: LossEntry[];
  rate?: number;
};

export type TaoResult = {
  preTax: number; increases: number; decreases: number;
  /** Adóalap a veszteség leírása előtt. */
  baseBeforeLoss: number;
  lossAvailable: number; lossUsed: number;
  base: number; tax: number;
  /** Ha az adóalap negatív: az év elhatárolható vesztesége. */
  newLoss: number;
  /** A fel nem használt, továbbvihető veszteségek (az évvel). */
  lossesAfter: LossEntry[];
};

export function taoCalc(i: TaoInput): TaoResult {
  const increases = i.increases || 0, decreases = i.decreases || 0;
  const baseBeforeLoss = r0(i.preTax + increases - decreases);
  const losses = (i.losses ?? []).map((l) => ({ ...l }));
  const lossAvailable = losses.reduce((a, l) => a + l.amount, 0);
  let lossUsed = 0;
  if (baseBeforeLoss > 0 && lossAvailable > 0) {
    let room = r0(baseBeforeLoss * LOSS_USE_CAP);
    for (const l of losses) {
      const use = Math.min(l.amount, room);
      l.amount -= use; room -= use; lossUsed += use;
      if (room <= 0) break;
    }
  }
  const base = Math.max(0, baseBeforeLoss - lossUsed);
  const newLoss = baseBeforeLoss < 0 ? -baseBeforeLoss : 0;
  return {
    preTax: r0(i.preTax), increases, decreases, baseBeforeLoss, lossAvailable, lossUsed, base,
    tax: r0(base * (i.rate ?? TAO_RATE)), newLoss,
    lossesAfter: losses.filter((l) => l.amount > 0),
  };
}

/**
 * Évek sorozata: minden év a korábbi évek elhatárolt veszteségével számol (legfeljebb 5 évig vihető tovább).
 * `years` időrendben; a visszaadott sor ugyanígy.
 */
export function taoSeries(years: { year: string; preTax: number; increases?: number; decreases?: number }[], rate = TAO_RATE): (TaoResult & { year: string })[] {
  let pool: LossEntry[] = [];
  return years.map((y) => {
    pool = pool.filter((l) => Number(y.year) - Number(l.year) <= LOSS_CARRY_YEARS);
    const r = taoCalc({ preTax: y.preTax, increases: y.increases, decreases: y.decreases, losses: pool, rate });
    pool = [...r.lossesAfter, ...(r.newLoss ? [{ year: y.year, amount: r.newLoss }] : [])];
    return { ...r, year: y.year, lossesAfter: pool.map((l) => ({ ...l })) };
  });
}

// --- Határidők ------------------------------------------------------------------------

/** Naptári év = üzleti év esetén: a bevallás és a befizetés határideje a következő év május 31. */
export function taxReturnDue(fyEnd: string): string {
  const y = Number(fyEnd.slice(0, 4)), m = Number(fyEnd.slice(5, 7));
  // az üzleti év utolsó napját követő 5. hónap utolsó napja
  const d = new Date(Date.UTC(y, m - 1 + 6, 0));
  return d.toISOString().slice(0, 10);
}
