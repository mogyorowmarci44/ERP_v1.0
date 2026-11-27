/**
 * v6.7.0 – Fájltároló: új bizonylat a tárolóba kerül, olvasható, mentésbe visszakerül, cégtörléskor törlődik.
 * Futtatás: TEST_DATABASE_URL és S3_TEST_ENDPOINT (pl. moto_server) mellett.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;
const s3 = process.env.S3_TEST_ENDPOINT;

describe.skipIf(!url || !s3)("fájltároló (S3-kompatibilis)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    Object.assign(process.env, { FILES_BUCKET: "erp-test", AWS_ENDPOINT_URL_S3: s3, AWS_REGION: "eu-central-1", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" });
    const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
    await new S3Client({ region: "eu-central-1", endpoint: s3, forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } })
      .send(new CreateBucketCommand({ Bucket: "erp-test" })).catch(() => undefined);
  });

  it("feltöltés → tároló, olvasás, mentés, törlés", async () => {
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const L = await import("@/lib/ledger");
    const svc = await import("@/lib/inbox/service");
    const FS = await import("@/lib/file-store");
    const B = await import("@/lib/backup");
    const { wipeCompanyData } = await import("@/lib/importer");
    const [u] = await db.insert(schema.users).values({ email: `fs-${Date.now()}@test.local`, name: "FS", passwordHash: "x" }).returning();
    const co = await L.createCompany(u.id, { name: `FS Kft ${Date.now()}` } as never);
    const big = Buffer.alloc(40_000, 7).toString("base64");
    const id = (await svc.addDocument(co.id, { source: "upload", sourceRef: `up:${Date.now()}`, kind: "invoice", filename: "szamla.pdf", mime: "application/pdf", data: big }))!;
    const small = (await svc.addDocument(co.id, { source: "upload", sourceRef: `up2:${Date.now()}`, kind: "invoice", filename: "kicsi.xml", mime: "text/xml", data: Buffer.from("<a/>").toString("base64") }))!;
    const [d] = await db.select().from(schema.inboxDocuments).where(eq(schema.inboxDocuments.id, id));
    expect(d.data).toBeNull();
    expect(d.storageKey).toMatch(new RegExp(`^c${co.id}/inbox/${id}-`));
    expect(await FS.docData(d)).toBe(big);
    const [s] = await db.select().from(schema.inboxDocuments).where(eq(schema.inboxDocuments.id, small));
    expect(s.storageKey).toBeNull(); // kis fájl az adatbázisban marad
    const b = await B.buildBackup(co.id);
    const row = b.tables.inbox_documents.find((r) => r.id === id)!;
    expect(row.data).toBe(big);
    expect(row.storage_key).toBeNull();
    const keys = await FS.companyFileKeys(co.id);
    expect(keys).toHaveLength(1);
    await wipeCompanyData(co.id);
    await expect(FS.getObjectBase64(keys[0])).rejects.toThrow();
    // visszaállítás után ismét a tárolóba kerül
    await db.delete(schema.companies).where(eq(schema.companies.id, co.id));
    await B.restoreBackup(b, { organizationId: (await db.select().from(schema.users).where(eq(schema.users.id, u.id)))[0].organizationId!, userId: u.id });
    const [d2] = await db.select().from(schema.inboxDocuments).where(eq(schema.inboxDocuments.id, id));
    expect(d2.storageKey).toBeTruthy();
    expect(await FS.docData(d2)).toBe(big);
  }, 60_000);
});
