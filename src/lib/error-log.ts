import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fingerprint, isControlFlow } from "@/lib/error-log-calc";

/**
 * v6.7.0 – Programhiba rögzítése a hibanaplóba (azonos hiba egy sorban, számlálóval). Soha nem dob hibát.
 * Az üzemeltetői *Admin › Hibanapló* oldalon látszik.
 */
export async function recordError(e: unknown, ctx: { path?: string | null; method?: string | null; kind?: string | null; userId?: number | null; companyId?: number | null } = {}) {
  try {
    if (isControlFlow(e)) return;
    const err = e instanceof Error ? e : new Error(String(e));
    const message = err.message.slice(0, 2000) || err.name;
    const stack = err.stack?.slice(0, 6000) ?? null;
    const fp = fingerprint(message, stack, ctx.path);
    const digest = typeof (err as { digest?: unknown }).digest === "string" ? String((err as { digest?: unknown }).digest).slice(0, 64) : null;
    const upd = await db.update(schema.errorLog)
      .set({ count: sql`${schema.errorLog.count} + 1`, lastAt: new Date(), stack, digest })
      .where(and(eq(schema.errorLog.fingerprint, fp), isNull(schema.errorLog.resolvedAt)))
      .returning({ id: schema.errorLog.id });
    if (upd.length) return;
    await db.insert(schema.errorLog).values({
      fingerprint: fp, message, stack, path: ctx.path?.slice(0, 500) ?? null, method: ctx.method ?? null, kind: ctx.kind ?? null, digest,
      userId: ctx.userId ?? null, companyId: ctx.companyId ?? null,
    }).onConflictDoNothing();
    console.error(`[hibanapló] ${message}`);
  } catch (x) {
    console.error("[hibanapló] nem sikerült rögzíteni:", x, "– eredeti hiba:", e);
  }
}
