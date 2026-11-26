import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseBackup, restoreBackup } from "@/lib/backup";

/** v6.1.0 – Cég visszaállítása mentésből (az ügyfélfiók adminja). */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  const back = (q: string) => NextResponse.redirect(new URL(q, req.url), 303);
  try {
    const fd = await req.formData();
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) return back(`/admin/backup?error=${encodeURIComponent("Válaszd ki a mentésfájlt.")}`);
    const b = parseBackup(Buffer.from(await f.arrayBuffer()));
    const r = await restoreBackup(b, { organizationId: admin.organizationId, userId: admin.id });
    await audit({ action: "backup.restore", companyId: r.companyId, target: r.name, details: { rows: r.rows, tables: r.tables, createdAt: b.createdAt, appVersion: b.appVersion } });
    return back(`/admin/backup?ok=${encodeURIComponent(`„${r.name}” visszaállítva a ${b.createdAt.slice(0, 10)}-i mentésből (${r.rows} sor, ${r.tables} tábla) – megtalálod a Cégeim között.`)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit({ action: "backup.restore", ok: false, details: { message: msg.slice(0, 300) } });
    return back(`/admin/backup?error=${encodeURIComponent(msg)}`);
  }
}
