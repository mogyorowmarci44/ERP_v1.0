/** v7.4.0 – a globális kereső tiszta segédfüggvénye. */
/** A keresőkifejezés értelmezése: ILIKE-minta, csak-számjegyek (adószámhoz), és összeg (ha szám). */
export function parseQuery(raw: string) {
  const s = raw.trim().slice(0, 100);
  const like = `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const digits = s.replace(/\D/g, "");
  const amt = /^-?[\d\s.,]+$/.test(s) ? Number(s.replace(/[\s.]/g, "").replace(",", ".")) : NaN;
  return { s, like, digits, amount: Number.isFinite(amt) && Math.abs(amt) >= 100 ? amt : null };
}

