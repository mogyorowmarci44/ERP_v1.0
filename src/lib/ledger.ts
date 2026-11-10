/**
 * Főkönyvi szolgáltatások: cég létrehozás, könyvelés, számlák, pénzügyi rendezés, storno.
 * Minden könyvelő művelet egy adatbázis-tranzakcióban fut.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type DbOrTx, type Tx } from "@/db";
import { ACCOUNT_CURRENCY, DEFAULT_COA, DEFAULT_JOURNALS, DEFAULT_SETTINGS, DEFAULT_VAT_CODES, isPostingCode } from "./coa";
import {
  assertBalanced,
  buildInvoicePosting,
  buildPaymentPosting,
  stornoLines,
  type DraftLine,
  type VatKind,
} from "./posting";
import { round2, roundHuf } from "./money";
import { vatRateDate } from "./fx";
import { getMnbRate } from "./fx-service";

const { accounts, companies, memberships, vatCodes, journals, journalEntries, journalLines, invoices, invoiceLines, partners, vehicles, payments, periodLocks } =
  schema;

/** Meglévő tranzakcióban fut, vagy újat nyit (az importálás egyetlen tranzakcióban viszi végig az egészet). */
function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.transaction(fn);
}

// ---------------------------------------------------------------------------
// Cég
// ---------------------------------------------------------------------------

export type NewCompany = {
  name: string;
  taxNumber?: string | null;
  euVatNumber?: string | null;
  registrationNumber?: string | null;
  address?: string | null;
  vatPeriod?: "monthly" | "quarterly" | "yearly";
  fiscalYearStartMonth?: number;
};

export async function createCompany(userId: number, data: NewCompany, outerTx?: Tx) {
  return inTx(outerTx, async (tx) => {
    const [c] = await tx
      .insert(companies)
      .values({ ...data, settings: DEFAULT_SETTINGS })
      .returning();
    await tx.insert(memberships).values({ userId, companyId: c.id, role: "owner" });
    await tx.insert(accounts).values(
      DEFAULT_COA.map(([code, name, type, reportLine]) => ({
        companyId: c.id,
        code,
        name,
        type,
        reportLine: reportLine ?? null,
        isPosting: isPostingCode(code),
        currency: ACCOUNT_CURRENCY[code] ?? "HUF",
      })),
    );
    await tx.insert(vatCodes).values(DEFAULT_VAT_CODES.map((v) => ({ ...v, companyId: c.id })));
    await tx.insert(journals).values(DEFAULT_JOURNALS.map((j) => ({ ...j, companyId: c.id })));
    return c;
  });
}

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

export async function accountIdByCode(tx: DbOrTx, companyId: number, code: string): Promise<number> {
  const [a] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  if (!a) throw new Error(`Hiányzó főkönyvi számla: ${code}`);
  return a.id;
}

export async function assertPeriodOpen(tx: DbOrTx, companyId: number, date: string) {
  const [y, m] = date.split("-").map(Number);
  const [lock] = await tx
    .select()
    .from(periodLocks)
    .where(and(eq(periodLocks.companyId, companyId), eq(periodLocks.year, y), eq(periodLocks.month, m)));
  if (lock) throw new Error(`A ${y}. ${String(m).padStart(2, "0")}. időszak le van zárva, oda nem lehet könyvelni.`);
}

async function nextEntryNumber(tx: Tx, companyId: number, journalCode: string, date: string) {
  const year = date.slice(0, 4);
  const prefix = `${journalCode}-${year}/`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:${prefix}`}))`);
  const [row] = await tx
    .select({ max: sql<string | null>`max(${journalEntries.number})` })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), sql`${journalEntries.number} like ${prefix + "%"}`));
  const last = row?.max ? Number(row.max.slice(prefix.length)) : 0;
  return `${prefix}${String(last + 1).padStart(6, "0")}`;
}

/** Ellenőrzi, hogy a sorokban szereplő számlák a céghez tartoznak és könyvelhetők. */
async function validateAccounts(tx: DbOrTx, companyId: number, lines: DraftLine[]) {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code, isPosting: accounts.isPosting, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), inArray(accounts.id, ids)));
  if (rows.length !== ids.length) throw new Error("Ismeretlen főkönyvi számla a tételben.");
  const bad = rows.find((r) => !r.isPosting || !r.isActive);
  if (bad) throw new Error(`A(z) ${bad.code} számlára nem lehet könyvelni (gyűjtő vagy inaktív).`);
}

export type PostEntryInput = {
  companyId: number;
  journalCode: string;
  date: string;
  description: string;
  sourceType?: string;
  sourceId?: number;
  reversalOfId?: number;
  userId?: number;
  lines: DraftLine[];
};

export async function postEntry(tx: Tx, input: PostEntryInput) {
  assertBalanced(input.lines);
  await assertPeriodOpen(tx, input.companyId, input.date);
  await validateAccounts(tx, input.companyId, input.lines);
  const [journal] = await tx
    .select()
    .from(journals)
    .where(and(eq(journals.companyId, input.companyId), eq(journals.code, input.journalCode)));
  if (!journal) throw new Error(`Ismeretlen napló: ${input.journalCode}`);
  const number = await nextEntryNumber(tx, input.companyId, journal.code, input.date);
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId: input.companyId,
      journalId: journal.id,
      number,
      date: input.date,
      description: input.description,
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      createdBy: input.userId ?? null,
    })
    .returning();
  await tx.insert(journalLines).values(
    input.lines
      .filter((l) => l.debit !== 0 || l.credit !== 0)
      .map((l) => ({
        entryId: entry.id,
        companyId: input.companyId,
        accountId: l.accountId,
        debit: round2(l.debit),
        credit: round2(l.credit),
        description: l.description ?? null,
        partnerId: l.partnerId ?? null,
        vehicleId: l.vehicleId ?? null,
        vatCodeId: l.vatCodeId ?? null,
        currency: l.currency ?? null,
        amountFx: l.amountFx ?? null,
        fxRate: l.fxRate ?? null,
      })),
  );
  return entry;
}

/** Tétel stornózása (piros storno) – az eredeti tétel megmarad, hivatkozással. */
export async function reverseEntry(tx: Tx, companyId: number, entryId: number, date: string, userId?: number, reason?: string) {
  const [orig] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
  if (!orig) throw new Error("A tétel nem található.");
  if (orig.reversedById) throw new Error("Ez a tétel már stornózva van.");
  if (orig.reversalOfId) throw new Error("Storno tételt nem lehet stornózni.");
  const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  const [journal] = await tx.select().from(journals).where(eq(journals.id, orig.journalId));
  const rev = await postEntry(tx, {
    companyId,
    journalCode: journal.code,
    date,
    description: `STORNO ${orig.number}${reason ? ` – ${reason}` : ""}`,
    sourceType: "storno",
    sourceId: orig.sourceId ?? undefined,
    reversalOfId: orig.id,
    userId,
    lines: stornoLines(lines),
  });
  await tx.update(journalEntries).set({ reversedById: rev.id }).where(eq(journalEntries.id, orig.id));
  return rev;
}

export async function manualEntry(
  companyId: number,
  input: { journalCode: string; date: string; description: string; lines: DraftLine[]; sourceType?: string },
  userId?: number,
  outerTx?: Tx,
) {
  for (const l of input.lines) {
    if (l.debit < 0 || l.credit < 0) throw new Error("Kézi tételben nem lehet negatív összeg (használd a stornót).");
    if (l.debit !== 0 && l.credit !== 0) throw new Error("Egy sorban vagy Tartozik, vagy Követel összeg legyen.");
  }
  return inTx(outerTx, async (tx) => {
    // Devizás pénzeszköz számlán a devizaösszeg is kötelező (átlagár-nyilvántartás miatt)
    const ids = [...new Set(input.lines.map((l) => l.accountId))];
    const accRows = ids.length ? await tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.id, ids))) : [];
    const lines = input.lines.map((l) => {
      const a = accRows.find((x) => x.id === l.accountId);
      if (a && a.currency !== "HUF") {
        if (!l.amountFx || !(l.amountFx > 0)) throw new Error(`A(z) ${a.code} devizás számlán a ${a.currency} összeget is meg kell adni.`);
        const huf = l.debit || l.credit;
        return { ...l, currency: a.currency, fxRate: Math.round((huf / l.amountFx) * 1e6) / 1e6 };
      }
      return { ...l, currency: null, amountFx: null, fxRate: null };
    });
    return postEntry(tx, { companyId, journalCode: input.journalCode, date: input.date, description: input.description, lines, sourceType: input.sourceType ?? "manual", userId });
  });
}

// ---------------------------------------------------------------------------
// Gépkocsik
// ---------------------------------------------------------------------------

/** A gépkocsi könyv szerinti értéke a készletszámlán (bekerülési érték + aktivált javítások). */
export async function vehicleBookValues(tx: DbOrTx, companyId: number, vehicleIds: number[]) {
  const res = new Map<number, number>();
  if (vehicleIds.length === 0) return res;
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  const invId = await accountIdByCode(tx, companyId, company.settings.inventoryGoods);
  const rows = await tx
    .select({ vehicleId: journalLines.vehicleId, bal: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::float8` })
    .from(journalLines)
    .where(and(eq(journalLines.companyId, companyId), eq(journalLines.accountId, invId), inArray(journalLines.vehicleId, vehicleIds)))
    .groupBy(journalLines.vehicleId);
  for (const r of rows) res.set(r.vehicleId!, round2(Number(r.bal)));
  return res;
}

/**
 * Különbözeti ÁFA alap: a gépkocsin megadott beszerzési ár, ha nincs megadva,
 * akkor a gépkocsira könyvelt különbözeti (ÁFA nélküli) beszerzési számlák végösszege.
 */
export async function marginPurchaseBase(tx: DbOrTx, companyId: number, vehicleId: number): Promise<number> {
  const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId)));
  if (!v) throw new Error("A gépkocsi nem található.");
  if (v.purchasePrice !== null && v.purchasePrice !== undefined) return Number(v.purchasePrice);
  const [row] = await tx
    .select({ s: sql<number>`coalesce(sum(${invoiceLines.grossHuf}), 0)::float8` })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.direction, "in"),
        eq(invoices.status, "posted"),
        eq(invoiceLines.vehicleId, vehicleId),
        inArray(vatCodes.kind, ["margin", "out_of_scope", "exempt"]),
      ),
    );
  return Number(row?.s ?? 0);
}

// ---------------------------------------------------------------------------
// Számlák
// ---------------------------------------------------------------------------

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatCodeId: number;
  accountId: number;
  vehicleId?: number | null;
};

export type InvoiceInput = {
  direction: "out" | "in";
  partnerId: number;
  invoiceNumber: string;
  issueDate: string;
  fulfillmentDate: string;
  dueDate?: string | null;
  paymentMethod: string;
  currency: string;
  /** Csak kézi árfolyamnál számít; egyébként a szerver MNB-ből tölti. */
  exchangeRate: number;
  rateManual?: boolean;
  periodic?: boolean;
  note?: string | null;
  lines: InvoiceLineInput[];
  /** Belső: a már eltárolt MNB árfolyam újrahasznosítása könyveléskor. */
  storedRate?: { rate: number; rateDate: string | null } | null;
};

async function loadPostingContext(tx: DbOrTx, companyId: number, partnerId: number, direction: "out" | "in") {
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  const [partner] = await tx.select().from(partners).where(and(eq(partners.id, partnerId), eq(partners.companyId, companyId)));
  if (!partner) throw new Error("A partner nem található.");
  const s = company.settings;
  const foreign = partner.country !== "HU";
  const partnerCode = direction === "out" ? (foreign ? s.receivableForeign : s.receivableDomestic) : foreign ? s.payableForeign : s.payableDomestic;
  return {
    company,
    partner,
    acc: {
      partnerAccountId: await accountIdByCode(tx, companyId, partnerCode),
      inputVatId: await accountIdByCode(tx, companyId, s.inputVat),
      outputVatId: await accountIdByCode(tx, companyId, s.outputVat),
      inventoryId: await accountIdByCode(tx, companyId, s.inventoryGoods),
      cogsId: await accountIdByCode(tx, companyId, s.cogs),
    },
  };
}

async function buildFromInput(tx: DbOrTx, companyId: number, input: InvoiceInput, withBookValues: boolean) {
  if (input.lines.length === 0) throw new Error("A számlának legalább egy tétele kell legyen.");
  const ctx = await loadPostingContext(tx, companyId, input.partnerId, input.direction);
  const codeIds = [...new Set(input.lines.map((l) => l.vatCodeId))];
  const codes = await tx.select().from(vatCodes).where(and(eq(vatCodes.companyId, companyId), inArray(vatCodes.id, codeIds)));
  const codeMap = new Map(codes.map((c) => [c.id, c]));
  const rateInfo = await resolveInvoiceRate(tx, input, codes.map((c) => c.kind));
  const fxRate = rateInfo.rate;

  const lines = [];
  for (const l of input.lines) {
    const vc = codeMap.get(l.vatCodeId);
    if (!vc) throw new Error("Ismeretlen ÁFA-kód.");
    let marginPurchaseHuf: number | null = null;
    if (vc.kind === "margin" && input.direction === "out") {
      if (!l.vehicleId) throw new Error(`Különbözeti tételhez gépkocsit kell választani: „${l.description}”`);
      marginPurchaseHuf = await marginPurchaseBase(tx, companyId, l.vehicleId);
    }
    lines.push({ ...l, vatRate: Number(vc.rate), vatKind: vc.kind as VatKind, marginPurchaseHuf });
  }
  const vehicleIds = input.direction === "out" ? lines.filter((l) => l.vehicleId).map((l) => l.vehicleId!) : [];
  const bv = withBookValues ? await vehicleBookValues(tx, companyId, vehicleIds) : new Map<number, number>();
  const posting = buildInvoicePosting(
    { direction: input.direction, partnerId: input.partnerId, currency: input.currency, fxRate, invoiceNumber: input.invoiceNumber, lines },
    ctx.acc,
    bv,
  );
  return { posting, lines, fxRate, rateInfo, ctx };
}

/**
 * A számla átszámítási árfolyama: az Áfa tv. 80. § / 63. § szerinti napon érvényes MNB árfolyam
 * (a cég a NAV-nál az MNB árfolyamot jelentette be), kivéve ha kézzel adták meg.
 * Ugyanez a követelés / kötelezettség könyv szerinti árfolyama (Szt. 60. § (5a)).
 */
export async function resolveInvoiceRate(tx: DbOrTx, input: InvoiceInput, vatKinds: string[]) {
  if (input.currency === "HUF") return { rate: 1, rateDate: null as string | null, source: "MNB" };
  const { date } = vatRateDate({ issueDate: input.issueDate, fulfillmentDate: input.fulfillmentDate, periodic: !!input.periodic, vatKinds });
  if (input.rateManual) {
    if (!(input.exchangeRate > 0)) throw new Error("Kézi árfolyamnál meg kell adni az árfolyamot.");
    return { rate: input.exchangeRate, rateDate: date, source: "manual" };
  }
  if (input.storedRate && input.storedRate.rateDate === date && input.storedRate.rate > 0) {
    return { rate: input.storedRate.rate, rateDate: date, source: "MNB" };
  }
  const r = await getMnbRate(input.currency, date, tx);
  return { rate: r.rate, rateDate: date, source: "MNB" };
}

/** Számla mentése piszkozatként (új vagy meglévő piszkozat felülírása). */
export async function saveInvoiceDraft(companyId: number, input: InvoiceInput, invoiceId?: number, outerTx?: Tx) {
  return inTx(outerTx, async (tx) => {
    const { posting, lines, fxRate, rateInfo } = await buildFromInput(tx, companyId, input, false);
    const header = {
      companyId,
      direction: input.direction,
      partnerId: input.partnerId,
      invoiceNumber: input.invoiceNumber.trim(),
      issueDate: input.issueDate,
      fulfillmentDate: input.fulfillmentDate,
      dueDate: input.dueDate || null,
      paymentMethod: input.paymentMethod,
      currency: input.currency,
      exchangeRate: fxRate,
      rateDate: rateInfo.rateDate,
      rateSource: rateInfo.source,
      periodic: !!input.periodic,
      netHuf: posting.totals.netHuf,
      vatHuf: posting.totals.vatHuf,
      grossHuf: posting.totals.payableHuf,
      grossFx: posting.totals.payableFx,
      note: input.note ?? null,
    };
    let id = invoiceId;
    if (id) {
      const [cur] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
      if (!cur) throw new Error("A számla nem található.");
      if (cur.status !== "draft") throw new Error("Csak piszkozat számla módosítható.");
      await tx.update(invoices).set(header).where(eq(invoices.id, id));
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    } else {
      const [ins] = await tx.insert(invoices).values(header).returning({ id: invoices.id });
      id = ins.id;
    }
    await tx.insert(invoiceLines).values(
      lines.map((l, i) => ({
        invoiceId: id!,
        position: i + 1,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatCodeId: l.vatCodeId,
        accountId: l.accountId,
        vehicleId: l.vehicleId ?? null,
        netHuf: posting.computed[i].netHuf,
        vatHuf: posting.computed[i].vatHuf,
        grossHuf: posting.computed[i].grossHuf,
        marginPurchaseHuf: l.marginPurchaseHuf,
      })),
    );
    return id!;
  });
}

async function loadInvoiceInput(tx: DbOrTx, companyId: number, invoiceId: number) {
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!inv) throw new Error("A számla nem található.");
  const ls = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position));
  const input: InvoiceInput = {
    direction: inv.direction,
    partnerId: inv.partnerId,
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.issueDate,
    fulfillmentDate: inv.fulfillmentDate,
    dueDate: inv.dueDate,
    paymentMethod: inv.paymentMethod,
    currency: inv.currency,
    exchangeRate: Number(inv.exchangeRate),
    rateManual: inv.rateSource === "manual",
    periodic: inv.periodic,
    storedRate: { rate: Number(inv.exchangeRate), rateDate: inv.rateDate },
    note: inv.note,
    lines: ls.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      vatCodeId: l.vatCodeId,
      accountId: l.accountId,
      vehicleId: l.vehicleId,
    })),
  };
  return { inv, input };
}

/** Számla könyvelése: főkönyvi tétel, gépkocsi státusz frissítés. */
export async function postInvoice(companyId: number, invoiceId: number, userId?: number, outerTx?: Tx) {
  return inTx(outerTx, async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${invoiceId} for update`);
    const { inv, input } = await loadInvoiceInput(tx, companyId, invoiceId);
    if (inv.status !== "draft") throw new Error("A számla már könyvelve vagy sztornózva van.");
    const { posting, lines, ctx, rateInfo } = await buildFromInput(tx, companyId, input, true);

    if (inv.direction === "out") {
      const soldIds = lines.filter((l) => l.vehicleId).map((l) => l.vehicleId!);
      if (soldIds.length) {
        const sold = await tx.select().from(vehicles).where(and(inArray(vehicles.id, soldIds), eq(vehicles.status, "sold")));
        if (sold.length) throw new Error(`A gépkocsi már el van adva: ${sold.map((v) => `${v.make} ${v.model} ${v.plate || v.vin || ""}`).join(", ")}`);
      }
    }

    const entry = await postEntry(tx, {
      companyId,
      journalCode: inv.direction === "out" ? "VE" : "SZ",
      date: inv.fulfillmentDate,
      description: `${inv.direction === "out" ? "Vevőszámla" : "Szállítói számla"} ${inv.invoiceNumber} – ${ctx.partner.name}`,
      sourceType: "invoice",
      sourceId: inv.id,
      userId,
      lines: posting.lines,
    });

    // Számított értékek frissítése (ÁFA alap a könyveléskori gépkocsi adatokból)
    for (let i = 0; i < lines.length; i++) {
      const c = posting.computed[i];
      await tx
        .update(invoiceLines)
        .set({ netHuf: c.netHuf, vatHuf: c.vatHuf, grossHuf: c.grossHuf, marginPurchaseHuf: lines[i].marginPurchaseHuf })
        .where(and(eq(invoiceLines.invoiceId, inv.id), eq(invoiceLines.position, i + 1)));
    }
    await tx
      .update(invoices)
      .set({
        status: "posted",
        journalEntryId: entry.id,
        exchangeRate: rateInfo.rate,
        rateDate: rateInfo.rateDate,
        rateSource: rateInfo.source,
        netHuf: posting.totals.netHuf,
        vatHuf: posting.totals.vatHuf,
        grossHuf: posting.totals.payableHuf,
        grossFx: posting.totals.payableFx,
      })
      .where(eq(invoices.id, inv.id));

    if (inv.direction === "out") {
      const soldIds = lines.filter((l) => l.vehicleId).map((l) => l.vehicleId!);
      if (soldIds.length) await tx.update(vehicles).set({ status: "sold" }).where(inArray(vehicles.id, soldIds));
    } else {
      // Beszerzési dátum kitöltése, ha még üres
      for (const l of lines.filter((x) => x.vehicleId && x.accountId === ctx.acc.inventoryId)) {
        await tx
          .update(vehicles)
          .set({ purchaseDate: inv.fulfillmentDate })
          .where(and(eq(vehicles.id, l.vehicleId!), sql`${vehicles.purchaseDate} is null`));
      }
    }
    return entry;
  });
}

/** Könyvelt számla sztornózása (piros storno). Csak akkor, ha nincs hozzá pénzügyi rendezés. */
export async function cancelInvoice(companyId: number, invoiceId: number, date: string, userId?: number) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
    if (!inv) throw new Error("A számla nem található.");
    if (inv.status === "draft") {
      await tx.delete(invoices).where(eq(invoices.id, inv.id));
      return null;
    }
    if (inv.status === "cancelled") throw new Error("A számla már sztornózva van.");
    const pays = await tx.select().from(payments).where(eq(payments.invoiceId, inv.id));
    const activePays = [];
    for (const p of pays) {
      const [e] = await tx.select().from(journalEntries).where(eq(journalEntries.id, p.journalEntryId!));
      if (e && !e.reversedById) activePays.push(p);
    }
    if (activePays.length) throw new Error("A számlához pénzügyi rendezés tartozik – előbb azt kell sztornózni.");
    const rev = await reverseEntry(tx, companyId, inv.journalEntryId!, date, userId, `számla sztornó ${inv.invoiceNumber}`);
    await tx.update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, inv.id));
    if (inv.direction === "out") {
      const ls = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
      const ids = ls.filter((l) => l.vehicleId).map((l) => l.vehicleId!);
      if (ids.length) await tx.update(vehicles).set({ status: "in_stock" }).where(inArray(vehicles.id, ids));
    }
    return rev;
  });
}

// ---------------------------------------------------------------------------
// Pénzügyi rendezés
// ---------------------------------------------------------------------------

export async function invoiceOpenAmount(tx: DbOrTx, invoiceId: number) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  const rows = await tx
    .select({ amountFx: payments.amountFx, partnerHuf: payments.partnerHuf, reversed: journalEntries.reversedById })
    .from(payments)
    .innerJoin(journalEntries, eq(journalEntries.id, payments.journalEntryId))
    .where(eq(payments.invoiceId, invoiceId));
  const active = rows.filter((r) => !r.reversed);
  const paidFx = round2(active.reduce((s, r) => s + Number(r.amountFx), 0));
  const paidHuf = round2(active.reduce((s, r) => s + Number(r.partnerHuf), 0));
  return { openFx: round2(Number(inv.grossFx) - paidFx), openHuf: round2(Number(inv.grossHuf) - paidHuf) };
}

/** Devizás pénzeszköz számla egyenlege adott napig: forint könyv szerinti érték és devizaállomány. */
export async function fxAccountBalance(tx: DbOrTx, accountId: number, date: string) {
  const [r] = await tx
    .select({
      huf: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::float8`,
      fx: sql<number>`coalesce(sum(case when ${journalLines.debit} <> 0 then ${journalLines.amountFx} else -${journalLines.amountFx} end), 0)::float8`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), sql`${journalEntries.date} <= ${date}`));
  return { huf: round2(Number(r.huf)), fx: round2(Number(r.fx)) };
}

export type PaymentRequest = {
  date: string;
  moneyAccountId: number;
  /** Kiegyenlített összeg a számla devizájában. */
  amountFx: number;
  /** Devizás számla forintszámláról: a ténylegesen terhelt / jóváírt forint. */
  moneyHuf?: number | null;
  /** Devizaszámlára befolyó összeg árfolyama – üresen az aznapi MNB. */
  fxRate?: number | null;
  note?: string | null;
};

export async function payInvoice(companyId: number, invoiceId: number, input: PaymentRequest, userId?: number, outerTx?: Tx) {
  return inTx(outerTx, async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${invoiceId} for update`);
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
    if (!inv || inv.status !== "posted") throw new Error("Csak könyvelt számla rendezhető.");
    if (!(input.amountFx > 0)) throw new Error("A kifizetett összeg legyen pozitív.");
    const open = await invoiceOpenAmount(tx, invoiceId);
    if (input.amountFx > open.openFx + 0.001) throw new Error(`A kifizetés meghaladja a nyitott összeget (${open.openFx} ${inv.currency}).`);
    const settles = Math.abs(open.openFx - input.amountFx) < 0.005;
    const ctx = await loadPostingContext(tx, companyId, inv.partnerId, inv.direction);
    const s = ctx.company.settings;
    const [moneyAcc] = await tx.select().from(accounts).where(and(eq(accounts.id, input.moneyAccountId), eq(accounts.companyId, companyId)));
    if (!moneyAcc || !moneyAcc.code.startsWith("38")) throw new Error("Pénzeszköz számlát (38x) kell választani.");

    const invRate = inv.currency === "HUF" ? 1 : Number(inv.exchangeRate);
    // Vevő / szállító oldal: könyv szerinti érték (teljes rendezésnél a teljes nyitott HUF egyenleg)
    const partnerHuf = settles ? open.openHuf : roundHuf(input.amountFx * invRate);

    // Pénzeszköz oldal – Szt. 60. §
    let moneyHuf: number;
    let moneyFx: { currency: string; rate: number } | null = null;
    if (moneyAcc.currency === "HUF") {
      if (inv.currency === "HUF") moneyHuf = input.amountFx;
      else {
        // Forintért vásárolt / eladott deviza: a ténylegesen fizetett / kapott forint
        if (!input.moneyHuf || !(input.moneyHuf > 0)) throw new Error("Add meg a forintszámlán ténylegesen terhelt / jóváírt összeget.");
        moneyHuf = input.moneyHuf;
      }
    } else {
      if (moneyAcc.currency !== inv.currency) throw new Error(`A ${moneyAcc.code} számla devizaneme ${moneyAcc.currency}, a számláé ${inv.currency}.`);
      if (inv.direction === "out") {
        // Befolyó deviza: választott (MNB) árfolyamon
        const rate = input.fxRate && input.fxRate > 0 ? input.fxRate : (await getMnbRate(inv.currency, input.date, tx)).rate;
        moneyHuf = roundHuf(input.amountFx * rate);
        moneyFx = { currency: inv.currency, rate };
      } else {
        // Kiáramló deviza: könyv szerinti értéken (átlagár módszer)
        const bal = await fxAccountBalance(tx, moneyAcc.id, input.date);
        if (bal.fx + 0.005 < input.amountFx) throw new Error(`Nincs elég deviza a ${moneyAcc.code} számlán (egyenleg: ${bal.fx} ${moneyAcc.currency}).`);
        moneyHuf = Math.abs(bal.fx - input.amountFx) < 0.005 ? bal.huf : roundHuf((input.amountFx * bal.huf) / bal.fx);
        moneyFx = { currency: inv.currency, rate: Math.round((moneyHuf / input.amountFx) * 1e6) / 1e6 };
      }
    }

    const res = buildPaymentPosting(
      {
        direction: inv.direction,
        partnerId: inv.partnerId,
        invoiceNumber: inv.invoiceNumber,
        currency: inv.currency,
        amountFx: input.amountFx,
        moneyHuf,
        moneyFx,
        partnerHuf,
        invoiceRate: invRate,
      },
      {
        partnerAccountId: ctx.acc.partnerAccountId,
        moneyAccountId: moneyAcc.id,
        fxGainId: await accountIdByCode(tx, companyId, s.fxGain),
        fxLossId: await accountIdByCode(tx, companyId, s.fxLoss),
      },
    );
    const entry = await postEntry(tx, {
      companyId,
      journalCode: moneyAcc.code.startsWith("381") ? "PE" : "BA",
      date: input.date,
      description: `${inv.direction === "out" ? "Befizetés" : "Kifizetés"} ${inv.invoiceNumber} – ${ctx.partner.name}`,
      sourceType: "payment",
      sourceId: inv.id,
      userId,
      lines: res.lines,
    });
    await tx.insert(payments).values({
      companyId,
      invoiceId,
      date: input.date,
      moneyAccountId: moneyAcc.id,
      amountFx: input.amountFx,
      fxRate: inv.currency === "HUF" ? 1 : Math.round((moneyHuf / input.amountFx) * 1e6) / 1e6,
      amountHuf: roundHuf(moneyHuf),
      partnerHuf,
      journalEntryId: entry.id,
      note: input.note ?? null,
    });
    return entry;
  });
}

export async function reversePayment(companyId: number, paymentId: number, date: string, userId?: number) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)));
    if (!p) throw new Error("A rendezés nem található.");
    return reverseEntry(tx, companyId, p.journalEntryId!, date, userId, "pénzügyi rendezés sztornó");
  });
}

export async function lockPeriod(companyId: number, year: number, month: number, userId?: number) {
  await db.insert(periodLocks).values({ companyId, year, month, lockedBy: userId ?? null }).onConflictDoNothing();
}

export async function unlockPeriod(companyId: number, year: number, month: number) {
  await db.delete(periodLocks).where(and(eq(periodLocks.companyId, companyId), eq(periodLocks.year, year), eq(periodLocks.month, month)));
}
