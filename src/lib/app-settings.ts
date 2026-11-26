import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Kötelező-e a kétlépcsős azonosítás (alapértelmezés: igen).
 * v6.0.0: ügyfélfiókonként állítható; ügyfélfiók nélküli felhasználónál mindig kötelező.
 */
export async function mfaRequired(organizationId: number | null | undefined): Promise<boolean> {
  if (!organizationId) return true;
  const [r] = await db.select({ v: schema.organizations.mfaRequired }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  return r ? r.v : true;
}

export async function setMfaRequired(organizationId: number, on: boolean) {
  await db.update(schema.organizations).set({ mfaRequired: on }).where(eq(schema.organizations.id, organizationId));
}
