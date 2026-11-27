import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** v7.2.0 – tárolóbeli mentés letöltése (csak a saját ügyfélfiókét). */
export async function GET(req: Request) {
  const me = await requireAdmin();
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!me.organizationId) return new Response("Nincs ügyfélfiók.", { status: 404 });
  const { readCloudBackup } = await import("@/lib/cloud-backup");
  let buf: Buffer;
  try { buf = await readCloudBackup(me.organizationId, key); } catch { return new Response("Nincs ilyen mentés.", { status: 404 }); }
  await audit({ action: "backup.download", organizationId: me.organizationId, details: { key, bytes: buf.length } });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${key.split("/").slice(-2).join("_")}"`, "Cache-Control": "no-store" },
  });
}
