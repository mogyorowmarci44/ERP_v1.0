/**
 * v3.1.0 – Kiolvasott bizonylat automatikus ellenőrzései (tiszta logika, adatbázis nélkül, tesztelhető).
 * Főleg a papír alapú (szkennelt / fotózott, OCR-rel olvasott) számlák hibáit fogja meg:
 *  - magyar adószám ellenőrző számjegye (CDV) és formai szabályai,
 *  - ÁFA = nettó × kulcs (tételenként, kerekítési tűréssel),
 *  - dátumok: jövőbeli / gyanúsan régi / teljesítés jóval a kelt után,
 *  - lezárt hónap és már bevallott ÁFA-időszak.
 * Az itt talált problémák a javaslat „issues” listájába kerülnek, így a bizonylat nem könyvelődik magától.
 */
import type { ExtractedDoc } from "@/db/schema";

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Magyar adószám: 8 jegyű törzsszám (8. jegy CDV: súlyok 9-7-3-1-9-7-3), ÁFA-kód 1–5, megyekód 02–20, 22, 41–44, 51. */
export function huTaxNumberProblem(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/^[A-Z]{2}/.test(s) && !s.startsWith("HU")) return null; // külföldi közösségi adószám – itt nem ellenőrizzük
  const d = digits(s);
  if (d.length !== 8 && d.length !== 11) return `formailag hibás (${d.length} számjegy)`;
  const w = [9, 7, 3, 1, 9, 7, 3];
  const sum = w.reduce((a, k, i) => a + k * Number(d[i]), 0);
  if ((10 - (sum % 10)) % 10 !== Number(d[7])) return "az ellenőrző számjegy nem stimmel (elírás vagy OCR-hiba)";
  if (d.length === 11) {
    if (!/[1-5]/.test(d[8])) return `érvénytelen ÁFA-kód (${d[8]})`;
    const county = Number(d.slice(9));
    if (!((county >= 2 && county <= 20) || county === 22 || (county >= 41 && county <= 44) || county === 51)) return `érvénytelen területi kód (${d.slice(9)})`;
  }
  return null;
}

const addDays = (iso: string, n: number) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fmt = (n: number) => Math.round(n).toLocaleString("hu-HU");

export type ValidateCtx = {
  today: string;
  /** Lezárt hónapok „YYYY-MM” alakban. */
  lockedMonths?: Set<string>;
  /** Az utolsó lezárt ÁFA-időszak vége (YYYY-MM-DD), ha van. */
  vatClosedUntil?: string | null;
};

export function validateExtracted(x: ExtractedDoc, ctx: ValidateCtx): string[] {
  const issues: string[] = [];
  if (x.docType === "bank_statement" || x.docType === "proforma" || x.docType === "other") return issues;
  const direction = x.direction ?? "in";
  const cp = direction === "in" ? x.seller : x.buyer;

  // 1. adószám
  const taxProblem = cp?.privatePerson ? null : huTaxNumberProblem(cp?.taxNumber);
  if (taxProblem) issues.push(`A partner adószáma (${cp?.taxNumber}) ${taxProblem} – nézd meg a papíron.`);

  // 2. ÁFA = nettó × kulcs, tételenként (a tűrés: 1 Ft + 0,2% a tételenkénti / összesítő kerekítés miatt)
  const huf = (x.currency ?? "HUF").toUpperCase() === "HUF";
  for (const l of x.lines ?? []) {
    if (l.vatRate == null || l.vat == null || !l.net) continue;
    const expect = (l.net * l.vatRate) / 100;
    const tol = (huf ? 1 : 0.01) + Math.abs(l.net) * 0.002;
    if (Math.abs(expect - l.vat) > tol) issues.push(`ÁFA-ellenőrzés: ${l.description.slice(0, 40)} – ${fmt(l.net)} × ${l.vatRate}% = ${fmt(expect)}, a bizonylaton ${fmt(l.vat)}. Valamelyik összeg rosszul olvasódott.`);
  }
  // összesítő: ha egyetlen kulcs van, a teljes ÁFA is legyen nettó × kulcs
  const rates = new Set((x.lines ?? []).map((l) => l.vatRate).filter((r): r is number => r != null));
  const t = x.totals;
  if (rates.size === 1 && t?.net != null && t.vat != null && !(x.lines ?? []).some((l) => l.vatType)) {
    const r = [...rates][0];
    const expect = (t.net * r) / 100;
    if (Math.abs(expect - t.vat) > (huf ? 2 : 0.02) + Math.abs(t.net) * 0.002 && !issues.some((i) => i.startsWith("ÁFA-ellenőrzés")))
      issues.push(`ÁFA-ellenőrzés: nettó ${fmt(t.net)} × ${r}% = ${fmt(expect)}, a végösszegben ${fmt(t.vat)}.`);
  }

  // 3. dátumok
  const issue = isIso(x.issueDate) ? x.issueDate : null;
  const ful = isIso(x.fulfillmentDate) ? x.fulfillmentDate : null;
  for (const [label, d] of [["kelte", issue], ["teljesítése", ful]] as const) {
    if (!d) continue;
    if (d > addDays(ctx.today, 1)) issues.push(`A bizonylat ${label} (${d}) jövőbeli – valószínűleg rosszul olvasódott.`);
    else if (d < addDays(ctx.today, -400)) issues.push(`A bizonylat ${label} (${d}) több mint egy éves – ellenőrizd az évszámot.`);
  }
  if (issue && ful && ful > addDays(issue, 31)) issues.push(`A teljesítés (${ful}) jóval a kelt (${issue}) utáni – ellenőrizd a dátumokat.`);

  // 4. lezárt időszak / bevallott ÁFA
  const bookDate = ful ?? issue;
  if (bookDate) {
    if (ctx.lockedMonths?.has(bookDate.slice(0, 7))) issues.push(`A ${bookDate.slice(0, 7)} hónap le van zárva – oda nem könyvelhető (nyisd fel, vagy módosítsd a dátumot).`);
    else if (ctx.vatClosedUntil && bookDate <= ctx.vatClosedUntil)
      issues.push(`Késve érkezett bizonylat: az ÁFA ${ctx.vatClosedUntil}-ig már be van vallva – döntsd el, melyik időszakba kerüljön (önellenőrzés vagy a levonás későbbi időszakban).`);
  }
  return issues;
}

/** Papír alapú (szkennelt / fotózott) bizonylat-e: a szövegét OCR adta, vagy maga a fájl egy kép. */
export const isPaperDoc = (mime: string, x: ExtractedDoc | null | undefined) => x?.method === "ocr" || /^image\//i.test(mime);

/** Következő iktatószám: P-ÉÉÉÉ-0001, cégenként és évenként folyamatos. */
export function nextFilingNo(year: number, existing: Array<string | null>): string {
  const prefix = `P-${year}-`;
  const max = existing.reduce((m, s) => (s && s.startsWith(prefix) ? Math.max(m, Number(s.slice(prefix.length)) || 0) : m), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Banki tétel, amely összegre egyezik a bizonylat bruttójával (a még párosításra váró kivonatsorok közül). */
export function bankMatch(x: ExtractedDoc, rows: Array<{ date: string; amount: number; text: string }>): { date: string; amount: number; text: string } | null {
  const g = x.totals?.gross;
  if (g == null || g <= 0) return null;
  const sign = (x.direction ?? "in") === "in" ? -1 : 1;
  const from = x.fulfillmentDate ?? x.issueDate ?? null;
  const hits = rows.filter((r) => Math.abs(r.amount - sign * g) <= 1 && (!from || r.date >= addDays(from, -45)));
  return hits.length === 1 ? hits[0] : null;
}
