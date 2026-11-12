/**
 * v2.0 – Entitás-típusok: társaság (Bt/Kft/Zrt) vagy adószámos magánszemély.
 *
 * A magánszemélynél is a kettős könyvelési motor fut a háttérben (bank, bizonylatok, árfolyam, nyitott tételek
 * változatlanul működnek), de saját, egyszerű számlatükörrel és pénzforgalmi szemléletű, SZJA-központú felülettel.
 */
import type { CompanySettings, TaxProfile } from "@/db/schema";
import { DEFAULT_COA, DEFAULT_JOURNALS, DEFAULT_SETTINGS, DEFAULT_VAT_CODES, type CoaRow } from "./coa";
import { round2 } from "./money";

export type EntityType = "company" | "private_taxpayer";

export const ENTITY_LABEL: Record<EntityType, string> = {
  company: "Társaság (Bt / Kft / Zrt)",
  private_taxpayer: "Adószámos magánszemély",
};

export const isPrivate = (c: { entityType?: string | null }) => c.entityType === "private_taxpayer";

// ---------------------------------------------------------------------------
// Számlatükör – adószámos magánszemély, szálláshely-szolgáltatás
// A kódok a társasági számlatükörrel kompatibilisek (311/454/466/467/381/384…), így a könyvelési motor
// és a cégbeállítások (CompanySettings) változatlanul használhatók.
// ---------------------------------------------------------------------------

export const PRIVATE_COA: CoaRow[] = [
  ["1", "TÁRGYI ESZKÖZÖK", "asset"],
  ["141", "Szálláshely berendezések, felszerelések", "asset"],
  ["149", "Berendezések értékcsökkenése", "asset"],
  ["1221", "Vendégház (ingatlan) – bekerülési érték", "asset"],
  ["2", "ANYAGOK", "asset"],
  ["211", "Anyagok, fogyóeszközök készlete", "asset"],
  ["3", "KÖVETELÉSEK, PÉNZESZKÖZÖK", "asset"],
  ["311", "Vendégekkel szembeni követelések (belföld)", "asset"],
  ["316", "Platformokkal / külföldi vendégekkel szembeni követelések", "asset"],
  ["351", "Adott előlegek", "asset"],
  ["368", "Egyéb követelések", "asset"],
  ["381", "Pénztár (HUF)", "asset"],
  ["3811", "Pénztár (EUR)", "asset"],
  ["384", "Bankszámla (HUF)", "asset"],
  ["3841", "Devizaszámla (EUR)", "asset"],
  ["389", "Átvezetési számla", "asset"],
  ["4", "FORRÁSOK", "liability"],
  ["411", "Induló saját forrás", "equity"],
  ["4191", "Magánszféra – befizetés a tevékenységbe", "equity"],
  ["4192", "Magánszféra – kivét a tevékenységből", "equity"],
  ["453", "Vendégektől kapott előlegek (foglaló)", "liability"],
  ["454", "Belföldi szállítók", "liability"],
  ["455", "Külföldi szállítók (pl. Airbnb jutalék)", "liability"],
  ["462", "Személyi jövedelemadó elszámolása", "liability"],
  ["463", "Költségvetési befizetési kötelezettségek (tételes adó, szocho)", "liability"],
  ["4631", "Beszedett idegenforgalmi adó (önkormányzat felé)", "liability"],
  ["466", "Előzetesen felszámított ÁFA", "liability"],
  ["467", "Fizetendő ÁFA (fordított adózás)", "liability"],
  ["468", "ÁFA elszámolási számla", "liability"],
  ["479", "Egyéb kötelezettségek", "liability"],
  ["491", "Nyitó számla", "off_balance"],
  ["492", "Záró számla", "off_balance"],
  ["5", "KÖLTSÉGEK", "expense"],
  ["511", "Anyagok, tisztítószerek, tisztasági csomag", "expense"],
  ["512", "Vendégellátás (élelmiszer, ital, kávé)", "expense"],
  ["513", "Kisértékű eszközök (200 ezer Ft alatt)", "expense"],
  ["514", "Berendezés, eszköz beszerzés (dézsa stb.)", "expense"],
  ["521", "Platform jutalék (Airbnb, Booking)", "expense"],
  ["522", "Rezsi – villany", "expense"],
  ["5221", "Rezsi – gáz, fűtés", "expense"],
  ["5222", "Rezsi – víz, csatorna", "expense"],
  ["5223", "Rezsi – szemétszállítás", "expense"],
  ["523", "Javítás, karbantartás", "expense"],
  ["524", "Hirdetés, reklám (Instagram, kiemelés)", "expense"],
  ["525", "Weboldal, domain, foglalási / NTAK szoftver", "expense"],
  ["526", "Takarítás, mosatás", "expense"],
  ["528", "Telefon, internet, TV", "expense"],
  ["529", "Egyéb igénybe vett szolgáltatások (könyvelés)", "expense"],
  ["531", "Hatósági, igazgatási díjak", "expense"],
  ["532", "Bankköltség, kártyaelfogadás díja", "expense"],
  ["533", "Biztosítás", "expense"],
  ["571", "Értékcsökkenési leírás", "expense"],
  ["8", "EGYÉB RÁFORDÍTÁSOK", "expense"],
  ["867", "Helyi adók, illetékek (építményadó, kommunális adó)", "expense"],
  ["869", "Egyéb ráfordítások", "expense"],
  ["872", "Fizetett kamatok", "expense"],
  ["876", "Realizált árfolyamveszteség", "expense"],
  ["877", "Nem realizált árfolyamveszteség", "expense"],
  ["879", "Kerekítési különbözet (ráfordítás)", "expense"],
  ["9", "BEVÉTELEK", "revenue"],
  ["911", "Szállásdíj – Airbnb", "revenue"],
  ["912", "Szállásdíj – egyéb platform (Booking, Szallas.hu)", "revenue"],
  ["913", "Szállásdíj – közvetlen (Instagram, weboldal, telefon)", "revenue"],
  ["914", "Kiegészítő szolgáltatások (takarítási díj, reggeli, egyéb)", "revenue"],
  ["925", "Ingatlan bérbeadás bevétele (hosszú táv, nem szálláshely)", "revenue"],
  ["969", "Egyéb bevételek", "revenue"],
  ["972", "Kapott kamatok", "revenue"],
  ["976", "Realizált árfolyamnyereség", "revenue"],
  ["977", "Nem realizált árfolyamnyereség", "revenue"],
  ["979", "Kerekítési különbözet (bevétel)", "revenue"],
];

export const PRIVATE_SETTINGS: CompanySettings = {
  ...DEFAULT_SETTINGS,
  inventoryGoods: "211",
  cogs: "869",
};

export const PRIVATE_VAT_CODES: typeof DEFAULT_VAT_CODES = [
  { code: "AAM", name: "Alanyi adómentes (Áfa tv. XIII. fejezet)", rate: 0, kind: "exempt" },
  { code: "27NL", name: "27% – nem levonható (költség része)", rate: 27, kind: "non_deductible" },
  { code: "18NL", name: "18% – nem levonható (költség része)", rate: 18, kind: "non_deductible" },
  { code: "5NL", name: "5% – nem levonható (költség része)", rate: 5, kind: "non_deductible" },
  { code: "FAD27", name: "Fordított adózás 27% (pl. Airbnb / Booking jutalék)", rate: 27, kind: "reverse_charge" },
  { code: "TAH", name: "Áfa tv. hatályán kívüli", rate: 0, kind: "out_of_scope" },
  { code: "AM", name: "Tárgyi adómentes", rate: 0, kind: "exempt" },
  // Ha egyszer kilép az alanyi mentességből:
  { code: "27", name: "27% általános", rate: 27, kind: "normal" },
  { code: "18", name: "18% kedvezményes (szálláshely)", rate: 18, kind: "normal" },
  { code: "5", name: "5% kedvezményes", rate: 5, kind: "normal" },
];

export const PRIVATE_JOURNALS = DEFAULT_JOURNALS;

export const DEFAULT_TAX_PROFILE: TaxProfile = {
  activity: "accommodation",
  vatExempt: true,
  szjaMethod: "flat_rate_room",
  rooms: 1,
  beds: null,
  settlement: null,
  ntakId: null,
  flatRatePerRoom: 38_400,
  ifaPerNight: null,
  channels: [],
};

/** Betöltendő törzsadatok az entitás-típus szerint. */
export function entitySeed(type: EntityType) {
  return type === "private_taxpayer"
    ? { coa: PRIVATE_COA, settings: PRIVATE_SETTINGS, vatCodes: PRIVATE_VAT_CODES, journals: PRIVATE_JOURNALS }
    : { coa: DEFAULT_COA, settings: DEFAULT_SETTINGS, vatCodes: DEFAULT_VAT_CODES, journals: DEFAULT_JOURNALS };
}

/** Új számlasor alapértelmezései (ÁFA-kód, ellenszámla) az entitás szerint. */
export function lineDefaults(c: { entityType?: string | null; taxProfile?: TaxProfile | null }) {
  if (!isPrivate(c)) return { outVat: "27", inVat: "27", outAcc: "913", inAcc: "523" };
  const exempt = c.taxProfile?.vatExempt ?? true;
  return { outVat: exempt ? "AAM" : "18", inVat: exempt ? "27NL" : "27", outAcc: "913", inAcc: "523" };
}

/** Alanyi ÁFA-mentesnél semmilyen előzetesen felszámított ÁFA nem vonható le (fordított adózásnál sem). */
export const noInputVatDeduction = (c: { entityType?: string | null; taxProfile?: TaxProfile | null }) =>
  isPrivate(c) && (c.taxProfile?.vatExempt ?? true);

// ---------------------------------------------------------------------------
// Adószámítások (tiszta függvények)
// ---------------------------------------------------------------------------

/** Alanyi adómentesség értékhatára (Áfa tv. 188. §) az adott évre. */
export function vatExemptThreshold(year: number): number {
  if (year >= 2028) return 24_000_000;
  if (year === 2027) return 22_000_000;
  if (year === 2026) return 20_000_000;
  if (year === 2025) return 18_000_000;
  return 12_000_000;
}

export type Installment = { quarter: number; due: string; amount: number };

/**
 * Tételes átalányadó (Szja tv. 57/A. §): évi összeg = szobák × szobánkénti tétel,
 * negyedéves egyenlő részletekben, a negyedévet követő hónap 12-éig.
 */
export function flatRateSchedule(rooms: number, perRoom: number, year: number): { annual: number; installments: Installment[] } {
  const annual = Math.max(1, rooms) * perRoom;
  const q = Math.round(annual / 4);
  const dues = [`${year}-04-12`, `${year}-07-12`, `${year}-10-12`, `${year + 1}-01-12`];
  return {
    annual,
    installments: dues.map((due, i) => ({ quarter: i + 1, due, amount: i < 3 ? q : annual - 3 * q })),
  };
}

export const SZJA_RATE = 0.15;
export const SZOCHO_RATE = 0.13;
/** Önálló tevékenységnél a szocho alapja a jövedelem 89%-a. */
export const SZOCHO_BASE_RATIO = 0.89;

export type MethodResult = {
  method: TaxProfile["szjaMethod"];
  label: string;
  income: number;
  szja: number;
  szocho: number;
  total: number;
  note: string;
};

/**
 * SZJA-módszerek összehasonlítása ugyanarra a bevételre / költségre (becslés).
 * A szocho éves felső határát és a más jogviszonyból eredő biztosítást nem modellezi.
 */
export function compareSzjaMethods(p: { revenue: number; costs: number; rooms: number; flatRatePerRoom: number }): MethodResult[] {
  const contrib = (income: number) => {
    const inc = Math.max(0, round2(income));
    const szja = Math.round(inc * SZJA_RATE);
    const szocho = Math.round(inc * SZOCHO_BASE_RATIO * SZOCHO_RATE);
    return { income: inc, szja, szocho, total: szja + szocho };
  };
  const flat = Math.max(1, p.rooms) * p.flatRatePerRoom;
  return [
    {
      method: "flat_rate_room",
      label: "Tételes átalányadó",
      income: 0,
      szja: flat,
      szocho: 0,
      total: flat,
      note: `${Math.max(1, p.rooms)} szoba × ${p.flatRatePerRoom.toLocaleString("hu-HU")} Ft, bevételtől függetlenül; szocho nincs`,
    },
    { method: "cost_ratio_10", label: "10% költséghányad", ...contrib(p.revenue * 0.9), note: "jövedelem = bevétel 90%-a, bizonylat nélkül" },
    { method: "itemized", label: "Tételes költségelszámolás", ...contrib(p.revenue - p.costs), note: "jövedelem = bevétel − igazolt költségek" },
  ];
}

/**
 * Tevékenységi bevétel / költség a főkönyvi kivonat soraiból: bevétel = 91x + 969 (a kamat és az árfolyamnyereség
 * nem szálláshely-bevétel), költség = 5xx + 8xx (a nem realizált árfolyamveszteség nélkül).
 */
export function revenueAndCosts(rows: Array<{ code: string; periodDebit: number; periodCredit: number }>) {
  let revenue = 0;
  let costs = 0;
  for (const r of rows) {
    if (r.code.length < 2) continue;
    if (r.code.startsWith("91") || r.code === "969") revenue += r.periodCredit - r.periodDebit;
    else if ((r.code.startsWith("5") || r.code.startsWith("8")) && !r.code.startsWith("877")) costs += r.periodDebit - r.periodCredit;
  }
  return { revenue: round2(revenue), costs: round2(costs) };
}

/** Adózási profil az űrlapból (új magánszemély / beállítások). */
export function taxProfileFromForm(fd: FormData, prev: TaxProfile = DEFAULT_TAX_PROFILE): TaxProfile {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const n = (k: string, d: number) => {
    const v = Number(s(k).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(v) && s(k) !== "" ? v : d;
  };
  const method = s("szjaMethod");
  const rooms = Math.round(n("rooms", prev.rooms));
  if (rooms < 1) throw new Error("Legalább 1 szoba kell (a tételes adót ingatlanonként legalább egy szoba után fizetni kell).");
  return {
    ...prev,
    activity: "accommodation",
    vatExempt: fd.has("vatExemptField") ? fd.get("vatExempt") === "on" : prev.vatExempt,
    szjaMethod: (["flat_rate_room", "cost_ratio_10", "itemized"].includes(method) ? method : prev.szjaMethod) as TaxProfile["szjaMethod"],
    rooms,
    beds: s("beds") ? Math.round(n("beds", 0)) : (prev.beds ?? null),
    settlement: s("settlement") || null,
    ntakId: s("ntakId") || null,
    flatRatePerRoom: n("flatRatePerRoom", prev.flatRatePerRoom),
    ifaPerNight: s("ifaPerNight") ? n("ifaPerNight", 0) : null,
    channels: s("channels") ? s("channels").split(",").map((x) => x.trim()).filter(Boolean) : (prev.channels ?? []),
  };
}

export const SZJA_METHOD_LABEL: Record<TaxProfile["szjaMethod"], string> = {
  flat_rate_room: "Tételes átalányadó (szobánként)",
  cost_ratio_10: "Önálló tevékenység – 10% költséghányad",
  itemized: "Önálló tevékenység – tételes költségelszámolás",
};

// ---------------------------------------------------------------------------
// v2.0 – TFH / IFA csatornánként (platform: Airbnb, Booking… / közvetlen), P&L-beállítás
// ---------------------------------------------------------------------------

export type Channel = "platform" | "direct";
export const CHANNEL_LABEL: Record<Channel, string> = { platform: "Platformon keresztüli (Airbnb, Booking)", direct: "Közvetlen" };
export type PnlTaxInclude = NonNullable<TaxProfile["pnlTaxInclude"]>;
export const PNL_INCLUDE_LABEL: Record<PnlTaxInclude, string> = {
  both: "Mindkettő",
  platform: "Csak platformos",
  direct: "Csak közvetlen",
  none: "Egyik sem",
};

/** Szállásdíj-bevételi számla → csatorna (911 Airbnb, 912 egyéb platform, 914 platformon beszedett kiegészítő díj, 913 közvetlen). */
export function revenueChannel(code: string): Channel | null {
  if (code.startsWith("913")) return "direct";
  if (code.startsWith("911") || code.startsWith("912") || code.startsWith("914")) return "platform";
  return null;
}

export const TFH_RATE = 0.04;
/** Időszakok, amikor nem kellett TFH-t megállapítani (veszélyhelyzeti könnyítések). */
export const TFH_SUSPENSIONS: Array<[string, string]> = [
  ["2020-03-01", "2021-12-31"],
  ["2022-10-01", "2023-03-31"],
];
export const tfhSuspended = (month: string) => TFH_SUSPENSIONS.some(([a, b]) => month >= a.slice(0, 7) && month <= b.slice(0, 7));

export type ChannelAmounts = Record<Channel, number>;
export const zeroCh = (): ChannelAmounts => ({ platform: 0, direct: 0 });

/** TFH-alap és TFH csatornánként havi bevételsorokból (a felfüggesztett hónapok nélkül). */
export function tfhByChannel(rows: Array<{ month: string; code: string; amount: number }>) {
  const base = zeroCh();
  const suspended = zeroCh();
  for (const r of rows) {
    const ch = revenueChannel(r.code);
    if (!ch) continue;
    if (tfhSuspended(r.month)) suspended[ch] = round2(suspended[ch] + r.amount);
    else base[ch] = round2(base[ch] + r.amount);
  }
  const tfh: ChannelAmounts = { platform: Math.round(base.platform * TFH_RATE), direct: Math.round(base.direct * TFH_RATE) };
  return { base, suspended, tfh };
}

/** IFA = vendégéjszaka × átlagos vendégszám × tarifa (csatornánként). Hiányzó adatnál null. */
export function ifaByChannel(nights: ChannelAmounts, avgGuests?: number | null, rate?: number | null): ChannelAmounts | null {
  if (!rate || !avgGuests) return null;
  return {
    platform: Math.round(nights.platform * avgGuests * rate),
    direct: Math.round(nights.direct * avgGuests * rate),
  };
}

/** A P&L-be számítandó összeg a kiválasztás szerint. */
export function pnlPick(x: ChannelAmounts | null, inc: PnlTaxInclude): number {
  if (!x) return 0;
  return (inc === "both" || inc === "platform" ? x.platform : 0) + (inc === "both" || inc === "direct" ? x.direct : 0);
}

/** Éjszakák kinyerése a számlasor szövegéből („3 éj”, „(5 éj, kb.”). */
export function nightsFromText(t: string): number {
  const m = t.match(/(\d+)\s*éj/);
  return m ? Number(m[1]) : 0;
}
