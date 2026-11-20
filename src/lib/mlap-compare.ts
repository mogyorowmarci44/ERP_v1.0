/** v3.7.1 – M-lap összevetés (tiszta függvény, adatbázis nélkül). */
export type SubmittedRow = { period: string; number: string; date: string | null; base: number; vat: number; tax8: string; partnerName: string };
export type ErpInvoice = {
  id: number; number: string; date: string; partnerId: number; partnerName: string; tax8: string | null;
  base: number; vat: number; deductibleVat: number; kinds: string[];
};
export type CheckIssue =
  | { type: "not_deductible"; sub: SubmittedRow; erp: ErpInvoice }
  | { type: "number_mismatch"; sub: SubmittedRow; erp: ErpInvoice; hint: "írásmód" | "összeg és partner alapján" }
  | { type: "missing"; sub: SubmittedRow };

const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/** A beadott M-lapok számláinak párosítása az ERP szállítói számláival. */
export function compareMSheets(submitted: SubmittedRow[], erp: ErpInvoice[]): CheckIssue[] {
  const byNum = new Map(erp.map((e) => [e.number, e]));
  const byNorm = new Map(erp.map((e) => [norm(e.number), e]));
  const out: CheckIssue[] = [];
  for (const sub of submitted) {
    const exact = byNum.get(sub.number);
    if (exact) {
      if (exact.deductibleVat < 0.5 && sub.vat > 0) out.push({ type: "not_deductible", sub, erp: exact });
      continue;
    }
    const n = byNorm.get(norm(sub.number));
    if (n) { out.push({ type: "number_mismatch", sub, erp: n, hint: "írásmód" }); continue; }
    // ugyanaz a partner (törzsszám vagy név) és ugyanaz az adóalap + áfa → valószínűleg elírt számlaszám
    const cand = erp.find((e) => (e.tax8 === sub.tax8 || norm(e.partnerName).startsWith(norm(sub.partnerName).slice(0, 6))) && near(e.vat, sub.vat) && near(e.base, sub.base))
      ?? erp.find((e) => near(e.vat, sub.vat) && near(e.base, sub.base) && sub.date != null && e.date === sub.date);
    if (cand) { out.push({ type: "number_mismatch", sub, erp: cand, hint: "összeg és partner alapján" }); continue; }
    out.push({ type: "missing", sub });
  }
  return out;
}

