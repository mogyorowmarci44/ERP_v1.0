/**
 * v3.9.0 – Partner felvétele számla-űrlapról (és a Partnerek oldalról): adószám
 * normalizálás / ellenőrzés, duplikáció-keresés. Tiszta függvények, DB nélkül.
 */

export type NewPartnerInput = {
  name: string;
  taxNumber?: string | null;
  euVatNumber?: string | null;
  country?: string | null;
  address?: string | null;
  email?: string | null;
  isPrivatePerson?: boolean;
};

export type CleanPartner = {
  name: string;
  taxNumber: string | null;
  euVatNumber: string | null;
  country: string;
  address: string | null;
  email: string | null;
  isPrivatePerson: boolean;
};

const blank = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

const digits = (s: string) => s.replace(/\D/g, "");

/** Törzsszám (első 8 jegy) ellenőrző számjegye: súlyok 9,7,3,1,9,7,3. */
export function huTorzsszamValid(t8: string): boolean {
  if (!/^\d{8}$/.test(t8)) return false;
  const w = [9, 7, 3, 1, 9, 7, 3];
  const sum = w.reduce((s, x, i) => s + x * Number(t8[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(t8[7]);
}

/** Magyar adószám → „12345678-1-12” alak; null, ha nem 11 számjegy. */
export function normalizeHuTaxNumber(raw: string): string | null {
  const d = digits(raw);
  if (d.length !== 11) return null;
  return `${d.slice(0, 8)}-${d[8]}-${d.slice(9)}`;
}

/** Magánszemély adóazonosító jele (10 jegy, 8-cal kezdődik; ellenőrző: Σ i·d_i mod 11). */
export function huAdoazonositoValid(raw: string): boolean {
  const d = digits(raw);
  if (!/^8\d{9}$/.test(d)) return false;
  const sum = [...d.slice(0, 9)].reduce((s, c, i) => s + (i + 1) * Number(c), 0);
  return sum % 11 === Number(d[9]);
}

/** A magyar adószám törzsszáma (első 8 jegy) – a duplikáció-kereséshez. */
export const torzsszam = (tax: string | null | undefined) => {
  const d = digits(tax ?? "");
  return d.length >= 8 && d.length !== 10 ? d.slice(0, 8) : null;
};

/**
 * Bevitt partneradatok ellenőrzése és tisztítása. Hibánál Error-t dob (magyar üzenettel).
 * - HU cégnél az adószám kötelező (meglévő partner szerkesztésekor `requireHuTax: false`), 11 jegy, helyes törzsszám-ellenőrzővel, ÁFA-kód 1–5.
 * - HU magánszemélynél az adószám nem kötelező; ha megadták: adószám vagy 10 jegyű adóazonosító jel.
 * - Külföldi partnernél az adószám szabad szöveg, a közösségi adószám országkóddal kezdődik.
 */
export function cleanPartnerInput(inp: NewPartnerInput, opts: { requireHuTax?: boolean } = {}): CleanPartner {
  const requireHuTax = opts.requireHuTax ?? true;
  const name = (inp.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("A partner neve kötelező.");
  const country = (blank(inp.country) ?? "HU").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Az országkód 2 betű legyen (pl. HU, DE, AT).");
  const isPrivatePerson = !!inp.isPrivatePerson;
  let taxNumber = blank(inp.taxNumber);
  const euVatNumber = blank(inp.euVatNumber)?.replace(/[\s.-]/g, "").toUpperCase() ?? null;

  if (country === "HU") {
    if (taxNumber) {
      const d = digits(taxNumber);
      if (isPrivatePerson && d.length === 10) {
        if (!huAdoazonositoValid(d)) throw new Error("Hibás adóazonosító jel (10 jegy, 8-cal kezdődik).");
        taxNumber = d;
      } else {
        const n = normalizeHuTaxNumber(taxNumber);
        if (!n) throw new Error("A magyar adószám 11 számjegy (12345678-1-12).");
        if (!huTorzsszamValid(n.slice(0, 8))) throw new Error(`Hibás adószám: a törzsszám (${n.slice(0, 8)}) ellenőrző számjegye nem stimmel.`);
        if (!/^[1-5]$/.test(n[9])) throw new Error("Hibás adószám: az ÁFA-kód (9. jegy) 1–5 lehet.");
        taxNumber = n;
      }
    } else if (!isPrivatePerson && requireHuTax) {
      throw new Error("Magyar cég partnernél az adószám kötelező (magánszemélynél elhagyható).");
    }
  }
  if (euVatNumber && !/^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(euVatNumber)) throw new Error("A közösségi adószám országkóddal kezdődjön (pl. DE123456789).");

  const email = blank(inp.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Hibás e-mail cím.");
  return { name, taxNumber, euVatNumber, country, address: blank(inp.address), email, isPrivatePerson };
}

/** Meglévő partner, amely ugyanaz: azonos törzsszám / közösségi adószám, vagy (adószám nélkül) azonos név. */
export function findDuplicatePartner<P extends { id: number; name: string; taxNumber?: string | null; euVatNumber?: string | null }>(
  list: P[],
  p: Pick<CleanPartner, "name" | "taxNumber" | "euVatNumber">,
): P | undefined {
  const t8 = torzsszam(p.taxNumber);
  if (t8) {
    const hit = list.find((x) => torzsszam(x.taxNumber) === t8);
    if (hit) return hit;
  }
  if (p.taxNumber && !t8) {
    const hit = list.find((x) => digits(x.taxNumber ?? "") === digits(p.taxNumber!) && digits(p.taxNumber!) !== "");
    if (hit) return hit;
  }
  if (p.euVatNumber) {
    const hit = list.find((x) => (x.euVatNumber ?? "").replace(/[\s.-]/g, "").toUpperCase() === p.euVatNumber);
    if (hit) return hit;
  }
  if (!p.taxNumber && !p.euVatNumber) {
    const n = p.name.toLocaleLowerCase("hu");
    return list.find((x) => x.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("hu") === n);
  }
  return undefined;
}
