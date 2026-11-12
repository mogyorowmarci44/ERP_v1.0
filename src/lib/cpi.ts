/**
 * v2.0 – Magyar fogyasztóiár-index (KSH), havonta, előző hónap = 100,0.
 * Forrás: KSH STADAT 1.2.1.2. (ara0040) és a havi gyorstájékoztatók; utolsó tényadat: 2026. október (közzététel: 2026.11.10.).
 * Előrejelzés: MNB Inflációs jelentés, 2026. szeptember – 2026: 1,8%, 2027: 3,1%, 2028: 2,5–2,8% (→ 2,7%),
 * utána az MNB 2028-tól érvényes 2,5%-os inflációs célja (felülírható a profilban).
 */
export const CPI_MOM: Record<string, number> = {
  "2021-08": 100.2, "2021-09": 100.2, "2021-10": 101.1, "2021-11": 100.7, "2021-12": 100.3,
  "2022-01": 101.4, "2022-02": 101.1, "2022-03": 101.0, "2022-04": 101.6, "2022-05": 101.7, "2022-06": 101.5,
  "2022-07": 102.3, "2022-08": 101.8, "2022-09": 104.1, "2022-10": 102.0, "2022-11": 101.8, "2022-12": 101.9,
  "2023-01": 102.3, "2023-02": 100.8, "2023-03": 100.8, "2023-04": 100.7, "2023-05": 99.6, "2023-06": 100.3,
  "2023-07": 100.3, "2023-08": 100.7, "2023-09": 100.4, "2023-10": 99.9, "2023-11": 100.0, "2023-12": 99.7,
  "2024-01": 100.7, "2024-02": 100.7, "2024-03": 100.8, "2024-04": 100.7, "2024-05": 99.9, "2024-06": 100.0,
  "2024-07": 100.7, "2024-08": 100.0, "2024-09": 99.9, "2024-10": 100.1, "2024-11": 100.5, "2024-12": 100.5,
  "2025-01": 101.5, "2025-02": 100.8, "2025-03": 100.0, "2025-04": 100.2, "2025-05": 100.2, "2025-06": 100.1,
  "2025-07": 100.4, "2025-08": 100.0, "2025-09": 100.0, "2025-10": 100.0, "2025-11": 100.1, "2025-12": 100.1,
  "2026-01": 100.3, "2026-02": 100.1, "2026-03": 100.4, "2026-04": 100.4, "2026-05": 100.0, "2026-06": 100.0,
  "2026-07": 99.9, "2026-08": 100.2, "2026-09": 100.2, "2026-10": 100.4,
};

export const CPI_LAST_ACTUAL = Object.keys(CPI_MOM).sort().at(-1)!;

/** Éves inflációs előrejelzés (MNB, 2026. szeptember); a táblán túli évekre a hosszú távú ráta. */
export const CPI_FORECAST: Record<string, number> = { "2026": 0.018, "2027": 0.031, "2028": 0.027 };
export const CPI_LONG_RUN = 0.025;

export const CPI_SOURCE =
  "KSH fogyasztóiár-index (előző hónap = 100), utolsó tényadat 2026. október; előrejelzés: MNB Inflációs jelentés 2026. szeptember (2026: 1,8%, 2027: 3,1%, 2028: 2,7%), utána a hosszú távú ráta.";

const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7));
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
};

/** Havi szorzó: tényadat, ha van; különben az éves előrejelzés havi megfelelője. */
export function monthlyFactor(month: string, longRun = CPI_LONG_RUN): { f: number; forecast: boolean } {
  const a = CPI_MOM[month];
  if (a !== undefined) return { f: a / 100, forecast: false };
  const annual = CPI_FORECAST[month.slice(0, 4)] ?? longRun;
  return { f: Math.pow(1 + annual, 1 / 12), forecast: true };
}

/**
 * Árszint-alapú diszkontálás: a t0 hónap árszintjén kifejezett forint.
 * df(d) = árszint(t0 hónapja) / árszint(d hónapja). A hónapon belül nincs további bontás.
 */
export function makeCpiDeflator(t0: string, longRun = CPI_LONG_RUN) {
  const base = t0.slice(0, 7);
  const level = new Map<string, number>([[base, 1]]);
  let last = base;
  const ensure = (m: string) => {
    while (last < m) {
      const n = nextMonth(last);
      level.set(n, level.get(last)! * monthlyFactor(n, longRun).f);
      last = n;
    }
  };
  return (d: string) => {
    const m = d.slice(0, 7);
    if (m <= base) return 1;
    ensure(m);
    return 1 / level.get(m)!;
  };
}

/** Kumulált infláció két hónap között (tény + előrejelzés). */
export function cumulativeInflation(fromMonth: string, toMonth: string, longRun = CPI_LONG_RUN): number {
  return 1 / makeCpiDeflator(`${fromMonth}-01`, longRun)(`${toMonth}-01`) - 1;
}
