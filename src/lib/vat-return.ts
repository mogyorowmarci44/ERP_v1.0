/**
 * v3.7.0 – ÁFA-bevallás (2565 / 2665) előállítása a könyvelt számlákból, és önellenőrzés a beadott bevalláshoz képest.
 *
 * Forrás: a NAV 2565 / 2665 kitöltési útmutatója és mezőazonosító-táblázata.
 *   05–07. sor  belföldi értékesítés 5 / 18 / 27%, általános szabály (adóalap, adó)
 *   09. sor     különös szabályok szerinti adó – használt cikk különbözeti adózás (adóalap = árrés adó nélkül)
 *   12–14. sor  Közösségen belüli termékbeszerzés 5 / 18 / 27% (fizetendő)
 *   36. sor     fizetendő adó összesen (01–35., 110. sorok)
 *   50. sor     a 09. sorból a használt cikkek különbözeti adója (kiemelés)
 *   64–66. sor  belföldi beszerzés levonható adója 5 / 18 / 27%
 *   69. sor     Közösségen belüli termékbeszerzés levonható adója
 *   76. sor     levonható adó összesen (63–75., 111. sorok)
 *   82–86. sor  előző időszakról áthozott követelés, különbözet, befizetendő, visszaigényelt, átvihető
 *   105., 108.  az M-lapok (összesítő jelentés) összesítője
 *   04. lap     önellenőrzési melléklet (pótlékalap, pótlék, kötelezettség növekedés / csökkenés)
 * A főlap sorai ezer forintban (kerekítve), az M-lapok számlánkénti adatai forintban.
 *
 * Tiszta függvények – tesztelhető; az adatbázis-réteg a vat-return-data.ts-ben.
 */
import type { AnykSheet, VatResult } from "./anyk";

export type VatLine = {
  direction: "in" | "out"; kind: string; rate: number;
  net: number; vat: number; gross: number; marginPurchase: number | null;
  invoiceNumber: string; fulfillmentDate: string; partnerName: string; partnerTax: string | null;
};

export type RowKey = "05" | "06" | "07" | "09" | "12" | "13" | "14" | "36" | "50" | "64" | "65" | "66" | "69" | "76" | "82" | "83" | "84" | "85" | "86" | "105" | "108";
export type Cell = { b: number | null; c: number | null };
export type Rows = Partial<Record<RowKey, Cell>>;

/** M-lap számla: base / vat = a számla teljes (áfás) adóalapja és áthárított áfája; deducted = ebből ténylegesen levont áfa (f3). */
export type MInvoice = { number: string; date: string; base: number; vat: number; deducted: number };
export type MPartner = { tax8: string; name: string; invoices: MInvoice[] };

export type Computed = {
  rows: Rows; partners: MPartner[]; warnings: string[];
  /** forintos összegek a magyarázathoz */
  huf: { marginBase: number; marginVat: number; normalOut: number; deductible: number; kbb: number };
};

export const K = (ft: number) => Math.round(ft / 1000);
const r2 = (n: number) => Math.round(n * 100) / 100;
const RATE_ROW_OUT: Record<number, RowKey> = { 5: "05", 18: "06", 27: "07" };
const RATE_ROW_KBB: Record<number, RowKey> = { 5: "12", 18: "13", 27: "14" };
const RATE_ROW_IN: Record<number, RowKey> = { 5: "64", 18: "65", 27: "66" };

/** Különbözeti adózás: az adóalap a (bruttó eladási ár − beszerzési ár) adó nélkül; negatív árrésnél 0. */
export function marginBase(l: Pick<VatLine, "gross" | "vat" | "marginPurchase" | "rate">) {
  if (l.marginPurchase != null && Number.isFinite(l.marginPurchase)) return Math.max(0, r2(l.gross - l.marginPurchase - l.vat));
  return l.rate ? r2((l.vat * 100) / l.rate) : 0;
}

/** Az időszak könyvelt számlasoraiból a bevallás sorai (az előző időszakról áthozott követeléssel, ezer Ft). */
export function computeVatReturn(lines: VatLine[], prevCarryK: number): Computed {
  const w: string[] = [];
  const huf: Record<string, { b: number; c: number }> = {};
  const add = (row: RowKey, b: number, c: number) => { const x = (huf[row] ??= { b: 0, c: 0 }); x.b = r2(x.b + b); x.c = r2(x.c + c); };
  const unsupported = new Set<string>();
  const byPartner = new Map<string, MPartner>();
  const noTax = new Set<string>();
  let marginB = 0, marginC = 0, normalOut = 0, deductible = 0, kbb = 0;
  // A számla teljes áfás összege (levonható + nem levonható sorok) – az M-lapra a számlán áthárított teljes áfa kerül
  const full = new Map<string, { base: number; vat: number }>();
  for (const l of lines) {
    if (l.direction !== "in" || (l.kind !== "normal" && l.kind !== "non_deductible") || !l.rate) continue;
    const k = `${l.partnerName}\u0000${l.invoiceNumber}`;
    const x = full.get(k) ?? { base: 0, vat: 0 };
    x.base = r2(x.base + l.net); x.vat = r2(x.vat + l.vat);
    full.set(k, x);
  }

  for (const l of lines) {
    if (l.direction === "out") {
      if (l.kind === "margin") { const b = marginBase(l); add("09", b, l.vat); marginB += b; marginC += l.vat; continue; }
      if (l.kind === "normal") {
        const row = RATE_ROW_OUT[l.rate];
        if (!row) { unsupported.add(`értékesítés ${l.rate}%`); continue; }
        add(row, l.net, l.vat); normalOut += l.vat; continue;
      }
      if (l.kind === "out_of_scope") continue;
      unsupported.add(`értékesítés: ${l.kind}`);
      continue;
    }
    // beszerzés
    if (l.kind === "margin" || l.kind === "out_of_scope" || l.kind === "non_deductible" || l.kind === "exempt") continue;
    if (l.kind === "eu_acquisition") {
      const row = RATE_ROW_KBB[l.rate];
      if (!row) { unsupported.add(`Közösségen belüli beszerzés ${l.rate}%`); continue; }
      add(row, l.net, l.vat); add("69", l.net, l.vat); kbb += l.vat; continue;
    }
    if (l.kind === "normal") {
      const row = RATE_ROW_IN[l.rate];
      if (!row) { unsupported.add(`levonható ${l.rate}%`); continue; }
      add(row, l.net, l.vat); deductible += l.vat;
      const tax8 = (l.partnerTax ?? "").replace(/\D/g, "").slice(0, 8);
      if (tax8.length !== 8) { noTax.add(`${l.partnerName} (${l.invoiceNumber})`); continue; }
      const p = byPartner.get(tax8) ?? { tax8, name: l.partnerName, invoices: [] };
      const inv = p.invoices.find((i) => i.number === l.invoiceNumber);
      if (inv) inv.deducted = r2(inv.deducted + l.vat);
      else {
        const t = full.get(`${l.partnerName}\u0000${l.invoiceNumber}`) ?? { base: l.net, vat: l.vat };
        p.invoices.push({ number: l.invoiceNumber, date: l.fulfillmentDate, base: t.base, vat: t.vat, deducted: r2(l.vat) });
      }
      byPartner.set(tax8, p);
      continue;
    }
    unsupported.add(`beszerzés: ${l.kind}`);
  }
  if (unsupported.size) w.push(`Kézzel kell kiegészíteni (ezt a jogcímet a modul nem tölti): ${[...unsupported].join(", ")}.`);
  if (noTax.size) w.push(`Levonható áfa adószám nélküli partnertől – az M-lapra nem került fel, pótold a partner adószámát: ${[...noTax].join("; ")}.`);
  if (kbb) w.push("Közösségen belüli termékbeszerzés: a 12–14. és a 69. sor kitöltve; a közösségi adószám és az A60 összesítő nyilatkozat külön teendő.");

  const rows: Rows = {};
  for (const [k, v] of Object.entries(huf)) rows[k as RowKey] = { b: K(v.b), c: K(v.c) };
  if (rows["09"]) rows["50"] = { ...rows["09"] };
  const sum = (keys: RowKey[]) => keys.reduce((a, k) => ({ b: a.b + (rows[k]?.b ?? 0), c: a.c + (rows[k]?.c ?? 0) }), { b: 0, c: 0 });
  rows["36"] = sum(["05", "06", "07", "09", "12", "13", "14"]);
  rows["76"] = sum(["64", "65", "66", "69"]);
  if (prevCarryK > 0) rows["82"] = { b: null, c: prevCarryK };
  const d = (rows["36"].c ?? 0) - (rows["76"].c ?? 0) - prevCarryK;
  rows["83"] = { b: null, c: d };
  if (d > 0) rows["84"] = { b: null, c: d };
  if (d < 0) rows["86"] = { b: null, c: -d };

  const partners = [...byPartner.values()].sort((a, b) => a.name.localeCompare(b.name, "hu"));
  for (const p of partners) p.invoices.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const nInv = partners.reduce((a, p) => a + p.invoices.length, 0);
  if (partners.length) {
    // az ÁNYK a partnerenként (M-főlapon) ezer Ft-ra kerekített összegeket adja össze
    const tb = partners.reduce((a, p) => a + K(p.invoices.reduce((q, i) => q + i.base, 0)), 0);
    const tv = partners.reduce((a, p) => a + K(p.invoices.reduce((q, i) => q + i.vat, 0)), 0);
    rows["105"] = { b: partners.length, c: nInv, ...{ d: tb, e: tv } } as Cell;
    rows["108"] = { ...(rows["105"] as Cell) };
  }
  return { rows, partners, warnings: w, huf: { marginBase: marginB, marginVat: marginC, normalOut, deductible, kbb } };
}

export const resultOf = (rows: Rows): VatResult => ({
  prevCarry: rows["82"]?.c ?? null, diff: rows["83"]?.c ?? null, payable: rows["84"]?.c ?? null, refund: rows["85"]?.c ?? null, carry: rows["86"]?.c ?? null,
});

// --- beadott bevallás sorai --------------------------------------------------------------------------

const ROW_FIELD: Record<string, { page: string; kind: "C" | "D" }> = {
  "05": { page: "B", kind: "C" }, "06": { page: "B", kind: "C" }, "07": { page: "B", kind: "C" }, "09": { page: "B", kind: "C" },
  "12": { page: "B", kind: "C" }, "13": { page: "B", kind: "C" }, "14": { page: "B", kind: "C" }, "36": { page: "B", kind: "C" },
  "50": { page: "C", kind: "C" }, "64": { page: "C", kind: "C" }, "65": { page: "C", kind: "C" }, "66": { page: "C", kind: "C" }, "69": { page: "C", kind: "C" },
  "76": { page: "D", kind: "C" }, "82": { page: "D", kind: "D" }, "83": { page: "D", kind: "D" }, "84": { page: "D", kind: "D" }, "85": { page: "D", kind: "D" }, "86": { page: "D", kind: "D" },
  "105": { page: "F", kind: "D" }, "108": { page: "F", kind: "D" },
};
/** A főlap egy sorának mezőkódja: pl. 07 b → 0_0B0001C0007BA */
export const fieldOf = (row: string, col: "A" | "B" | "C" | "D" | "E") => {
  const f = ROW_FIELD[row];
  return `0_0${f.page}0001${f.kind}${row.padStart(4, "0")}${col}A`;
};
export const MAIN_ROWS = Object.keys(ROW_FIELD) as RowKey[];

/** Egy beadott (beolvasott) bevallás főlap-sorai a mezőkből. */
export function rowsFromFields(fields: Record<string, string>): Rows {
  const n = (k: string) => { const v = fields[k]; return v === undefined || v === "" ? null : Number(v); };
  const rows: Rows = {};
  for (const r of MAIN_ROWS) {
    // a 82–86. sor „b” oszlopa az önellenőrzési lánc előző értéke – a bevallás saját adata a „c”
    const b = ["82", "83", "84", "85", "86"].includes(r) ? null : n(fieldOf(r, "B")), c = n(fieldOf(r, "C"));
    if (b != null || c != null) rows[r] = { b, c };
  }
  return rows;
}

// --- önellenőrzési pótlék ----------------------------------------------------------------------------

/** Jegybanki alapkamat (hatálybalépés napjától). */
export const BASE_RATES: Array<{ from: string; pct: number }> = [
  { from: "2024-09-25", pct: 6.5 },
  { from: "2026-02-25", pct: 6.25 },
  { from: "2026-06-24", pct: 6.0 },
  { from: "2026-07-22", pct: 5.75 },
  { from: "2026-08-26", pct: 5.5 },
];
const addDay = (iso: string, n = 1) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const rateOn = (iso: string) => [...BASE_RATES].reverse().find((r) => r.from <= iso)?.pct ?? BASE_RATES[0].pct;

/**
 * Önellenőrzési pótlék (Art. 212. §): naponta a jegybanki alapkamat 365-öd része, ismételt önellenőrzésnél másfélszerese,
 * az eredeti bevallási határidőt követő naptól az önellenőrzés benyújtásáig (a kamatváltozások szerint szakaszolva).
 * A napi összeg három tizedesre kerekítve. Eredmény forintban.
 */
export function selfRevisionSurcharge(baseFt: number, dueDate: string, submitDate: string, repeated: boolean) {
  if (baseFt <= 0 || submitDate <= dueDate) return { amount: 0, days: 0, parts: [] as Array<{ from: string; to: string; days: number; pct: number }> };
  const parts: Array<{ from: string; to: string; days: number; pct: number }> = [];
  let total = 0, days = 0;
  let d = addDay(dueDate);
  while (d <= submitDate) {
    const pct = rateOn(d);
    const next = BASE_RATES.find((r) => r.from > d)?.from;
    const end = next && addDay(next, -1) < submitDate ? addDay(next, -1) : submitDate;
    const n = Math.round((Date.parse(end) - Date.parse(d)) / 86400000) + 1;
    const daily = Math.round(((baseFt * pct) / 100 / 365) * (repeated ? 1.5 : 1) * 1000) / 1000;
    total += daily * n; days += n;
    parts.push({ from: d, to: end, days: n, pct });
    d = addDay(end);
  }
  return { amount: Math.round(total), days, parts };
}

/**
 * A pótlék alapja (ezer Ft) a 04. lap 1. sorához – a kitöltési útmutató szerint, a 82–86. sor b (előző) és c (helyes) oszlopából.
 * Ha az átvihető követelés csak az előző hónap miatt változott (göngyölítés, Art. 212. § (5)), a pótlékalap az időszak
 * saját különbözetére korlátozódik (05-ös ok-kód).
 */
export function surchargeBase(prev: Rows, next: Rows) {
  const v = (r: Rows, k: RowKey) => r[k]?.c ?? 0;
  const p84 = v(prev, "84"), n84 = v(next, "84"), p86 = v(prev, "86"), n86 = v(next, "86");
  let rule = 0;
  if (p86 > 0 && n84 > 0) rule = p86 + n84;
  else if (n84 > p84) rule = n84 - p84;
  else if (p86 > n86 && n84 === 0) rule = p86 - n86;
  const own = (r: Rows) => v(r, "36") - v(r, "76");
  const ownInc = Math.max(0, own(next) - own(prev));
  const base = Math.min(rule, ownInc);
  return { base, rule, chainReduced: base < rule, increase: Math.max(0, n84 - p84), decrease: Math.max(0, p84 - n84) };
}

// --- ÁNYK lapok összeállítása --------------------------------------------------------------------------

export type BuildOpts = {
  form: string; // 2565 | 2665
  from: string; to: string; taxNumber: string; taxpayerName: string;
  /** a láncban előző (beadott) bevallás főlapja – a fejadatokat (ügyintéző, bankszámla, gyakoriság…) innen vesszük */
  baseFields: Record<string, string> | null;
  computed: Computed;
  selfRevision: null | { prev: Rows; repeated: boolean; baseK: number; surchargeK: number; increaseK: number; decreaseK: number; chainReduced: boolean };
  signDate: string; signPlace?: string | null;
};

const ROW_DATA = /^0_0[B-F]0001[CD]\d{4}[A-Z]A$/;
const ANNEX_DATA = /^0_0[IJ]0001[CDE]\d{3,4}[A-Z]?A$/;

export function buildVatSheets(o: BuildOpts): AnykSheet[] {
  const is26 = o.form === "2665";
  const tax11 = o.taxNumber.replace(/\D/g, "").slice(0, 11);
  const d8 = (iso: string) => iso.replace(/-/g, "");
  const f: Record<string, string> = {};
  // fejadatok az előző bevallásból (sorok, számított mezők, jelleg nélkül)
  for (const [k, v] of Object.entries(o.baseFields ?? {})) {
    // a dinamikus lapokat (XXXX) nem visszük át – az M-lapokat újra előállítjuk, a többi (pl. 09-es lap) itt nem kell
    if (ROW_DATA.test(k) || ANNEX_DATA.test(k) || /^0_\d+$/.test(k) || k.includes("XXXX") || /^\d+_0[A-Z]\d{4}/.test(k) && !k.includes("0001")) continue;
    f[k] = v;
  }
  const lap04 = is26 ? "0_0A0001F015A" : "0_0A0001F014A";
  for (const k of ["0_0A0001F005A", "0_0A0001F021A", "0_0A0001I002A", lap04, "0_0A0001C001H", "0_0A0001C002H", "0_0A0001C003H", "0_0A0001C004H"]) delete f[k];
  f["0_0A0001E001A"] = tax11;
  f["0_0A0001E007A"] ||= o.taxpayerName;
  f["0_0A0001F001A"] = d8(o.from);
  f["0_0A0001F002A"] = d8(o.to);
  f["0_0A0001F006A"] ||= "H";
  f["0_0A0001I002A"] = d8(o.signDate);
  if (o.signPlace) f["0_0A0001I001A"] = o.signPlace;
  for (const p of ["B", "C", "D", "F"]) f[`0_0${p}0001B001A`] = tax11;

  const rows = o.computed.rows;
  for (const [row, cell] of Object.entries(rows) as Array<[RowKey, Cell & { d?: number; e?: number }]>) {
    if (row === "105" || row === "108") {
      if (cell.b) f[fieldOf(row, "B")] = String(cell.b);
      if (cell.c) f[fieldOf(row, "C")] = String(cell.c);
      if (cell.d != null) f[fieldOf(row, "D")] = String(cell.d);
      if (cell.e != null) f[fieldOf(row, "E")] = String(cell.e);
      continue;
    }
    if (["82", "83", "84", "85", "86"].includes(row)) { if (cell.c != null) f[fieldOf(row, "C")] = String(cell.c); continue; }
    if (cell.b != null && cell.b !== 0) f[fieldOf(row, "B")] = String(cell.b);
    if (cell.c != null && cell.c !== 0) f[fieldOf(row, "C")] = String(cell.c);
  }
  // 105–109. sor: M-lapok összesítője. A 106. (korrekciók) b–e 0-val kitöltendő, a 108. = 105. + 106.
  const r105 = rows["105"] as (Cell & { d?: number; e?: number }) | undefined;
  if (r105) {
    for (const c of ["B", "C", "D", "E"]) f[`0_0F0001D0106${c}A`] = "0";
    if (is26) {
      const h = o.computed.partners.reduce((a, p) => a + K(p.invoices.reduce((q, i) => q + i.deducted, 0)), 0);
      f["0_0F0001D0105HA"] = String(h); // a 106. és 108. sor h oszlopa üresen marad
    }
  }
  // 109. sor: levonásba helyezett belföldi adó (64–66., 68. sor c – a, – 31. a) és az M-lapok adójának különbözete
  const c109 = (["64", "65", "66"] as RowKey[]).reduce((a, r) => a + (rows[r]?.c ?? 0), 0);
  f["0_0F0001D0109CA"] = String(c109);
  // 109 e: csak ha az M-lapok adója (108 e) nem több a levonásba helyezettnél; egyezésnél 0, ha több: üres
  if (c109 >= (r105?.e ?? 0)) f["0_0F0001D0109EA"] = String(c109 - (r105?.e ?? 0));
  // a 83. sor 0 is kitöltendő (különbözet)
  f[fieldOf("83", "C")] = String(rows["83"]?.c ?? 0);
  if (o.computed.partners.length) f["0_0A0001F021A"] = String(o.computed.partners.length);

  if (o.selfRevision) {
    const s = o.selfRevision;
    f["0_0A0001F005A"] = "O";
    f[lap04] = "1";
    for (const r of ["82", "83", "84", "85", "86"] as RowKey[]) {
      const pv = s.prev[r]?.c;
      if (pv != null) f[fieldOf(r, "B")] = String(pv);
    }
    if (f[fieldOf("83", "B")] === undefined) f[fieldOf("83", "B")] = "0";
    const P = is26 ? "J" : "I";
    f[`0_0${P}0001B001A`] = tax11;
    if (s.repeated) f[`0_0${P}0001C001A`] = "X";
    if (s.baseK > 0) {
      f[`0_0${P}0001D0001CA`] = String(s.baseK);
      f[`0_0${P}0001D0002CA`] = String(s.surchargeK);
    }
    if (is26 && s.chainReduced) f["0_0J0001D0001BA"] = "05";
    f[`0_0${P}0001D0003CA`] = String(s.increaseK);
    f[`0_0${P}0001D0004CA`] = String(s.decreaseK);
  }

  const sheets: AnykSheet[] = [{ id: `${o.form}A`, version: null, fields: f }];
  for (const p of o.computed.partners) sheets.push(mSheet(o, p, tax11));
  return sheets;
}

/** M-lap partnerenként: főlap (04. sor összesen, ezer Ft) + 02 részletező lapok, lapnként 36 számla (forintban). */
function mSheet(o: BuildOpts, p: MPartner, tax11: string): AnykSheet {
  const d8 = (iso: string) => iso.replace(/-/g, "");
  const f: Record<string, string> = {
    "0_0A0001C001A": tax11, "0_0A0001C004A": o.taxpayerName, "0_0A0001C005A": p.tax8, "0_0A0001C006A": p.name.slice(0, 80),
    "0_0A0001D001A": d8(o.from), "0_0A0001D002A": d8(o.to),
  };
  const tb = p.invoices.reduce((a, i) => a + i.base, 0), tv = p.invoices.reduce((a, i) => a + i.vat, 0);
  f["0_0A0001E0004BA"] = String(p.invoices.length);
  f["0_0A0001E0004CA"] = String(K(tb));
  f["0_0A0001E0004DA"] = String(K(tv));
  // 2665: levonásba helyezett adó (f3 → g oszlop) a 04. és az összesen (07.) sorban is
  if (o.form === "2665") f["0_0A0001E0004GA"] = f["0_0A0001E0007GA"] = String(K(p.invoices.reduce((a, i) => a + i.deducted, 0)));
  f["0_0A0001E0007BA"] = String(p.invoices.length);
  f["0_0A0001E0007CA"] = String(K(tb));
  f["0_0A0001E0007DA"] = String(K(tv));
  const pages = Math.max(1, Math.ceil(p.invoices.length / 36));
  for (let pg = 0; pg < pages; pg++) {
    const pre = `${pg}_0BXXXX`;
    f[`${pre}B001A`] = String(pg + 1);
    f[`${pre}B002A`] = tax11;
    f[`${pre}B004A`] = p.tax8;
    f[`${pre}B005A`] = p.name.slice(0, 80);
    p.invoices.slice(pg * 36, pg * 36 + 36).forEach((inv, i) => {
      const r = `${pre}C${String(i + 1).padStart(4, "0")}`;
      f[`${r}AA`] = inv.number.slice(0, 50);
      f[`${r}BA`] = d8(inv.date);
      f[`${r}CA`] = String(Math.round(inv.base));
      f[`${r}DA`] = String(Math.round(inv.vat));
      if (o.form === "2665") f[`${r}HA`] = String(Math.round(inv.deducted));
    });
    if (pg === pages - 1) {
      f[`${pre}C0037CA`] = String(Math.round(tb));
      f[`${pre}C0037DA`] = String(Math.round(tv));
      if (o.form === "2665") f[`${pre}C0037HA`] = String(Math.round(p.invoices.reduce((a, i) => a + i.deducted, 0)));
    }
  }
  return { id: `${o.form}M`, version: null, fields: f };
}
