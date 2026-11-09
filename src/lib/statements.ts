/**
 * Pénzügyi kimutatások időszakos bontásban:
 *  - Eredménykimutatás (Szt. 1. sz. melléklet, összköltség eljárás, "A" változat szerkezete)
 *  - Mérleg (Szt. 1. sz. melléklet, "A" változat szerkezete), időszak végi állapotok
 *  - Cash-flow (indirekt módszer, Szt. 3. sz. melléklet logikája szerint egyszerűsítve)
 *
 * A számítás tiszta függvény (napi, számlánkénti forgalmakon), így tesztelhető.
 * Költségek a 5. számlaosztályon (az 59 átvezetés és a 6–7. költséghelyi osztály nélkül).
 */
import { round2 } from "./money";
import { addDays } from "./fx";

export type Granularity = "day" | "week" | "month" | "quarter";
export const GRAN_LABEL: Record<Granularity, string> = { day: "Napi", week: "Heti", month: "Havi", quarter: "Negyedéves" };
export const MAX_COLUMNS = 92;

export type Bucket = { key: string; label: string; start: string; end: string };

const HU_MONTH = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
const ROMAN = ["I.", "II.", "III.", "IV."];

function dow(date: string) {
  return new Date(date + "T00:00:00Z").getUTCDay(); // 0 = vasárnap
}
function monthEndOf(date: string) {
  const [y, m] = date.split("-").map(Number);
  return `${date.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
const mmdd = (d: string) => `${d.slice(5, 7)}.${d.slice(8, 10)}.`;

/** Időszakok a [from, to] tartományon belül (a szélső időszakok a tartományra vágva). */
export function buckets(from: string, to: string, gran: Granularity): Bucket[] {
  if (from > to) return [];
  const out: Bucket[] = [];
  let cur = from;
  while (cur <= to && out.length <= MAX_COLUMNS) {
    let end: string;
    let label: string;
    if (gran === "day") {
      end = cur;
      label = mmdd(cur);
    } else if (gran === "week") {
      const toSunday = (7 - dow(cur)) % 7; // hétfő–vasárnap hét
      end = addDays(cur, toSunday);
      label = end.slice(5, 7) === cur.slice(5, 7) ? `${mmdd(cur)}–${end.slice(8, 10)}.` : `${mmdd(cur)}–${mmdd(end)}`;
    } else if (gran === "month") {
      end = monthEndOf(cur);
      label = `${cur.slice(0, 4)}. ${HU_MONTH[Number(cur.slice(5, 7)) - 1]}`;
    } else {
      const m = Number(cur.slice(5, 7));
      const qEndMonth = Math.ceil(m / 3) * 3;
      end = monthEndOf(`${cur.slice(0, 4)}-${String(qEndMonth).padStart(2, "0")}-01`);
      label = `${cur.slice(0, 4)}. ${ROMAN[qEndMonth / 3 - 1]} n.év`;
    }
    if (end > to) end = to;
    out.push({ key: cur, label, start: cur, end });
    cur = addDays(end, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Számlaszűrők
// ---------------------------------------------------------------------------

export type DailyRow = { code: string; date: string; amount: number }; // amount = Tartozik − Követel
type Pred = (code: string) => boolean;

const pre = (...ps: string[]): Pred => (c) => ps.some((p) => c.startsWith(p));
const and = (a: Pred, b: Pred): Pred => (c) => a(c) && b(c);
const not = (a: Pred): Pred => (c) => !a(c);

const PL: Pred = (c) => (c.startsWith("5") && !c.startsWith("59")) || c.startsWith("8") || c.startsWith("9");

class Ledger {
  constructor(private rows: DailyRow[]) {}
  /** Forgalom (T − K) a [start, end] napokon. */
  mov(p: Pred, start: string, end: string) {
    let s = 0;
    for (const r of this.rows) if (r.date >= start && r.date <= end && p(r.code)) s += r.amount;
    return round2(s);
  }
  /** Egyenleg (T − K) az adott nap végén. */
  bal(p: Pred, at: string) {
    let s = 0;
    for (const r of this.rows) if (r.date <= at && p(r.code)) s += r.amount;
    return round2(s);
  }
  /** Számlánkénti egyenleg (pl. a 46-os csoport nettó előjeléhez). */
  balByGroup(p: Pred, at: string, groupLen: number) {
    const m = new Map<string, number>();
    for (const r of this.rows) if (r.date <= at && p(r.code)) m.set(r.code.slice(0, groupLen), (m.get(r.code.slice(0, groupLen)) ?? 0) + r.amount);
    return m;
  }
}

// ---------------------------------------------------------------------------
// Kimutatás sorok
// ---------------------------------------------------------------------------

export type RowKind = "line" | "subtotal" | "total" | "check";
export type StatementRow = { key: string; label: string; kind: RowKind; values: number[]; total?: number; indent?: number };
export type Statement = { title: string; columns: Bucket[]; columnLabels: string[]; rows: StatementRow[]; hasTotal: boolean; checkOk: boolean };

/** Eredménykimutatás (összköltség eljárás). Bevételek pozitív, ráfordítások pozitív előjellel a saját soraikban. */
const PNL_LINES: Array<{ key: string; label: string; sign: 1 | -1; p: Pred; indent?: number }> = [
  { key: "I", label: "I. Értékesítés nettó árbevétele", sign: -1, p: pre("91", "92", "93", "94") },
  { key: "II", label: "II. Aktivált saját teljesítmények értéke", sign: -1, p: pre("58") },
  { key: "III", label: "III. Egyéb bevételek", sign: -1, p: and(pre("9"), not(pre("91", "92", "93", "94", "97"))) },
  { key: "IV5", label: "Anyagköltség", sign: 1, p: pre("51"), indent: 1 },
  { key: "IV6", label: "Igénybe vett szolgáltatások értéke", sign: 1, p: pre("52"), indent: 1 },
  { key: "IV7", label: "Egyéb szolgáltatások értéke", sign: 1, p: pre("53"), indent: 1 },
  { key: "IV8", label: "Eladott áruk beszerzési értéke", sign: 1, p: pre("811", "812", "813", "814"), indent: 1 },
  { key: "IV9", label: "Eladott (közvetített) szolgáltatások értéke", sign: 1, p: pre("815", "816", "817"), indent: 1 },
  { key: "V10", label: "Bérköltség", sign: 1, p: pre("54"), indent: 1 },
  { key: "V11", label: "Személyi jellegű egyéb kifizetések", sign: 1, p: pre("55"), indent: 1 },
  { key: "V12", label: "Bérjárulékok", sign: 1, p: pre("56"), indent: 1 },
  { key: "VI", label: "VI. Értékcsökkenési leírás", sign: 1, p: pre("57") },
  { key: "VII", label: "VII. Egyéb ráfordítások", sign: 1, p: and(pre("8"), not(pre("81", "87", "89"))) },
  { key: "VIII", label: "VIII. Pénzügyi műveletek bevételei", sign: -1, p: pre("97") },
  { key: "IX", label: "IX. Pénzügyi műveletek ráfordításai", sign: 1, p: pre("87") },
  { key: "X", label: "X. Adófizetési kötelezettség", sign: 1, p: pre("89") },
];

/** Egyéb 5-ös költségnemek (pl. 50, 58 kivételével) a IV.6-ba – hogy semmi ne vesszen el. */
const OTHER_5: Pred = and(pre("5"), not(pre("51", "52", "53", "54", "55", "56", "57", "58", "59")));

export function buildPnl(rows: DailyRow[], cols: Bucket[]): Statement {
  const L = new Ledger(rows);
  const v = (p: Pred, sign: number) => cols.map((b) => round2(sign * L.mov(p, b.start, b.end)));
  const line = new Map<string, number[]>();
  for (const d of PNL_LINES) line.set(d.key, v(d.p, d.sign));
  const other5 = v(OTHER_5, 1);
  line.set("IV6", line.get("IV6")!.map((x, i) => round2(x + other5[i])));
  const add = (...ks: string[]) => cols.map((_, i) => round2(ks.reduce((s, k) => s + (k.startsWith("-") ? -line.get(k.slice(1))![i] : line.get(k)![i]), 0)));
  line.set("IV", add("IV5", "IV6", "IV7", "IV8", "IV9"));
  line.set("V", add("V10", "V11", "V12"));
  line.set("A", add("I", "II", "III", "-IV", "-V", "-VI", "-VII"));
  line.set("B", add("VIII", "-IX"));
  line.set("C", add("A", "B"));
  line.set("D", add("C", "-X"));
  // Ellenőrzés: D = −(5–9 osztály forgalma)
  const check = cols.map((b, i) => round2(line.get("D")![i] + L.mov(PL, b.start, b.end)));

  const R = (key: string, label: string, kind: RowKind = "line", indent = 0): StatementRow => {
    const values = line.get(key)!;
    return { key, label, kind, values, total: round2(values.reduce((a, b) => a + b, 0)), indent };
  };
  const lab = (k: string) => PNL_LINES.find((x) => x.key === k)!.label;
  return {
    title: "Eredménykimutatás",
    columns: cols,
    columnLabels: cols.map((c) => c.label),
    hasTotal: true,
    checkOk: check.every((x) => Math.abs(x) < 0.5),
    rows: [
      R("I", lab("I")),
      R("II", lab("II")),
      R("III", lab("III")),
      R("IV", "IV. Anyagjellegű ráfordítások", "subtotal"),
      R("IV5", lab("IV5"), "line", 1),
      R("IV6", lab("IV6"), "line", 1),
      R("IV7", lab("IV7"), "line", 1),
      R("IV8", lab("IV8"), "line", 1),
      R("IV9", lab("IV9"), "line", 1),
      R("V", "V. Személyi jellegű ráfordítások", "subtotal"),
      R("V10", lab("V10"), "line", 1),
      R("V11", lab("V11"), "line", 1),
      R("V12", lab("V12"), "line", 1),
      R("VI", lab("VI")),
      R("VII", lab("VII")),
      R("A", "A. Üzemi (üzleti) tevékenység eredménye", "total"),
      R("VIII", lab("VIII")),
      R("IX", lab("IX")),
      R("B", "B. Pénzügyi műveletek eredménye", "total"),
      R("C", "C. Adózás előtti eredmény", "total"),
      R("X", lab("X")),
      R("D", "D. Adózott eredmény", "total"),
    ],
  };
}

// ---------------------------------------------------------------------------
// Mérleg
// ---------------------------------------------------------------------------

export function fiscalYearStartOf(date: string, startMonth: number): string {
  const [y, m] = date.split("-").map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

export function buildBalanceSheet(rows: DailyRow[], cols: Bucket[], fiscalStartMonth: number, from: string): Statement {
  const L = new Ledger(rows);
  // Oszlopok: nyitó (from előtti nap vége) + minden időszak vége
  const dates = [addDays(from, -1), ...cols.map((c) => c.end)];
  const labels = ["Nyitó", ...cols.map((c) => c.label)];

  const asset = (p: Pred) => dates.map((d) => L.bal(p, d));
  const liab = (p: Pred) => dates.map((d) => -L.bal(p, d));

  // 46 – adók: csoportonként nettó; tartozik egyenleg követelés, követel egyenleg kötelezettség
  const tax46 = dates.map((d) => {
    let deb = 0,
      cred = 0;
    for (const [, v] of L.balByGroup(pre("46"), d, 3)) v >= 0 ? (deb += v) : (cred += -v);
    return { deb: round2(deb), cred: round2(cred) };
  });

  // Eredmény: tárgyévi (üzleti év elejétől) és korábbi évek le nem zárt eredménye
  const curResult = dates.map((d) => -L.mov(PL, fiscalYearStartOf(d, fiscalStartMonth), d));
  const priorResult = dates.map((d) => -L.bal(PL, addDays(fiscalYearStartOf(d, fiscalStartMonth), -1)));

  const sum = (...xs: number[][]) => dates.map((_, i) => round2(xs.reduce((s, x) => s + x[i], 0)));

  const AI = asset(pre("11"));
  const AII = asset(pre("12", "13", "14", "15", "16"));
  const AIII = asset(pre("17", "18", "19"));
  const A = sum(AI, AII, AIII);
  const BI = asset(pre("2"));
  const BII = sum(asset(pre("31", "32", "33", "34", "35", "36")), tax46.map((t) => t.deb));
  const BIII = asset(pre("37"));
  const BIV = asset(pre("38"));
  const B = sum(BI, BII, BIII, BIV);
  const C = asset(pre("39"));
  const ASSETS = sum(A, B, C);

  const DI = liab(pre("411"));
  const DII = liab(pre("412"));
  const DIII = liab(pre("413"));
  const DIV = sum(liab(pre("414")), priorResult);
  const DV = liab(pre("417"));
  const DVI = liab(pre("418"));
  const DVII = sum(liab(pre("419", "493")), curResult);
  const D = sum(DI, DII, DIII, DIV, DV, DVI, DVII);
  const E = liab(pre("42"));
  const FI = liab(pre("43"));
  const FII = liab(pre("44"));
  const FIII = sum(liab(pre("45", "47")), tax46.map((t) => t.cred));
  const F = sum(FI, FII, FIII);
  const G = liab(pre("48"));
  // Nem besorolt (pl. 491/492 nyitó-/zárómérleg számlák, 415/416 stb.) – normál esetben 0
  const UNCL = liab(and(pre("4"), not(pre("411", "412", "413", "414", "417", "418", "419", "42", "43", "44", "45", "46", "47", "48", "493"))));
  const LIABEQ = sum(D, E, F, G, UNCL);
  const CHECK = dates.map((_, i) => round2(ASSETS[i] - LIABEQ[i]));

  const R = (key: string, label: string, values: number[], kind: RowKind = "line", indent = 0): StatementRow => ({ key, label, kind, values, indent });
  const rowsOut: StatementRow[] = [
    R("A", "A. Befektetett eszközök", A, "subtotal"),
    R("AI", "I. Immateriális javak", AI, "line", 1),
    R("AII", "II. Tárgyi eszközök", AII, "line", 1),
    R("AIII", "III. Befektetett pénzügyi eszközök", AIII, "line", 1),
    R("B", "B. Forgóeszközök", B, "subtotal"),
    R("BI", "I. Készletek", BI, "line", 1),
    R("BII", "II. Követelések", BII, "line", 1),
    R("BIII", "III. Értékpapírok", BIII, "line", 1),
    R("BIV", "IV. Pénzeszközök", BIV, "line", 1),
    R("C", "C. Aktív időbeli elhatárolások", C, "subtotal"),
    R("ASSETS", "Eszközök összesen", ASSETS, "total"),
    R("D", "D. Saját tőke", D, "subtotal"),
    R("DI", "I. Jegyzett tőke", DI, "line", 1),
    R("DII", "II. Jegyzett, de még be nem fizetett tőke", DII, "line", 1),
    R("DIII", "III. Tőketartalék", DIII, "line", 1),
    R("DIV", "IV. Eredménytartalék", DIV, "line", 1),
    R("DV", "V. Lekötött tartalék", DV, "line", 1),
    R("DVI", "VI. Értékelési tartalék", DVI, "line", 1),
    R("DVII", "VII. Adózott eredmény", DVII, "line", 1),
    R("E", "E. Céltartalékok", E, "subtotal"),
    R("F", "F. Kötelezettségek", F, "subtotal"),
    R("FI", "I. Hátrasorolt kötelezettségek", FI, "line", 1),
    R("FII", "II. Hosszú lejáratú kötelezettségek", FII, "line", 1),
    R("FIII", "III. Rövid lejáratú kötelezettségek", FIII, "line", 1),
    R("G", "G. Passzív időbeli elhatárolások", G, "subtotal"),
  ];
  if (UNCL.some((x) => Math.abs(x) >= 0.5)) rowsOut.push(R("UNCL", "Nem besorolt forrásszámlák (ellenőrizd!)", UNCL, "check"));
  rowsOut.push(R("LIABEQ", "Források összesen", LIABEQ, "total"));
  const checkOk = CHECK.every((x) => Math.abs(x) < 0.5);
  if (!checkOk) rowsOut.push(R("CHECK", "Eltérés (eszközök − források)", CHECK, "check"));
  return { title: "Mérleg", columns: cols, columnLabels: labels, rows: rowsOut, hasTotal: false, checkOk };
}

// ---------------------------------------------------------------------------
// Cash-flow (indirekt)
// ---------------------------------------------------------------------------

export function buildCashFlow(rows: DailyRow[], cols: Bucket[]): Statement {
  const L = new Ledger(rows);
  // Δ = forgalom (T − K) az időszakban
  const d = (p: Pred) => cols.map((b) => L.mov(p, b.start, b.end));
  const neg = (x: number[]) => x.map((v) => round2(-v));
  const sum = (...xs: number[][]) => cols.map((_, i) => round2(xs.reduce((s, x) => s + x[i], 0)));

  const PL_NO_TAX: Pred = and(PL, not(pre("89")));
  const result = neg(d(PL_NO_TAX)); // adózás előtti eredmény
  const depreciation = d(pre("57"));
  const assetSaleAdj = sum(d(pre("861")), d(pre("961")));
  const inventories = neg(d(pre("2")));
  const receivables = neg(d(pre("31", "32", "33", "34", "35", "36", "37", "39")));
  const shortLiab = neg(d(and(pre("42", "45", "46", "47", "48"), not(pre("451", "4791")))));
  const tax = neg(d(pre("89")));
  const OP = sum(result, depreciation, assetSaleAdj, inventories, receivables, shortLiab, tax);

  const capex = sum(neg(d(pre("1"))), neg(depreciation), neg(d(pre("861"))));
  const disposals = neg(d(pre("961")));
  const INV = sum(capex, disposals);

  const equity = neg(d(pre("41", "49")));
  const loans = neg(d(pre("43", "44", "451", "4791")));
  const FIN = sum(equity, loans);

  const cashChange = d(pre("38"));
  const explained = sum(OP, INV, FIN);
  const other = cols.map((_, i) => round2(cashChange[i] - explained[i])); // pl. 6–7. osztály / 59 nem nullázódó egyenlege
  const openCash = cols.map((b) => L.bal(pre("38"), addDays(b.start, -1)));
  const closeCash = cols.map((b) => L.bal(pre("38"), b.end));

  const R = (key: string, label: string, values: number[], kind: RowKind = "line", indent = 0, withTotal = true): StatementRow => ({
    key,
    label,
    kind,
    values,
    total: withTotal ? round2(values.reduce((a, b) => a + b, 0)) : undefined,
    indent,
  });
  const out: StatementRow[] = [
    R("open", "Pénzeszközök nyitó állománya", openCash, "subtotal", 0, false),
    R("OP", "I. Működési cash-flow", OP, "subtotal"),
    R("op1", "Adózás előtti eredmény", result, "line", 1),
    R("op2", "Elszámolt értékcsökkenés", depreciation, "line", 1),
    R("op3", "Befektetett eszközök értékesítésének eredménye", assetSaleAdj, "line", 1),
    R("op4", "Készletek változása", inventories, "line", 1),
    R("op5", "Követelések és aktív elhatárolások változása", receivables, "line", 1),
    R("op6", "Rövid lejáratú kötelezettségek és passzív elhatárolások változása", shortLiab, "line", 1),
    R("op7", "Társasági adó", tax, "line", 1),
    R("INV", "II. Befektetési cash-flow", INV, "subtotal"),
    R("inv1", "Befektetett eszközök beszerzése", capex, "line", 1),
    R("inv2", "Befektetett eszközök eladása", disposals, "line", 1),
    R("FIN", "III. Finanszírozási cash-flow", FIN, "subtotal"),
    R("fin1", "Tőkebevonás, saját tőke változása", equity, "line", 1),
    R("fin2", "Hitelek, kölcsönök, tagi kölcsön változása", loans, "line", 1),
  ];
  if (other.some((x) => Math.abs(x) >= 0.5)) out.push(R("other", "Egyéb, nem besorolt (6–7. osztály / 59)", other, "check"));
  out.push(R("IV", "IV. Pénzeszközök változása", cashChange, "total"));
  out.push(R("close", "Pénzeszközök záró állománya", closeCash, "subtotal", 0, false));
  return { title: "Cash-flow kimutatás", columns: cols, columnLabels: cols.map((c) => c.label), rows: out, hasTotal: true, checkOk: true };
}
