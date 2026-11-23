/** v3.9.2 – Pénzösszeg az e-mailekben: 2,31 M Ft / 612 e Ft / 840 Ft. */
const nf = (d = 0) => new Intl.NumberFormat("hu-HU", { maximumFractionDigits: d, minimumFractionDigits: d, useGrouping: "always" });
/** 2,31 M Ft / 612 e Ft / 840 Ft */
export function money(n: number, sign = false): string {
  const s = sign ? (n > 0.5 ? "+" : n < -0.5 ? "−" : "") : n < -0.5 ? "−" : "";
  const a = Math.abs(n);
  const body = a >= 1_000_000 ? `${nf(2).format(a / 1_000_000)} M` : a >= 1000 ? `${nf(0).format(Math.round(a / 1000))} e` : nf(0).format(Math.round(a));
  return `${s}${body} Ft`;
}
