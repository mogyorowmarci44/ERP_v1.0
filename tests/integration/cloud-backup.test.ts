/** v7.2.0 – Mentés gombbal a tárolóba: minden cég mentése, listázás, letöltés csak a saját fiókból, visszaállítható formátum. */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;
const s3 = process.env.S3_TEST_ENDPOINT;

describe.skipIf(!url || !s3)("mentés a tárolóba", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    Object.assign(process.env, { FILES_BUCKET: "erp-test", AWS_ENDPOINT_URL_S3: s3, AWS_REGION: "eu-central-1", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" });
    const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
    await new S3Client({ region: "eu-central-1", endpoint: s3, forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } })
      .send(new CreateBucketCommand({ Bucket: "erp-test" })).catch(() => undefined);
  });

  it("két cég, két mentés, letöltés és visszaolvasás", async () => {
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const L = await import("@/lib/ledger");
    const CB = await import("@/lib/cloud-backup");
    const B = await import("@/lib/backup");
    const [u] = await db.insert(schema.users).values({ email: `cb-${Date.now()}@test.local`, name: "CB", passwordHash: "x" }).returning();
    const c1 = await L.createCompany(u.id, { name: `CB Egy Kft ${Date.now()}` } as never);
    const [me] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    const org = me.organizationId!;
    const c2 = await L.createCompany(u.id, { name: `CB Kettő Kft ${Date.now()}` } as never);

    const r1 = await CB.cloudBackupAll(org);
    expect(r1).toMatchObject({ companies: 2, errors: [] });
    await new Promise((r) => setTimeout(r, 1100)); // eltérő időbélyeg
    await CB.cloudBackupAll(org);
    const list = await CB.listCloudBackups(org);
    expect(list.filter((x) => x.companyId === c1.id)).toHaveLength(2);
    expect(list.filter((x) => x.companyId === c2.id)).toHaveLength(2);

    const buf = await CB.readCloudBackup(org, list[0].key);
    const b = B.parseBackup(buf);
    expect([c1.id, c2.id]).toContain(b.company.id);
    await expect(CB.readCloudBackup(org + 999, list[0].key)).rejects.toThrow(/Nincs ilyen mentés/);
    await expect(CB.readCloudBackup(org, `backups/o${org}/../o1/x`)).rejects.toThrow(/Nincs ilyen mentés/);
    const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, c1.id));
    expect(c.lastFullExportAt).not.toBeNull();
  });
});
