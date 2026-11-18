/**
 * Bérszámfejtés – tiszta számítómotor (adatbázis nélkül, kliensen is fut).
 * Jogviszonyok: teljes munkaidő, részmunkaidő (6 / 4 óra / egyéb), egyszerűsített foglalkoztatás (alkalmi, idénymunka),
 * társas vállalkozó. Túlóra (50% / 100% pótlék), prémium, béren kívüli juttatások (SZÉP: keretig 28%, felette 33,04%).
 * Kedvezmények (családi, 25 év alatti, anyák) a 2. fázisban.
 */

export type PayrollParams = {
  minWage: number;            // minimálbér (havi)
  guaranteedMin: number;      // garantált bérminimum (havi)
  minWageDaily: number;       // napi minimálbér (EFO mentesített keret alapja)
  guaranteedMinDaily: number;
  szjaPct: number;            // 15
  tbPct: number;              // 18.5
  szochoPct: number;          // 13
  memberSzochoBasePct: number; // társas vállalkozó minimum szocho-alap a minimálbér %-ában (2025: 112.5, 2026: 100)
  efoCasualPct: number;       // alkalmi munka napi közteher a minimálbér %-ában (1)
  efoSeasonalPct: number;     // idénymunka (0.5)
  efoExemptPct: number;       // EFO napi mentesített keret a napi minimálbér %-ában (130)
  efoMaxDays: number;         // alkalmi munka éves napkorlát (120)
  overtimeYearLimit: number;  // éves túlóra-keret (250)
  hourDivisor: number;        // havi osztószám teljes munkaidőnél (174)
  szepLimit: number;          // SZÉP éves kedvezményes keret
  benefitPct: number;         // béren kívüli juttatás közterhe a kereten belül (28)
  ejmPct: number;             // egyes meghatározott juttatás közterhe (33.04)
  memberTbAccount: string;    // a társas vállalkozó helyett a cég által viselt járulék költségszámlája
};

export const DEFAULT_PARAMS: Record<number, PayrollParams> = {
  2025: {
    minWage: 290_800, guaranteedMin: 348_800, minWageDaily: 13_370, guaranteedMinDaily: 16_040,
    szjaPct: 15, tbPct: 18.5, szochoPct: 13, memberSzochoBasePct: 112.5,
    efoCasualPct: 1, efoSeasonalPct: 0.5, efoExemptPct: 130, efoMaxDays: 90, overtimeYearLimit: 250, hourDivisor: 174,
    szepLimit: 450_000, benefitPct: 28, ejmPct: 33.04, memberTbAccount: "551",
  },
  2026: {
    minWage: 322_800, guaranteedMin: 373_200, minWageDaily: 14_850, guaranteedMinDaily: 17_160,
    szjaPct: 15, tbPct: 18.5, szochoPct: 13, memberSzochoBasePct: 100,
    efoCasualPct: 1, efoSeasonalPct: 0.5, efoExemptPct: 130, efoMaxDays: 120, overtimeYearLimit: 250, hourDivisor: 174,
    szepLimit: 450_000, benefitPct: 28, ejmPct: 33.04, memberTbAccount: "551",
  },
};

export function defaultParams(year: number): PayrollParams {
  const ys = Object.keys(DEFAULT_PARAMS).map(Number).sort();
  const y = ys.filter((x) => x <= year).at(-1) ?? ys[0];
  return { ...DEFAULT_PARAMS[y] };
}

export const PARAM_LABELS: Array<{ key: keyof PayrollParams; label: string; unit: string }> = [
  { key: "minWage", label: "Minimálbér (havi)", unit: "Ft" },
  { key: "guaranteedMin", label: "Garantált bérminimum (havi)", unit: "Ft" },
  { key: "minWageDaily", label: "Napi minimálbér", unit: "Ft" },
  { key: "guaranteedMinDaily", label: "Napi garantált bérminimum", unit: "Ft" },
  { key: "szjaPct", label: "SZJA", unit: "%" },
  { key: "tbPct", label: "TB-járulék", unit: "%" },
  { key: "szochoPct", label: "Szociális hozzájárulási adó", unit: "%" },
  { key: "memberSzochoBasePct", label: "Társas vállalkozó min. szocho-alap (a minimálbér %-a)", unit: "%" },
  { key: "efoCasualPct", label: "EFO alkalmi munka napi közteher (a minimálbér %-a)", unit: "%" },
  { key: "efoSeasonalPct", label: "EFO idénymunka napi közteher (a minimálbér %-a)", unit: "%" },
  { key: "efoExemptPct", label: "EFO napi mentesített keret (a napi minimálbér %-a)", unit: "%" },
  { key: "efoMaxDays", label: "Alkalmi munka éves napkorlát", unit: "nap" },
  { key: "overtimeYearLimit", label: "Éves túlóra-keret", unit: "óra" },
  { key: "hourDivisor", label: "Havi osztószám (teljes munkaidő)", unit: "óra" },
  { key: "szepLimit", label: "SZÉP-kártya éves kedvezményes keret", unit: "Ft" },
  { key: "benefitPct", label: "Béren kívüli juttatás közterhe (kereten belül)", unit: "%" },
  { key: "ejmPct", label: "Egyes meghatározott juttatás közterhe", unit: "%" },
  { key: "memberTbAccount", label: "Társas vállalkozó helyett viselt járulék – költségszámla", unit: "" },
];

export type EmploymentKind = "full" | "part6" | "part4" | "part" | "efo_casual" | "efo_seasonal" | "member";
export const KIND_LABEL: Record<EmploymentKind, string> = {
  full: "Teljes munkaidő (8 óra)", part6: "Részmunkaidő – 6 óra", part4: "Részmunkaidő – 4 óra", part: "Részmunkaidő – egyéb",
  efo_casual: "Alkalmi munka (EFO)", efo_seasonal: "Idénymunka (EFO)", member: "Társas vállalkozó",
};
export const KIND_SHORT: Record<EmploymentKind, string> = { full: "teljes · 8 óra", part6: "rész · 6 óra", part4: "rész · 4 óra", part: "rész", efo_casual: "alkalmi (EFO)", efo_seasonal: "idény (EFO)", member: "társas vállalkozó" };
export const weeklyHoursOf = (kind: EmploymentKind, weekly?: number | null) =>
  kind === "full" ? 40 : kind === "part6" ? 30 : kind === "part4" ? 20 : kind === "part" ? Number(weekly || 20) : kind === "member" ? 40 : 0;
export const isEfo = (k: EmploymentKind) => k === "efo_casual" || k === "efo_seasonal";

export type Employment = {
  kind: EmploymentKind; monthlyWage: number; dailyWage: number; weeklyHours?: number | null; guaranteedMin: boolean;
  startDate: string; endDate: string | null;
};
export type BenefitKind = "szep" | "ejm" | "taxfree";
export const BENEFIT_LABEL: Record<BenefitKind, string> = { szep: "SZÉP-kártya", ejm: "Egyéb (egyes meghatározott)", taxfree: "Adómentes" };
export type PayrollInput = { otHours50?: number; otHours100?: number; bonus?: number; efoDays?: number; benefits?: Array<{ kind: BenefitKind; amount: number; note?: string }> };
export type YearToDate = { szepUsed: number; efoDays: number; overtimeHours: number };

export type PayrollResult = {
  base: number; overtimePay: number; bonus: number; gross: number;
  szja: number; tb: number; net: number;
  tbCompany: number;          // társas vállalkozó: a minimum alap miatti, a cég által viselt járulék
  szocho: number;             // bér utáni szocho (+ társas vállalkozó minimum)
  efoTax: number;             // EFO napi közteher
  benefitTotal: number; benefitSzja: number; benefitSzocho: number;
  employerCost: number;
  hourlyRate: number; prorate: number;
  warnings: string[];
};

const r0 = (n: number) => Math.round(n);
const hf = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });
const F = (n: number) => hf.format(Math.round(n)).replace(/\s/g, " ");
const round100 = (n: number) => Math.round(n / 100) * 100;
const daysIn = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** A hónapban a jogviszonyban töltött naptári napok aránya (belépés / kilépés hó közben). */
export function prorateOf(e: Pick<Employment, "startDate" | "endDate">, period: string) {
  const n = daysIn(period);
  const first = `${period}-01`, last = `${period}-${String(n).padStart(2, "0")}`;
  if (e.startDate > last || (e.endDate && e.endDate < first)) return 0;
  const from = e.startDate > first ? Number(e.startDate.slice(8, 10)) : 1;
  const to = e.endDate && e.endDate < last ? Number(e.endDate.slice(8, 10)) : n;
  return Math.max(0, to - from + 1) / n;
}

export function calcPayroll(e: Employment, input: PayrollInput, p: PayrollParams, period: string, ytd: YearToDate = { szepUsed: 0, efoDays: 0, overtimeHours: 0 }): PayrollResult {
  const w: string[] = [];
  const ratio = isEfo(e.kind) ? 1 : prorateOf(e, period);
  const res: PayrollResult = { base: 0, overtimePay: 0, bonus: 0, gross: 0, szja: 0, tb: 0, net: 0, tbCompany: 0, szocho: 0, efoTax: 0, benefitTotal: 0, benefitSzja: 0, benefitSzocho: 0, employerCost: 0, hourlyRate: 0, prorate: ratio, warnings: w };
  const pct = (x: number) => x / 100;

  if (isEfo(e.kind)) {
    const days = Math.max(0, Math.round(Number(input.efoDays ?? 0)));
    const daily = Number(e.dailyWage || 0);
    res.base = r0(daily * days);
    res.gross = res.base;
    res.net = res.gross; // az EFO-ból a munkáltató nem von le; a mentesített keret felett a munkavállaló vall be
    res.efoTax = round100(p.minWage * pct(e.kind === "efo_casual" ? p.efoCasualPct : p.efoSeasonalPct)) * days;
    const exempt = (e.guaranteedMin ? p.guaranteedMinDaily : p.minWageDaily) * pct(p.efoExemptPct);
    if (daily > exempt) w.push(`A napidíj (${F(daily)} Ft) meghaladja a napi mentesített keretet (${F(exempt)} Ft) – a különbözetre a munkavállalónak bevallási kötelezettsége van.`);
    const minDaily = e.guaranteedMin ? p.guaranteedMinDaily : p.minWageDaily;
    if (days && daily < minDaily) w.push(`A napidíj kevesebb a napi ${e.guaranteedMin ? "garantált bérminimumnál" : "minimálbérnél"} (${F(minDaily)} Ft).`);
    if (e.kind === "efo_casual" && ytd.efoDays + days > p.efoMaxDays) w.push(`Az alkalmi napok száma az évben ${ytd.efoDays + days} – túllépi a ${p.efoMaxDays} napos korlátot.`);
  } else {
    const weekly = weeklyHoursOf(e.kind, e.weeklyHours);
    const monthly = Number(e.monthlyWage || 0);
    res.base = r0(monthly * ratio);
    res.hourlyRate = weekly ? monthly / (p.hourDivisor * weekly / 40) : 0;
    const ot50 = Number(input.otHours50 ?? 0), ot100 = Number(input.otHours100 ?? 0);
    res.overtimePay = r0(res.hourlyRate * (ot50 * 1.5 + ot100 * 2));
    res.bonus = r0(Number(input.bonus ?? 0));
    res.gross = res.base + res.overtimePay + res.bonus;
    res.szja = r0(res.gross * pct(p.szjaPct));
    if (ot50 + ot100 > 0 && e.kind === "member") w.push("Társas vállalkozónál nincs túlóra – a pótlék tagi jövedelemként számolódik.");
    if (ytd.overtimeHours + ot50 + ot100 > p.overtimeYearLimit && e.kind !== "member") w.push(`Az éves túlóra ${ytd.overtimeHours + ot50 + ot100} óra – túllépi a ${p.overtimeYearLimit} órás keretet.`);

    if (e.kind === "member") {
      const minBase = (e.guaranteedMin ? p.guaranteedMin : p.minWage) * ratio;
      const tbBase = Math.max(res.gross, minBase);
      const tbTotal = r0(tbBase * pct(p.tbPct));
      res.tb = Math.min(tbTotal, r0(res.gross * pct(p.tbPct)));
      res.tbCompany = tbTotal - res.tb;
      res.szocho = r0(Math.max(res.gross, minBase * pct(p.memberSzochoBasePct)) * pct(p.szochoPct));
      if (res.tbCompany > 0) w.push(`A tagi jövedelem a minimum járulékalap (${F(minBase)} Ft) alatt van – ${F(res.tbCompany)} Ft járulékot a társaság visel.`);
    } else {
      res.tb = r0(res.gross * pct(p.tbPct));
      res.szocho = r0(res.gross * pct(p.szochoPct));
      const min = (e.guaranteedMin ? p.guaranteedMin : p.minWage) * weekly / 40;
      if (monthly < min - 0.5) w.push(`Az alapbér (${F(monthly)} Ft) kevesebb a ${weekly} órás ${e.guaranteedMin ? "garantált bérminimumnál" : "minimálbérnél"} (${F(min)} Ft).`);
    }
    res.net = res.gross - res.szja - res.tb;
  }

  // béren kívüli juttatások (a munkáltató fizeti a közterhet)
  let szepLeft = Math.max(0, p.szepLimit - ytd.szepUsed);
  for (const b of input.benefits ?? []) {
    const amt = r0(Number(b.amount || 0));
    if (amt <= 0) continue;
    res.benefitTotal += amt;
    if (b.kind === "taxfree") continue;
    let within = 0, over = amt;
    if (b.kind === "szep") { within = Math.min(amt, szepLeft); over = amt - within; szepLeft -= within; }
    // kereten belül: 15% SZJA + 13% szocho az összeg után; felette (és egyes meghatározott juttatásnál) az 1,18-szoros alap után
    res.benefitSzja += r0(within * pct(p.szjaPct) + over * 1.18 * pct(p.szjaPct));
    res.benefitSzocho += r0(within * pct(p.szochoPct) + over * 1.18 * pct(p.szochoPct));
    if (b.kind === "szep" && over > 0) w.push(`A SZÉP-juttatásból ${F(over)} Ft meghaladja az éves keretet – arra ${p.ejmPct}% a közteher.`);
  }

  res.employerCost = res.gross + res.szocho + res.tbCompany + res.efoTax + res.benefitTotal + res.benefitSzja + res.benefitSzocho;
  return res;
}

/** A havi összesítő (könyveléshez és a 08-as bevalláshoz). */
export function sumResults(rs: PayrollResult[]) {
  const k = ["gross", "szja", "tb", "net", "tbCompany", "szocho", "efoTax", "benefitTotal", "benefitSzja", "benefitSzocho", "employerCost", "overtimePay"] as const;
  return Object.fromEntries(k.map((x) => [x, rs.reduce((s, r) => s + r[x], 0)])) as Record<(typeof k)[number], number>;
}
