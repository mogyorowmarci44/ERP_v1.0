/**
 * Integrációs teszt: teljes könyvelési folyamat egy friss cégen, valódi Postgres adatbázison.
 *
 * Futtatás:  TEST_DATABASE_URL=postgres://… npm run test:integration
 * (a migrációkat előtte le kell futtatni ugyanarra az adatbázisra: DATABASE_URL=… npm run db:migrate).
 * TEST_DATABASE_URL nélkül a teszt kimarad – a normál `npm test` adatbázis nélkül is fut.
 * SOHA ne az éles adatbázisra irányítsd: minden futás új tesztcéget hoz létre.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)("könyvelési folyamat (integráció)", () => {
  // a modulok csak a DATABASE_URL beállítása után tölthetők be
  let m: { eq: typeof import("drizzle-orm").eq; and: typeof import("drizzle-orm").and;
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
      eq: (await import("drizzle-orm")).eq, and: (await import("drizzle-orm")).and,
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

  it("v3.9.6: készpénz 5 Ft-os kerekítés, ÁFA-befizetés a 468-ra, zárás-újraszámolás, kézi ÁFA a bevallásban", async () => {
    const sup = await partner("Bolt Kft");
    await m.db.db.update(m.db.schema.partners).set({ taxNumber: "12345676-2-41" }).where(m.eq(m.db.schema.partners.id, sup));
    // 10 000 + 27% = 12 700 → 12 700; 10 001 nettó → 12 701 bruttó → készpénzben 12 700, a különbözet 979
    const id = await inv("in", sup, "KP-1", "2026-11-03", [["Anyag", 10_001, "27", "512"]], { paymentMethod: "cash" });
    await m.L.payInvoice(cid, id, { date: "2026-11-03", moneyAccountId: await acc("381"), amountFx: 12_700 }, userId);
    expect((await m.db.db.transaction((tx) => m.L.invoiceOpenAmount(tx, id))).openFx).toBe(0);
    const t1 = await m.R.trialBalance(cid, "2026-11-01", "2026-11-30");
    expect(bal(t1, "979")).toBe(-1);

    // NAV ÁFA-befizetés kézi bank tételként a 467-re → automatikusan a 468-ra kerül
    const e = await m.L.manualEntry(cid, { journalCode: "BA", date: "2026-11-05", description: "ÁFA befizetés", lines: [{ accountId: await acc("467"), debit: 1_000, credit: 0 }, { accountId: await acc("384"), debit: 0, credit: 1_000 }] }, userId);
    const el = (await m.db.db.select().from(m.db.schema.journalLines)).filter((l) => l.entryId === e.id);
    expect(el.find((l) => Number(l.debit) === 1_000)!.accountId).toBe(await acc("468"));

    // kézi visszáru-jóváírás (K 466) bekerül az ÁFA analitikába és a bevallás soraiba
    await m.L.manualEntry(cid, { journalCode: "PE", date: "2026-11-06", description: "Visszáru – Bolt Kft [VJ-1]", lines: [
      { accountId: await acc("381"), debit: 1_270, credit: 0, partnerId: sup }, { accountId: await acc("512"), debit: 0, credit: 1_000, partnerId: sup }, { accountId: await acc("466"), debit: 0, credit: 270, partnerId: sup }] }, userId);
    const VR = await import("@/lib/vat-return-data");
    const ml = await VR.loadManualVatLines(cid, "2026-11-01", "2026-11-30");
    expect(ml).toHaveLength(1);
    expect(ml[0]).toMatchObject({ direction: "in", vat: -270, net: -1_000, invoiceNumber: "VJ-1" });
    const t2 = await m.R.trialBalance(cid, "2026-01-01", "2026-11-30");
    const va = await m.R.vatAnalytics(cid, "2026-01-01", "2026-11-30");
    expect(Math.abs(va.deductible - bal(t2, "466"))).toBeLessThan(1);

    // ÁFA-zárás, majd utólag a lezárt időszakba könyvelt tétel → újraszámolás után a 468 = a tényleges fizetendő
    const r = await m.V.closeVatPeriod(cid, "2026-11-01", "2026-11-30", userId);
    await inv("out", await partner("Vevő2", true), "V-NOV", "2026-11-20", [["Szerviz", 10_000, "27", "911"]]);
    const before = bal(await m.R.trialBalance(cid, "2026-01-01", "2026-11-30"), "467");
    expect(before).toBe(-2_700);
    const rc = await m.V.recomputeVatClosings(cid, userId);
    expect(rc.changed).toBeGreaterThan(0);
    const t3 = await m.R.trialBalance(cid, "2026-01-01", "2026-11-30");
    expect(bal(t3, "467")).toBe(0);
    expect(bal(t3, "466")).toBe(0);
    const [cl] = (await m.db.db.select().from(m.db.schema.vatClosings)).filter((x) => x.companyId === cid && x.toDate === "2026-11-30");
    expect(Number(cl.payable)).toBe(r.net + 2_700);
  });

  it("v3.9.6: egyezőség, partner-összevonás, adatbázis-szintű T = K védelem", async () => {
    const a = await partner("Dupla Kft"), b = await partner("DUPLA KFT.");
    for (const id of [a, b]) await m.db.db.update(m.db.schema.partners).set({ taxNumber: "12345676-2-41" }).where(m.eq(m.db.schema.partners.id, id));
    await inv("in", b, "D-1", "2026-11-10", [["Anyag", 1_000, "27", "512"]]);
    const C = await import("@/lib/consistency");
    const PM = await import("@/lib/partner-merge");
    let checks = await C.runConsistency(cid);
    expect(checks.find((c) => c.key === "partners")!.level).toBe("warn");
    await PM.mergeAllDuplicates(cid);
    checks = await C.runConsistency(cid);
    expect(checks.find((c) => c.key === "partners")!.level).toBe("ok");
    for (const k of ["balance", "invoice_gl", "stock", "reversed", "vat_payment"]) expect(checks.find((c) => c.key === k)!.level).toBe("ok");
    // kiegyensúlyozatlan tétel az adatbázisba sem kerülhet be
    const [ent] = (await m.db.db.select().from(m.db.schema.journalEntries)).filter((x) => x.companyId === cid);
    await expect(m.db.db.transaction(async (tx) => {
      await tx.insert(m.db.schema.journalLines).values({ entryId: ent.id, companyId: cid, accountId: await acc("384"), debit: 1, credit: 0 });
    })).rejects.toThrow();
  });
  it("v6.0.0 – ügyfélfiókok: a cég a létrehozó ügyfélfiókjába kerül, két felhasználó külön fiókot kap", async () => {
    const { users, companies } = m.db.schema;
    const [me] = await m.db.db.select().from(users).where(m.eq(users.id, userId));
    const [co] = await m.db.db.select().from(companies).where(m.eq(companies.id, cid));
    expect(me.organizationId).toBeTruthy();
    expect(co.organizationId).toBe(me.organizationId);
    const [u2] = await m.db.db.insert(users).values({ email: `it2-${Date.now()}@test.local`, name: "Másik ügyfél", passwordHash: "x" }).returning();
    const co2 = await m.L.createCompany(u2.id, { name: `IT2 Kft ${Date.now()}` } as never);
    const [u2b] = await m.db.db.select().from(users).where(m.eq(users.id, u2.id));
    expect(co2.organizationId).toBe(u2b.organizationId);
    expect(co2.organizationId).not.toBe(me.organizationId);
    // ugyanaz a felhasználó második cége már a meglévő fiókjába kerül
    const co3 = await m.L.createCompany(u2.id, { name: `IT3 Kft ${Date.now()}` } as never);
    expect(co3.organizationId).toBe(co2.organizationId);
  });
  it("v6.1.0 – érzékeny mezők titkosítva, teljes mentés → törlés → visszaállítás azonos eredménnyel", async () => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { sql } = await import("drizzle-orm");
    const B = await import("@/lib/backup");
    const { wipeCompanyData } = await import("@/lib/importer");
    const s = m.db.schema;
    const [emp] = await m.db.db.insert(s.employees).values({ companyId: cid, name: "Dolgozó Dóra", taxId: "8123456789" }).returning();
    await m.db.db.insert(s.companyMembers).values({ companyId: cid, name: "Tag Tamás", motherName: "Anya Anna", taxId: "8987654321", address: "1111 Budapest, Fő u. 1." });
    // az adatbázisban titkosítva, a programban olvashatóan
    const [raw] = (await m.db.db.execute(sql`select tax_id from employees where id = ${emp.id}`)) as unknown as Array<{ tax_id: string }>;
    expect(raw.tax_id.startsWith("enc1:")).toBe(true);
    const [back] = await m.db.db.select().from(s.employees).where(m.eq(s.employees.id, emp.id));
    expect(back.taxId).toBe("8123456789");

    const before = await tb();
    const count = async (t: string, col = "company_id") => Number(((await m.db.db.execute(sql`select count(*)::int as n from ${sql.identifier(t)} where ${sql.identifier(col)} = ${cid}`)) as unknown as Array<{ n: number }>)[0].n);
    const nLines = await count("journal_lines"), nInv = await count("invoices");
    const b = B.parseBackup(B.backupToGzip(await B.buildBackup(cid)));
    expect(b.tables.employees.find((e) => e.id === emp.id)?.tax_id).toBe("8123456789"); // a mentés visszafejtve tartalmazza
    // létező cégre nem állítható vissza
    await expect(B.restoreBackup(b, { organizationId: 1, userId })).rejects.toThrow(/még megvan/);

    const [me] = await m.db.db.select().from(s.users).where(m.eq(s.users.id, userId));
    await wipeCompanyData(cid);
    await m.db.db.delete(s.companies).where(m.eq(s.companies.id, cid));
    expect(await count("journal_lines")).toBe(0);

    const r = await B.restoreBackup(b, { organizationId: me.organizationId!, userId });
    expect(r.companyId).toBe(cid);
    expect(await count("journal_lines")).toBe(nLines);
    expect(await count("invoices")).toBe(nInv);
    expect(await tb()).toEqual(before);
    const [emp2] = await m.db.db.select().from(s.employees).where(m.eq(s.employees.id, emp.id));
    expect(emp2.taxId).toBe("8123456789");
    const [raw2] = (await m.db.db.execute(sql`select tax_id from employees where id = ${emp.id}`)) as unknown as Array<{ tax_id: string }>;
    expect(raw2.tax_id.startsWith("enc1:")).toBe(true);
    // a sorszámok a visszaállított azonosítók után folytatódnak
    const [p2] = await m.db.db.insert(s.partners).values({ companyId: cid, name: "Visszaállítás után" }).returning();
    expect(p2.id).toBeGreaterThan(Math.max(...b.tables.partners.map((p) => Number(p.id))));
    delete process.env.DATA_ENCRYPTION_KEY;
  }, 120_000);
  it("v6.3.0 – cikkes készlet: bevételezés szállítói számláról, kiadás vevőszámlán, havi ELÁBÉ a különbözettel", async () => {
    const I = await import("@/lib/inventory");
    const s = m.db.schema;
    const [it] = await m.db.db.insert(s.items).values({ companyId: cid, name: "Csavar", unit: "db", stockAccount: "262", cogsAccount: "811" }).returning();
    const sup = await partner("Szállító Bt"), cust = await partner("Vásárló Kft");
    const vatId = await vat("27");
    const mk = async (direction: "in" | "out", pid: number, no: string, date: string, qty: number, price: number, acc: string) => {
      const id = await m.L.saveInvoiceDraft(cid, { direction, partnerId: pid, invoiceNumber: no, issueDate: date, fulfillmentDate: date, dueDate: date, paymentMethod: "transfer", currency: "HUF", exchangeRate: 1,
        lines: [{ description: "Csavar", quantity: qty, unitPrice: price, vatCodeId: vatId, accountId: await acc_(acc), itemId: it.id }] } as never);
      await m.L.postInvoice(cid, id, userId);
      return id;
    };
    const acc_ = (c: string) => acc(c);
    await mk("in", sup, "SZ-CS-1", "2026-11-03", 100, 50, "262");
    await mk("in", sup, "SZ-CS-2", "2026-11-05", 100, 70, "262");
    const sale = await mk("out", cust, "V-CS-1", "2026-11-10", 30, 150, "911");
    let [row] = (await I.itemsWithBalance(cid)).filter((x) => x.id === it.id);
    expect(row).toMatchObject({ qty: 170, avg: 60, value: 10_200 });
    let nov = (await I.monthlyCogs(cid, 2026)).find((x) => x.period === "2026-11")!;
    expect(nov).toMatchObject({ computed: 1_800, booked: 0, diff: 1_800 });
    await I.postMonthlyCogs(cid, "2026-11", userId);
    let t = await tb();
    expect(bal(t, "262")).toBe(10_200);
    expect(bal(t, "811")).toBe(1_800);
    // utólagos sztornó → a hónap különbözete negatív, újra könyvelve a főkönyv visszaáll
    await m.L.cancelInvoice(cid, sale, "2026-11-20", userId);
    nov = (await I.monthlyCogs(cid, 2026)).find((x) => x.period === "2026-11")!;
    expect(nov).toMatchObject({ computed: 0, booked: 1_800, diff: -1_800 });
    await I.postMonthlyCogs(cid, "2026-11", userId);
    t = await tb();
    expect(bal(t, "262")).toBe(12_000);
    expect(bal(t, "811")).toBe(0);
    [row] = (await I.itemsWithBalance(cid)).filter((x) => x.id === it.id);
    expect(row.value).toBe(12_000);
    await expect(I.postMonthlyCogs(cid, "2026-11", userId)).rejects.toThrow(/Nincs könyvelendő/);
  }, 120_000);
  it("v6.5.0 – bevezetés: számlatükör, partnerek és nyitómérleg betöltése új cégbe", async () => {
    const O = await import("@/lib/onboarding");
    const s = m.db.schema;
    const co = await m.L.createCompany(userId, { name: `IT Nyitó Kft ${Date.now()}`, vatPeriod: "monthly", fiscalYearStartMonth: 1 } as never);
    const c2 = co.id;
    const acc2 = await O.importAccounts(c2, [{ Számla: "3842", Megnevezés: "EUR bankszámla" }, { Számla: "384", Megnevezés: "Elszámolási betétszámla" }], true);
    expect(acc2.ok).toBe(true);
    await m.db.db.update(s.accounts).set({ currency: "EUR" }).where(m.and(m.eq(s.accounts.companyId, c2), m.eq(s.accounts.code, "3842")));
    const prt = await O.importPartners(c2, [{ Név: "Hibás Kft", Adószám: "12345678-1-11" }], true);
    expect(prt.ok).toBe(false); // hibás ellenőrző szám → semmi nem kerül be
    const rows = [
      { Számla: "384", Tartozik: "1 000 000" },
      { Számla: "3842", Tartozik: "400 000", Devizaösszeg: "1 000" },
      { Számla: "311", Tartozik: 250_000, Partner: "Nyitó Vevő Kft" },
      { Számla: "4791", Megnevezés: "Tagi kölcsön", Követel: 150_000 },
      { Számla: "411", Követel: 3_000_000 },
      { Számla: "413", Tartozik: 1_500_000 },
    ];
    const check = await O.importOpening(c2, rows, { date: "2026-01-01", apply: false, userId });
    expect(check.ok).toBe(true);
    expect(check.messages.join(" ")).toMatch(/Nyitó Vevő Kft/);
    expect((await m.db.db.select().from(s.journalEntries).where(m.eq(s.journalEntries.companyId, c2))).length).toBe(0);
    const done = await O.importOpening(c2, rows, { date: "2026-01-01", apply: true, userId });
    expect(done.ok).toBe(true);
    const t = await m.R.trialBalance(c2, "2026-01-01", "2026-12-31");
    const b2 = (code: string) => Math.round(t.filter((r) => r.code === code).reduce((x, r) => x + r.closingDebit - r.closingCredit, 0));
    expect(b2("384")).toBe(1_000_000);
    expect(b2("311")).toBe(250_000);
    expect(b2("411")).toBe(-3_000_000);
    const again = await O.importOpening(c2, rows, { date: "2026-01-01", apply: true, userId });
    expect(again.ok).toBe(false);
    const st = await O.onboardingStatus(c2);
    expect(st.steps.opening && st.steps.partners).toBe(true);
  }, 120_000);
});
