/**
 * v5.0.0 – Tevékenységprofil (cégenként).
 *
 * - car_dealer: autókereskedés (PezCar, MM Car Trade) – ÁrSugó, AutóMérleg, KészletMérleg, jármű-EPR,
 *   különbözeti ÁFA, autónkénti Forecast.
 * - general: általános társaság, a tevékenységi kör még nem ismert.
 *
 * v5.0.0-ban a profil még csak címke: az „általános” Kft sablon ugyanazt a számlatükröt, ÁFA-kódokat,
 * naplókat és felületet kapja, mint az autókereskedés. A profil szerinti modulkapcsolás a következő lépés
 * (lásd `isCarDealer`).
 */
export type ActivityProfile = "car_dealer" | "general";

export const ACTIVITY_PROFILES: ActivityProfile[] = ["car_dealer", "general"];

export const ACTIVITY_LABEL: Record<ActivityProfile, string> = {
  car_dealer: "Autókereskedés",
  general: "Általános (tevékenységi kör még nem ismert)",
};

/** Rövid címke a cégkártyákra. */
export const ACTIVITY_SHORT: Record<ActivityProfile, string> = {
  car_dealer: "Autókereskedés",
  general: "Általános",
};

export function parseActivityProfile(v: unknown, fallback: ActivityProfile = "general"): ActivityProfile {
  return ACTIVITY_PROFILES.includes(v as ActivityProfile) ? (v as ActivityProfile) : fallback;
}

/** Autókereskedés-specifikus modulok ennél a cégnél (a következő verziótól ez kapcsolja a menüt és a nyitóoldalt). */
export const isCarDealer = (c: { activityProfile?: string | null }) => c.activityProfile === "car_dealer";
