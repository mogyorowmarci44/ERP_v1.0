/**
 * Demó adatok + integrációs ellenőrzés: létrehoz egy demó felhasználót és céget,
 * végigviszi egy gépkocsi teljes életútját (beszerzés → fényezés → eladás → rendezés),
 * majd ellenőrzi a főkönyvi kivonat egyensúlyát és a különbözeti ÁFÁ-t.
 *
 *   DATABASE_URL=... npm run db:seed-demo
 */
import { eq, and } from "drizzle-orm";
import { db, sql, schema } from "../src/db";
import { createCompany, saveInvoiceDraft, postInvoice, payInvoice, cancelInvoice, accountIdByCode, manualEntry, lockPeriod } from "../src/lib/ledger";
import { trialBalance, vatAnalytics, vehicleStock, openItems } from "../src/lib/reports";
import bcrypt from "bcryptjs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ELLENŐRZÉS SIKERTELEN: " + msg);
  console.log("  ✓", msg);
}

async function main() {
  const email = `demo+${Date.now()}@mm-erp.local`;
  const [user] = await db
    .insert(schema.users)
    .values({ email, name: "Demó", passwordHash: await bcrypt.hash("demo1234", 10) })
    .returning();
  const c = await createCompany(user.id, { name: "Demó Autó Kft", taxNumber: "12345678-2-42" });
  const id = c.id;
  const acc = (code: string) => accountIdByCode(db, id, code);
  const vat = async (code: string) =>
    (await db.select().from(schema.vatCodes).where(and(eq(schema.vatCodes.companyId, id), eq(schema.vatCodes.code, code))))[0].id;

  const [maganszemely] = await db.insert(schema.partners).values({ companyId: id, name: "Kiss János", isPrivatePerson: true }).returning();
  const [fenyezo] = await db.insert(schema.partners).values({ companyId: id, name: "Fényező Bt", taxNumber: "87654321-2-13" }).returning();
  const [vevo] = await db.insert(schema.partners).values({ companyId: id, name: "Nagy Péter", isPrivatePerson: true }).returning();
  const [nemet] = await db.insert(schema.partners).values({ companyId: id, name: "Autohaus GmbH", country: "DE", euVatNumber: "DE123456789" }).returning();
  const [golf] = await db.insert(schema.vehicles).values({ companyId: id, make: "VW", model: "Golf", plate: "ABC-123", vin: "WVWZZZ1KZ6W000001" }).returning();

  // Tőkebefizetés
  await manualEntry(id, {
    journalCode: "BA",
    date: "2026-10-01",
    description: "Jegyzett tőke befizetése",
    lines: [
      { accountId: await acc("384"), debit: 3_000_000, credit: 0 },
      { accountId: await acc("411"), debit: 0, credit: 3_000_000 },
    ],
  });

  console.log("1) Beszerzés magánszemélytől (különbözeti, ÁFA nélkül)");
  const buyId = await saveInvoiceDraft(id, {
    direction: "in", partnerId: maganszemely.id, invoiceNumber: "ASZ-2026-001", issueDate: "2026-10-05", fulfillmentDate: "2026-10-05",
    paymentMethod: "cash", currency: "HUF", exchangeRate: 1,
    lines: [{ description: "VW Golf ABC-123 adásvétel", quantity: 1, unitPrice: 2_500_000, vatCodeId: await vat("KÜL27"), accountId: await acc("261"), vehicleId: golf.id }],
  });
  await postInvoice(id, buyId, user.id);
  await payInvoice(id, buyId, { date: "2026-10-05", moneyAccountId: await acc("384"), amountFx: 2_500_000, fxRate: 1 });

  console.log("2) Fényezés (normál ÁFA, aktiválva a gépkocsira)");
  const paintId = await saveInvoiceDraft(id, {
    direction: "in", partnerId: fenyezo.id, invoiceNumber: "FB-77", issueDate: "2026-10-10", fulfillmentDate: "2026-10-10",
    paymentMethod: "transfer", currency: "HUF", exchangeRate: 1,
    lines: [{ description: "Fényezés", quantity: 1, unitPrice: 300_000, vatCodeId: await vat("27"), accountId: await acc("261"), vehicleId: golf.id }],
  });
  await postInvoice(id, paintId, user.id);

  console.log("3) Eladás különbözeti adózással");
  const saleId = await saveInvoiceDraft(id, {
    direction: "out", partnerId: vevo.id, invoiceNumber: "MM-2026-0001", issueDate: "2026-10-20", fulfillmentDate: "2026-10-20",
    paymentMethod: "transfer", currency: "HUF", exchangeRate: 1,
    lines: [{ description: "VW Golf ABC-123", quantity: 1, unitPrice: 3_135_000, vatCodeId: await vat("KÜL27"), accountId: await acc("911"), vehicleId: golf.id }],
  });
  await postInvoice(id, saleId, user.id);
  await payInvoice(id, saleId, { date: "2026-10-22", moneyAccountId: await acc("384"), amountFx: 3_135_000, fxRate: 1 });

  console.log("4) EUR alkatrész Németországból (KBB), kifizetés eltérő banki árfolyamon");
  const deId = await saveInvoiceDraft(id, {
    direction: "in", partnerId: nemet.id, invoiceNumber: "DE-2026-55", issueDate: "2026-10-15", fulfillmentDate: "2026-10-15",
    paymentMethod: "transfer", currency: "EUR", exchangeRate: 390,
    lines: [{ description: "Alkatrész", quantity: 2, unitPrice: 100, vatCodeId: await vat("KBB27"), accountId: await acc("262") }],
  });
  await postInvoice(id, deId, user.id);
  await payInvoice(id, deId, { date: "2026-10-25", moneyAccountId: await acc("384"), amountFx: 200, fxRate: 395 });

  console.log("5) Hibás piszkozat törlése, könyvelt számla sztornója");
  const wrongId = await saveInvoiceDraft(id, {
    direction: "in", partnerId: fenyezo.id, invoiceNumber: "FB-78", issueDate: "2026-10-11", fulfillmentDate: "2026-10-11",
    paymentMethod: "transfer", currency: "HUF", exchangeRate: 1,
    lines: [{ description: "Téves", quantity: 1, unitPrice: 1000, vatCodeId: await vat("27"), accountId: await acc("523") }],
  });
  await postInvoice(id, wrongId, user.id);
  await cancelInvoice(id, wrongId, "2026-10-12", user.id);

  console.log("Ellenőrzések:");
  const tb = await trialBalance(id, "2026-10-01", "2026-10-31");
  const sumD = tb.reduce((s, r) => s + r.closingDebit, 0);
  const sumC = tb.reduce((s, r) => s + r.closingCredit, 0);
  const pd = tb.reduce((s, r) => s + r.periodDebit, 0);
  const pc = tb.reduce((s, r) => s + r.periodCredit, 0);
  assert(Math.abs(pd - pc) < 0.01, `forgalom egyezik (T ${pd} = K ${pc})`);
  assert(Math.abs(sumD - sumC) < 0.01, `záró egyenleg egyezik (T ${sumD} = K ${sumC})`);
  const row = (code: string) => tb.find((r) => r.code === code);
  assert((row("261")?.closingDebit ?? 0) === 0, "261 gépkocsi készlet kiürült az eladással");
  assert(row("262")?.closingDebit === 200 * 390, "262 alkatrész készlet = 200 EUR × 390");
  assert(row("814")?.closingDebit === 2_800_000, "ELÁBÉ = beszerzés + fényezés = 2 800 000");
  // Árrés: 3 135 000 - 2 500 000 = 635 000 → ÁFA 635 000 × 27/127 = 135 000
  assert(row("911")?.closingCredit === 3_000_000, "911 árbevétel = 3 135 000 − 135 000");
  const v = await vatAnalytics(id, "2026-10-01", "2026-10-31");
  assert(v.payable === 135_000 + 21_060, `fizetendő ÁFA = különbözeti 135 000 + KBB 21 060 (${v.payable})`);
  assert(v.deductible === 81_000 + 21_060, `levonható ÁFA = fényezés 81 000 + KBB 21 060 (${v.deductible})`);
  assert(row("876")?.closingDebit === 1000, "árfolyamveszteség 200 × (395 − 390) = 1 000");
  const stock = await vehicleStock(id);
  assert(stock[0].status === "sold" && stock[0].bookValue === 0, "Golf eladva, könyv szerinti érték 0");
  const open = await openItems(id, "in");
  assert(open.length === 1 && open[0].invoiceNumber === "FB-77", "nyitott szállító: csak a fényezés");

  await lockPeriod(id, 2026, 10, user.id);
  let locked = false;
  try {
    await manualEntry(id, { journalCode: "VN", date: "2026-10-31", description: "x", lines: [{ accountId: await acc("384"), debit: 1, credit: 0 }, { accountId: await acc("969"), debit: 0, credit: 1 }] });
  } catch {
    locked = true;
  }
  assert(locked, "lezárt időszakba nem lehet könyvelni");

  console.log(`\nKész. Demó belépés: ${email} / demo1234 (cég #${id})`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
