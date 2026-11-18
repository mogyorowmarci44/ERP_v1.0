/**
 * Integrációs teszt: teljes könyvelési folyamat egy friss cégen, valódi Postgres adatbázison.
 *
 * Futtatás:  TEST_DATABASE_URL=postgres://… npm run test:integration
 * (a migrációkat előtte le kell futtatni ugyanarra az adatbázisra: DATABASE_URL=… npm run db:migrate).
 * TEST_DATABASE_URL nélkül a teszt kimarad – a normál `npm test` adatbázis nélkül is fut.
 * SOHA ne az éles adatbázisra irányítsd: minden futás új tesztcéget hoz létre.
 */
import { beforeAll, describe, expect, it } from "vitest";

const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)("könyvelési folyamat (integráció)", () => {
  // a modulok csak a DATABASE_URL beállítása után tölthetők be
  let m: {
    db: typeof import("@/db"); L: typeof import("@/lib/ledger"); R: typeof import("@/lib/reports"); S: typeof import("@/lib/statements");
    A: typeof import("@/lib/assets"); P: typeof import("@/lib/payroll"); D: typeof import("@/lib/delta-import"); X: typeof import("@/lib/data-export");
    M: typeof import("@/lib/matching"); V: typeof import("@/lib/vat-closing"); AC: typeof import("@/lib/accruals"); ML: typeof import("@/lib/member-loans");
  };
  let cid = 0, userId = 0;
  const acc = (c: string) => m.db.db.transaction((tx) => m.L.accountIdByCode(tx, cid, c));
  const vat = async (c: string) => (await m.db.db.select().from(m.db.schema.vatCodes)).find((v) => v.companyId === cid && v.code === c)!.id;
  const tb = async () => m.R.trialBalance(cid, "2026-01-01", "2026-12-31");
  const bal = (rows: Awaited<ReturnType<typeof tb>>, code: string) => Math.round(rows.filter((r) => r.code === code).reduce((s, r) => s + r.closingDebit - r.closingCredit, 0) * 100) / 100;
  const partner = async (name: string, priv = false) => (await m.db.db.insert(m.db.schema.partners).values({ companyId: cid, name, isPrivatePerson: priv }).returning())[0].id;
  type L3 = [string, number, string, string, number?];
  const inv = async (direction: "in" | "out", partnerId: number, number: string, date: string, lines: L3[], extra: Record<string, unknown> = {}) => {
    const id = await m.L.saveInvoiceDraft(cid, {
      direction, partnerId, invoiceNumber: number, issueDate: date, fulfillmentDate: date, dueDate: date, paymentMethod: "transfer", currency: "HUF", exchangeRate: 1, ...extra,
      lines: await Promise.all(lines.map(async ([d, p, vc, a, v]) => ({ description: d, quantity: 1, unitPrice: p, vatCodeId: await vat(vc), accountId: await acc(a), vehicleId: v ?? null }))),
    } as never);
    await m.L.postInvoice(cid, id, userId);
    return id;
  };
  const lineOf = async (invoiceId: number) => (await m.db.db.select().from(m.db.schema.invoiceLines)).filter((l) => l.invoiceId === invoiceId);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    m = {
      db: await import("@/db"), L: await import("@/lib/ledger"), R: await import("@/lib/reports"), S: await import("@/lib/statements"),
      A: await import("@/lib/assets"), P: await import("@/lib/payroll"), D: await import("@/lib/delta-import"), X: await import("@/lib/data-export"),
      M: await import("@/lib/matching"), V: await import("@/lib/vat-closing"), AC: await import("@/lib/accruals"), ML: await import("@/lib/member-loans"),
    };
    const [u] = await m.db.db.insert(m.db.schema.users).values({ email: `it-${Date.now()}@test.local`, name: "Integrációs teszt", passwordHash: "x" }).returning();
    userId = u.id;
    const co = await m.L.createCompany(userId, { name: `IT Kft ${Date.now()}`, taxNumber: "11111111-2-11", vatPeriod: "monthly", fiscalYearStartMonth: 1 } as never);
    cid = co.id;
    await m.L.manualEntry(cid, { journalCode: "BA", date: "2026-09-01", description: "Jegyzett tőke", lines: [{ accountId: await acc("384"), debit: 3_000_000, credit: 0 }, { accountId: await acc("411"), debit: 0, credit: 3_000_000 }] }, userId);
  }, 60_000);

  it("különbözeti ÁFA: az alap csak a vételár, a hatósági díj nem", async () => {
    const seller = await partner("Eladó", true), buyer = await partner("Vevő", true), auth = await partner("Hivatal");
    const [veh] = await m.db.db.insert(m.db.schema.vehicles).values({ companyId: cid, make: "Teszt", model: "A", plate: "IT-1", vatTreatment: "margin" }).returning();
    await inv("in", seller, "AV-1", "2026-09-05", [["Vétel", 1_000_000, "KÜL27", "261", veh.id]]);
    await inv("in", auth, "HAT-1", "2026-09-06", [["Díj", 20_000, "TAH", "261", veh.id]]);
    const sale = await inv("out", buyer, "V-1", "2026-09-20", [["Eladás", 1_400_000, "KÜL27", "911", veh.id]]);
    const [l] = await lineOf(sale);
    expect(Number(l.marginPurchaseHuf)).toBe(1_000_000);
    expect(Number(l.vatHuf)).toBe(85_039);
    const t = await tb();
    expect(bal(t, "261")).toBe(0);
    expect(bal(t, "814")).toBe(1_020_000);

    // helyesbítő számla: 100 000 Ft árengedmény → az árrés 300 000, az ÁFA 63 780; nincs ELÁBÉ-mozgás
    const corr = await m.L.saveInvoiceDraft(cid, { direction: "out", partnerId: buyer, invoiceNumber: "V-1/H", issueDate: "2026-09-25", fulfillmentDate: "2026-09-25", dueDate: null, paymentMethod: "transfer", currency: "HUF", exchangeRate: 1, correctsInvoiceId: sale,
      lines: [{ description: "Árengedmény", quantity: 1, unitPrice: -100_000, vatCodeId: await vat("KÜL27"), accountId: await acc("911"), vehicleId: veh.id }] });
    await m.L.postInvoice(cid, corr, userId);
    const [cl] = await lineOf(corr);
    expect(Number(cl.vatHuf)).toBe(Math.round(300_000 * 27 / 127) - 85_039);
    expect(bal(await tb(), "814")).toBe(1_020_000);
    await expect(m.L.cancelInvoice(cid, sale, "2026-09-30", userId)).rejects.toThrow(/helyesbítő/);

    // beszámítás: a vevőszámla (1 400 000) és a jóváírás (−100 000), majd a maradék befizetése
    await m.M.offsetInvoices(cid, sale, corr, "2026-09-26", null, userId);
    expect((await m.db.db.transaction((tx) => m.L.invoiceOpenAmount(tx, corr))).openFx).toBe(0);
    await m.L.payInvoice(cid, sale, { date: "2026-09-27", moneyAccountId: await acc("384"), amountFx: 1_300_000 }, userId);
    expect((await m.db.db.transaction((tx) => m.L.invoiceOpenAmount(tx, sale))).openFx).toBe(0);
    expect(bal(await tb(), "311")).toBe(0);
  });

  it("devizás számla árfolyam-különbözettel, sztornók, túlfizetés", async () => {
    const eu = (await m.db.db.insert(m.db.schema.partners).values({ companyId: cid, name: "EU GmbH", country: "DE" }).returning())[0].id;
    const id = await inv("in", eu, "EU-1", "2026-10-05", [["Fuvar", 100, "FAD27", "261"]], { currency: "EUR", exchangeRate: 400, rateManual: true });
    await m.L.payInvoice(cid, id, { date: "2026-10-10", moneyAccountId: await acc("384"), amountFx: 100, moneyHuf: 41_000 }, userId);
    const t = await tb();
    expect(bal(t, "876")).toBe(1_000);
    expect(bal(t, "455")).toBe(0);
    await expect(m.L.payInvoice(cid, id, { date: "2026-10-11", moneyAccountId: await acc("384"), amountFx: 1, moneyHuf: 400 }, userId)).rejects.toThrow();
    const shop = await partner("Bolt");
    const s1 = await inv("in", shop, "B-1", "2026-10-12", [["Téves", 5_000, "27", "529"]]);
    await m.L.payInvoice(cid, s1, { date: "2026-10-12", moneyAccountId: await acc("384"), amountFx: 6_350 }, userId);
    await expect(m.L.cancelInvoice(cid, s1, "2026-10-13", userId)).rejects.toThrow(/rendezés/);
    const [p] = (await m.db.db.select().from(m.db.schema.payments)).filter((x) => x.invoiceId === s1);
    await m.L.reversePayment(cid, p.id, "2026-10-13", userId);
    await m.L.cancelInvoice(cid, s1, "2026-10-13", userId);
  });

  it("párosítás kézi banki tétellel", async () => {
    const shop = await partner("Szolgáltató");
    const id = await inv("in", shop, "SZ-1", "2026-10-03", [["Könyvelés", 10_000, "27", "529"]]);
    const e = await m.L.manualEntry(cid, { journalCode: "BA", date: "2026-10-04", description: "Utalás Szolgáltató", lines: [{ accountId: await acc("454"), debit: 12_700, credit: 0 }, { accountId: await acc("384"), debit: 0, credit: 12_700 }] }, userId);
    const c = await m.M.matchCandidates(cid, id);
    expect(c.candidates.some((x) => x.entryId === e.id && x.exact)).toBe(true);
    await m.M.linkEntryToInvoice(cid, id, e.id);
    expect((await m.db.db.transaction((tx) => m.L.invoiceOpenAmount(tx, id))).openFx).toBe(0);
    expect((await m.R.openItems(cid, "in")).some((x) => x.id === id)).toBe(false);
    const [p] = (await m.db.db.select().from(m.db.schema.payments)).filter((x) => x.invoiceId === id);
    await m.L.reversePayment(cid, p.id, "2026-10-05", userId); // bontás: a kézi tétel megmarad
    expect((await m.db.db.transaction((tx) => m.L.invoiceOpenAmount(tx, id))).openFx).toBe(12_700);
    expect((await m.db.db.select().from(m.db.schema.journalEntries)).find((x) => x.id === e.id)?.reversedById).toBeNull();

    // szállítói jóváíró (helyesbítő) számla visszatérítése negatív rendezéssel
    const cn = await m.L.saveInvoiceDraft(cid, { direction: "in", partnerId: shop, invoiceNumber: "SZ-1/J", issueDate: "2026-10-06", fulfillmentDate: "2026-10-06", dueDate: null, paymentMethod: "transfer", currency: "HUF", exchangeRate: 1, correctsInvoiceId: id,
      lines: [{ description: "Jóváírás", quantity: 1, unitPrice: -2_000, vatCodeId: await vat("27"), accountId: await acc("529"), vehicleId: null }] });
    await m.L.postInvoice(cid, cn, userId);
    await expect(m.L.payInvoice(cid, cn, { date: "2026-10-07", moneyAccountId: await acc("384"), amountFx: 2_540 }, userId)).rejects.toThrow(/negatív/);
    await m.L.payInvoice(cid, cn, { date: "2026-10-07", moneyAccountId: await acc("384"), amountFx: -2_540 }, userId);
    expect((await m.db.db.transaction((tx) => m.L.invoiceOpenAmount(tx, cn))).openFx).toBe(0);
  });

  it("időszakzár: könyvelés, sztornó, újranyitás tiltva", async () => {
    await m.L.lockPeriod(cid, 2026, 9, userId);
    await expect(m.L.manualEntry(cid, { journalCode: "VN", date: "2026-09-30", description: "x", lines: [{ accountId: await acc("529"), debit: 1, credit: 0 }, { accountId: await acc("384"), debit: 0, credit: 1 }] }, userId)).rejects.toThrow(/le van zárva/);
    await m.L.unlockPeriod(cid, 2026, 9);
    await expect(m.L.manualEntry(cid, { journalCode: "VN", date: "2026-10-20", description: "rossz", lines: [{ accountId: await acc("529"), debit: 100, credit: 0 }, { accountId: await acc("384"), debit: 0, credit: 90 }] }, userId)).rejects.toThrow(/egyensúly/);
  });

  it("tárgyi eszköz, ÉCS, bér, elhatárolás", async () => {
    await m.A.createAsset(cid, { name: "Laptop", accountCode: "143", activationDate: "2026-10-02", cost: 300_000, usefulLifeMonths: 36 }, { userId });
    await m.L.manualEntry(cid, { journalCode: "VN", date: "2026-10-02", description: "Laptop aktiválás", lines: [{ accountId: await acc("143"), debit: 300_000, credit: 0 }, { accountId: await acc("384"), debit: 0, credit: 300_000 }] }, userId);
    await m.A.postDepreciation(cid, "2026-10", userId);
    expect((await m.A.reconcile(cid)).every((r) => r.ok)).toBe(true);
    const [emp] = await m.db.db.insert(m.db.schema.employees).values({ companyId: cid, name: "Dolgozó" }).returning();
    await m.db.db.insert(m.db.schema.employments).values({ companyId: cid, employeeId: emp.id, kind: "full", startDate: "2026-10-01", monthlyWage: 322_800 });
    await m.P.postMonth(cid, "2026-10", userId);
    const mo = await m.P.loadMonth(cid, "2026-10");
    expect([mo.totals.net, mo.totals.szocho]).toEqual([214_662, 41_964]);
    const acr = await m.L.manualEntry(cid, { journalCode: "VN", date: "2026-10-31", description: "EPR becslés", lines: [{ accountId: await acc("529"), debit: 50_000, credit: 0 }, { accountId: await acc("482"), debit: 0, credit: 50_000 }] }, userId);
    expect((await m.AC.openAccruals(cid)).some((a) => a.entryId === acr.id)).toBe(true);
    await m.AC.releaseAccrual(cid, acr.id, "2026-11-05", userId);
    expect((await m.AC.openAccruals(cid)).some((a) => a.entryId === acr.id)).toBe(false);
    expect(bal(await tb(), "482")).toBe(0);
  });

  it("ÁFA-zárás: 466 / 467 → 468, visszavonható", async () => {
    const before = await tb();
    const exp = Math.round((-bal(before, "467") - bal(before, "466")) * 100) / 100;
    const r = await m.V.closeVatPeriod(cid, "2026-10-01", "2026-10-31", userId);
    const t1 = await m.R.trialBalance(cid, "2026-01-01", "2026-10-31");
    expect(bal(t1, "466")).toBe(0);
    expect(bal(t1, "467")).toBe(0);
    expect(-bal(t1, "468")).toBe(exp);
    expect(r.net).toBe(exp);
    await expect(m.V.closeVatPeriod(cid, "2026-10-01", "2026-10-31", userId)).rejects.toThrow(/már le van zárva/);
    const [c] = (await m.db.db.select().from(m.db.schema.vatClosings)).filter((x) => x.companyId === cid);
    await m.V.reopenVatPeriod(cid, c.id, userId);
    expect(bal(await m.R.trialBalance(cid, "2026-01-01", "2026-10-31"), "468")).toBe(0);
  });

  it("kiegészítő import: előnézet nem ír, ismétlés kihagy", async () => {
    const bundle = { format: "mm-erp-delta/1" as const, company: { taxNumber: "11111111-2-11" }, items: [{ kind: "entry" as const, ref: `it-${cid}`, journal: "VN", date: "2026-10-31", description: "Delta", lines: [{ account: "529", debit: 500 }, { account: "384", credit: 500 }] }] };
    const count = async () => (await m.db.db.select().from(m.db.schema.journalEntries)).filter((e) => e.companyId === cid).length;
    const n0 = await count();
    await m.D.runDelta(cid, bundle, { dryRun: true });
    expect(await count()).toBe(n0);
    expect((await m.D.runDelta(cid, bundle, { dryRun: false })).applied).toBe(true);
    expect((await m.D.runDelta(cid, bundle, { dryRun: true })).results[0].status).toBe("skip");
  });

  it("egyeztetések: főkönyv, mérleg, ÁFA analitika, export", async () => {
    const t = await tb();
    const d = t.reduce((s, r) => s + r.closingDebit, 0), c = t.reduce((s, r) => s + r.closingCredit, 0);
    expect(Math.abs(d - c)).toBeLessThan(0.01);
    const rows = await m.R.dailyRows(cid, "2026-12-31");
    expect(m.S.buildBalanceSheet(rows, m.S.buckets("2026-01-01", "2026-12-31", "month"), 1, "2026-01-01").checkOk).toBe(true);
    const va = await m.R.vatAnalytics(cid, "2026-01-01", "2026-12-31");
    expect(Math.abs(va.payable + bal(t, "467"))).toBeLessThan(1);
    expect(Math.abs(va.deductible - bal(t, "466"))).toBeLessThan(1);
    const x = await m.X.buildExport(cid, "2026-01-01", "2026-12-31");
    expect(Math.abs(x.balances.reduce((s, b) => s + b.balance, 0))).toBeLessThan(0.01);
  });
});
