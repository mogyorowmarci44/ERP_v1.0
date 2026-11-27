/**
 * v6.2.0 – Modulkapcsolók cégenként.
 *
 * A tevékenységprofil csak kiinduló beállítás: megadja, mely modulok alapból bekapcsoltak. A cég Beállítások oldalán bármelyik
 * modul egyenként be- vagy kikapcsolható (companies.settings.modules). A kikapcsolt modul eltűnik a menüből és a nyitóoldalról,
 * az oldalai pedig nem nyílnak meg – az adatai megmaradnak, és visszakapcsoláskor újra elérhetők.
 * Az alap könyvelés (számlák, napló, ÁFA, kimutatások, évzárás, partnerek, számlatükör) mindig elérhető.
 */
import type { ActivityProfile } from "@/lib/activity";

export type ModuleKey = "vehicles" | "inventory" | "inbox" | "payroll" | "memberLoans" | "assets" | "forecast" | "filings" | "summary" | "fx";

export type ModuleDef = { key: ModuleKey; label: string; description: string; defaults: ActivityProfile[] };

const ALL: ActivityProfile[] = ["car_dealer", "general", "services", "trade"];

export const MODULES: ModuleDef[] = [
  { key: "vehicles", label: "Gépkocsi-kereskedés", description: "Gépkocsi készlet, különbözeti ÁFA kartonok, ÁrSugó, AutóMérleg, KészletMérleg, jármű-EPR", defaults: ["car_dealer"] },
  { key: "inventory", label: "Készletnyilvántartás (cikkek)", description: "Cikktörzs, bevételezés és kiadás, csúsztatott átlagár, készletérték", defaults: ["trade"] },
  { key: "inbox", label: "Beérkező bizonylatok", description: "Bizonylatok beolvasása Gmailből, Drive-ból, feltöltésből; iktatás", defaults: ALL },
  { key: "payroll", label: "Bérszámfejtés", description: "Dolgozók, jogviszonyok, havi bérszámfejtés, jelenléti naptár", defaults: ALL },
  { key: "memberLoans", label: "Tagi kölcsön", description: "Tagi kölcsönök, okiratok, hosszabbítás, devizás kölcsön", defaults: ALL },
  { key: "assets", label: "Tárgyi eszközök", description: "Eszköznyilvántartás, értékcsökkenés", defaults: ALL },
  { key: "forecast", label: "Forecast", description: "Előrejelzés, tervezett tételek, várható eredmény", defaults: ALL },
  { key: "filings", label: "NAV-bevallások (ÁNYK)", description: "ÁFA- és járulékbevallás előkészítése, ÁNYK export", defaults: ALL },
  { key: "summary", label: "Napi összefoglaló", description: "Napi e-mail a cég vezetőinek", defaults: ALL },
  { key: "fx", label: "Devizás tételek (MNB árfolyamok)", description: "Árfolyamtáblázat, devizás számlák árfolyama", defaults: ALL },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

type CompanyLike = { activityProfile?: string | null; settings?: unknown };

/** A profil szerinti alapértelmezés. */
export function moduleDefault(profile: string | null | undefined, key: ModuleKey): boolean {
  const def = MODULES.find((m) => m.key === key);
  return !!def && def.defaults.includes((profile ?? "general") as ActivityProfile);
}

/** Be van-e kapcsolva a modul ennél a cégnél (kézi beállítás, különben a profil alapértelmezése). */
export function moduleOn(c: CompanyLike, key: ModuleKey): boolean {
  const o = (c.settings as { modules?: Partial<Record<ModuleKey, boolean>> } | null | undefined)?.modules?.[key];
  return typeof o === "boolean" ? o : moduleDefault(c.activityProfile, key);
}

/** Az űrlapból: csak az alapértelmezéstől eltérő értékeket tároljuk, így profilváltáskor a többi követi a profilt. */
export function modulesFromForm(profile: string | null | undefined, on: (key: ModuleKey) => boolean): Partial<Record<ModuleKey, boolean>> {
  const out: Partial<Record<ModuleKey, boolean>> = {};
  for (const k of MODULE_KEYS) if (on(k) !== moduleDefault(profile, k)) out[k] = on(k);
  return out;
}

/** v6.11.0 – a modul a cégnél be van kapcsolva ÉS a felhasználó elől nincs elrejtve (tulajdonos elől soha). */
export function moduleVisible(c: CompanyLike, hidden: readonly string[] | null | undefined, key: ModuleKey): boolean {
  return moduleOn(c, key) && !(hidden ?? []).includes(key);
}
