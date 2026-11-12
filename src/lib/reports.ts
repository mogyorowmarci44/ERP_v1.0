/** Lekérdezések / riportok: főkönyvi kivonat, karton, napló, ÁFA analitika, nyitott tételek, készlet. */
import { and, asc, desc, eq, gte, lte, lt, sql, inArray } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/db";
import { round2 } from "./money";

const { accounts, journalEntries, journalLines, journals, invoices, invoiceLines, vatCodes, partners, vehicles, companies, payments } = schema;

/** Az üzleti év kezdete egy adott dátumhoz. */
export function fiscalYearStart(date: string, startMonth: number): string {
  const [y, m] = date.split("-").map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

const isBalanceSheet = (type: string) => type === "asset" || type === "liability" || type === "equity" || type === "off_balance";

export type TrialBalanceRow = {
  accountId: number;
  code: string;
  name: string;
  type: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};

/**
 * Főkönyvi kivonat: nyitó egyenleg, időszaki forgalom, záró egyenleg.
 * Mérlegszámláknál a nyitó a kezdettől halmozott; eredményszámláknál az üzleti év elejétől.
 */
export async function trialBalance(companyId: number, from: string, to: string, tx: DbOrTx = db): Promise<TrialBalanceRow[]> {
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  const fyStart = fiscalYearStart(from, company.fiscalYearStartMonth);

  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      openBs: sql<number>`coalesce(sum(case when ${journalEntries.date} < ${from} then ${journalLines.debit} - ${journalLines.credit} end), 0)::float8`,
      openPl: sql<number>`coalesce(sum(case when ${journalEntries.date} >= ${fyStart} and ${journalEntries.date} < ${from} then ${journalLines.debit} - ${journalLines.credit} end), 0)::float8`,
      pd: sql<number>`coalesce(sum(case when ${journalEntries.date} between ${from} and ${to} then ${journalLines.debit} end), 0)::float8`,
      pc: sql<number>`coalesce(sum(case when ${journalEntries.date} between ${from} and ${to} then ${journalLines.credit} end), 0)::float8`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.companyId, companyId), lte(journalEntries.date, to)))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
    .orderBy(asc(accounts.code));

  const split = (bal: number) => (bal >= 0 ? [round2(bal), 0] : [0, round2(-bal)]);
  return rows
    .map((r) => {
      const open = isBalanceSheet(r.type) ? Number(r.openBs) : Number(r.openPl);
      const pd = round2(Number(r.pd));
      const pc = round2(Number(r.pc));
      const close = round2(open + pd - pc);
      const [od, oc] = split(open);
      const [cd, cc] = split(close);
      return { accountId: r.accountId, code: r.code, name: r.name, type: r.type, openingDebit: od, openingCredit: oc, periodDebit: pd, periodCredit: pc, closingDebit: cd, closingCredit: cc };
    })
    .filter((r) => r.openingDebit || r.openingCredit || r.periodDebit || r.periodCredit || r.closingDebit || r.closingCredit);
}

/** Számlakarton (főkönyvi számla tételei) nyitó egyenleggel és futó egyenleggel. */
export async function accountLedger(companyId: number, accountId: number, from: string, to: string) {
  const [acc] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  if (!acc) throw new Error("A számla nem található.");
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const openFrom = isBalanceSheet(acc.type) ? "0001-01-01" : fiscalYearStart(from, company.fiscalYearStartMonth);
  const [o] = await db
    .select({ bal: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::float8` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), gte(journalEntries.date, openFrom), lt(journalEntries.date, from)));
  const lines = await db
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.date,
      entryDescription: journalEntries.description,
      description: journalLines.description,
      debit: journalLines.debit,
      credit: journalLines.credit,
      partnerName: partners.name,
      currency: journalLines.currency,
      amountFx: journalLines.amountFx,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .where(and(eq(journalLines.accountId, accountId), gte(journalEntries.date, from), lte(journalEntries.date, to)))
    .orderBy(asc(journalEntries.date), asc(journalEntries.number), asc(journalLines.id));
  let run = round2(Number(o.bal));
  const opening = run;
  const withBal = lines.map((l) => {
    run = round2(run + Number(l.debit) - Number(l.credit));
    return { ...l, balance: run };
  });
  return { account: acc, opening, closing: run, lines: withBal };
}

/** Napló: tételek időszakra, soraikkal. */
export async function journalList(companyId: number, from: string, to: string, journalCode?: string) {
  const conds = [eq(journalEntries.companyId, companyId), gte(journalEntries.date, from), lte(journalEntries.date, to)];
  if (journalCode) conds.push(eq(journals.code, journalCode));
  const entries = await db
    .select({ e: journalEntries, journalCode: journals.code })
    .from(journalEntries)
    .innerJoin(journals, eq(journals.id, journalEntries.journalId))
    .where(and(...conds))
    .orderBy(desc(journalEntries.date), desc(journalEntries.number))
    .limit(500);
  const ids = entries.map((x) => x.e.id);
  const lines = ids.length
    ? await db
        .select({ l: journalLines, code: accounts.code, name: accounts.name, partnerName: partners.name })
        .from(journalLines)
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .leftJoin(partners, eq(partners.id, journalLines.partnerId))
        .where(inArray(journalLines.entryId, ids))
        .orderBy(asc(journalLines.id))
    : [];
  return entries.map((x) => ({ ...x.e, journalCode: x.journalCode, lines: lines.filter((l) => l.l.entryId === x.e.id) }));
}

/** ÁFA analitika: könyvelt számlák tételei teljesítési dátum szerint, ÁFA-kódonként összesítve. */
export async function vatAnalytics(companyId: number, from: string, to: string, opts: { noInputVatDeduction?: boolean } = {}) {
  const rows = await db
    .select({
      direction: invoices.direction,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      fulfillmentDate: invoices.fulfillmentDate,
      status: invoices.status,
      partnerName: partners.name,
      partnerTax: partners.taxNumber,
      vatCode: vatCodes.code,
      vatName: vatCodes.name,
      vatKind: vatCodes.kind,
      description: invoiceLines.description,
      netHuf: invoiceLines.netHuf,
      vatHuf: invoiceLines.vatHuf,
      grossHuf: invoiceLines.grossHuf,
      marginPurchaseHuf: invoiceLines.marginPurchaseHuf,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
    .innerJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "posted"), gte(invoices.fulfillmentDate, from), lte(invoices.fulfillmentDate, to)))
    .orderBy(asc(invoices.direction), asc(vatCodes.code), asc(invoices.fulfillmentDate));

  const summary = new Map<string, { direction: string; vatCode: string; vatName: string; vatKind: string; net: number; vat: number; gross: number; count: number }>();
  for (const r of rows) {
    const k = `${r.direction}|${r.vatCode}`;
    const s = summary.get(k) ?? { direction: r.direction, vatCode: r.vatCode, vatName: r.vatName, vatKind: r.vatKind, net: 0, vat: 0, gross: 0, count: 0 };
    s.net = round2(s.net + Number(r.netHuf));
    s.vat = round2(s.vat + Number(r.vatHuf));
    s.gross = round2(s.gross + Number(r.grossHuf));
    s.count++;
    summary.set(k, s);
  }
  const all = [...summary.values()];
  const payable = round2(all.filter((s) => s.direction === "out" || ["reverse_charge", "eu_acquisition"].includes(s.vatKind)).reduce((a, s) => a + s.vat, 0));
  // Alanyi ÁFA-mentesnél (v2.0) nincs levonható ÁFA – a fordított adózás ÁFÁ-ja csak fizetendő.
  const deductible = opts.noInputVatDeduction
    ? 0
    : round2(all.filter((s) => s.direction === "in" && s.vatKind !== "non_deductible").reduce((a, s) => a + s.vat, 0));
  return { rows, summary: all, payable, deductible, balance: round2(payable - deductible) };
}

/** Nyitott vevő / szállító tételek. */
export async function openItems(companyId: number, direction: "out" | "in") {
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      partnerName: partners.name,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      currency: invoices.currency,
      grossFx: invoices.grossFx,
      grossHuf: invoices.grossHuf,
      paidFx: sql<number>`coalesce((select sum(p.amount_fx) from payments p join journal_entries je on je.id = p.journal_entry_id where p.invoice_id = "invoices"."id" and je.reversed_by_id is null), 0)::float8`,
    })
    .from(invoices)
    .innerJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.direction, direction), eq(invoices.status, "posted")))
    .orderBy(asc(invoices.dueDate));
  return rows.map((r) => ({ ...r, openFx: round2(Number(r.grossFx) - Number(r.paidFx)) })).filter((r) => Math.abs(r.openFx) >= 0.005);
}

/** Gépkocsi készlet könyv szerinti értékkel. */
export async function vehicleStock(companyId: number) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const [inv] = await db.select().from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, company.settings.inventoryGoods)));
  const list = await db
    .select({
      v: vehicles,
      bookValue: sql<number>`coalesce((select sum(jl.debit - jl.credit) from journal_lines jl where jl.vehicle_id = "vehicles"."id" and jl.account_id = ${inv?.id ?? 0}), 0)::float8`,
      totalCost: sql<number>`coalesce((select sum(jl.debit) from journal_lines jl where jl.vehicle_id = "vehicles"."id" and jl.account_id = ${inv?.id ?? 0}), 0)::float8`,
      revenue: sql<number>`coalesce((select sum(il.net_huf) from invoice_lines il join invoices i on i.id = il.invoice_id where il.vehicle_id = "vehicles"."id" and i.direction = 'out' and i.status = 'posted'), 0)::float8`,
    })
    .from(vehicles)
    .where(eq(vehicles.companyId, companyId))
    .orderBy(desc(vehicles.id));
  return list.map((x) => ({ ...x.v, bookValue: round2(Number(x.bookValue)), totalCost: round2(Number(x.totalCost)), revenue: round2(Number(x.revenue)) }));
}

export async function invoicePayments(invoiceId: number) {
  return db
    .select({ p: payments, accountCode: accounts.code, accountName: accounts.name, entryNumber: journalEntries.number, reversed: journalEntries.reversedById })
    .from(payments)
    .innerJoin(accounts, eq(accounts.id, payments.moneyAccountId))
    .innerJoin(journalEntries, eq(journalEntries.id, payments.journalEntryId))
    .where(eq(payments.invoiceId, invoiceId))
    .orderBy(asc(payments.date));
}

/** Napi, számlánkénti forgalmak (T − K) a kimutatásokhoz. */
export async function dailyRows(companyId: number, to: string) {
  const rows = await db
    .select({
      code: accounts.code,
      date: journalEntries.date,
      amount: sql<number>`sum(${journalLines.debit} - ${journalLines.credit})::float8`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.companyId, companyId), lte(journalEntries.date, to)))
    .groupBy(accounts.code, journalEntries.date);
  return rows.map((r) => ({ code: r.code, date: r.date, amount: Number(r.amount) }));
}
