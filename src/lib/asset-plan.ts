/** Tárgyi eszközök – tiszta (adatbázis nélküli) számítások: ÉCS-terv, számlaszabályok. Lásd: assets.ts. */
import { round2 } from "./money";

export const LOW_VALUE_LIMIT = 200_000;
export const ASSET_ACCOUNTS: Array<{ code: string; label: string; lifeMonths: number }> = [
  { code: "114", label: "114 – Vagyoni értékű jogok", lifeMonths: 72 },
  { code: "115", label: "115 – Szellemi termékek (pl. szoftver)", lifeMonths: 36 },
  { code: "122", label: "122 – Épületek, épületrészek", lifeMonths: 600 },
  { code: "131", label: "131 – Termelő gépek, berendezések", lifeMonths: 84 },
  { code: "141", label: "141 – Üzemi (üzleti) gépek, berendezések", lifeMonths: 84 },
  { code: "142", label: "142 – Egyéb járművek", lifeMonths: 60 },
  { code: "143", label: "143 – Irodai, igazgatási berendezések (pl. számítógép)", lifeMonths: 36 },
];

/** Az eszközszámlához tartozó halmozott ÉCS számla: 14x → 149, 13x → 139, 12x → 129, 11x → 119. */
export const accDepAccount = (code: string) => `${code.slice(0, 2)}9`;
export const isAssetAccount = (code: string) => /^1[1-4]/.test(code) && !/^1[1-4]9/.test(code) && !code.startsWith("121");

// --- dátum segédek (UTC, időzóna-független) ---------------------------------------------------
const D = (s: string) => Date.parse(`${s}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
export const periodOf = (d: string) => d.slice(0, 7);
export const monthEndOf = (p: string) => { const [y, m] = p.split("-").map(Number); return iso(Date.UTC(y, m, 0)); };
const nextPeriod = (p: string) => { const [y, m] = p.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
const addMonthsIso = (d: string, n: number) => {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last)));
};

export type AssetPlanInput = {
  activationDate: string; cost: number; salvage: number; usefulLifeMonths: number;
  taxRatePct: number | null; method: string; disposedOn: string | null;
  openingAccumulated: number; openingTaxAccumulated: number;
};
export type PlanRow = { period: string; amount: number; taxAmount: number; cumAmount: number; cumTax: number };

/**
 * A teljes ÉCS-terv havonta (az aktiválás hónapjától a leírás végéig vagy a kivezetésig).
 * A nyitó (korábban elszámolt) ÉCS-t „elfogyasztja” – az első hónapokban addig 0 jön ki, amíg a halmozott terv el nem éri.
 */
export function depreciationPlan(a: AssetPlanInput): PlanRow[] {
  const cost = Number(a.cost), salvage = Number(a.salvage);
  const start = D(a.activationDate);
  const out: PlanRow[] = [];
  if (a.method === "lowvalue") {
    const amt = round2(Math.max(0, cost - Number(a.openingAccumulated)));
    const tax = round2(Math.max(0, cost - Number(a.openingTaxAccumulated)));
    return [{ period: periodOf(a.activationDate), amount: amt, taxAmount: tax, cumAmount: cost, cumTax: cost }];
  }
  const base = Math.max(0, cost - salvage);
  const end = D(addMonthsIso(a.activationDate, Math.max(1, a.usefulLifeMonths))); // kizárólagos
  const totalDays = Math.max(1, (end - start) / DAY);
  const stop = a.disposedOn ? Math.min(D(a.disposedOn) + DAY, end) : end; // a kivezetés napjáig (bezárólag)
  const taxRate = a.taxRatePct == null ? null : Number(a.taxRatePct) / 100;
  const taxDays = taxRate ? Math.ceil((cost / (cost * taxRate)) * 365) : totalDays;
  const taxStop = a.disposedOn ? Math.min(D(a.disposedOn) + DAY, start + taxDays * DAY) : start + taxDays * DAY;
  const lastMs = Math.max(stop, taxStop) - DAY;

  const cumAcc = (ms: number) => Math.round((base * Math.min(Math.max(0, (Math.min(ms, stop) - start) / DAY), totalDays)) / totalDays);
  const cumTaxF = (ms: number) => taxRate == null
    ? cumAcc(ms)
    : Math.min(Math.round(cost), Math.round(cost * taxRate * Math.max(0, (Math.min(ms, taxStop) - start) / DAY) / 365));

  let prevA = 0, prevT = 0;
  const openA = Number(a.openingAccumulated), openT = a.taxRatePct == null ? Number(a.openingAccumulated) : Number(a.openingTaxAccumulated);
  for (let p = periodOf(a.activationDate); D(`${p}-01`) <= lastMs; p = nextPeriod(p)) {
    const endMs = D(monthEndOf(p)) + DAY; // a hónap végéig bezárólag
    const ca = cumAcc(endMs), ct = cumTaxF(endMs);
    const amount = Math.max(0, ca - Math.max(prevA, openA));
    const taxAmount = Math.max(0, ct - Math.max(prevT, openT));
    prevA = Math.max(prevA, ca); prevT = Math.max(prevT, ct);
    out.push({ period: p, amount, taxAmount, cumAmount: ca, cumTax: ct });
  }
  return out;
}

