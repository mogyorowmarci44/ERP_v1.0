import type { CompanySnapshot, HoldingSnapshot } from "@/lib/daily-summary/data";

const series = Array.from({ length: 30 }, (_, i) => 3_200_000 + Math.round(Math.sin(i / 4) * 400_000) + i * 40_000);

export const pezcar: CompanySnapshot = {
  companyId: 1, name: "PezCar Kft", private: false, date: "2026-11-24", day: "2026-11-23",
  headline: "Tegnap 1 autó ment el 486 e Ft nettó fedezettel. 2 teendő vár, ebből 1 sürgős.",
  kpi: { cash: 2_310_000, cashHuf: 412_500, liquidity: 2_356_000, revenueDay: 2_748_000, stock: 4, lateReceivable: 0, lateReceivableCount: 0 },
  results: { month: 612_000, quarter: 1_840_000, year: 4_900_000, yearForecast: 6_350_000, yearForecastAfterTax: 5_780_000, forecastPartial: false },
  deadlines: { vat: { date: "2026-12-21", days: 27 }, payroll: { date: "2026-12-14", days: 20 } },
  todos: [
    { level: "red", text: "Járulékbevallás, 2026. október – nincs beküldve", path: "/c/1/filings" },
    { level: "yellow", text: "12 beérkező bizonylat könyvelésre vár", path: "/c/1/inbox" },
  ],
  cars: {
    daysSinceSale: 1, capital: 11_200_000, avgDays: 58,
    soldDay: [{ title: "Suzuki Vitara (RLM-512)", f2: 486_000 }],
    lanes: { red: { count: 1, capital: 6_700_000, holding: 312_000 }, yellow: { count: 1, capital: 2_300_000, holding: 61_000 }, green: { count: 2, capital: 2_200_000, holding: 21_000 } },
    top: [
      { title: "Suzuki SX4 (NKR-204)", days: 96, holding: 142_000, status: "red", note: "8 nap múlva nullszaldó" },
      { title: "Suzuki Swift (SMR-731)", days: 71, holding: 61_000, status: "yellow", note: "cél ár 2 590 e Ft, most 2 690 e Ft" },
    ],
    greenCount: 2,
  },
  finance: {
    entries: [
      { label: "VE · Suzuki Vitara eladás", amount: 3_490_000, debit: "311", credit: "911 / 467" },
      { label: "BA · Vevő kiegyenlítés", amount: 3_490_000, debit: "384", credit: "311" },
      { label: "SZ · Fényezés (Swift)", amount: 254_000, debit: "261 / 466", credit: "454" },
    ],
    entryCount: 3, mtdResult: 612_000, prevMtdResult: 410_000, vatBalance: 84_000, cashIn30: 3_900_000,
  },
  extra: { mtdRevenue: 6_100_000, ytdResult: 4_900_000, taxLiability: 412_000, payablesDue14: 180_000, memberLoans: 2_150_000, cashSeries: series, guesthouse: null },
};

export const mmcar: CompanySnapshot = {
  ...pezcar, companyId: 2, name: "MM Car Trade Kft", headline: "Tegnap nem volt eladás, az utolsó óta 9 nap telt el. 1 teendő vár.",
  kpi: { cash: 1_950_000, cashHuf: 180_000, liquidity: 1_950_000, revenueDay: 0, stock: 3, lateReceivable: 0, lateReceivableCount: 0 },
  todos: [{ level: "yellow", text: "1 lejárt szállítói számla · 82 eFt", path: "/c/2/reports/open-items" }],
  cars: { ...pezcar.cars!, daysSinceSale: 9, soldDay: [], capital: 7_200_000, lanes: { red: { count: 0, capital: 0, holding: 0 }, yellow: { count: 1, capital: 2_300_000, holding: 60_000 }, green: { count: 2, capital: 4_900_000, holding: 37_000 } }, top: [pezcar.cars!.top[1]] },
  finance: { ...pezcar.finance, mtdResult: 240_000, prevMtdResult: 190_000 },
  extra: { ...pezcar.extra, memberLoans: 0, taxLiability: 200_000, payablesDue14: 120_000, cashSeries: series.map((x) => x * 0.6) },
};

export const dezsavu: CompanySnapshot = {
  ...pezcar, companyId: 3, name: "Dézsavű", private: true, headline: "Hó eddig 11 vendégéjszaka. Minden rendben.",
  kpi: { cash: 560_000, cashHuf: 60_000, liquidity: 560_000, revenueDay: 42_000, stock: null, lateReceivable: 0, lateReceivableCount: 0 },
  todos: [], cars: null, finance: { ...pezcar.finance, mtdResult: 118_000, prevMtdResult: 90_000, cashIn30: null },
  extra: { ...pezcar.extra, memberLoans: 0, taxLiability: 0, payablesDue14: 0, cashSeries: series.map((x) => x * 0.15), guesthouse: { occupancy: 0.43, nextStay: "2026-11-28", nights: 11 } },
};

export const holding: HoldingSnapshot = {
  date: "2026-11-24", day: "2026-11-23", companies: [pezcar, mmcar, dezsavu],
  totals: { cash: 4_820_000, revenueDay: 2_790_000, mtdResult: 970_000, prevMtdResult: 690_000, ytdResult: 6_400_000, capital: 18_400_000, stock: 7, obligations14: 1_112_000, cover: 4.33, memberLoans: 2_150_000 },
  cashSeries: series.map((x) => x * 1.75),
  lanes: { red: { count: 1, capital: 6_700_000, holding: 312_000 }, yellow: { count: 2, capital: 4_600_000, holding: 121_000 }, green: { count: 4, capital: 7_100_000, holding: 58_000 } },
  bestSale: { company: "PezCar Kft", title: "Suzuki Vitara (RLM-512)", f2: 486_000 },
  headline: "A holding pénze 4,82 M Ft, hó eddig +970 e Ft eredmény. 3 teendő, ebből 1 sürgős.",
};
