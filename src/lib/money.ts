/**
 * Kerekítés 2 tizedesre (devizás összegek), fél fillértől felfelé, abszolút értékben (előjel-szimmetrikus).
 * v3.9.6: a lebegőpontos ábrázolás miatt pl. 9 944 590,995 × 100 = 994 459 099,4999… – a 15 értékes jegyre
 * kerekített szorzat ezt kiküszöböli; a negatív összegek (sztornó) ugyanúgy kerekednek, mint a pozitívak.
 */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return x;
  const r = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
  return x < 0 ? -r : r;
}

/** v3.9.6 – Készpénzes fizetés kerekítése 0 / 5 forintra (2008. évi III. tv. – az 1 és 2 forintos kivezetése). */
export function roundCash5(x: number): number {
  const r = Math.round(Math.abs(x) / 5) * 5;
  return x < 0 ? -r : r;
}

/** Forint összegek egész forintra kerekítve (kerekítés fél forinttól felfelé, abszolút értékben). */
export function roundHuf(x: number): number {
  const r = Math.round(Math.abs(x) + 1e-9);
  return x < 0 ? -r : r;
}

export function sum(xs: number[]): number {
  return round2(xs.reduce((a, b) => a + b, 0));
}

// useGrouping "always": a magyar alapbeállítás a 4 jegyű számokat nem tagolja (8412 → 8 412)
const hufFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });
const fxFmt = new Intl.NumberFormat("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });

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

/** Általános számformázás egységes ezres tagolással (4 jegyűnél is: 8 412). */
export function fmtNum(x: number | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "";
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 3, ...opts, useGrouping: "always" }).format(x === 0 ? 0 : x);
}
