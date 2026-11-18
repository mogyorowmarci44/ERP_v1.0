import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/** Kötelező-e a kétlépcsős azonosítás az egész rendszerben (alapértelmezés: igen). */
export async function mfaRequired(): Promise<boolean> {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "mfaRequired"));
  return r ? r.value !== false : true;
}

export async function setMfaRequired(on: boolean) {
  await db.insert(schema.appSettings).values({ key: "mfaRequired", value: on })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: on, updatedAt: new Date() } });
}
