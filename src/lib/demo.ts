/**
 * v6.12.0 – Bemutató cég: egy gombnyomással létrehozott, valósághű mintaadatokkal feltöltött cég,
 * hogy az új felhasználó (vagy egy érdeklődő) azonnal kipróbálhassa az ERP-t.
 * A dátumok a mai naphoz igazodnak (az elmúlt 3 hónap), így a határidők, kintlévőségek, ÁFA-időszakok élnek.
 * A bemutató cég nem számít bele a csomag cégszám-keretébe, és egy gombbal (türelmi idő nélkül) törölhető.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { createCompany, saveInvoiceDraft, postInvoice, payInvoice, manualEntry, accountIdByCode } from "@/lib/ledger";
import { today } from "@/lib/dates";
import { addDaysIso } from "@/lib/dates";
import { demoTaxNumber, demoPlan } from "@/lib/demo-calc";
export { demoTaxNumber, demoPlan };

export const DEMO_NAME = "Bemutató Autószerviz Kft. (demó)";

const CUSTOMERS = [
  { name: "Kovács és Társa Bt.", taxNumber: demoTaxNumber("1234567"), address: "7621 Pécs, Király u. 5." },
  { name: "Mecsek Logisztika Kft.", taxNumber: demoTaxNumber("2345678"), address: "7630 Pécs, Megyeri út 40." },
  { name: "Dráva Futár Kft.", taxNumber: demoTaxNumber("3456789", "2", "02"), address: "7900 Szigetvár, Rákóczi u. 12." },
  { name: "Szabó Építő Kft.", taxNumber: demoTaxNumber("4567890"), address: "7400 Kaposvár, Fő u. 3." },
  { name: "Nagy Péter", taxNumber: null, address: "7900 Szigetvár, Vár u. 8.", privatePerson: true },
];
const SUPPLIERS = [
  { name: "Műhelyház Ingatlan Kft.", taxNumber: demoTaxNumber("5678901"), address: "7900 Szigetvár, Ipari út 2." },
  { name: "AutóAlkatrész Nagyker Zrt.", taxNumber: demoTaxNumber("6789012", "2", "41"), address: "1097 Budapest, Könyves K. krt. 12." },
  { name: "Telekom Szolgáltató Nyrt.", taxNumber: demoTaxNumber("7890123", "2", "44"), address: "1097 Budapest, Telekom u. 1." },
  { name: "Számvitel Pont Bt.", taxNumber: demoTaxNumber("8901234"), address: "7900 Szigetvár, Szent István ltp. 4." },
];

export async function createDemoCompany(userId: number): Promise<{ id: number }> {
  const t = today();
  const plan = demoPlan(t);
  return db.transaction(async (tx: Tx) => {
    const c = await createCompany(userId, { name: DEMO_NAME, taxNumber: demoTaxNumber("9012345"), address: "7900 Szigetvár, Szerviz u. 1.", vatPeriod: "monthly", activityProfile: "services" }, tx);
    const id = c.id;
    const [cur] = await tx.select({ settings: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, id));
    await tx.update(schema.companies).set({ settings: { ...(cur?.settings ?? {}), demo: true } }).where(eq(schema.companies.id, id));
    const acc = (code: string) => accountIdByCode(tx, id, code);
    const vatId = async (code: string) => (await tx.select().from(schema.vatCodes).where(and(eq(schema.vatCodes.companyId, id), eq(schema.vatCodes.code, code))))[0].id;
    const v27 = await vatId("27");
    const bank = await acc("384");
    const cash = await acc("381");
    const mkPartners = (list: typeof CUSTOMERS) => Promise.all(list.map(async (p) =>
      (await tx.insert(schema.partners).values({ companyId: id, name: p.name, taxNumber: p.taxNumber, address: p.address, isPrivatePerson: !!(p as { privatePerson?: boolean }).privatePerson }).returning())[0]));
    const customers = await mkPartners(CUSTOMERS);
    const suppliers = await mkPartners(SUPPLIERS);

    await manualEntry(id, { journalCode: "BA", date: plan.capitalDate, description: "Jegyzett tőke befizetése", lines: [
      { accountId: bank, debit: 3_000_000, credit: 0 }, { accountId: await acc("411"), debit: 0, credit: 3_000_000 },
    ] }, userId, tx);

    const year = t.slice(0, 4);
    for (const o of plan.out) {
      const lines = await Promise.all(o.lines.map(async ([description, quantity, unitPrice, code]) => ({ description: String(description), quantity: Number(quantity), unitPrice: Number(unitPrice), vatCodeId: v27, accountId: await acc(String(code)) })));
      const inv = await saveInvoiceDraft(id, { direction: "out", partnerId: customers[o.p].id, invoiceNumber: `DEMO-${year}-${String(o.n).padStart(3, "0")}`, issueDate: o.date, fulfillmentDate: o.date, dueDate: o.method === "transfer" ? o.due : o.date, paymentMethod: o.method, currency: "HUF", exchangeRate: 1, lines }, undefined, tx);
      await postInvoice(id, inv, userId, tx);
      if (o.paid) {
        const gross = lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPrice * 1.27), 0);
        await payInvoice(id, inv, { date: o.method === "transfer" ? addDaysIso(o.date, 5) : o.date, moneyAccountId: o.method === "cash" ? cash : bank, amountFx: gross }, userId, tx);
      }
    }
    for (const i of plan.inn) {
      const lines = await Promise.all(i.lines.map(async ([description, quantity, unitPrice, code]) => ({ description: String(description), quantity: Number(quantity), unitPrice: Number(unitPrice), vatCodeId: v27, accountId: await acc(String(code)) })));
      const inv = await saveInvoiceDraft(id, { direction: "in", partnerId: suppliers[i.s].id, invoiceNumber: `${i.no}/${year}`, issueDate: i.date, fulfillmentDate: i.date, dueDate: i.due, paymentMethod: "transfer", currency: "HUF", exchangeRate: 1, periodic: i.periodic, lines }, undefined, tx);
      await postInvoice(id, inv, userId, tx);
      if (i.paid) {
        const gross = lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPrice * 1.27), 0);
        await payInvoice(id, inv, { date: addDaysIso(i.date, 7), moneyAccountId: bank, amountFx: gross }, userId, tx);
      }
    }
    return { id };
  });
}

export function isDemo(c: { settings?: unknown }): boolean {
  return !!(c.settings as { demo?: boolean } | null | undefined)?.demo;
}

/** Az ügyfélfiók meglévő bemutató cége (egyszerre csak egy lehet). */
export async function demoCompanyOf(organizationId: number | null | undefined): Promise<number | null> {
  if (!organizationId) return null;
  const r = (await db.execute(sql`select id from companies where organization_id = ${organizationId} and (settings->>'demo')::boolean is true limit 1`)) as unknown as Array<{ id: number }>;
  return r[0]?.id ?? null;
}
