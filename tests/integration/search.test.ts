/** v7.4.0 – globális kereső: csak a saját cégekben, feltöltő szerep és rejtett modul nélkül; összegre is. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("globális kereső", () => {
  it("találatok, elkülönítés, szerepek", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, and } = await import("drizzle-orm");
    const D = await import("@/lib/demo");
    const S = await import("@/lib/search");
    const mk = async (n: string) => (await db.insert(schema.users).values({ email: `${n}${Date.now()}${Math.random()}@t.local`, name: n, passwordHash: "x" }).returning())[0];
    const a = await mk("a"), b = await mk("b");
    const { id: cid } = await D.createDemoCompany(a.id);
    await db.insert(schema.vehicles).values({ companyId: cid, make: "Suzuki", model: "Vitara", plate: "ABC-123" });

    const r1 = await S.globalSearch(a.id, "Mecsek");
    expect(r1.hits.some((h) => h.kind === "partner" && h.title.startsWith("Mecsek"))).toBe(true);
    expect(r1.hits.some((h) => h.kind === "invoice")).toBe(true);
    const r2 = await S.globalSearch(a.id, "DEMO-");
    expect(r2.hits.filter((h) => h.kind === "invoice").length).toBeGreaterThan(5);
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, cid)).limit(1);
    const r3 = await S.globalSearch(a.id, String(Math.round(Number(inv.grossHuf))));
    expect(r3.hits.some((h) => h.href.endsWith(`/invoices/${inv.id}`))).toBe(true);
    // gépkocsi csak ha a modul látható – a demó (szolgáltató) profilnál alapból ki van kapcsolva
    expect((await S.globalSearch(a.id, "ABC-123")).hits.some((h) => h.kind === "vehicle")).toBe(false);
    const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
    await db.update(schema.companies).set({ settings: { ...c.settings, modules: { ...(c.settings as { modules?: object }).modules, vehicles: true } } as never }).where(eq(schema.companies.id, cid));
    expect((await S.globalSearch(a.id, "abc-123")).hits.some((h) => h.kind === "vehicle")).toBe(true);
    await db.update(schema.memberships).set({ hiddenModules: ["vehicles"] }).where(and(eq(schema.memberships.userId, a.id), eq(schema.memberships.companyId, cid)));
    expect((await S.globalSearch(a.id, "abc-123")).hits.some((h) => h.kind === "vehicle")).toBe(false);

    // másik felhasználó nem lát semmit; feltöltőként sem
    expect((await S.globalSearch(b.id, "Mecsek")).hits).toHaveLength(0);
    await db.insert(schema.memberships).values({ userId: b.id, companyId: cid, role: "uploader" });
    expect((await S.globalSearch(b.id, "Mecsek")).hits).toHaveLength(0);
    await db.update(schema.memberships).set({ role: "viewer" }).where(and(eq(schema.memberships.userId, b.id), eq(schema.memberships.companyId, cid)));
    expect((await S.globalSearch(b.id, "Mecsek")).hits.length).toBeGreaterThan(0);
    expect((await S.globalSearch(a.id, "x")).hits).toHaveLength(0);
  });
});
