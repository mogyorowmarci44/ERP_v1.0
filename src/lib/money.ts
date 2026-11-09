/** Kerekítés 2 tizedesre (devizás összegek). */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Forint összegek egész forintra kerekítve (kerekítés fél forinttól felfelé, abszolút értékben). */
export function roundHuf(x: number): number {
  const r = Math.round(Math.abs(x) + 1e-9);
  return x < 0 ? -r : r;
}

export function sum(xs: number[]): number {
  return round2(xs.reduce((a, b) => a + b, 0));
}

const hufFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 });
const fxFmt = new Intl.NumberFormat("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtHuf(x: number | null | undefined): string {
  if (x === null || x === undefined) return "";
  const v = Math.round(x);
  return hufFmt.format(v === 0 ? 0 : v); // nincs „−0”
}

export function fmtMoney(x: number | null | undefined, currency = "HUF"): string {
  if (x === null || x === undefined) return "";
  return currency === "HUF" ? `${hufFmt.format(x)} Ft` : `${fxFmt.format(x)} ${currency}`;
}

/** Magyar formátumú szám beolvasása: "1 234 567,89" → 1234567.89 */
export function parseNumber(s: FormDataEntryValue | string | null | undefined): number {
  if (s === null || s === undefined) return 0;
  const str = String(s).replace(/\s| /g, "").replace(",", ".");
  if (str === "") return 0;
  const n = Number(str);
  if (!Number.isFinite(n)) throw new Error(`Érvénytelen szám: ${s}`);
  return n;
}
