import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { backupToGzip, buildBackup } from "@/lib/backup";
import { today } from "@/lib/dates";

/** v6.1.0 – A cég teljes mentése (.json.gz) – tulajdonosnak vagy az ügyfélfiók adminjának. */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { role, user, support } = await requireCompany(cid);
  if (support || (role !== "owner" && !user.isAdmin)) return new Response("Teljes mentést csak a cég tulajdonosa vagy az ügyfélfiók adminja tölthet le.", { status: 403 });
  const b = await buildBackup(cid);
  const gz = backupToGzip(b);
  await db.update(schema.companies).set({ lastFullExportAt: new Date() }).where(eq(schema.companies.id, cid));
  const rows = Object.values(b.tables).reduce((s, r) => s + r.length, 0);
  await audit({ action: "backup.download", companyId: cid, details: { rows, bytes: gz.length } });
  const safe = b.company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || `ceg-${cid}`;
  return new Response(new Uint8Array(gz), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${safe}_mentes_${today()}.json.gz"`,
      "Cache-Control": "no-store",
    },
  });
}
