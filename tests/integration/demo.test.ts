/** v6.12.0 – bemutató cég: kiegyensúlyozott könyvelés, nyitott tételek, nem számít a keretbe. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("bemutató cég", () => {
  it("létrehozás mintaadatokkal", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, sql } = await import("drizzle-orm");
    const D = await import("@/lib/demo");
    const B = await import("@/lib/billing");
    const [u] = await db.insert(schema.users).values({ email: `demo${Date.now()}@t.local`, name: "D", passwordHash: "x" }).returning();
    const { id } = await D.createDemoCompany(u.id);
    const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
    expect(D.isDemo(c)).toBe(true);
    expect(await D.demoCompanyOf(c.organizationId)).toBe(id);
    const [bal] = (await db.execute(sql`select sum(debit)::float8 d, sum(credit)::float8 k, count(*)::int n from journal_lines where company_id = ${id}`)) as unknown as Array<{ d: number; k: number; n: number }>;
    expect(bal.n).toBeGreaterThan(40);
    expect(Math.abs(bal.d - bal.k)).toBeLessThan(0.01);
    const inv = (await db.execute(sql`select direction, status, count(*)::int n from invoices where company_id = ${id} group by 1, 2`)) as unknown as Array<{ direction: string; status: string; n: number }>;
    expect(inv.find((r) => r.direction === "out")?.n).toBe(10);
    const { openItems } = await import("@/lib/reports");
    expect((await openItems(id, "out")).length).toBe(3);
    // a cégszám-keretbe nem számít bele (1 cég engedélyezett, a bemutató mellett még egy létrehozható)
    const [plan] = await db.insert(schema.plans).values({ code: `demo${Date.now()}`, name: "Mini", priceHuf: 1, maxCompanies: 1 }).returning();
    await db.update(schema.organizations).set({ planId: plan.id, subStatus: "active" }).where(eq(schema.organizations.id, c.organizationId!));
    await expect(B.assertCompanyLimit(c.organizationId)).resolves.toBeUndefined();
  });
});
