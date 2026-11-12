/**
 * v2.0 – Vendégház elemzés: tiszta számítások (adatbázis nélkül, tesztelhető).
 * A főkönyvi tételekből napi bontású tényadatokat építünk (P&L teljesítés szerint szétosztva,
 * cash flow a pénzmozgás napján), ebből jön minden heti / havi / negyedéves / éves nézet,
 * a mutatók (kihasználtság, ADR, RevPAR …) és a diszkontált megtérülés.
 */
import { TFH_RATE, tfhSuspended, pnlPick, type PnlTaxInclude } from "./entity";

export type Gran = "week" | "month" | "quarter" | "year";
export type Rec = Record<string, number>;
export type Day = { date: string; v: Rec };

// ---------------------------------------------------------------------------
// Dátumok
// ---------------------------------------------------------------------------

const DAY = 86400000;
const ms = (d: string) => Date.parse(d + "T00:00:00Z");
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");
export const monthEndOf = (d: string) => `${d.slice(0, 8)}${pad(daysInMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7))))}`;
export const addMonths = (d: string, n: number) => {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(Number(d.slice(8, 10)), daysInMonth(yy, mm)))}`;
};

/** ISO hét (hétfő kezdettel): év és hét sorszáma. */
export function isoWeek(d: string): { year: number; week: number } {
  const t = new Date(ms(d));
  const dow = (t.getUTCDay() + 6) % 7; // hétfő = 0
  const thu = new Date(t.getTime() + (3 - dow) * DAY);
  const year = thu.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  return { year, week: 1 + Math.floor((thu.getTime() - jan1) / DAY / 7) };
}

export function periodKey(d: string, g: Gran): string {
  if (g === "year") return d.slice(0, 4);
  if (g === "month") return d.slice(0, 7);
  if (g === "quarter") return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  const w = isoWeek(d);
  return `${w.year}-W${pad(w.week)}`;
}

export function periodRange(key: string, g: Gran): { from: string; to: string } {
  if (g === "year") return { from: `${key}-01-01`, to: `${key}-12-31` };
  if (g === "month") return { from: `${key}-01`, to: monthEndOf(`${key}-01`) };
  if (g === "quarter") {
    const y = key.slice(0, 4), q = Number(key.slice(-1));
    const from = `${y}-${pad(q * 3 - 2)}-01`;
    return { from, to: monthEndOf(`${y}-${pad(q * 3)}-01`) };
  }
  const y = Number(key.slice(0, 4)), w = Number(key.slice(6));
  // az év 1. hete az, amelyikben január 4. van
  const jan4 = `${y}-01-04`;
  const dow = (new Date(ms(jan4)).getUTCDay() + 6) % 7;
  const from = addDays(jan4, -dow + (w - 1) * 7);
  return { from, to: addDays(from, 6) };
}

const HU_MONTH = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
export function periodLabel(key: string, g: Gran, short = false): string {
  if (g === "year") return key;
  if (g === "month") return short ? `${HU_MONTH[Number(key.slice(5)) - 1]}` : `${key.slice(0, 4)}. ${HU_MONTH[Number(key.slice(5)) - 1]}`;
  if (g === "quarter") return `${key.slice(0, 4)}. ${key.slice(-1)}. n.év`;
  const r = periodRange(key, g);
  return short ? `${Number(key.slice(6))}. hét` : `${key.slice(0, 4)}. ${Number(key.slice(6))}. hét (${r.from.slice(5).replace("-", ".")}.–${r.to.slice(5).replace("-", ".")}.)`;
}

/** Az időszakok kulcsai két dátum között (mindkét végét érintő időszakokkal). */
export function periodKeys(from: string, to: string, g: Gran): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to) {
    const k = periodKey(d, g);
    if (out[out.length - 1] !== k) out.push(k);
    d = addDays(periodRange(k, g).to, 1);
  }
  return out;
}

export function prevPeriod(key: string, g: Gran): string {
  return periodKey(addDays(periodRange(key, g).from, -1), g);
}

// ---------------------------------------------------------------------------
// Számlák → sorok
// ---------------------------------------------------------------------------

export const PNL_LINES = {
  rev_airbnb: "Airbnb (szállásdíj + takarítási díj)",
  rev_booking: "Booking.com",
  rev_direct: "Közvetlen foglalás",
  rev_other: "Egyéb bevétel (pl. hosszú távú bérlet)",
  c_commission: "Platform jutalék",
  c_cleaning: "Takarítás",
  c_supplies: "Anyag, tisztítószer, vendégellátás",
  c_firewood: "Tűzifa, fűtés",
  c_utilities: "Rezsi (villany, víz, internet)",
  c_marketing: "Marketing, hirdetés",
  c_repair: "Javítás, eszközbeszerzés",
  c_other: "Egyéb költség",
} as const;
export type PnlLine = keyof typeof PNL_LINES;

export function pnlKey(code: string): PnlLine | null {
  if (code.startsWith("977") || code.startsWith("877")) return null;
  if (code.startsWith("911") || code.startsWith("914")) return "rev_airbnb";
  if (code.startsWith("912")) return "rev_booking";
  if (code.startsWith("913")) return "rev_direct";
  if (code.startsWith("9")) return "rev_other";
  if (code.startsWith("521")) return "c_commission";
  if (code.startsWith("526")) return "c_cleaning";
  if (code.startsWith("511") || code.startsWith("512")) return "c_supplies";
  if (code.startsWith("5221")) return "c_firewood";
  if (code.startsWith("522") || code.startsWith("528")) return "c_utilities";
  if (code.startsWith("524")) return "c_marketing";
  if (code.startsWith("523") || code.startsWith("513") || code.startsWith("514")) return "c_repair";
  if (code.startsWith("5") || code.startsWith("8")) return "c_other";
  return null;
}

/** Cash flow kategória a pénzmozgás ellenszámlája (vagy a kiegyenlített számla sora) alapján. */
export function cfKey(code: string): string {
  const k = pnlKey(code);
  if (k) return k;
  if (code.startsWith("12") || code.startsWith("11")) return "inv_property";
  if (code.startsWith("1")) return "inv_other";
  if (code.startsWith("46")) return "tax_paid";
  return "other";
}

/** Pénz: bank / pénztár (38x, kivéve az 389 átvezetést) és a magánszféra (419x – a tulajdonos zsebe). */
export const isMoney = (code: string) => (code.startsWith("38") && !code.startsWith("389")) || code.startsWith("419");

export type NightChannel = "airbnb" | "booking" | "direct";
export function nightChannel(code: string): NightChannel | null {
  if (code.startsWith("911")) return "airbnb";
  if (code.startsWith("912")) return "booking";
  if (code.startsWith("913")) return "direct";
  return null;
}

// ---------------------------------------------------------------------------
// Teljesítési időszak felismerése a szövegből
// ---------------------------------------------------------------------------

const RANGE = /(\d{4}-\d{2}-\d{2})\s*[–—-]\s*(\d{4}-\d{2}-\d{2})/;
const YM = /(\d{4})\.\s?(\d{2})\./;
const CODE = /\[([A-Z0-9][A-Z0-9-]{5,})\]/;

/**
 * Melyik napokra osszuk szét a tételt?
 * - „2023-01-20–2023-01-22” → a két dátum közötti éjszakák (a záró nap nélkül),
 * - hónap utolsó napján könyvelt „2023. 01.” havi összesítő → a hónap minden napja,
 * - egyébként a könyvelés napja.
 */
export function spread(date: string, text: string): { from: string; days: number; exact: boolean } {
  const r = text.match(RANGE);
  if (r) {
    const n = daysBetween(r[1], r[2]);
    if (n >= 1 && n <= 400) return { from: r[1], days: n, exact: true };
  }
  const m = text.match(YM);
  if (m && `${m[1]}-${m[2]}` === date.slice(0, 7) && date === monthEndOf(date)) {
    return { from: `${date.slice(0, 7)}-01`, days: daysInMonth(Number(m[1]), Number(m[2])), exact: false };
  }
  return { from: date, days: 1, exact: false };
}

/** Becsült éjszakadíj, ha egy havi összesítőben nincs éjszakaszám (Booking havi nettó). */
export const EST_NIGHT_RATE = 24000;

export function nightsOf(code: string, text: string, amount: number): { nights: number; exact: boolean } {
  if (!nightChannel(code) || amount <= 0) return { nights: 0, exact: false };
  const r = text.match(RANGE);
  if (r) {
    const n = daysBetween(r[1], r[2]);
    if (n >= 1 && n <= 400) return { nights: n, exact: true };
  }
  const m = text.match(/(\d+)\s*éj/);
  if (m) return { nights: Number(m[1]), exact: false };
  if (code.startsWith("912")) return { nights: Math.max(1, Math.round(amount / EST_NIGHT_RATE)), exact: false };
  return { nights: 0, exact: false };
}

export function bookingCode(text: string): string | null {
  return text.match(CODE)?.[1] ?? text.match(/foglalás\s+([A-Z0-9]{8,12})\b/)?.[1] ?? null;
}

export function guestName(text: string): string | null {
  const m = text.match(/–\s*([^(\[]+?)\s*\(/);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Napi tényadatok
// ---------------------------------------------------------------------------

export class Daily {
  private map = new Map<string, Rec>();
  add(date: string, key: string, v: number) {
    if (!v) return;
    let r = this.map.get(date);
    if (!r) this.map.set(date, (r = {}));
    r[key] = (r[key] ?? 0) + v;
  }
  addSpread(from: string, days: number, key: string, total: number) {
    const per = total / days;
    for (let i = 0; i < days; i++) this.add(addDays(from, i), key, per);
  }
  days(): Day[] {
    return [...this.map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, v]) => ({ date, v }));
  }
}

export function sumRange(days: Day[], from: string, to: string): Rec {
  const out: Rec = {};
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    for (const k in d.v) out[k] = (out[k] ?? 0) + d.v[k];
  }
  return out;
}

export function groupBy(days: Day[], g: Gran, from: string, to: string): Map<string, Rec> {
  const out = new Map<string, Rec>();
  for (const k of periodKeys(from, to, g)) out.set(k, {});
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    const r = out.get(periodKey(d.date, g));
    if (!r) continue;
    for (const k in d.v) r[k] = (r[k] ?? 0) + d.v[k];
  }
  return out;
}

export type TaxSettings = {
  flatAnnual: number | null; // tételes adó évente (null = nem tételes)
  ifaPerNight: number | null;
  ifaAvgGuests: number | null;
  activityStart: string | null; // első szállásdíj hónapjának 1. napja
  asOf: string;
};

/**
 * Számított adók napi bontásban (P&L), és esedékesség szerint (cash flow):
 * tételes adó (időarányosan, negyedévente esedékes), TFH 4% (csatornánként, a felfüggesztett hónapok nélkül;
 * a következő év febr. 25-én esedékes), IFA (éjszaka × vendég × tarifa; a következő hó 15-én).
 */
export function addTaxes(daily: Daily, days: Day[], s: TaxSettings) {
  const flatQ = new Map<string, number>();
  const tfhY = new Map<string, { p: number; d: number }>();
  const ifaM = new Map<string, { p: number; d: number }>();
  for (const d of days) {
    const v = d.v;
    const plat = (v.rev_airbnb ?? 0) + (v.rev_booking ?? 0);
    const dir = v.rev_direct ?? 0;
    if (!tfhSuspended(d.date.slice(0, 7))) {
      const tp = plat * TFH_RATE, td = dir * TFH_RATE;
      daily.add(d.date, "t_tfh_p", tp);
      daily.add(d.date, "t_tfh_d", td);
      const y = tfhY.get(d.date.slice(0, 4)) ?? { p: 0, d: 0 };
      y.p += tp; y.d += td;
      tfhY.set(d.date.slice(0, 4), y);
    }
    if (s.ifaPerNight && s.ifaAvgGuests) {
      const f = s.ifaPerNight * s.ifaAvgGuests;
      const ip = ((v.n_airbnb ?? 0) + (v.n_booking ?? 0)) * f, id = (v.n_direct ?? 0) * f;
      daily.add(d.date, "t_ifa_p", ip);
      daily.add(d.date, "t_ifa_d", id);
      const m = ifaM.get(d.date.slice(0, 7)) ?? { p: 0, d: 0 };
      m.p += ip; m.d += id;
      ifaM.set(d.date.slice(0, 7), m);
    }
  }
  if (s.flatAnnual && s.activityStart) {
    for (let d = s.activityStart; d <= s.asOf; d = addDays(d, 1)) {
      const y = Number(d.slice(0, 4));
      const per = s.flatAnnual / (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365);
      daily.add(d, "t_flat", per);
      const q = periodKey(d, "quarter");
      flatQ.set(q, (flatQ.get(q) ?? 0) + per);
    }
  }
  // esedékességek – csak a már lejártak kerülnek a pénzforgalomba
  for (const [q, amt] of flatQ) {
    const due = addDays(periodRange(q, "quarter").to, 12);
    if (due <= s.asOf) daily.add(due, "cf_t_flat", -amt);
  }
  for (const [y, a] of tfhY) {
    const due = `${Number(y) + 1}-02-25`;
    if (due <= s.asOf) { daily.add(due, "cf_t_tfh_p", -a.p); daily.add(due, "cf_t_tfh_d", -a.d); }
  }
  for (const [m, a] of ifaM) {
    const due = addDays(monthEndOf(`${m}-01`), 15);
    if (due <= s.asOf) { daily.add(due, "cf_t_ifa_p", -a.p); daily.add(due, "cf_t_ifa_d", -a.d); }
  }
}

// ---------------------------------------------------------------------------
// Eredmény és mutatók egy időszakra
// ---------------------------------------------------------------------------

const g0 = (r: Rec, k: string) => r[k] ?? 0;
const div = (a: number, b: number) => (b ? a / b : null);

export function pnlOf(r: Rec, inc: PnlTaxInclude) {
  const rev = { airbnb: g0(r, "rev_airbnb"), booking: g0(r, "rev_booking"), direct: g0(r, "rev_direct"), other: g0(r, "rev_other") };
  const accRevenue = rev.airbnb + rev.booking + rev.direct;
  const revenue = accRevenue + rev.other;
  const commission = g0(r, "c_commission");
  const netRevenue = revenue - commission;
  const variable = g0(r, "c_cleaning") + g0(r, "c_supplies") + g0(r, "c_firewood");
  const contribution = netRevenue - variable;
  const fixed = g0(r, "c_utilities") + g0(r, "c_marketing") + g0(r, "c_repair") + g0(r, "c_other");
  const operating = contribution - fixed;
  const tfh = pnlPick({ platform: g0(r, "t_tfh_p"), direct: g0(r, "t_tfh_d") }, inc);
  const ifa = pnlPick({ platform: g0(r, "t_ifa_p"), direct: g0(r, "t_ifa_d") }, inc);
  const flat = g0(r, "t_flat");
  const taxes = flat + tfh + ifa;
  const variableParts = { cleaning: g0(r, "c_cleaning"), supplies: g0(r, "c_supplies"), firewood: g0(r, "c_firewood") };
  const fixedParts = { utilities: g0(r, "c_utilities"), marketing: g0(r, "c_marketing"), repair: g0(r, "c_repair"), other: g0(r, "c_other") };
  return { rev, accRevenue, revenue, commission, netRevenue, variable, variableParts, contribution, fixed, fixedParts, operating, flat, tfh, ifa, taxes, result: operating - taxes };
}

export const CF_LINES: Array<[string, string]> = [
  ["rev_airbnb", "Airbnb kifizetések (jutalék után)"],
  ["rev_booking", "Booking.com"],
  ["rev_direct", "Közvetlen vendégek"],
  ["rev_other", "Egyéb bevétel (bérleti díj stb.)"],
  ["c_commission", "Platform jutalék (külön fizetve)"],
  ["c_cleaning", "Takarítás"],
  ["c_supplies", "Anyag, tisztítószer, vendégellátás"],
  ["c_firewood", "Tűzifa, fűtés"],
  ["c_utilities", "Rezsi"],
  ["c_marketing", "Marketing"],
  ["c_repair", "Javítás, eszközbeszerzés"],
  ["c_other", "Egyéb kiadás"],
  ["tax_paid", "Könyvelt adóbefizetés"],
  ["other", "Egyéb pénzmozgás"],
];

export function cfOf(r: Rec, inc: PnlTaxInclude) {
  const c = (k: string) => g0(r, `cf_${k}`);
  const lines = CF_LINES.map(([k, label]) => ({ key: k, label, amount: c(k) }));
  const inflow = lines.filter((l) => l.key.startsWith("rev_")).reduce((a, l) => a + l.amount, 0);
  const opOut = lines.filter((l) => !l.key.startsWith("rev_")).reduce((a, l) => a + l.amount, 0);
  const flat = c("t_flat");
  const tfh = pnlPick({ platform: c("t_tfh_p"), direct: c("t_tfh_d") }, inc);
  const ifa = pnlPick({ platform: c("t_ifa_p"), direct: c("t_ifa_d") }, inc);
  const operating = inflow + opOut + flat + tfh + ifa;
  const property = c("inv_property");
  const invOther = c("inv_other");
  return { lines, inflow, opOut, flat, tfh, ifa, operating, property, invOther, net: operating + property + invOther };
}

export function kpis(r: Rec, availableDays: number, inc: PnlTaxInclude) {
  const p = pnlOf(r, inc);
  const nights = g0(r, "n_airbnb") + g0(r, "n_booking") + g0(r, "n_direct");
  const cf = cfOf(r, inc);
  return {
    ...p,
    nights,
    nightsEstimated: g0(r, "n_est"),
    occupancy: availableDays ? Math.min(1, nights / availableDays) : null,
    adr: div(p.accRevenue, nights),
    revpar: availableDays ? p.accRevenue / availableDays : null,
    commissionPct: div(p.commission, p.rev.airbnb),
    directShare: div(p.rev.direct, p.accRevenue),
    roas: div(p.rev.direct, g0(r, "c_marketing")),
    marketing: g0(r, "c_marketing"),
    varPerNight: div(p.variable, nights),
    margin: div(p.result, p.revenue),
    stays: g0(r, "stays_airbnb"),
    los: div(g0(r, "n_airbnb_exact"), g0(r, "stays_airbnb")),
    cfNet: cf.net,
    cfOperating: cf.operating,
  };
}
export type Kpis = ReturnType<typeof kpis>;

/** Fedezeti pont: hány éjszaka kell havonta a fix költségek + tételes adó fedezéséhez. */
export function breakEven(k: Kpis, months: number): { fixedPerMonth: number; contributionPerNight: number | null; nightsPerMonth: number | null } {
  const fixedPerMonth = (k.fixed + k.flat) / Math.max(1, months);
  const cpn = k.nights ? (k.netRevenue - k.rev.other - k.variable - k.tfh - k.ifa) / k.nights : null;
  return { fixedPerMonth, contributionPerNight: cpn, nightsPerMonth: cpn && cpn > 0 ? fixedPerMonth / cpn : null };
}

// ---------------------------------------------------------------------------
// Diszkontált megtérülés
// ---------------------------------------------------------------------------

/** Diszkonttényező: a dátum pénzének értéke a kiinduló (vásárlási) árszinten. */
export type Deflator = (date: string) => number;

/** Állandó éves rátával (tesztekhez, összevetéshez). */
export const discountFactor = (t0: string, d: string, rate: number) => Math.pow(1 + rate, -daysBetween(t0, d) / 365.25);
export const constantRate = (t0: string, rate: number): Deflator => (d) => discountFactor(t0, d, rate);

export type PaybackPoint = { date: string; nominal: number; discounted: number };

/** A megtérülést szolgáló napi pénzáramok (minden pénzmozgás, kivéve magát az ingatlanvásárlást), diszkontálva. */
export function paybackFlows(days: Day[], inc: PnlTaxInclude, t0: string, df: Deflator, asOf = "9999-12-31"): PaybackPoint[] {
  const out: PaybackPoint[] = [];
  for (const d of days) {
    if (d.date < t0 || d.date > asOf) continue;
    const cf = cfOf(d.v, inc);
    const n = cf.operating + cf.invOther;
    if (!n) continue;
    out.push({ date: d.date, nominal: n, discounted: n * df(d.date) });
  }
  return out;
}

export function paybackSummary(flows: PaybackPoint[], base: number, df: Deflator, asOf: string) {
  let cumN = 0, cumD = 0;
  let reachedN: string | null = null, reachedD: string | null = null;
  for (const f of flows) {
    cumN += f.nominal;
    cumD += f.discounted;
    if (!reachedN && cumN >= base) reachedN = f.date;
    if (!reachedD && cumD >= base) reachedD = f.date;
  }
  // előrejelzés az utolsó 12 hónap átlagos havi pénzáramával
  const from = addDays(asOf, -364);
  const ttm = flows.filter((f) => f.date >= from && f.date <= asOf).reduce((a, f) => a + f.nominal, 0);
  const monthly = ttm / 12;
  const project = (discounted: boolean, start: number): string | null => {
    if (monthly <= 0) return null;
    let c = start;
    for (let k = 1; k <= 12 * 100; k++) {
      const d = addMonths(asOf, k);
      c += monthly * (discounted ? df(d) : 1);
      if (c >= base) return d;
    }
    return null;
  };
  return {
    base,
    cumNominal: cumN,
    cumDiscounted: cumD,
    recoveredPct: base ? cumD / base : 0,
    recoveredPctNominal: base ? cumN / base : 0,
    npv: cumD - base,
    ttm,
    monthly,
    reachedNominal: reachedN,
    reachedDiscounted: reachedD,
    projectedNominal: reachedN ?? project(false, cumN),
    projectedDiscounted: reachedD ?? project(true, cumD),
  };
}
