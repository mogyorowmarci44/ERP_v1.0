import "server-only";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { afterFailure, ipFromForwarded, lockedMinutes, type ThrottleLimit } from "@/lib/throttle-calc";

const { authThrottle } = schema;

/** A kérés IP-címe (szerveroldali műveletben / oldalon). */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return ipFromForwarded(h.get("x-forwarded-for"), h.get("x-real-ip"));
  } catch {
    return "ismeretlen";
  }
}

async function load(key: string) {
  const [r] = await db.select().from(authThrottle).where(eq(authThrottle.key, key));
  return r ?? null;
}

/** Hány percig zárolt még a kulcs (0 = nem zárolt). */
export async function throttleLockedMinutes(key: string): Promise<number> {
  return lockedMinutes(await load(key), new Date());
}

/** Hibás próbálkozás rögzítése; visszaadja, hogy ettől zárolódott-e. */
export async function throttleFail(key: string, lim: ThrottleLimit): Promise<boolean> {
  const next = afterFailure(await load(key), new Date(), lim);
  const { locked, ...row } = next;
  await db.insert(authThrottle).values({ key, ...row }).onConflictDoUpdate({ target: authThrottle.key, set: row });
  return locked;
}

/** Sikeres belépés után a fiók számlálója nullázódik. */
export async function throttleClear(key: string) {
  await db.delete(authThrottle).where(eq(authThrottle.key, key));
}

export const emailKey = (email: string) => `email:${email.toLowerCase()}`;
export const ipKey = (ip: string) => `ip:${ip}`;
