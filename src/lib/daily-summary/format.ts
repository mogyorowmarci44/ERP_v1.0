/** v3.9.2 – Pénzösszeg az e-mailekben: 2,31 m Ft / 612 e Ft / 840 Ft. */
const nf = (d = 0) => new Intl.NumberFormat("hu-HU", { maximumFractionDigits: d, minimumFractionDigits: d, useGrouping: "always" });
/** 2,31 m Ft / 612 e Ft / 840 Ft */
export function money(n: number, sign = false): string {
  const s = sign ? (n > 0.5 ? "+" : n < -0.5 ? "−" : "") : n < -0.5 ? "−" : "";
  const a = Math.abs(n);
  const body = a >= 1_000_000 ? `${nf(2).format(a / 1_000_000)} m` : a >= 1000 ? `${nf(0).format(Math.round(a / 1000))} e` : nf(0).format(Math.round(a));
  return `${s}${body} Ft`;
}

const grp = (d: number) => new Intl.NumberFormat("hu-HU", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" });
/** v3.9.5 – fix egységű formák a fejléc-számokhoz (ezres tagolással). */
export const mFt2 = (n: number) => `${grp(2).format(n / 1_000_000)} m Ft`; // 11,62 m Ft
export const eFt1 = (n: number) => `${grp(1).format(n / 1000)} e Ft`; // 2 356,0 e Ft
/** v3.9.9 – a −0 („-0 Ft”) kerekítési maradékot sima 0-ra veszi. */
export const ft0 = (n: number) => `${grp(0).format(Math.round(n) || 0)} Ft`; // 2 748 000 Ft
