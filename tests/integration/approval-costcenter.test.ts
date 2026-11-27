/** v7.5.0 – jóváhagyás kifizetés előtt (kézi és banki rendezésnél is) és költséghelyek a könyvelésben. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("jóváhagyás és költséghely", () => {
  it("jóváhagyás nélkül nem fizethető; költséghely a naplóban és a kimutatásban", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, and } = await import("drizzle-orm");
    const L = await import("@/lib/ledger");
    const CC = await import("@/lib/cost-centers");
    const [u] = await db.insert(schema.users).values({ email: `ap${Date.now()}@t.local`, name: "A", passwordHash: "x" }).returning();
    const co = await L.createCompany(u.id, { name: `Jóváhagyó Kft ${Date.now()}` } as never);
    const cid = (co as { id: number }).id;
    const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
    await db.update(schema.companies).set({ settings: { ...c.settings, approval: { on: true, threshold: 100000 } } }).where(eq(schema.companies.id, cid));
    const [cc] = await db.insert(schema.costCenters).values({ companyId: cid, code: "SZIG", name: "Szigetvár" }).returning();
    const [p] = await db.insert(schema.partners).values({ companyId: cid, name: "Szállító Kft" }).returning();
    const vat = (await db.select().from(schema.vatCodes).where(and(eq(schema.vatCodes.companyId, cid), eq(schema.vatCodes.code, "27"))))[0].id;
    const acc = (code: string) => L.accountIdByCode(db, cid, code);
    const mk = async (no: string, price: number) => {
      const id = await L.saveInvoiceDraft(cid, { direction: "in", partnerId: p.id, invoiceNumber: no, issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", dueDate: "2026-11-10", paymentMethod: "transfer", currency: "HUF", exchangeRate: 1,
        lines: [{ description: "Bérleti díj", quantity: 1, unitPrice: price, vatCodeId: vat, accountId: await acc("522"), costCenterId: cc.id }] });
      await L.postInvoice(cid, id, u.id);
      return id;
    };
    const big = await mk("B-1", 200000), small = await mk("B-2", 50000);
    const pay = (id: number, amt: number) => L.payInvoice(cid, id, { date: "2026-11-05", moneyAccountId: 0, amountFx: amt } as never, u.id);
    const bank = await acc("384");
    await expect(L.payInvoice(cid, big, { date: "2026-11-05", moneyAccountId: bank, amountFx: 254000 }, u.id)).rejects.toThrow(/jóváhagyásra vár/);
    await expect(L.payInvoice(cid, small, { date: "2026-11-05", moneyAccountId: bank, amountFx: 63500 }, u.id)).resolves.toBeTruthy();
    await db.update(schema.invoices).set({ approvedAt: new Date(), approvedBy: u.id }).where(eq(schema.invoices.id, big));
    await expect(L.payInvoice(cid, big, { date: "2026-11-05", moneyAccountId: bank, amountFx: 254000 }, u.id)).resolves.toBeTruthy();
    void pay;

    // költséghely: a költségsoron rajta van, a kimutatás összesen = könyvelés szerinti eredmény
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, big));
    const jl = await db.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, inv.journalEntryId!));
    expect(jl.find((l) => Number(l.debit) === 200000)?.costCenterId).toBe(cc.id);
    const r = await CC.costCenterResults(cid, "2026-01-01", "2026-12-31");
    expect(r.find((x) => x.id === cc.id)).toMatchObject({ code: "SZIG", cost: 250000, revenue: 0, result: -250000 });

    // idegen költséghely tiltva
    const co2 = await L.createCompany(u.id, { name: `Másik Kft ${Date.now()}` } as never);
    const [cc2] = await db.insert(schema.costCenters).values({ companyId: (co2 as { id: number }).id, code: "X", name: "X" }).returning();
    await expect(L.saveInvoiceDraft(cid, { direction: "in", partnerId: p.id, invoiceNumber: "B-3", issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", dueDate: "2026-11-10", paymentMethod: "transfer", currency: "HUF", exchangeRate: 1,
      lines: [{ description: "x", quantity: 1, unitPrice: 1000, vatCodeId: vat, accountId: await acc("522"), costCenterId: cc2.id }] })).rejects.toThrow(/Ismeretlen költséghely/);
  });
});
