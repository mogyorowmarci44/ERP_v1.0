import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getUser } from "@/lib/auth";
import { clientIp } from "@/lib/throttle";
import { formDetails, redirectOutcome, resultOutcome } from "@/lib/audit-calc";

type Actor = { id: number; email: string; organizationId: number | null };

export type AuditEntry = {
  action: string;
  ok?: boolean;
  companyId?: number | null;
  organizationId?: number | null;
  target?: string | null;
  details?: Record<string, unknown> | null;
  /** Ha nincs megadva, a bejelentkezett felhasználó (belépés előtti eseményeknél add meg kézzel). */
  user?: Actor | null;
};

/**
 * v6.0.0 – Bejegyzés a tevékenységnaplóba. Soha nem dob hibát: a napló hibája nem akaszthatja meg a munkát.
 */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    const user = e.user === undefined ? await getUser() : e.user;
    let orgId = e.organizationId ?? null;
    if (orgId == null && e.companyId) {
      const [c] = await db.select({ o: schema.companies.organizationId }).from(schema.companies).where(eq(schema.companies.id, e.companyId));
      orgId = c?.o ?? null;
    }
    if (orgId == null) orgId = user?.organizationId ?? null;
    await db.insert(schema.auditLog).values({
      organizationId: orgId,
      companyId: e.companyId ?? null,
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      action: e.action.slice(0, 64),
      ok: e.ok ?? true,
      target: e.target?.slice(0, 255) ?? null,
      details: e.details && Object.keys(e.details).length ? e.details : null,
      ip: await clientIp(),
    });
  } catch (err) {
    console.error("[audit] nem sikerült naplózni:", err);
  }
}

/**
 * Írási szerveroldali művelet naplózott futtatása. A műveletek a végén átirányítanak (siker: ?ok=…, hiba: ?error=…),
 * így az eredményt az átirányítás céljából, illetve a visszaadott { error } mezőből olvassuk ki.
 */
export async function withAudit<T>(action: string, ctx: FormData | { cid: number }, fn: () => Promise<T>): Promise<T> {
  const fd = ctx instanceof FormData ? ctx : null;
  const cid = fd ? Number(fd.get("cid") ?? fd.get("companyId")) : (ctx as { cid: number }).cid;
  const companyId = Number.isInteger(cid) && cid > 0 ? cid : null;
  const details = formDetails(fd);
  try {
    const r = await fn();
    const o = resultOutcome(r);
    await audit({ action, companyId, ok: o.ok, details: o.message ? { ...details, message: o.message } : details });
    return r;
  } catch (e) {
    const o = redirectOutcome((e as { digest?: unknown })?.digest);
    if (o) await audit({ action, companyId, ok: o.ok, details: o.message ? { ...details, message: o.message } : details });
    else {
      const message = e instanceof Error ? e.message : String(e);
      await audit({ action, companyId, ok: false, details: { ...details, message: message.slice(0, 300) } });
      // v6.0.0 – a jogosultsági hiba (pl. csak olvasható / archivált cég) ne hibaoldalt adjon: vissza az előző oldalra, hibaüzenettel
      const digest = (e as { digest?: unknown })?.digest;
      if (fd && e instanceof Error && digest === undefined) {
        const back = await sameOriginReferer();
        if (back) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
      }
    }
    throw e;
  }
}

/** Az előző oldal útvonala (csak saját oldalról; a korábbi ?ok= / ?error= nélkül). */
async function sameOriginReferer(): Promise<string | null> {
  try {
    const h = await headers();
    const ref = h.get("referer");
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!ref || !host) return null;
    const u = new URL(ref);
    if (u.host !== host) return null;
    u.searchParams.delete("ok");
    u.searchParams.delete("error");
    return u.pathname + (u.search || "");
  } catch {
    return null;
  }
}
