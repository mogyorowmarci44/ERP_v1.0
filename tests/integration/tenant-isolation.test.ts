/** v7.0.0 – adatelkülönítés: egy cég tétele nem hivatkozhat másik cég adatára (alkalmazás- és adatbázis-szinten sem). */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;
const crossRef = (e: unknown) => /Cégek közötti hivatkozás/.test(String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message));

describe.skipIf(!url)("adatelkülönítés", () => {
  it("idegen partner, főkönyvi számla, gépkocsi, pénzszámla, napló-hivatkozás tiltva", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const L = await import("@/lib/ledger");
    const mk = async (n: string) => {
      const [u] = await db.insert(schema.users).values({ email: `${n}${Date.now()}${Math.random()}@t.local`, name: n, passwordHash: "x" }).returning();
      const c = await L.createCompany(u.id, { name: `${n} Kft ${Date.now()}` } as never);
      return { u, cid: (c as { id: number }).id };
    };
    const A = await mk("A"), B = await mk("B");
    const acc = (cid: number, code: string) => L.accountIdByCode(db, cid, code);
    const vat = async (cid: number) => (await db.select().from(schema.vatCodes).where(and(eq(schema.vatCodes.companyId, cid), eq(schema.vatCodes.code, "27"))))[0].id;
    const [pa] = await db.insert(schema.partners).values({ companyId: A.cid, name: "A partner" }).returning();
    const [pb] = await db.insert(schema.partners).values({ companyId: B.cid, name: "B partner" }).returning();
    const [vb] = await db.insert(schema.vehicles).values({ companyId: B.cid, make: "X", model: "Y" }).returning();
    const base = { direction: "out" as const, invoiceNumber: `T-${Date.now()}`, issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", dueDate: "2026-11-10", paymentMethod: "transfer" as const, currency: "HUF", exchangeRate: 1 };
    const line = async (accountCid: number, extra: object = {}) => ({ description: "x", quantity: 1, unitPrice: 1000, vatCodeId: await vat(A.cid), accountId: await acc(accountCid, "913"), ...extra });

    // alkalmazás-szint
    await expect(L.saveInvoiceDraft(A.cid, { ...base, partnerId: pb.id, lines: [await line(A.cid)] })).rejects.toThrow(/partner nem található/);
    await expect(L.saveInvoiceDraft(A.cid, { ...base, partnerId: pa.id, lines: [await line(B.cid)] })).rejects.toThrow(/Ismeretlen főkönyvi számla/);
    await expect(L.saveInvoiceDraft(A.cid, { ...base, partnerId: pa.id, lines: [await line(A.cid, { vehicleId: vb.id })] })).rejects.toThrow(/Ismeretlen gépkocsi/);
    await expect(L.saveInvoiceDraft(A.cid, { ...base, partnerId: pa.id, lines: [{ ...(await line(A.cid)), vatCodeId: await vat(B.cid) }] })).rejects.toThrow(/ÁFA-kód/);
    await expect(L.manualEntry(A.cid, { journalCode: "VE", date: "2026-11-02", description: "x", lines: [
      { accountId: await acc(B.cid, "384"), debit: 1, credit: 0 }, { accountId: await acc(A.cid, "911"), debit: 0, credit: 1 },
    ] }, A.u.id)).rejects.toThrow();
    const inv = await L.saveInvoiceDraft(A.cid, { ...base, partnerId: pa.id, lines: [await line(A.cid)] });
    await L.postInvoice(A.cid, inv, A.u.id);
    await expect(L.payInvoice(A.cid, inv, { date: "2026-11-05", moneyAccountId: await acc(B.cid, "384"), amountFx: 1270 }, A.u.id)).rejects.toThrow();
    await expect(L.payInvoice(B.cid, inv, { date: "2026-11-05", moneyAccountId: await acc(B.cid, "384"), amountFx: 1270 }, B.u.id)).rejects.toThrow();

    // adatbázis-szint (ha az alkalmazás hibázna)
    const [e] = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, A.cid)).limit(1);
    await expect(db.insert(schema.journalLines).values({ entryId: e.id, companyId: A.cid, accountId: await acc(B.cid, "384"), debit: 0, credit: 0 })).rejects.toSatisfy(crossRef);
    await expect(db.insert(schema.journalLines).values({ entryId: e.id, companyId: B.cid, accountId: await acc(B.cid, "384"), debit: 0, credit: 0 })).rejects.toSatisfy(crossRef);
    await expect(db.update(schema.invoices).set({ partnerId: pb.id }).where(eq(schema.invoices.id, inv))).rejects.toSatisfy(crossRef);
    const [il] = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv));
    await expect(db.update(schema.invoiceLines).set({ vehicleId: vb.id }).where(eq(schema.invoiceLines.id, il.id))).rejects.toSatisfy(crossRef);
    await expect(db.insert(schema.payments).values({ companyId: B.cid, invoiceId: inv, date: "2026-11-05", amountHuf: "1", moneyAccountId: await acc(B.cid, "384") } as never)).rejects.toSatisfy(crossRef);
  });
});
