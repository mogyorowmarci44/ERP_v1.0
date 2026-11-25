/**
 * v4.5.3 – Típuskatalógus: az auto-data.net kigyűjtés (autodata_tipusok.csv) sorainak értelmezése.
 * Oszlopok: autodata_id; Brand; Model; Generation; Modification (Engine); Start of production; End of production;
 * Powertrain Architecture; Body type; Fuel Type; Power; Engine displacement; Engine Model/Code; Drive wheel;
 * Number of gears and type of gearbox; Kerb Weight; Max. weight; System power; Electric motor power
 */

export type CatalogRow = {
  sourceId: number;
  make: string;
  model: string;
  generation: string;
  name: string;
  yearFrom: number | null;
  monthFrom: number | null;
  yearTo: number | null;
  monthTo: number | null;
  powertrain: string | null;
  body: string | null;
  fuel: string | null;
  fuelRaw: string | null;
  displacementCc: number | null;
  powerHp: number | null;
  powerKw: number | null;
  engineCode: string | null;
  drive: string | null;
  gears: number | null;
  gearbox: string | null;
  gearboxRaw: string | null;
  kerbMinKg: number | null;
  kerbMaxKg: number | null;
  grossKg: number | null;
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** „October, 2018” / „2020” → { year, month } */
export function parseProd(s: string): { year: number | null; month: number | null } {
  const t = s.trim();
  if (!t) return { year: null, month: null };
  const y = t.match(/(19|20)\d{2}/);
  const m = t.toLowerCase().match(/^([a-z]+)/);
  return { year: y ? Number(y[0]) : null, month: m && MONTHS[m[1]] ? MONTHS[m[1]] : null };
}

const int = (s: string | undefined): number | null => {
  const m = (s ?? "").replace(/\s/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

/** „1195-1240 kg” → [1195, 1240]; „1546 kg” → [1546, 1546] */
export function parseKgRange(s: string): [number | null, number | null] {
  const nums = (s ?? "").replace(/(\d)\s(\d)/g, "$1$2").match(/\d+/g)?.map(Number).filter((n) => n >= 300 && n <= 10000) ?? [];
  if (!nums.length) return [null, null];
  return [Math.min(...nums), Math.max(...nums)];
}

/** „140 Hp @ 5500 rpm.” → 140 */
export const parseHp = (s: string): number | null => {
  const m = (s ?? "").match(/(\d+)\s*Hp/i);
  return m ? Number(m[1]) : null;
};

export const hpToKw = (hp: number | null) => (hp == null ? null : Math.round(hp * 0.73549875));

export function normFuel(raw: string, powertrain: string): string | null {
  const f = raw.toLowerCase(), p = powertrain.toLowerCase();
  if (/electric/.test(f) && !/petrol|diesel|gasoline/.test(f)) return "elektromos";
  if (/battery electric|bev/.test(p)) return "elektromos";
  if (/hydrogen/.test(f)) return "hidrogén";
  if (/hybrid|phev|hev/.test(p) || (/electric/.test(f) && /petrol|diesel/.test(f))) return "hibrid";
  if (/lpg/.test(f)) return "LPG";
  if (/cng|natural gas/.test(f)) return "CNG";
  if (/diesel/.test(f)) return "dízel";
  if (/petrol|gasoline|ethanol/.test(f)) return "benzin";
  return raw ? "egyéb" : null;
}

export function normPowertrain(raw: string): string | null {
  const p = raw.toLowerCase();
  if (!p) return null;
  if (/plug-in|phev/.test(p)) return "phev";
  if (/mild hybrid|mhev/.test(p)) return "mhev";
  if (/hybrid|hev/.test(p)) return "hev";
  if (/fuel cell|fcev/.test(p)) return "fcev";
  if (/battery electric|bev|electric vehicle/.test(p)) return "bev";
  if (/internal combustion/.test(p)) return "ice";
  return null;
}

export function normDrive(raw: string): string | null {
  const d = raw.toLowerCase();
  if (/all wheel|4x4|awd/.test(d)) return "awd";
  if (/rear/.test(d)) return "rwd";
  if (/front/.test(d)) return "fwd";
  return null;
}

/** „7 gears, automatic transmission DSG” → { gears: 7, gearbox: "DSG" } */
export function parseGearbox(raw: string): { gears: number | null; gearbox: string | null } {
  const g = raw.toLowerCase();
  const gears = g.match(/(\d+)\s*gears?/);
  let box: string | null = null;
  if (/dsg|dual[- ]clutch|dct|pdk|s tronic|edc|powershift/.test(g)) box = "DSG";
  else if (/cvt|continuously|multitronic|e-cvt/.test(g)) box = "CVT";
  else if (/robotized|automated manual|amt|ags|sensodrive|easytronic|selespeed/.test(g)) box = "robot";
  else if (/automatic/.test(g)) box = "automata";
  else if (/manual/.test(g)) box = "manuális";
  return { gears: gears ? Number(gears[1]) : null, gearbox: box };
}

const clean = (s: string | undefined, max: number) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/** Egy CSV-sor (mezők tömbje) → katalógussor; null, ha nincs azonosító vagy márka/modell. */
export function parseCatalogRow(f: string[]): CatalogRow | null {
  const [id, brand, model, gen, mod, start, end, pt, body, fuel, power, disp, code, drive, gear, kerb, maxw, sysPower] = f;
  const sourceId = Number(id);
  if (!sourceId || !brand?.trim() || !model?.trim()) return null;
  const s = parseProd(start ?? ""), e = parseProd(end ?? "");
  const hp = parseHp(power ?? "") ?? parseHp(sysPower ?? "");
  const [kMin, kMax] = parseKgRange(kerb ?? "");
  const [, gMax] = parseKgRange(maxw ?? "");
  const gb = parseGearbox(gear ?? "");
  const powertrain = normPowertrain(pt ?? "");
  return {
    sourceId, make: brand.trim(), model: model.trim(), generation: (gen ?? "").trim().slice(0, 160) || model.trim(), name: (mod ?? "").trim().slice(0, 200) || "–",
    yearFrom: s.year, monthFrom: s.month, yearTo: e.year, monthTo: e.month,
    powertrain, body: clean(body, 60), fuel: normFuel(fuel ?? "", pt ?? ""), fuelRaw: clean(fuel, 80),
    displacementCc: int(disp), powerHp: hp, powerKw: hpToKw(hp), engineCode: clean(code, 80), drive: normDrive(drive ?? ""),
    gears: gb.gears, gearbox: gb.gearbox, gearboxRaw: clean(gear, 120),
    kerbMinKg: kMin, kerbMaxKg: kMax, grossKg: gMax,
  };
}

/** Pontosvesszős, idézőjeles CSV (BOM-mal) → mezőtömbök. */
export function parseCsv(text: string, sep = ";"): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cur); out.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

/** Évjáratonkénti keresés: az adott évjáratban gyártott változat-e. */
export const variantCoversYear = (v: { yearFrom: number | null; yearTo: number | null }, year: number, thisYear = new Date().getFullYear()) =>
  v.yearFrom != null && v.yearFrom <= year && year <= (v.yearTo ?? thisYear);
