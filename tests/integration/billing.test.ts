/** v6.8.0 – Stripe webhook-feldolgozás és a hozzáférés (írható / csak olvasható) az ügyfélfiókon. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("előfizetés (Stripe webhook)", () => {
  it("checkout → aktív, elmaradt fizetés → türelmi idő, lemondás → csak olvasható; esemény csak egyszer", async () => {
    process.env.DATABASE_URL = url;
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const B = await import("@/lib/billing");
    const Stripe = (await import("stripe")).default;
    const [org] = await db.insert(schema.organizations).values({ name: `Bill ${Date.now()}`, ...B.trialStart(14) }).returning();
    const [plan] = await db.insert(schema.plans).values({ code: `p${Date.now()}`, name: "Alap", priceHuf: 9900, stripePriceId: `price_T${Date.now()}`, maxCompanies: 1 }).returning();
    expect((await B.orgAccess(org.id)).writable).toBe(true);
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const sub = (status: string, extra = {}) => ({ id: "sub_1", object: "subscription", status, customer: "cus_1", metadata: { organizationId: String(org.id) }, cancel_at_period_end: false, items: { data: [{ current_period_end: end, price: { id: plan.stripePriceId } }] }, ...extra });
    const ev = (id: string, type: string, object: unknown) => ({ id, type, data: { object } }) as never;

    // aláírás-ellenőrzés (offline)
    const s = new Stripe("sk_test_dummy");
    const payload = JSON.stringify({ id: "evt_sig", type: "ping", data: { object: {} } });
    const header = s.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
    expect(s.webhooks.constructEvent(payload, header, "whsec_test").id).toBe("evt_sig");
    expect(() => s.webhooks.constructEvent(payload, header, "whsec_masik")).toThrow();

    const r1 = await B.handleStripeEvent(ev(`evt_a${org.id}`, "checkout.session.completed", { mode: "subscription", subscription: "sub_1" }), async () => sub("active") as never);
    expect(r1).toMatchObject({ ok: true, status: "active" });
    let [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, org.id));
    expect(o).toMatchObject({ subStatus: "active", planId: plan.id, stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" });
    expect(Math.round(o.currentPeriodEnd!.getTime() / 1000)).toBe(end);
    // ugyanaz az esemény másodszor: kihagyva
    expect(await B.handleStripeEvent(ev(`evt_a${org.id}`, "checkout.session.completed", {}), async () => { throw new Error("nem hívható"); })).toEqual({ skipped: true });

    await B.handleStripeEvent(ev(`evt_b${org.id}`, "customer.subscription.updated", sub("past_due")));
    [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, org.id));
    expect(o.subStatus).toBe("past_due");
    expect(o.pastDueSince).toBeTruthy();
    expect((await B.orgAccess(org.id))).toMatchObject({ writable: true, warn: true });

    await B.handleStripeEvent(ev(`evt_c${org.id}`, "customer.subscription.deleted", sub("canceled")));
    expect((await B.orgAccess(org.id)).writable).toBe(false);
    [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, org.id));
    expect(o.stripeSubscriptionId).toBeNull();

    // cégszám-korlát a csomag szerint
    const [u] = await db.insert(schema.users).values({ email: `b${Date.now()}@t.local`, name: "B", passwordHash: "x", organizationId: org.id }).returning();
    const L = await import("@/lib/ledger");
    await L.createCompany(u.id, { name: `Bill Kft ${Date.now()}` } as never);
    await expect(B.assertCompanyLimit(org.id)).rejects.toThrow(/legfeljebb 1 céget/);
  }, 60_000);
});
