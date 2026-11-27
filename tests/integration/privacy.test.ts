/** v7.6.0 – GDPR: saját adatok exportja, fióktörlés (álnevesítés) feltételekkel, ügyfélfiók megszüntetése. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("adatkérés és -törlés", () => {
  it("export, akadályok, álnevesítés, megszüntetés", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, and, count } = await import("drizzle-orm");
    const L = await import("@/lib/ledger");
    const P = await import("@/lib/privacy");
    const { audit } = await import("@/lib/audit");
    const stamp = Date.now();
    const [owner] = await db.insert(schema.users).values({ email: `own${stamp}@t.local`, name: "Tulaj Tamás", passwordHash: "x" }).returning();
    const co = await L.createCompany(owner.id, { name: `GDPR Kft ${stamp}` } as never);
    const cid = (co as { id: number }).id;
    const [o2] = await db.select().from(schema.users).where(eq(schema.users.id, owner.id));
    const org = o2.organizationId!;
    await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, owner.id));
    const [acc] = await db.insert(schema.users).values({ email: `acc${stamp}@t.local`, name: "Könyvelő Kata", passwordHash: "x", organizationId: org }).returning();
    await db.insert(schema.memberships).values({ userId: acc.id, companyId: cid, role: "accountant" });
    await audit({ action: "login.ok", user: { id: acc.id, email: acc.email, organizationId: org } });

    const ex = await P.exportUserData(acc.id);
    expect(ex.account).toMatchObject({ email: acc.email, name: "Könyvelő Kata" });
    expect(ex.memberships).toEqual([expect.objectContaining({ companyId: cid, role: "accountant" })]);
    expect(ex.activity.length).toBeGreaterThan(0);
    expect(JSON.stringify(ex)).not.toContain("passwordHash");

    // a tulajdonos most nem törölhető (egyedüli tulajdonos, más is dolgozik; egyedüli admin)
    const bl = await P.deletionBlockers(owner.id);
    expect(bl.join(" ")).toMatch(/egyetlen tulajdonos/);
    expect(bl.join(" ")).toMatch(/egyetlen adminja/);
    // a könyvelő törölheti magát
    expect(await P.deletionBlockers(acc.id)).toEqual([]);
    await P.deleteOwnAccount(acc.id);
    const [a2] = await db.select().from(schema.users).where(eq(schema.users.id, acc.id));
    expect(a2).toMatchObject({ email: P.anonEmail(acc.id), name: "Törölt felhasználó", totpSecret: null });
    expect((await db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.userId, acc.id)))[0].n).toBe(0);
    const logs = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, acc.id));
    expect(logs.every((l) => l.userEmail === P.anonEmail(acc.id))).toBe(true);
    // most már a tulajdonos maradt egyedül: csak a cég törlése után
    expect((await P.deletionBlockers(owner.id)).join(" ")).toMatch(/rajtad kívül senki/);

    // ügyfélfiók: amíg van cég, nem szüntethető meg
    await expect(P.closeOrganization(org)).rejects.toThrow(/még 1 cég van/);
    await db.delete(schema.companies).where(eq(schema.companies.id, cid));
    await P.closeOrganization(org);
    const [o3] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, org));
    expect(o3).toMatchObject({ subStatus: "canceled", name: `Megszüntetett ügyfélfiók #${org}` });
    const [ow] = await db.select().from(schema.users).where(and(eq(schema.users.id, owner.id)));
    expect(ow.email).toBe(P.anonEmail(owner.id));
  });
});
