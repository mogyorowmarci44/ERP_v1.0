/**
 * v3.3.3 – Települési HIPA-szabályok: tárolás, irányítószám → település, cég telephelyei → szabályok.
 * A szabályok a Kincstár HAKKA országos adatállományából jönnek („Frissítés a Kincstártól” gomb vagy kézi feltöltés),
 * a rendszerszintű app_settings táblában ("hipaRules"). Amíg nincs letöltve, a beépített szabályok élnek.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import postal from "@/data/postal-codes-hu.json";
import type { HipaRule, HipaSiteCalc } from "./corp-tax";

export type HipaSite = { zip: string; city: string; role: "seat" | "site"; share: number };

export type HipaRuleStore = {
  fetchedAt: string;
  source: string;
  /** normalizált név → szabály */
  rules: Record<string, HipaRule>;
};

export type HipaImportLog = {
  at: string;
  ok: boolean;
  mode: "kincstar" | "upload";
  message: string;
  municipalities?: number;
  withExemption?: number;
  /** Mit talált: fájlok, munkalapok, fejlécek – hogy formátumváltozásnál látszódjon, mi jött. */
  diagnostics?: string[];
};

const STOP = new Set(["városi", "város", "községi", "község", "nagyközségi", "nagyközség", "megyei", "jogú", "önkormányzata", "önkormányzat",
  "önkormányzati", "polgármesteri", "hivatal", "hivatala", "közös", "képviselő", "testülete", "testület", "fővárosi", "főváros", "jegyzője", "jegyző"]);

/** Név normalizálása összevetéshez: kisbetű, írásjelek és az „Önkormányzat”, „Város”, „Község” … szavak nélkül. */
export function normName(s: string): string {
  return s
    .toLocaleLowerCase("hu-HU")
    .replace(/[^\p{L}\d]+/gu, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

/** Beépített szabályok – a Kincstár letöltéséig (forrás: önkormányzati rendeletek). */
export const BUILTIN_HIPA_RULES: Record<string, HipaRule> = {
  [normName("Mór")]: {
    name: "Mór", rate: 0.02, exemptBelow: 2_500_000, exemptInclusive: false,
    notes: ["27/2018. (XI.30.) önkormányzati rendelet: mentes, akinek a vállalkozási szintű adóalapja nem éri el a 2 500 000 Ft-ot"],
    source: "beépített (Mór, 27/2018. rendelet)",
  },
};

const ZIPS = (postal as { source: string; zips: Record<string, string[]> }).zips;
export const POSTAL_SOURCE = (postal as { source: string }).source;

/** Irányítószám → település(ek). Egy irányítószámhoz több település is tartozhat. */
export function citiesForZip(zip: string): string[] {
  const z = (zip || "").replace(/\D/g, "").slice(0, 4);
  return z.length === 4 ? ZIPS[z] ?? [] : [];
}

/** A cím elejéről/közepéből kiveszi az irányítószámot (pl. „8060 Mór, Fő u. 1.”). */
export function zipFromAddress(address: string | null | undefined): string | null {
  const m = (address ?? "").match(/\b([1-9]\d{3})\b/);
  return m ? m[1] : null;
}

const STORE_KEY = "hipaRules";
const LOG_KEY = "hipaImportLog";

export async function loadHipaStore(): Promise<HipaRuleStore | null> {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, STORE_KEY));
  return (r?.value as HipaRuleStore | undefined) ?? null;
}

export async function saveHipaStore(store: HipaRuleStore) {
  await db.insert(schema.appSettings).values({ key: STORE_KEY, value: store })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: store, updatedAt: new Date() } });
}

export async function loadImportLog(): Promise<HipaImportLog | null> {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, LOG_KEY));
  return (r?.value as HipaImportLog | undefined) ?? null;
}

export async function saveImportLog(log: HipaImportLog) {
  await db.insert(schema.appSettings).values({ key: LOG_KEY, value: log })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: log, updatedAt: new Date() } });
}

/** Szabály egy településre: Kincstár → beépített → null (ismeretlen: a számoló 2%-kal, mentesség nélkül számol). */
export function ruleFor(city: string, store: HipaRuleStore | null): HipaRule | null {
  const k = normName(city);
  return store?.rules[k] ?? BUILTIN_HIPA_RULES[k] ?? null;
}

/** A cég telephelyei a beállításokból; ha nincs megadva, a cég címéből a székhely (100%). */
export function companyHipaSites(company: { address: string | null; settings: { hipaSites?: HipaSite[] | null } }): { sites: HipaSite[]; fromAddress: boolean } {
  const s = company.settings.hipaSites ?? [];
  if (s.length) return { sites: s, fromAddress: false };
  const zip = zipFromAddress(company.address);
  const city = zip ? citiesForZip(zip)[0] : undefined;
  return { sites: zip && city ? [{ zip, city, role: "seat", share: 1 }] : [], fromAddress: true };
}

export async function resolveHipaSites(company: { address: string | null; settings: { hipaSites?: HipaSite[] | null } }): Promise<{ sites: (HipaSite & { rule: HipaRule | null })[]; calc: HipaSiteCalc[]; fromAddress: boolean; store: HipaRuleStore | null }> {
  const store = await loadHipaStore();
  const { sites, fromAddress } = companyHipaSites(company);
  const withRules = sites.map((s) => ({ ...s, rule: ruleFor(s.city, store) }));
  return { sites: withRules, calc: withRules.map((s) => ({ name: s.city, role: s.role, share: s.share, rule: s.rule })), fromAddress, store };
}
