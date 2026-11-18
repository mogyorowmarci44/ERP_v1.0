/**
 * v2.2 – Adatexport (mm-erp-export/1): a cég könyvelése egy időszakra, gépi (JSON) és olvasható (Excel) formában.
 * A JSON-ban minden tétel saját azonosítóval (bizonylatszám, számla id, partner / gépkocsi kulcs) szerepel,
 * így egy kiegészítő csomag (mm-erp-delta/1) pontosan hivatkozhat rájuk.
 */
import ExcelJS from "exceljs";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeTheme } from "./themes";
import { brandWorkbook, finish, palette, sheet, d, HUF, type Col } from "./invoice-export";

const s = schema;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const partnerKey = (id: number | null | undefined) => (id ? `P${id}` : null);
export const vehicleKey = (id: number | null | undefined) => (id ? `V${id}` : null);

export async function buildExport(companyId: number, from: string, to: string) {
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, companyId));
  const [accounts, vatCodes, journals, partners, vehicles, locks] = await Promise.all([
    db.select().from(s.accounts).where(eq(s.accounts.companyId, companyId)).orderBy(asc(s.accounts.code)),
    db.select().from(s.vatCodes).where(eq(s.vatCodes.companyId, companyId)),
    db.select().from(s.journals).where(eq(s.journals.companyId, companyId)),
    db.select().from(s.partners).where(eq(s.partners.companyId, companyId)).orderBy(asc(s.partners.id)),
    db.select().from(s.vehicles).where(eq(s.vehicles.companyId, companyId)).orderBy(asc(s.vehicles.id)),
    db.select().from(s.periodLocks).where(eq(s.periodLocks.companyId, companyId)),
  ]);
  const accCode = new Map(accounts.map((a) => [a.id, a.code]));
  const vatCode = new Map(vatCodes.map((v) => [v.id, v.code]));
  const jCode = new Map(journals.map((j) => [j.id, j.code]));

  // --- napló ---
  const entries = await db.select().from(s.journalEntries)
    .where(and(eq(s.journalEntries.companyId, companyId), gte(s.journalEntries.date, from), lte(s.journalEntries.date, to)))
    .orderBy(asc(s.journalEntries.date), asc(s.journalEntries.number));
  const eIds = entries.map((e) => e.id);
  const lines = eIds.length ? await db.select().from(s.journalLines).where(inArray(s.journalLines.entryId, eIds)).orderBy(asc(s.journalLines.id)) : [];
  const allNumbers = new Map((await db.select({ id: s.journalEntries.id, number: s.journalEntries.number }).from(s.journalEntries).where(eq(s.journalEntries.companyId, companyId))).map((r) => [r.id, r.number]));
  const refs = await db.select().from(s.importRefs).where(eq(s.importRefs.companyId, companyId));
  const refOfEntry = new Map(refs.filter((r) => r.journalEntryId).map((r) => [r.journalEntryId!, r.ref]));

  // --- számlák (a teljesítés vagy a kelte az időszakban) ---
  const invoices = await db.select().from(s.invoices)
    .where(and(eq(s.invoices.companyId, companyId), sql`(${s.invoices.fulfillmentDate} between ${from} and ${to} or ${s.invoices.issueDate} between ${from} and ${to})`))
    .orderBy(asc(s.invoices.fulfillmentDate), asc(s.invoices.id));
  const iIds = invoices.map((i) => i.id);
  const [iLines, pays] = iIds.length
    ? await Promise.all([
        db.select().from(s.invoiceLines).where(inArray(s.invoiceLines.invoiceId, iIds)).orderBy(asc(s.invoiceLines.invoiceId), asc(s.invoiceLines.position)),
        db.select().from(s.payments).where(inArray(s.payments.invoiceId, iIds)).orderBy(asc(s.payments.date)),
      ])
    : [[], []];
  const invOfEntry = new Map<number, string>();
  for (const i of invoices) if (i.journalEntryId) invOfEntry.set(i.journalEntryId, `${i.direction === "in" ? "szállítói" : "vevő"} ${i.invoiceNumber}`);
  const open = iIds.length
    ? new Map(((await db.execute(sql`
        select i.id, (i.gross_fx - coalesce((select sum(p.amount_fx) from payments p join journal_entries e on e.id = p.journal_entry_id where p.invoice_id = i.id and e.reversed_by_id is null), 0))::float8 open
        from invoices i where i.id in ${sql.raw(`(${iIds.join(",")})`)}`)) as unknown as Array<{ id: number; open: number }>).map((r) => [r.id, Number(r.open)]))
    : new Map<number, number>();

  // --- záró egyenlegek az időszak végén ---
  const balances = (await db.execute(sql`
    select a.code, a.name, sum(jl.debit)::float8 debit, sum(jl.credit)::float8 credit
    from journal_lines jl join journal_entries e on e.id = jl.entry_id join accounts a on a.id = jl.account_id
    where jl.company_id = ${companyId} and e.date <= ${to} group by a.code, a.name order by a.code`)) as unknown as Array<{ code: string; name: string; debit: number; credit: number }>;

  const assets = await db.select().from(s.fixedAssets).where(eq(s.fixedAssets.companyId, companyId));
  const loanTerms = await db.select().from(s.memberLoanTerms).where(eq(s.memberLoanTerms.companyId, companyId));
  const batches = await db.select().from(s.importBatches).where(eq(s.importBatches.companyId, companyId)).orderBy(asc(s.importBatches.id));

  return {
    format: "mm-erp-export/1" as const,
    exportedAt: new Date().toISOString(),
    company: { id: company.id, name: company.name, taxNumber: company.taxNumber, entityType: company.entityType, fiscalYearStartMonth: company.fiscalYearStartMonth },
    period: { from, to },
    periodLocks: locks.map((l) => `${l.year}-${String(l.month).padStart(2, "0")}`).sort(),
    accounts: accounts.map((a) => ({ code: a.code, name: a.name, type: a.type, currency: a.currency, posting: a.isPosting })),
    vatCodes: vatCodes.map((v) => ({ code: v.code, name: v.name, rate: num(v.rate), kind: v.kind })),
    journals: journals.map((j) => ({ code: j.code, name: j.name })),
    partners: partners.map((p) => ({ key: partnerKey(p.id), name: p.name, taxNumber: p.taxNumber, country: p.country, isPrivatePerson: p.isPrivatePerson })),
    vehicles: vehicles.map((v) => ({ key: vehicleKey(v.id), make: v.make, model: v.model, plate: v.plate, vin: v.vin, year: v.year, status: v.status, vatTreatment: v.vatTreatment, purchaseDate: v.purchaseDate, purchasePrice: num(v.purchasePrice) })),
    invoices: invoices.map((i) => ({
      id: i.id, direction: i.direction, number: i.invoiceNumber, partner: partnerKey(i.partnerId), status: i.status,
      issueDate: i.issueDate, fulfillmentDate: i.fulfillmentDate, dueDate: i.dueDate, paymentMethod: i.paymentMethod,
      currency: i.currency, exchangeRate: num(i.exchangeRate), periodic: i.periodic,
      net: num(i.netHuf), vat: num(i.vatHuf), gross: num(i.grossHuf), grossFx: num(i.grossFx), openFx: open.get(i.id) ?? null,
      entry: i.journalEntryId ? allNumbers.get(i.journalEntryId) ?? null : null, note: i.note,
      lines: iLines.filter((l) => l.invoiceId === i.id).map((l) => ({
        lineId: l.id, description: l.description, quantity: num(l.quantity), unitPrice: num(l.unitPrice), vatCode: vatCode.get(l.vatCodeId) ?? null,
        account: accCode.get(l.accountId) ?? null, vehicle: vehicleKey(l.vehicleId), net: num(l.netHuf), vat: num(l.vatHuf), gross: num(l.grossHuf),
      })),
      payments: pays.filter((p) => p.invoiceId === i.id).map((p) => ({ id: p.id, date: p.date, account: accCode.get(p.moneyAccountId) ?? null, amountFx: num(p.amountFx), amountHuf: num(p.amountHuf), entry: p.journalEntryId ? allNumbers.get(p.journalEntryId) ?? null : null })),
    })),
    journal: entries.map((e) => ({
      number: e.number, journal: jCode.get(e.journalId) ?? null, date: e.date, description: e.description,
      source: e.sourceType, invoice: invOfEntry.get(e.id) ?? null, importRef: refOfEntry.get(e.id) ?? null,
      reversalOf: e.reversalOfId ? allNumbers.get(e.reversalOfId) ?? null : null, reversedBy: e.reversedById ? allNumbers.get(e.reversedById) ?? null : null,
      lines: lines.filter((l) => l.entryId === e.id).map((l) => ({
        account: accCode.get(l.accountId) ?? null, debit: num(l.debit), credit: num(l.credit), description: l.description,
        partner: partnerKey(l.partnerId), vehicle: vehicleKey(l.vehicleId), currency: l.currency, amountFx: num(l.amountFx),
      })),
    })),
    balances: balances.map((b) => ({ code: b.code, name: b.name, debit: Number(b.debit), credit: Number(b.credit), balance: Math.round((Number(b.debit) - Number(b.credit)) * 100) / 100 })),
    fixedAssets: assets.map((a) => ({ id: a.id, inventoryNo: a.inventoryNo, name: a.name, account: a.accountCode, activationDate: a.activationDate, cost: num(a.cost), method: a.method, usefulLifeMonths: a.usefulLifeMonths, status: a.status, invoiceLineId: a.invoiceLineId })),
    memberLoanTerms: loanTerms.map((t) => ({ entry: allNumbers.get(t.entryId) ?? null, contractNo: t.contractNo, dueDate: t.dueDate, originalDueDate: t.originalDueDate })),
    importBatches: batches.map((b) => ({ id: b.id, at: b.createdAt.toISOString(), fileName: b.fileName, note: b.note, items: b.items })),
  };
}

export type ExportData = Awaited<ReturnType<typeof buildExport>>;

/** Olvasható Excel ugyanabból az adatból: napló (soronként), számlák, egyenlegek. */
export async function buildExportWorkbook(x: ExportData) {
  const [company] = await db.select({ theme: s.companies.theme }).from(s.companies).where(eq(s.companies.id, x.company.id));
  const pal = palette(normalizeTheme(company.theme).accent);
  const meta = { company: x.company.name, period: `${x.period.from} – ${x.period.to}`, pal };
  const wb = new ExcelJS.Workbook();
  brandWorkbook(wb);
  const pName = new Map(x.partners.map((p) => [p.key, p.name]));
  const vName = new Map(x.vehicles.map((v) => [v.key, `${v.make} ${v.model}${v.plate ? ` ${v.plate}` : ""}`]));
  const aName = new Map(x.accounts.map((a) => [a.code, a.name]));

  const jCols: Col[] = [
    { header: "Bizonylatszám", key: "num", width: 18 }, { header: "Dátum", key: "date", width: 12, date: true }, { header: "Napló", key: "j", width: 7 },
    { header: "Megnevezés", key: "desc", width: 42 }, { header: "Számla", key: "acc", width: 9 }, { header: "Számla neve", key: "accName", width: 28 },
    { header: "Tartozik", key: "debit", width: 14, fmt: HUF }, { header: "Követel", key: "credit", width: 14, fmt: HUF },
    { header: "Partner", key: "partner", width: 24 }, { header: "Gépkocsi", key: "vehicle", width: 22 }, { header: "Forrás", key: "src", width: 22 },
  ];
  const ws1 = sheet(wb, "Napló", "Napló", jCols, meta);
  for (const e of x.journal) for (const l of e.lines) ws1.addRow({
    num: e.number, date: d(e.date), j: e.journal, desc: l.description || e.description, acc: l.account, accName: aName.get(l.account ?? "") ?? "",
    debit: l.debit || null, credit: l.credit || null, partner: pName.get(l.partner ?? "") ?? "", vehicle: vName.get(l.vehicle ?? "") ?? "",
    src: e.reversalOf ? `storno: ${e.reversalOf}` : e.invoice ?? (e.importRef ? `csomag: ${e.importRef}` : e.source ?? ""),
  });
  finish(ws1, pal, jCols, (r) => String(r.getCell("num").value ?? ""));

  const iCols: Col[] = [
    { header: "Irány", key: "dir", width: 9 }, { header: "Számlaszám", key: "num", width: 18 }, { header: "Partner", key: "partner", width: 26 },
    { header: "Teljesítés", key: "ful", width: 12, date: true }, { header: "Állapot", key: "st", width: 11 }, { header: "Nettó", key: "net", width: 14, fmt: HUF },
    { header: "ÁFA", key: "vat", width: 12, fmt: HUF }, { header: "Bruttó", key: "gross", width: 14, fmt: HUF }, { header: "Nyitott (dev.)", key: "open", width: 14, fmt: HUF },
    { header: "Tételek", key: "lines", width: 50 }, { header: "Napló", key: "entry", width: 18 },
  ];
  const ws2 = sheet(wb, "Számlák", "Számlák", iCols, meta);
  for (const i of x.invoices) ws2.addRow({
    dir: i.direction === "in" ? "Szállítói" : "Vevő", num: i.number, partner: pName.get(i.partner ?? "") ?? "", ful: d(i.fulfillmentDate), st: i.status,
    net: i.net, vat: i.vat, gross: i.gross, open: i.openFx || null, lines: i.lines.map((l) => `${l.account} ${l.description}`).join(" · "), entry: i.entry ?? "",
  });
  finish(ws2, pal, iCols);

  const bCols: Col[] = [
    { header: "Számla", key: "code", width: 9 }, { header: "Megnevezés", key: "name", width: 40 },
    { header: "Tartozik forgalom", key: "debit", width: 16, fmt: HUF }, { header: "Követel forgalom", key: "credit", width: 16, fmt: HUF }, { header: "Egyenleg (T−K)", key: "bal", width: 16, fmt: HUF },
  ];
  const ws3 = sheet(wb, "Egyenlegek", `Egyenlegek ${x.period.to}-ig`, bCols, meta);
  for (const b of x.balances) ws3.addRow({ code: b.code, name: b.name, debit: b.debit, credit: b.credit, bal: b.balance });
  finish(ws3, pal, bCols);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
