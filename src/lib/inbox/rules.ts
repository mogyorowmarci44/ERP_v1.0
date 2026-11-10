/**
 * Szabályalapú (AI nélküli) kiolvasás – tiszta függvények, tesztelhetők.
 *  - parseDocumentText: számla / nyugta / adásvételi szövegéből (PDF-szövegréteg vagy OCR) a fő adatok,
 *  - parseStatementTable: bankkivonat CSV / Excel exportjából a tranzakciók.
 * Amit nem talál biztosan, azt üresen hagyja – a javaslat ilyenkor jóváhagyásra kerül, nem könyvelődik magától.
 */
import type { ExtractedDoc } from "@/db/schema";

type Company = { name: string; taxNumber: string | null };
type Hint = { kind?: string; subject?: string | null; from?: string | null; filename?: string | null };

// ---------------------------------------------------------------------------
// Számok, dátumok
// ---------------------------------------------------------------------------

const SP = "[ \\u00a0\\u202f\\u2009]";
/** Pénzösszeg-tokenek: 1 234 567 · 1.234.567,50 · 1,234.50 · 12446 · -3 150 */
const AMOUNT_RE = new RegExp(`(?<![A-Za-z0-9\\-/.,])-?(?:\\d{1,3}(?:${SP}\\d{3})+|\\d{1,3}(?:\\.\\d{3})+|\\d{1,3}(?:,\\d{3})+(?=\\.\\d{2}\\b)|\\d+)(?:[.,]\\d{1,2})?(?![\\d])`, "g");

export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[    ]/g, "");
  if (!/\d/.test(s)) return null;
  const neg = s.startsWith("-") || /^\(.*\)$/.test(s);
  s = s.replace(/[-()]/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // mindkettő: a későbbi a tizedesjel
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = /,\d{3}$/.test(s) && (s.match(/,/g)?.length ?? 0) >= 1 && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** A sor pénzösszegei (dátumok, adószámok, százalékok, darabszám nélkül). */
export function amountsIn(line: string): number[] {
  const clean = line
    .replace(/\b\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}\.?/g, " ") // dátum
    .replace(/\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}\b/g, " ")
    .replace(/\b\d{8}-\d-\d{2}\b/g, " ") // adószám
    .replace(/\b[A-Z]{2}\d{8,12}\b/g, " ") // EU adószám
    .replace(/\b\d+(?:[.,]\d+)?\s?%/g, " ") // százalék
    .replace(/\b\d{8}-\d{8}(?:-\d{8})?\b/g, " ") // bankszámlaszám
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, " "); // alvázszám
  return [...clean.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0])).filter((n): n is number => n != null);
}

const pad = (n: number) => String(n).padStart(2, "0");
const okDate = (y: number, m: number, d: number) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, "már": 3, mar: 3, "ápr": 4, apr: 4, "máj": 5, maj: 5, may: 5, "jún": 6, jun: 6, "júl": 7, jul: 7, aug: 8, szept: 9, szep: 9, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12,
};

/** Dátumok a sorban, előfordulási sorrendben (YYYY-MM-DD). */
export function datesIn(line: string): string[] {
  const out: Array<[number, string]> = [];
  for (const m of line.matchAll(/\b(20\d{2})\s?[.\-/]\s?(\d{1,2})\s?[.\-/]\s?(\d{1,2})\.?/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (okDate(y, mo, d)) out.push([m.index!, `${y}-${pad(mo)}-${pad(d)}`]);
  }
  for (const m of line.matchAll(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (okDate(y, mo, d)) out.push([m.index!, `${y}-${pad(mo)}-${pad(d)}`]);
  }
  for (const m of line.matchAll(/\b(20\d{2})\.?\s+([a-záéíóöőúüű]{3,})\.?\s+(\d{1,2})\.?/gi)) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("szept") ? 5 : 3)];
    if (mo && okDate(Number(m[1]), mo, Number(m[3]))) out.push([m.index!, `${m[1]}-${pad(mo)}-${pad(Number(m[3]))}`]);
  }
  for (const m of line.matchAll(/\b(\d{4})(\d{2})(\d{2})\b/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (okDate(y, mo, d)) out.push([m.index!, `${y}-${pad(mo)}-${pad(d)}`]);
  }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// ---------------------------------------------------------------------------
// Címkék
// ---------------------------------------------------------------------------

const L = {
  issue: /(szamla\s*kelte|kiallitas\s*(datuma|kelte)?|kelte|keltezes|szamla\s*datuma|invoice\s*date|date\s*of\s*issue|rechnungsdatum|ausstellungsdatum|^datum\b)/,
  fulfil: /(teljesites(\s*datuma|\s*kelte|\s*idopontja)?|telj\.?\s*dat|fulfil+ment|delivery\s*date|date\s*of\s*supply|leistungsdatum|lieferdatum|tax\s*point)/,
  due: /(fizetesi\s*hatarido|hatarido|esedekesseg|esedekes|due\s*date|payment\s*due|fallig|zahlbar\s*bis|zahlungsziel)/,
  gross: /(fizetendo(\s*osszeg)?|vegosszeg|brutto\s*osszesen|osszesen\s*brutto|szamla\s*osszesen|mindosszesen|total\s*(amount|due|to\s*pay|gross|incl)|amount\s*due|grand\s*total|gesamtbetrag|rechnungsbetrag|zu\s*zahlen|endbetrag|summe\s*brutto|bruttobetrag|vetelar)/,
  net: /(netto\s*osszesen|osszesen\s*netto|total\s*net|net\s*total|subtotal|nettobetrag|summe\s*netto|zwischensumme)/,
  vat: /(afa\s*osszesen|osszes\s*afa|afa\s*ertek\s*osszesen|total\s*vat|vat\s*total|vat\s*amount|mwst\.?\s*betrag|umsatzsteuer\s*betrag|ust\.?\s*betrag)/,
  number: /(szamla\s*sorszama|szamlaszam|szamla\s*szama|sorszam|bizonylatszam|invoice\s*(no\.?|number|nr\.?|#)|rechnungs\s*-?\s*(nummer|nr\.?)|rechnung\s*nr\.?|document\s*no\.?)/,
  payment: /(fizetesi\s*mod|fizetes\s*modja|payment\s*(method|terms)|zahlungsart|zahlungsweise)/,
};

/** Az első számot is tartalmazó azonosító (pl. „/ Invoice number: BC60712” → BC60712), dátum nélkül. */
function numberToken(s: string): string | null {
  for (const m of s.matchAll(/[A-Z0-9][A-Z0-9\-/._]{2,30}/gi)) {
    const t = m[0].replace(/[.,;:/-]+$/, "");
    if (!/\d/.test(t) || /^\d{1,2}$/.test(t) || datesIn(t).length || /^\d{8}-\d-\d{2}$/.test(t)) continue;
    return t;
  }
  return null;
}

function labelValue(lines: string[], f: string[], re: RegExp, pick: (s: string) => string | null, lookAhead = 2): string | null {
  for (let i = 0; i < f.length; i++) {
    const m = re.exec(f[i]);
    if (!m) continue;
    const after = lines[i].slice(m.index + m[0].length);
    const v = pick(after);
    if (v) return v;
    for (let k = 1; k <= lookAhead && i + k < lines.length; k++) {
      // táblázatos fejléc: a címke oszlopa szerinti érték a következő sorban
      const col = colAt(lines[i], m.index, lines[i + k]);
      const v2 = (col && pick(col)) || null;
      if (v2) return v2;
    }
  }
  return null;
}

/** A fejlécsor címkéjének megfelelő oszlop értéke a következő sorban (két szóközzel tagolt oszlopok). */
function colAt(header: string, labelPos: number, next: string): string | null {
  const cells = (s: string) => { const out: Array<[number, string]> = []; for (const m of s.matchAll(/\S+(?: \S+)*/g)) out.push([m.index!, m[0]]); return out; };
  const hc = cells(header), nc = cells(next);
  if (!nc.length) return null;
  const hi = hc.findIndex(([p, t]) => labelPos >= p && labelPos < p + t.length);
  if (hi >= 0 && hc.length === nc.length) return nc[hi][1];
  // különben a legközelebbi kezdőpozíció
  return nc.reduce((best, c) => (Math.abs(c[0] - labelPos) < Math.abs(best[0] - labelPos) ? c : best))[1];
}

/** Ha egy sorban több dátumcímke áll (pl. „Teljesítés  Kelte  Határidő”), a következő sor dátumai sorrendben. */
function headerDates(lines: string[], f: string[]) {
  const res: { issue?: string; fulfil?: string; due?: string } = {};
  for (let i = 0; i < f.length - 1; i++) {
    const found = (["issue", "fulfil", "due"] as const)
      .map((k) => { const m = L[k].exec(f[i]); return m ? ([k, m.index] as const) : null; })
      .filter((x): x is readonly ["issue" | "fulfil" | "due", number] => !!x);
    // a „kelte” a „teljesítés kelte” része is lehet – azonos pozíció kétszer ne számítson
    const uniq = found.filter((x, j) => !found.some((y, k) => k !== j && y[1] === x[1] && y[0] === "fulfil" && x[0] === "issue"));
    if (uniq.length < 2 || datesIn(lines[i]).length) continue;
    const ds = datesIn(lines[i + 1]);
    if (ds.length < uniq.length) continue;
    uniq.sort((a, b) => a[1] - b[1]).forEach(([k], j) => { res[k] ??= ds[j]; });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Számla szövegéből
// ---------------------------------------------------------------------------

const TAX_HU = /\b(\d{8})-(\d)-(\d{2})\b/g;
const EU_VAT = /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)\s?([0-9A-Z]{8,12})\b/g;
const COMPANY_SUFFIX = /\b(kft|zrt|nyrt|bt|kkt|e\.?\s?v\.?|egyéni vállalkozó|gmbh|ag|ug|kg|ohg|ltd|limited|s\.?\s?a\.?|s\.?r\.?l\.?|b\.?\s?v\.?|sp\.?\s?z\s?o\.?\s?o\.?|s\.?r\.?o\.?|a\.?s\.?|oy|ab)\b\.?/i;
const VIN = /\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/;
const PLATE = /\b([A-Z]{2}\s?[A-Z]{2}[-\s]?\d{3}|[A-Z]{3}[-\s]?\d{3})\b/;

export function parseDocumentText(text: string, company: Company, hint: Hint = {}): ExtractedDoc {
  const lines = text.split(/\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const f = lines.map(fold);
  const all = f.join("\n");

  // típus
  let docType: ExtractedDoc["docType"] = "invoice";
  const head = f.slice(0, 25).join("\n");
  if (/(szamlakivonat|bankszamlakivonat|kontoauszug|account\s*statement|bank\s*statement)/.test(head) || hint.kind === "statement") docType = "bank_statement";
  else if (/(dijbekero|proforma|elolegbekero|pro\s*forma)/.test(head)) docType = "proforma";
  else if (/(sztorno|storno|jovairo|helyesbito|credit\s*note|gutschrift|stornorechnung)/.test(head)) docType = "credit_note";
  else if (/(adasveteli\s*szerzodes|kaufvertrag|vehicle\s*purchase\s*agreement)/.test(head)) docType = "sale_contract";
  else if (/(nyugta|receipt|kassenbon|blokk)/.test(head) && !/szamla|invoice|rechnung/.test(head)) docType = "receipt";

  if (docType === "bank_statement") return { docType, confidence: 0, notes: "PDF-kivonat: AI nélkül nem bontom tételekre – a netbankból letöltött CSV / Excel exportot pontosan beolvasom." };

  // adószámok – sorrend szerint (az eladó adatai jellemzően előbb állnak)
  const ownTax = digits(company.taxNumber).slice(0, 8);
  const taxes: Array<{ pos: number; tax8: string; full: string; eu?: boolean }> = [];
  const joined = lines.join("\n");
  for (const m of joined.matchAll(TAX_HU)) taxes.push({ pos: m.index!, tax8: m[1], full: m[0] });
  for (const m of joined.matchAll(EU_VAT)) {
    const t8 = m[1] === "HU" ? m[2].slice(0, 8) : "";
    if (!taxes.some((t) => t.tax8 && t.tax8 === t8)) taxes.push({ pos: m.index!, tax8: t8, full: `${m[1]}${m[2]}`, eu: true });
  }
  taxes.sort((a, b) => a.pos - b.pos);
  const own = taxes.find((t) => ownTax && t.tax8 === ownTax);
  const ownName = fold(company.name).replace(COMPANY_SUFFIX, "").replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter((w) => w.length > 2);
  const ownPhrase = ownName.join(" ");
  const ownNamePos = ownPhrase.length >= 4 ? fold(joined).replace(/[^a-z0-9\n]+/g, " ").indexOf(ownPhrase) : -1;
  const other = taxes.find((t) => !(ownTax && t.tax8 === ownTax));

  // partner neve: a partner adószáma előtti legközelebbi cégnév-sor, különben az első idegen cégnév
  const lineStart = (pos: number) => joined.slice(0, pos).split("\n").length - 1;
  const isOwn = (l: string) => ownName.length > 0 && ownName.every((w) => fold(l).includes(w));
  const cleanName = (l: string) => {
    const m = COMPANY_SUFFIX.exec(l);
    let s = m ? l.slice(0, m.index + m[0].length) : l;
    s = s.replace(/^(elado|szallito|kibocsato|seller|supplier|verkaufer|vevo|buyer|kunde|nev|name)\s*:?\s*/i, "");
    // két oszlop egy sorban: a cégnév-utótagot tartalmazó rész
    const parts = s.split(/\s{2,}/);
    return (parts.find((p) => COMPANY_SUFFIX.test(p) && !isOwn(p)) ?? parts[0]).trim();
  };
  let partnerName: string | null = null;
  if (other) {
    const li = lineStart(other.pos);
    for (let k = li; k >= Math.max(0, li - 8); k--) {
      const parts = lines[k].split(/\s{2,}/).filter((p) => COMPANY_SUFFIX.test(p) && !isOwn(p));
      if (parts.length) { partnerName = cleanName(parts[0]); break; }
    }
  }
  if (!partnerName) {
    const cand = lines.slice(0, 40).flatMap((l) => l.split(/\s{2,}/)).find((p) => COMPANY_SUFFIX.test(p) && !isOwn(p) && p.length < 80 && !/\d{8}-\d-\d{2}/.test(p));
    if (cand) partnerName = cleanName(cand);
  }
  if (!partnerName && hint.from) {
    const n = hint.from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
    if (n && !n.includes("@")) partnerName = n;
  }
  // irány: az eladó adatai állnak elöl (adószám-sorrend, különben a cégnevek sorrendje)
  const foldedFlat = fold(joined).replace(/[^a-z0-9\n]+/g, " ");
  const partnerPos = partnerName ? foldedFlat.indexOf(fold(partnerName).replace(/[^a-z0-9]+/g, " ").trim()) : -1;
  let direction: "in" | "out" = "in";
  if (own && other) direction = own.pos < other.pos ? "out" : "in";
  else if (ownNamePos >= 0 && partnerPos >= 0) direction = ownNamePos < partnerPos ? "out" : "in";
  else if (own && !other && /(vevo|buyer|kunde)/.test(all)) direction = (/(elado|szallito|seller|verkaufer)/.exec(all)?.index ?? 1e9) < own.pos ? "out" : "in";

  // adásvételi: magánszemély eladó / vevő a „Eladó:” / „Vevő:” sorból
  let privatePerson = false;
  if (docType === "sale_contract" && !other) {
    const lab = direction === "in" ? /(elado|verkaufer)\s*(neve)?\s*:?\s*/ : /(vevo|kaufer)\s*(neve)?\s*:?\s*/;
    const i = f.findIndex((l) => lab.test(l));
    if (i >= 0) {
      const after = lines[i].slice((lab.exec(f[i])!.index) + lab.exec(f[i])![0].length).split(/\s{2,}|,/)[0].trim();
      if (after && !isOwn(after)) { partnerName = after; privatePerson = !COMPANY_SUFFIX.test(after); }
    }
  }

  // számlaszám
  const invoiceNumber = labelValue(lines, f, L.number, numberToken);

  // dátumok
  const hd = headerDates(lines, f);
  const firstDate = (s: string) => datesIn(s)[0] ?? null;
  const issueDate = hd.issue ?? labelValue(lines, f, L.issue, firstDate);
  const fulfillmentDate = hd.fulfil ?? labelValue(lines, f, L.fulfil, firstDate);
  const dueDate = hd.due ?? labelValue(lines, f, L.due, firstDate);
  const anyDate = datesIn(joined)[0] ?? null;

  // időszakos
  const periodic = /(elszamolasi\s*idoszak|szamlazasi\s*idoszak|targyidoszak|idoszak\s*:|billing\s*period|leistungszeitraum|abrechnungszeitraum)/.test(all) &&
    lines.some((l, i) => /(idoszak|period|zeitraum)/.test(f[i]) && datesIn(l).length >= 2);

  // ÁFA-jelleg
  let vatType: string | null = null;
  if (/(kulonbozet|kulonbozeti\s*adozas|differenzbesteuerung|§\s*25\s*a|margin\s*scheme|regime\s*particulier|hasznalt\s*cikk)/.test(all)) vatType = "KÜL";
  else if (/(forditott\s*adozas|reverse\s*charge|steuerschuldnerschaft\s*des\s*leistungsempfangers|afa\s*tv\.?\s*142)/.test(all)) vatType = "FAD";
  else if (/(targyi\s*adomentes|alanyi\s*adomentes|\baam\b|\btam\b|adomentes|steuerfrei|vat\s*exempt|kozossegen\s*beluli\s*termekertekesites|innergemeinschaftliche\s*lieferung)/.test(all)) vatType = "AM";
  const rateMatch = [...all.matchAll(/\b(27|18|5|19|20|21|22|23|24|25)\s?%/g)].map((m) => Number(m[1]));
  const vatRate = vatType ? null : rateMatch.includes(27) ? 27 : rateMatch.includes(18) ? 18 : rateMatch.includes(5) ? 5 : rateMatch[0] ?? null;

  // pénznem
  const gl = f.filter((l) => L.gross.test(l)).join(" ");
  const EURX = /(\beur\b|€)/, HUFX = /(\bhuf\b|\bft\b|forint)/;
  const currency = EURX.test(gl) ? "EUR" : HUFX.test(gl) ? "HUF" : EURX.test(all) && !HUFX.test(all) ? "EUR" : "HUF";

  // végösszegek
  const lastAmount = (s: string) => { const a = amountsIn(s).filter((n) => Math.abs(n) >= 1); return a.length ? String(a[a.length - 1]) : null; };
  const num = (s: string | null) => (s == null ? null : Number(s));
  const gross = num(labelValue(lines, f, L.gross, lastAmount, 1));
  let net = num(labelValue(lines, f, L.net, lastAmount, 1));
  let vat = num(labelValue(lines, f, L.vat, lastAmount, 1));

  // tételsorok: szöveg + összegek, ahol nettó + ÁFA ≈ bruttó (vagy különbözeti / mentes sor)
  type Line = NonNullable<ExtractedDoc["lines"]>[number];
  const items: Line[] = [];
  const SKIP = /(osszesen|total|summe|vegosszeg|fizetendo|afa\s*alap|afa\s*tartalom|kerekites|rundung|szamla\s*osszesen|reszosszeg|subtotal|^\s*afa\b|^\s*vat\b|egyenleg|atutalando|befizetendo)/;
  for (let i = 0; i < lines.length; i++) {
    if (SKIP.test(f[i])) continue;
    const textPart = lines[i].replace(/^[\s\d.)]*\s/, "").split(/\s{2,}|\s(?=-?\d)/)[0]?.trim() ?? "";
    if (textPart.replace(/[^a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ]/g, "").length < 3) continue;
    const am = amountsIn(lines[i]);
    if (am.length < 2) continue;
    const rate = /(\d{1,2})\s?%/.exec(lines[i])?.[1];
    const r = rate ? Number(rate) : null;
    const [a, b, c] = am.slice(-3);
    if (am.length >= 3 && r != null && Math.abs(a + b - c) <= Math.max(2, c * 0.001) && Math.abs(a * r / 100 - b) <= Math.max(2, a * 0.002)) {
      const qty = am.length >= 5 && am[am.length - 5] > 0 && am[am.length - 5] < 10000 ? am[am.length - 5] : null;
      items.push({ description: textPart, quantity: qty, net: a, vatRate: r, vat: b, gross: c });
    } else if (r === 0 || /(kul|aam|tam|fad|ahk|tah|mentes|margin|frei)/i.test(fold(lines[i]))) {
      const g = am[am.length - 1];
      if (g > 0) items.push({ description: textPart, net: g, vatType: vatType ?? "AM", gross: g });
    }
  }
  const itemGross = items.reduce((s, l) => s + (l.gross ?? l.net + (l.vat ?? 0)), 0);
  let useItems = items.length > 0 && gross != null && Math.abs(itemGross - gross) <= Math.max(2, gross * 0.001);

  // ÁFA-összesítő sor (pl. „27%  12 950  3 497  16 447”), ha a tételek nem jöttek ki
  if (!useItems && gross != null && vatRate && !vatType) {
    for (const l of lines) {
      if (!new RegExp(`\\b${vatRate}\\s?%`).test(l)) continue;
      const am = amountsIn(l);
      for (let k = 0; k + 2 < am.length + 0; k++) {
        const [a, b, c] = [am[k], am[k + 1], am[k + 2]];
        if (c != null && Math.abs(c - gross) <= 2 && Math.abs(a + b - c) <= 2) { net ??= a; vat ??= b; }
      }
    }
  }
  if (gross != null && !vatType && vatRate && (net == null || vat == null)) {
    if (net != null) vat = Math.round((gross - net) * 100) / 100;
    else if (vat != null) net = Math.round((gross - vat) * 100) / 100;
    else { vat = Math.round(gross * vatRate / (100 + vatRate) * (currency === "HUF" ? 1 : 100)) / (currency === "HUF" ? 1 : 100); net = gross - vat; }
  }
  if (gross != null && vatType) { net ??= gross; vat ??= 0; }

  const desc = (() => {
    const s = (hint.subject ?? "").replace(/^(fw|fwd|re|tov[aá]bb[ií]tott)\s*:\s*/i, "").trim();
    return docType === "sale_contract" ? "Gépkocsi (adásvételi szerződés)" : s && s.length < 80 ? s : partnerName ? `${partnerName} számla` : "Számla";
  })();
  const vinLine0 = lines.find((l) => VIN.test(l));
  const vehDesc = vinLine0 ? vinLine0.replace(VIN, "").replace(/\b(fin|vin|alvazszam|alvázszám|chassis|fahrgestell(nummer)?)\b\s*:?/gi, "").replace(AMOUNT_RE, "").replace(/[€$]|\b(eur|huf|ft)\b/gi, "").replace(/\s{2,}/g, " ").trim() : "";
  let lineOut: Line[] = [];
  if (useItems) lineOut = items.map((l) => ({ ...l, vatType: l.vatType ?? vatType }));
  else if (gross != null) {
    lineOut = [{ description: vehDesc.length >= 3 && vehDesc.length < 80 ? vehDesc : desc, quantity: 1, net: net ?? gross, vatRate: vatType ? null : vatRate, vatType, vat: vat ?? 0, gross }];
    useItems = false;
  }

  // gépkocsi
  const vinLine = lines.find((l, i) => /(alvazszam|alvaz|vin|fin\b|fahrgestell|chassis|azonosito)/.test(f[i]) && VIN.test(l)) ?? lines.find((l) => VIN.test(l));
  const vin = vinLine ? VIN.exec(vinLine)?.[0] ?? null : null;
  const plateLine = lines.find((l, i) => /(rendszam|frsz|forgalmi\s*rendszam|kennzeichen|license\s*plate|registration)/.test(f[i]) && PLATE.test(l.toUpperCase()));
  const plate = plateLine ? PLATE.exec(plateLine.toUpperCase())?.[1]?.replace(/\s/g, "") ?? null : null;

  // fizetés módja
  const PAYW = /(keszpenz|\bcash\b|\bbar\b|barzahlung|kp\.|bankkartya|kartya|card|karte|atutalas|transfer|uberweisung)/;
  const payLine = labelValue(lines, f, L.payment, (s) => (PAYW.test(fold(s)) ? s : null), 1) ?? (lines.find((l, i) => /(fizetes|zahl|payment|per\s)/.test(f[i]) && PAYW.test(f[i])) ?? "");
  const pf = fold(payLine) || all;
  const paymentMethod: ExtractedDoc["paymentMethod"] = /(keszpenz|\bcash\b|\bbar\b|barzahlung|kp\.)/.test(fold(payLine)) ? "cash"
    : /(bankkartya|kartya|card|karte|ec-cash)/.test(fold(payLine)) ? "card"
    : /(atutalas|transfer|uberweisung|bank)/.test(fold(payLine)) ? "transfer"
    : docType === "receipt" && /(keszpenz|bankkartya)/.test(pf) ? (/bankkartya/.test(pf) ? "card" : "cash") : null;
  const paid = /(fizetve|kiegyenlitve|paid\b|bezahlt|a\s*szamla\s*kifizetesre\s*kerult)/.test(all) || docType === "receipt" ? true : null;

  // biztonság: mennyi kulcsadat van meg és stimmel-e
  const okSum = useItems || (gross != null && net != null && vat != null && Math.abs(net + vat - gross) <= 2);
  const parts = [!!invoiceNumber || docType === "sale_contract", !!(issueDate || fulfillmentDate), gross != null, !!(other || partnerName), okSum, !!(vatType || vatRate)];
  const confidence = Math.round((parts.filter(Boolean).length / parts.length) * (useItems ? 1 : 0.95) * 100) / 100;

  const party = { name: partnerName, taxNumber: other && !other.eu ? other.full : other?.full.startsWith("HU") ? `${other.full.slice(2, 10)}` : null, euVat: other?.eu ? other.full : null, privatePerson: privatePerson || null };
  const us = { name: company.name, taxNumber: company.taxNumber };
  return {
    docType,
    direction,
    seller: direction === "in" ? party : us,
    buyer: direction === "in" ? us : party,
    invoiceNumber: invoiceNumber ?? null,
    issueDate: issueDate ?? fulfillmentDate ?? anyDate,
    fulfillmentDate: fulfillmentDate ?? issueDate ?? anyDate,
    dueDate: dueDate ?? null,
    paymentMethod,
    paid,
    currency,
    periodic: periodic || null,
    lines: lineOut,
    totals: { net, vat, gross },
    vehicle: vin || plate ? { vin, plate, make: vehDesc.split(" ")[0] || null, model: vehDesc.split(" ").slice(1).join(" ") || null } : null,
    refInvoiceNumber: docType === "credit_note" ? labelValue(lines, f, /(eredeti\s*szamla|hivatkozott\s*szamla|ref(erence)?\s*invoice|zu\s*rechnung)/, numberToken) : null,
    confidence,
    notes: useItems ? "Szabályalapú kiolvasás – tételsorok a bizonylatról." : "Szabályalapú kiolvasás – egy összesítő tétel a végösszegből.",
  };
}

// ---------------------------------------------------------------------------
// Bankkivonat-export (CSV / Excel)
// ---------------------------------------------------------------------------

const H = {
  date: /(konyveles\s*(datuma|napja)|tranzakcio\s*(datuma|napja)|terhelesi\s*nap|datum|date|buchungstag|booking\s*date)/,
  value: /(erteknap|value\s*date|valuta|wertstellung)/,
  amount: /(osszeg|amount|betrag)/,
  debit: /(terheles(?!\/)|\bdebit\b|tartozik|soll)/,
  credit: /(jovairas(?!\/)|\bcredit\b|kovetel|haben)/,
  tj: /(t\s*\/\s*j|terheles\s*\/\s*jovairas|jelleg|irany)/,
  cur: /(penznem|devizanem|deviza|currency|wahrung)/,
  name: /(partner\s*neve|ellenoldali\s*(nev|szamlatulajdonos)|kedvezmenyezett|befizeto|partner|kuldo|name|empfanger|auftraggeber|counterparty)/,
  acct: /(partner\s*szamla|ellenoldali\s*szamla|ellenszamla|szamlaszam|iban|account)/,
  desc: /(kozlemeny|megjegyzes|leiras|description|verwendungszweck|details|tranzakcio\s*tipus|tipus|narrative)/,
  ref: /(hivatkozas|reference|referencia|azonosito)/,
  balance: /(egyenleg|balance|saldo)/,
};

export function parseStatementTable(rows: string[][]): ExtractedDoc {
  if (!rows.length) return { docType: "bank_statement", confidence: 0, statement: { transactions: [] }, notes: "Üres táblázat." };
  // fejléc: az első 10 sor közül az, amelyikben dátum- és összegoszlop-név is van
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const fr = rows[i].map(fold);
    if (fr.some((c) => H.date.test(c)) && fr.some((c) => H.amount.test(c) || H.debit.test(c) || H.credit.test(c))) { hi = i; break; }
  }
  const col: Partial<Record<keyof typeof H, number>> = {};
  let data: string[][];
  if (hi >= 0) {
    const fr = rows[hi].map(fold);
    const used = new Set<number>();
    const take = (k: keyof typeof H, avoid?: RegExp) => {
      const i = fr.findIndex((c, j) => !used.has(j) && H[k].test(c) && !(avoid && avoid.test(c)));
      if (i >= 0) { col[k] = i; used.add(i); }
    };
    take("value"); take("date", H.value); take("tj"); take("balance"); take("cur");
    take("amount", /(egyenleg|balance)/); take("debit"); take("credit");
    take("acct"); take("name"); take("ref"); take("desc");
    data = rows.slice(hi + 1);
  } else {
    // fejléc nélküli export (pl. OTP CSV): oszlopok tartalom alapján
    data = rows;
    const n = Math.max(...rows.map((r) => r.length));
    const share = (j: number, t: (s: string) => boolean) => rows.filter((r) => r[j] && t(r[j])).length / rows.length;
    const dateCols = [...Array(n).keys()].filter((j) => share(j, (s) => datesIn(s).length === 1 && s.length <= 12) > 0.8);
    col.date = dateCols[0]; col.value = dateCols[1];
    col.tj = [...Array(n).keys()].find((j) => share(j, (s) => /^[TJ]$/i.test(s)) > 0.8);
    const numCols = [...Array(n).keys()].filter((j) => !dateCols.includes(j) && share(j, (s) => /^[-+]?[\d ., ]+$/.test(s) && parseAmount(s) != null && !/^\d{8}-?\d{8}/.test(s)) > 0.8);
    col.amount = numCols[0];
    col.cur = [...Array(n).keys()].find((j) => share(j, (s) => /^(HUF|EUR|USD|CHF|GBP)$/i.test(s)) > 0.8);
    col.acct = [...Array(n).keys()].find((j) => share(j, (s) => /^\d{8}-?\d{8}(-?\d{8})?$|^[A-Z]{2}\d{2}[A-Z0-9 ]{10,}$/.test(s)) > 0.3 && j !== 0);
    const textCols = [...Array(n).keys()].filter((j) => ![col.date, col.value, col.tj, col.amount, col.cur, col.acct].includes(j) && share(j, (s) => /[a-z]/i.test(s)) > 0.3);
    col.name = textCols[0]; col.desc = textCols[1];
  }

  const get = (r: string[], k: keyof typeof H) => (col[k] != null ? (r[col[k]!] ?? "").trim() : "");
  const tx: NonNullable<ExtractedDoc["statement"]>["transactions"] = [];
  let currency: string | null = null;
  for (const r of data) {
    const date = datesIn(get(r, "date"))[0];
    if (!date) continue;
    let amt: number | null = null;
    if (col.amount != null) amt = parseAmount(get(r, "amount"));
    if ((amt == null || amt === 0) && (col.debit != null || col.credit != null)) {
      const d = parseAmount(get(r, "debit")) ?? 0, c = parseAmount(get(r, "credit")) ?? 0;
      amt = c - Math.abs(d);
    }
    if (amt == null || amt === 0) continue;
    const tj = fold(get(r, "tj"));
    if (/^(t|terheles|debit|kiadas|-)/.test(tj) && amt > 0) amt = -amt;
    if (/^(j|jovairas|credit|bevetel|\+)/.test(tj) && amt < 0) amt = -amt;
    currency ??= get(r, "cur").toUpperCase() || null;
    const descr = [get(r, "desc"), ...(col.desc != null ? r.filter((_, j) => j > col.desc! && ![col.balance, col.ref].includes(j) && /[a-z]/i.test(r[j] ?? "") && r[j].length > 2) : [])].filter(Boolean).join(" ").trim();
    tx.push({
      date, valueDate: datesIn(get(r, "value"))[0] ?? null, amount: Math.round(amt * 100) / 100,
      counterparty: get(r, "name") || null, counterpartyAccount: get(r, "acct") || null,
      description: descr || null, reference: get(r, "ref") || null,
    });
  }
  return {
    docType: "bank_statement",
    statement: { currency: currency ?? "HUF", transactions: tx },
    confidence: tx.length ? 1 : 0,
    notes: tx.length ? `Bankkivonat-export: ${tx.length} tranzakció.` : "A táblázatban nem találtam dátum + összeg oszlopot.",
  };
}
