import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * v6.1.0 – Az üzemeltető (szolgáltató) adatai a jogi dokumentumokhoz (ÁSZF, adatkezelési tájékoztató, adatfeldolgozói szerződés).
 * Az üzemeltetői oldalon szerkeszthető; app_settings.vendor kulcs.
 */
export type Vendor = {
  name: string;
  seat: string;
  regNumber: string;
  taxNumber: string;
  email: string;
  phone: string;
  web: string;
  /** Jogász átnézte-e a dokumentumokat – addig „tervezet” sáv jelenik meg rajtuk. */
  legalReviewed: boolean;
};

/** A dokumentumok változata – ha a szöveg érdemben változik, növelni kell: minden felhasználónak újra el kell fogadnia. */
export const TERMS_VERSION = "2026-11-26";

const EMPTY: Vendor = { name: "", seat: "", regNumber: "", taxNumber: "", email: "", phone: "", web: "", legalReviewed: false };

export async function getVendor(): Promise<Vendor> {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "vendor"));
  return { ...EMPTY, ...((r?.value as Partial<Vendor> | undefined) ?? {}) };
}

export async function setVendor(v: Vendor) {
  await db.insert(schema.appSettings).values({ key: "vendor", value: v })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: v, updatedAt: new Date() } });
}

/** Hiányzó kötelező adatok (a dokumentum ezeket jelöli). */
export function vendorMissing(v: Vendor): string[] {
  const m: string[] = [];
  if (!v.name) m.push("cégnév");
  if (!v.seat) m.push("székhely");
  if (!v.regNumber) m.push("cégjegyzékszám");
  if (!v.taxNumber) m.push("adószám");
  if (!v.email) m.push("e-mail");
  return m;
}
