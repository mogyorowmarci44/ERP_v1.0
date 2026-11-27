import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * v6.7.0 – Bizonylatfájlok külön fájltárolóban (Neon Object Storage, S3-kompatibilis).
 *
 * Beállítás (Render környezeti változók): FILES_BUCKET, AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
 * Ha nincs beállítva, minden a régi módon az adatbázisban marad (base64). Beállítás után az új fájlok a tárolóba kerülnek,
 * a meglévőket a `db:migrate` (telepítéskor) átköltözteti. Az adatbázisban a fájl helye (storage_key) marad.
 * A kis fájlok (a banki letöltések JSON-jai) szándékosan az adatbázisban maradnak – gyakran olvassuk őket.
 */
const SMALL = 16_000; // base64 karakter (~12 kB) alatt nem költöztetjük

let client: S3Client | null = null;
export const fileStoreConfigured = () =>
  !!(process.env.FILES_BUCKET && process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

function s3() {
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_REGION || "eu-central-1",
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }
  return client;
}
const bucket = () => process.env.FILES_BUCKET!;

export const docKey = (companyId: number, id: number, sha: string) => `c${companyId}/inbox/${id}-${sha.slice(0, 16)}`;

export async function putObject(key: string, base64: string, mime: string) {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: Buffer.from(base64, "base64"), ContentType: mime }));
}
export async function getObjectBase64(key: string): Promise<string> {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray()).toString("base64");
}
export async function putBuffer(key: string, body: Buffer, mime: string) {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mime }));
}
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
/** v7.2.0 – a tároló objektumai egy előtag alatt (lapozva). */
export async function listObjects(prefix: string): Promise<Array<{ key: string; size: number; at: Date | null }>> {
  const out: Array<{ key: string; size: number; at: Date | null }> = [];
  let token: string | undefined;
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0), at: o.LastModified ?? null });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** A bizonylat fájlja base64-ben – akár az adatbázisban, akár a tárolóban van. */
export async function docData(d: { data: string | null; storageKey: string | null }): Promise<string> {
  if (d.data != null) return d.data;
  if (!d.storageKey) throw new Error("A bizonylat fájlja hiányzik.");
  if (!fileStoreConfigured()) throw new Error("A bizonylat a fájltárolóban van, de a tároló nincs beállítva (FILES_BUCKET, AWS_*).");
  return getObjectBase64(d.storageKey);
}

const shouldOffload = (d: { data: string | null; sourceRef: string }) => d.data != null && d.data.length >= SMALL && !d.sourceRef.startsWith("bank:");

/** Egy bizonylat kiköltöztetése a tárolóba (ha be van állítva és érdemes). */
export async function offloadDoc(id: number) {
  if (!fileStoreConfigured()) return false;
  const [d] = await db.select().from(schema.inboxDocuments).where(eq(schema.inboxDocuments.id, id));
  if (!d || !shouldOffload(d)) return false;
  const key = docKey(d.companyId, d.id, d.sha256);
  await putObject(key, d.data!, d.mime);
  await db.update(schema.inboxDocuments).set({ storageKey: key, data: null }).where(and(eq(schema.inboxDocuments.id, id), isNull(schema.inboxDocuments.storageKey)));
  return true;
}

/** A meglévő nagy fájlok átköltöztetése (telepítéskor fut, idempotens; csomagokban). */
export async function offloadAll(limit = 5_000): Promise<number> {
  if (!fileStoreConfigured()) return 0;
  const ids = await db
    .select({ id: schema.inboxDocuments.id })
    .from(schema.inboxDocuments)
    .where(and(isNull(schema.inboxDocuments.storageKey), isNotNull(schema.inboxDocuments.data), sql`length(${schema.inboxDocuments.data}) >= ${SMALL}`, sql`${schema.inboxDocuments.sourceRef} not like 'bank:%'`))
    .limit(limit);
  let n = 0;
  for (const { id } of ids) if (await offloadDoc(id)) n++;
  return n;
}

/** Egy cég tárolóbeli fájljainak kulcsai (törlés előtt kell összegyűjteni). */
export async function companyFileKeys(companyId: number): Promise<string[]> {
  const rows = await db.select({ key: schema.inboxDocuments.storageKey }).from(schema.inboxDocuments)
    .where(and(eq(schema.inboxDocuments.companyId, companyId), isNotNull(schema.inboxDocuments.storageKey)));
  return rows.map((r) => r.key!);
}

/** Tárolóbeli fájlok törlése (a sorok sikeres törlése után). */
export async function deleteKeys(keys: string[]) {
  if (!fileStoreConfigured()) return 0;
  for (const k of keys) await deleteObject(k).catch(() => undefined);
  return keys.length;
}

/** Mentéshez: a tárolóbeli fájlok tartalma visszakerül a sorokba (a mentés önálló marad). */
export async function inlineStoredFiles(rows: Record<string, unknown>[]) {
  const keyed = rows.filter((r) => r.storage_key && r.data == null);
  for (const r of keyed) {
    r.data = await getObjectBase64(String(r.storage_key));
    r.storage_key = null;
  }
}

