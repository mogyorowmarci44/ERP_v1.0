/**
 * v5.0.0 – Tevékenységprofil (cégenként). v6.2.0: a profil a modulok kiinduló beállítása (lib/modules.ts);
 * a modulok a cég Beállítások oldalán egyenként is kapcsolhatók.
 *
 * - car_dealer: gépkocsi-kereskedés – gépkocsi készlet, különbözeti ÁFA, ÁrSugó, AutóMérleg, KészletMérleg, jármű-EPR.
 * - general: általános társaság, a tevékenységi kör még nem ismert.
 * - services: szolgáltató cég (készlet nélkül).
 * - trade: kereskedelmi cég – cikkenkénti készletnyilvántartással.
 */
export type ActivityProfile = "car_dealer" | "general" | "services" | "trade";

export const ACTIVITY_PROFILES: ActivityProfile[] = ["general", "services", "trade", "car_dealer"];

export const ACTIVITY_LABEL: Record<ActivityProfile, string> = {
  car_dealer: "Gépkocsi-kereskedés",
  general: "Általános (tevékenységi kör még nem ismert)",
  services: "Szolgáltatás",
  trade: "Kereskedelem (cikkenkénti készlettel)",
};

/** Rövid címke a cégkártyákra. */
export const ACTIVITY_SHORT: Record<ActivityProfile, string> = {
  car_dealer: "Gépkocsi-kereskedés",
  general: "Általános",
  services: "Szolgáltatás",
  trade: "Kereskedelem",
};

export function parseActivityProfile(v: unknown, fallback: ActivityProfile = "general"): ActivityProfile {
  return ACTIVITY_PROFILES.includes(v as ActivityProfile) ? (v as ActivityProfile) : fallback;
}

/** Gépkocsi-kereskedés modul ennél a cégnél (v6.2.0: a modulkapcsoló szerint, ld. lib/modules.ts). */
export const isCarDealer = (c: { activityProfile?: string | null; settings?: unknown }) => {
  const o = (c.settings as { modules?: { vehicles?: boolean } } | null | undefined)?.modules?.vehicles;
  return typeof o === "boolean" ? o : c.activityProfile === "car_dealer";
};
