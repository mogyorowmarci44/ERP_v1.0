/**
 * v7.2.0 – Mentés gombbal a fájltárolóba (Neon Object Storage): az ügyfélfiók összes (nem archivált) cégének teljes mentése,
 * cégenként a legutóbbi KEEP darab megtartásával. Időzítő nincs – az Admin › Mentés oldalon a „Mentés most” gomb indítja.
 * A mentésfájl ugyanaz a .json.gz, amit a letöltés ad, így a meglévő visszaállítással visszatölthető.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { backupToGzip, buildBackup } from "@/lib/backup";
import { deleteObject, fileStoreConfigured, getObjectBuffer, listObjects, putBuffer } from "@/lib/file-store";
import { backupKey, pruneList, backupPrefix, parseBackupKey } from "@/lib/cloud-backup-calc";

export const KEEP = 12;

export type CloudBackupResult = { companies: number; bytes: number; pruned: number; errors: string[] };

export async function cloudBackupAll(organizationId: number): Promise<CloudBackupResult> {
  if (!fileStoreConfigured()) throw new Error("A fájltároló nincs beállítva (FILES_BUCKET, AWS_… környezeti változók).");
  const cos = await db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies)
    .where(and(eq(schema.companies.organizationId, organizationId), isNull(schema.companies.archivedAt))).orderBy(asc(schema.companies.id));
  const res: CloudBackupResult = { companies: 0, bytes: 0, pruned: 0, errors: [] };
  const now = new Date();
  for (const c of cos) {
    try {
      const gz = backupToGzip(await buildBackup(c.id));
      await putBuffer(backupKey(organizationId, c.id, now), gz, "application/gzip");
      await db.update(schema.companies).set({ lastFullExportAt: now }).where(eq(schema.companies.id, c.id));
      res.companies++;
      res.bytes += gz.length;
      const old = pruneList((await listObjects(`${backupPrefix(organizationId)}c${c.id}/`)).map((o) => o.key), KEEP);
      for (const k of old) { await deleteObject(k); res.pruned++; }
    } catch (e) {
      res.errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  return res;
}

export async function listCloudBackups(organizationId: number) {
  if (!fileStoreConfigured()) return [];
  return (await listObjects(backupPrefix(organizationId)))
    .map((o) => ({ ...o, ...parseBackupKey(o.key) }))
    .filter((o) => o.companyId)
    .sort((a, b) => b.key.localeCompare(a.key));
}

/** Egy mentés letöltése – csak a saját ügyfélfiók előtagja alól. */
export async function readCloudBackup(organizationId: number, key: string): Promise<Buffer> {
  if (!key.startsWith(backupPrefix(organizationId)) || key.includes("..")) throw new Error("Nincs ilyen mentés.");
  return getObjectBuffer(key);
}
