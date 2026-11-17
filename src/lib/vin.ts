/**
 * Alvázszám (VIN, ISO 3779) offline dekódolása: gyártó (WMI, 1–3. karakter) és modellév (10. karakter).
 * A tömeg és a járműkategória NEM olvasható ki a VIN-ből – azt a forgalmi engedélyből kell rögzíteni.
 * A modellév a 10. karakterből 30 éves ciklusban ismétlődik; a legkésőbbi, még nem jövőbeli évet választjuk.
 * Európai gyártóknál a 10. karakter nem mindig modellév – ezért csak üres évjárat-mezőt töltünk vele.
 */

const WMI: Record<string, string> = {
  WVW: "Volkswagen", WVG: "Volkswagen", WV1: "Volkswagen", WV2: "Volkswagen", WV3: "Volkswagen", "1VW": "Volkswagen", "3VW": "Volkswagen",
  WAU: "Audi", WUA: "Audi", WA1: "Audi", TRU: "Audi",
  TMB: "Škoda", TMP: "Škoda",
  VSS: "Seat", VSE: "Seat",
  WBA: "BMW", WBS: "BMW", WBY: "BMW", WBX: "BMW", "4US": "BMW", "5UX": "BMW", WMW: "Mini",
  WDB: "Mercedes-Benz", WDD: "Mercedes-Benz", WDC: "Mercedes-Benz", WDF: "Mercedes-Benz", W1K: "Mercedes-Benz", W1N: "Mercedes-Benz", W1V: "Mercedes-Benz", W1W: "Mercedes-Benz", "4JG": "Mercedes-Benz",
  WP0: "Porsche", WP1: "Porsche",
  W0L: "Opel", W0V: "Opel", VXK: "Opel",
  WF0: "Ford", WF1: "Ford", "1FA": "Ford", "1FM": "Ford", "1FT": "Ford",
  VF1: "Renault", VF6: "Renault", UU1: "Dacia",
  VF3: "Peugeot", VR3: "Peugeot", VF7: "Citroën", VR7: "Citroën", VR1: "DS",
  ZFA: "Fiat", ZFF: "Ferrari", ZAR: "Alfa Romeo", ZLA: "Lancia", ZHW: "Lamborghini", ZAM: "Maserati",
  YV1: "Volvo", YV4: "Volvo", LVY: "Volvo",
  SAJ: "Jaguar", SAL: "Land Rover", SAR: "Land Rover", SCC: "Lotus", SCB: "Bentley", SCF: "Aston Martin",
  JTD: "Toyota", JTE: "Toyota", JTM: "Toyota", JTN: "Toyota", JTH: "Lexus", SB1: "Toyota", NMT: "Toyota", VNK: "Toyota", TMA: "Hyundai",
  KMH: "Hyundai", KMF: "Hyundai", NLH: "Hyundai", KNA: "Kia", KND: "Kia", U5Y: "Kia", U6Y: "Kia",
  JMZ: "Mazda", JM1: "Mazda", JN1: "Nissan", SJN: "Nissan", VSK: "Nissan", JN8: "Nissan",
  JHM: "Honda", SHH: "Honda", SHS: "Honda", JSA: "Suzuki", TSM: "Suzuki", MA3: "Suzuki",
  JMB: "Mitsubishi", JMY: "Mitsubishi", JF1: "Subaru", JF2: "Subaru",
  "5YJ": "Tesla", LRW: "Tesla", XP7: "Tesla", "7SA": "Tesla",
  "1G1": "Chevrolet", KL1: "Chevrolet", "1C4": "Jeep", "1J4": "Jeep", ZACN: "Jeep",
};

const YEAR_CHARS = "ABCDEFGHJKLMNPRSTVWXY123456789"; // 1980 = A … 2009 = 9, majd 2010 = A …

export function normalizeVin(v: string | null | undefined): string | null {
  const s = (v ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) ? s : null;
}

export function vinMake(vin: string): string | null {
  return WMI[vin.slice(0, 4)] ?? WMI[vin.slice(0, 3)] ?? null;
}

/** Modellév a 10. karakterből; a legkésőbbi év, ami nem nagyobb, mint `maxYear` (alapból a következő év). */
export function vinModelYear(vin: string, maxYear = new Date().getUTCFullYear() + 1): number | null {
  const i = YEAR_CHARS.indexOf(vin[9]);
  if (i < 0) return null;
  let y = 1980 + i;
  while (y + 30 <= maxYear) y += 30;
  return y > maxYear ? null : y;
}

export type VinDecode = { vin: string; make: string | null; year: number | null };
export function decodeVin(raw: string | null | undefined, maxYear?: number): VinDecode | null {
  const vin = normalizeVin(raw);
  if (!vin) return null;
  return { vin, make: vinMake(vin), year: vinModelYear(vin, maxYear) };
}

/** Egyezik-e a rögzített gyártmány a VIN szerintivel (ékezet- és kisbetű-független, részleges egyezés). */
export function sameMake(recorded: string, decoded: string): boolean {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const a = n(recorded), b = n(decoded);
  return !!a && !!b && (a.includes(b) || b.includes(a) || (b === "mercedesbenz" && a.startsWith("merc")) || (b === "volkswagen" && a === "vw"));
}
