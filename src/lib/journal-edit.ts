/**
 * Lekönyvelt kézi (vegyes / bank / pénztár) tétel kiegészítő adatainak módosítása.
 * Csak a megnevezés, a sorok szövege, partnere és gépkocsija módosítható – összeg, főkönyvi számla
 * és dátum nem (azt sztornóval kell javítani). Minden változás a journal_line_changes táblába kerül.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { assertBalanced } from "./posting";
import { assertPeriodOpen, validateAccounts, payInvoice, type PaymentRequest } from "./ledger";
import { round2 } from "./money";

const { journalEntries, journalLines, journalLineChanges, partners, vehicles } = schema;

/** Kézi tétel szerkeszthető, ha nem sztornózott / nem sztornó és nincs „ellenőrzött” jelölése.
 *  (A számlából, rendezésből származó tételt a számlánál lehet javítani; tagi kölcsön tételt sztornóval.) */
export const EDITABLE_SOURCES = ["manual"];
type EntryLike = { sourceType: string | null; reversedById: number | null; reversalOfId: number | null; checkedAt?: Date | null };
export const canEditMeta = (e: EntryLike) => EDITABLE_SOURCES.includes(e.sourceType ?? "") && !e.reversedById && !e.reversalOfId && !e.checkedAt;
export const canEditEntry = canEditMeta;

export type LineMetaInput = { id: number; description: string | null; partnerId: number | null; vehicleId: number | null };

export async function updateEntryMeta(companyId: number, entryId: number, userId: number, input: { description: string; lines: LineMetaInput[] }) {
  const desc = input.description.trim();
  if (!desc) throw new Error("A megnevezés kötelező.");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
    if (!e) throw new Error("A tétel nem található.");
    if (!canEditMeta(e)) throw new Error(e.checkedAt ? "Ellenőrzöttnek jelölt tétel nem módosítható – előbb vedd le a jelölést." : "Csak nem sztornózott kézi tétel adatai módosíthatók. Számlából származó tételt a számlánál javíts.");
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId));
    const byId = new Map(lines.map((l) => [l.id, l]));
    const pIds = [...new Set(input.lines.map((l) => l.partnerId).filter((x): x is number => !!x))];
    const vIds = [...new Set(input.lines.map((l) => l.vehicleId).filter((x): x is number => !!x))];
    const okP = pIds.length ? await tx.select({ id: partners.id, name: partners.name }).from(partners).where(and(eq(partners.companyId, companyId), inArray(partners.id, pIds))) : [];
    const okV = vIds.length ? await tx.select({ id: vehicles.id, make: vehicles.make, model: vehicles.model, plate: vehicles.plate }).from(vehicles).where(and(eq(vehicles.companyId, companyId), inArray(vehicles.id, vIds))) : [];
    if (okP.length !== pIds.length) throw new Error("Ismeretlen partner.");
    if (okV.length !== vIds.length) throw new Error("Ismeretlen gépkocsi.");
    const allP = await tx.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.companyId, companyId));
    const allV = await tx.select({ id: vehicles.id, make: vehicles.make, model: vehicles.model, plate: vehicles.plate }).from(vehicles).where(eq(vehicles.companyId, companyId));
    const pName = (id: number | null) => (id ? allP.find((p) => p.id === id)?.name ?? `#${id}` : null);
    const vName = (id: number | null) => {
      const v = id ? allV.find((x) => x.id === id) : null;
      return v ? `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : ""}` : id ? `#${id}` : null;
    };

    const changes: (typeof journalLineChanges.$inferInsert)[] = [];
    if (desc !== e.description) {
      changes.push({ companyId, entryId, lineId: null, field: "entry_description", oldValue: e.description, newValue: desc, userId });
      await tx.update(journalEntries).set({ description: desc }).where(eq(journalEntries.id, entryId));
    }
    for (const x of input.lines) {
      const l = byId.get(x.id);
      if (!l) throw new Error("A sor nem ehhez a tételhez tartozik.");
      const d = x.description?.trim() || null;
      const patch: Partial<typeof journalLines.$inferInsert> = {};
      if (d !== (l.description ?? null)) { patch.description = d; changes.push({ companyId, entryId, lineId: l.id, field: "description", oldValue: l.description, newValue: d, userId }); }
      if (x.partnerId !== l.partnerId) { patch.partnerId = x.partnerId; changes.push({ companyId, entryId, lineId: l.id, field: "partner", oldValue: pName(l.partnerId), newValue: pName(x.partnerId), userId }); }
      if (x.vehicleId !== l.vehicleId) { patch.vehicleId = x.vehicleId; changes.push({ companyId, entryId, lineId: l.id, field: "vehicle", oldValue: vName(l.vehicleId), newValue: vName(x.vehicleId), userId }); }
      if (Object.keys(patch).length) await tx.update(journalLines).set(patch).where(eq(journalLines.id, l.id));
    }
    if (changes.length) await tx.insert(journalLineChanges).values(changes);
    return changes.length;
  });
}

/**
 * Könyvelt számla egy tételének megnevezés-javítása (pl. elírt alvázszám). Összeg, ÁFA, számla nem változik.
 * A számla könyvelési tételében a régi szöveget tartalmazó sorok szövege is cserélődik; minden változás naplózva.
 */
export async function renameInvoiceLine(companyId: number, invoiceId: number, lineId: number, userId: number, newDescription: string) {
  const desc = newDescription.trim();
  if (!desc) throw new Error("A megnevezés nem lehet üres.");
  const { invoices, invoiceLines } = schema;
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
    if (!inv) throw new Error("A számla nem található.");
    if (inv.status !== "posted") throw new Error("Csak könyvelt számla tételének megnevezése javítható így (piszkozatot szerkessz).");
    const [line] = await tx.select().from(invoiceLines).where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.invoiceId, invoiceId)));
    if (!line) throw new Error("A tétel nem található.");
    const old = line.description;
    if (old === desc) return 0;
    await tx.update(invoiceLines).set({ description: desc }).where(eq(invoiceLines.id, lineId));
    const entries = await tx.select().from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.sourceType, "invoice"), eq(journalEntries.sourceId, invoiceId)));
    const changes: (typeof journalLineChanges.$inferInsert)[] = [];
    for (const e of entries) {
      const jl = await tx.select().from(journalLines).where(eq(journalLines.entryId, e.id));
      let first = true;
      for (const l of jl) {
        if (!l.description || !l.description.includes(old)) continue;
        const nd = l.description.split(old).join(desc);
        await tx.update(journalLines).set({ description: nd }).where(eq(journalLines.id, l.id));
        if (first) { changes.push({ companyId, entryId: e.id, lineId: null, field: "invoice_line", oldValue: `${inv.invoiceNumber} #${line.position}: ${old}`, newValue: desc, userId }); first = false; }
        changes.push({ companyId, entryId: e.id, lineId: l.id, field: "description", oldValue: l.description, newValue: nd, userId });
      }
    }
    if (changes.length) await tx.insert(journalLineChanges).values(changes);
    return changes.length;
  });
}


// ---------------------------------------------------------------------------
// Teljes javítás (összeg, számla, dátum is) – zárolás: „ellenőrzött” jelölés
// ---------------------------------------------------------------------------

const { accounts, invoices, invoiceChecks, payments, vehicles: vehiclesT } = schema;
const hu = (n: number) => Math.round(n).toLocaleString("hu-HU", { useGrouping: "always" } as Intl.NumberFormatOptions);

/** Napló-tétel „ellenőrzött” jelölése / visszavonása. */
export async function setEntryChecked(companyId: number, entryId: number, userId: number, on: boolean) {
  const [e] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
  if (!e) throw new Error("A tétel nem található.");
  await db.update(journalEntries).set({ checkedAt: on ? new Date() : null, checkedBy: on ? userId : null }).where(eq(journalEntries.id, entryId));
}

/** Számla zárolt-e (ellenőrzöttnek jelölték). */
export async function invoiceLocked(invoiceId: number) {
  const [c] = await db.select({ at: invoiceChecks.checkedAt }).from(invoiceChecks).where(eq(invoiceChecks.invoiceId, invoiceId));
  return !!c?.at;
}

export type EntryLineInput = {
  id?: number | null; // meglévő sor; üres = új sor
  remove?: boolean;
  accountId: number;
  debit: number;
  credit: number;
  amountFx?: number | null;
  description?: string | null;
  partnerId?: number | null;
  vehicleId?: number | null;
};

/** Kézi tétel teljes javítása helyben (a tételszám marad), minden eltérés naplózva. */
export async function updateManualEntry(companyId: number, entryId: number, userId: number, input: { date: string; description: string; lines: EntryLineInput[] }) {
  const desc = input.description.trim();
  if (!desc) throw new Error("A megnevezés kötelező.");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
    if (!e) throw new Error("A tétel nem található.");
    if (!canEditEntry(e)) throw new Error(e.checkedAt ? "Ellenőrzöttnek jelölt tétel nem módosítható – előbb vedd le a jelölést." : "Csak nem sztornózott kézi tétel javítható itt.");
    if (input.date.slice(0, 4) !== e.date.slice(0, 4)) throw new Error("Másik évre nem lehet áttenni a tételt (a tételszám évhez kötött) – sztornózd és rögzítsd újra.");
    await assertPeriodOpen(tx, companyId, e.date);
    if (input.date !== e.date) await assertPeriodOpen(tx, companyId, input.date);

    const keep = input.lines.filter((l) => !l.remove && (l.debit || l.credit));
    if (keep.length < 2) throw new Error("Legalább két sor kell (tartozik és követel).");
    for (const l of keep) {
      if (l.debit < 0 || l.credit < 0) throw new Error("Negatív összeg nem lehet (használd a stornót).");
      if (l.debit && l.credit) throw new Error("Egy sorban vagy Tartozik, vagy Követel összeg legyen.");
    }
    assertBalanced(keep);
    await validateAccounts(tx, companyId, keep.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })));
    const accIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accRows = await tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.id, accIds)));
    const acc = (id: number) => accRows.find((a) => a.id === id);
    const pIds = [...new Set(keep.map((l) => l.partnerId).filter((x): x is number => !!x))];
    const vIds = [...new Set(keep.map((l) => l.vehicleId).filter((x): x is number => !!x))];
    if (pIds.length && (await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.companyId, companyId), inArray(partners.id, pIds)))).length !== pIds.length) throw new Error("Ismeretlen partner.");
    if (vIds.length && (await tx.select({ id: vehiclesT.id }).from(vehiclesT).where(and(eq(vehiclesT.companyId, companyId), inArray(vehiclesT.id, vIds)))).length !== vIds.length) throw new Error("Ismeretlen gépkocsi.");

    const shape = (l: EntryLineInput) => {
      const a = acc(l.accountId)!;
      if (a.currency !== "HUF") {
        if (!l.amountFx || !(l.amountFx > 0)) throw new Error(`A(z) ${a.code} devizás számlán a ${a.currency} összeget is meg kell adni.`);
        const huf = l.debit || l.credit;
        return { currency: a.currency, amountFx: l.amountFx, fxRate: Math.round((huf / l.amountFx) * 1e6) / 1e6 };
      }
      return { currency: null, amountFx: null, fxRate: null };
    };

    const old = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId));
    const oldById = new Map(old.map((l) => [l.id, l]));
    const allP = await tx.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.companyId, companyId));
    const allV = await tx.select({ id: vehiclesT.id, make: vehiclesT.make, model: vehiclesT.model, plate: vehiclesT.plate }).from(vehiclesT).where(eq(vehiclesT.companyId, companyId));
    const allA = await tx.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(eq(accounts.companyId, companyId));
    const aName = (id: number | null) => { const a = id ? allA.find((x) => x.id === id) : null; return a ? `${a.code} ${a.name}` : null; };
    const pName = (id: number | null) => (id ? allP.find((p) => p.id === id)?.name ?? `#${id}` : null);
    const vName = (id: number | null) => { const v = id ? allV.find((x) => x.id === id) : null; return v ? `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : ""}` : null; };
    const sum = (l: { accountId: number; debit: number | string; credit: number | string }) => `${aName(l.accountId)} · ${Number(l.debit) ? `T ${hu(Number(l.debit))}` : `K ${hu(Number(l.credit))}`}`;

    const changes: (typeof journalLineChanges.$inferInsert)[] = [];
    const log = (lineId: number | null, field: string, o: unknown, n: unknown) => changes.push({ companyId, entryId, lineId, field, oldValue: o == null || o === "" ? null : String(o), newValue: n == null || n === "" ? null : String(n), userId });

    if (desc !== e.description) log(null, "entry_description", e.description, desc);
    if (input.date !== e.date) log(null, "date", e.date, input.date);
    await tx.update(journalEntries).set({ description: desc, date: input.date }).where(eq(journalEntries.id, entryId));

    const seen = new Set<number>();
    for (const l of input.lines) {
      const cur = l.id ? oldById.get(l.id) : undefined;
      if (l.id && !cur) throw new Error("A sor nem ehhez a tételhez tartozik.");
      const drop = l.remove || !(l.debit || l.credit);
      if (cur) seen.add(cur.id);
      if (cur && drop) {
        log(null, "line_deleted", sum(cur), null);
        await tx.delete(journalLines).where(eq(journalLines.id, cur.id));
        continue;
      }
      if (drop) continue;
      const fx = shape(l);
      const vals = { accountId: l.accountId, debit: round2(l.debit), credit: round2(l.credit), description: l.description?.trim() || null, partnerId: l.partnerId ?? null, vehicleId: l.vehicleId ?? null, ...fx };
      if (!cur) {
        const [ins] = await tx.insert(journalLines).values({ entryId, companyId, ...vals }).returning({ id: journalLines.id });
        log(ins.id, "line_added", null, sum(vals));
        continue;
      }
      if (cur.accountId !== vals.accountId) log(cur.id, "account", aName(cur.accountId), aName(vals.accountId));
      if (Number(cur.debit) !== vals.debit) log(cur.id, "debit", hu(Number(cur.debit)), hu(vals.debit));
      if (Number(cur.credit) !== vals.credit) log(cur.id, "credit", hu(Number(cur.credit)), hu(vals.credit));
      if ((cur.amountFx === null ? null : Number(cur.amountFx)) !== vals.amountFx) log(cur.id, "amount_fx", cur.amountFx, vals.amountFx);
      if ((cur.description ?? null) !== vals.description) log(cur.id, "description", cur.description, vals.description);
      if (cur.partnerId !== vals.partnerId) log(cur.id, "partner", pName(cur.partnerId), pName(vals.partnerId));
      if (cur.vehicleId !== vals.vehicleId) log(cur.id, "vehicle", vName(cur.vehicleId), vName(vals.vehicleId));
      await tx.update(journalLines).set(vals).where(eq(journalLines.id, cur.id));
    }
    for (const l of old) if (!seen.has(l.id)) { log(null, "line_deleted", sum(l), null); await tx.delete(journalLines).where(eq(journalLines.id, l.id)); }
    if (changes.length) await tx.insert(journalLineChanges).values(changes);
    return changes.length;
  });
}

/** Könyvelt számla újranyitása javításra: a könyvelési tétel törlődik, a számla piszkozat lesz, újrakönyveléskor ugyanazt a tételszámot kapja. */
export async function reopenInvoice(companyId: number, invoiceId: number, userId: number) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
    if (!inv) throw new Error("A számla nem található.");
    if (inv.status !== "posted") throw new Error("Csak könyvelt számla nyitható újra.");
    const [c] = await tx.select({ at: invoiceChecks.checkedAt }).from(invoiceChecks).where(eq(invoiceChecks.invoiceId, invoiceId));
    if (c?.at) throw new Error("Ellenőrzöttnek jelölt számla nem nyitható újra – előbb vedd le a jelölést.");
    await assertPeriodOpen(tx, companyId, inv.fulfillmentDate);
    const [e] = inv.journalEntryId ? await tx.select().from(journalEntries).where(eq(journalEntries.id, inv.journalEntryId)) : [];
    if (e?.reversedById) throw new Error("A számla könyvelése sztornózva van.");
    if (e?.checkedAt) throw new Error("A számla könyvelési tétele ellenőrzöttnek van jelölve – előbb vedd le a jelölést a naplóban.");
    if (inv.direction === "out") {
      const vIds = (await tx.select({ v: schema.invoiceLines.vehicleId }).from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId))).map((x) => x.v).filter((x): x is number => !!x);
      if (vIds.length) await tx.update(vehiclesT).set({ status: "in_stock" }).where(and(inArray(vehiclesT.id, vIds), eq(vehiclesT.status, "sold")));
    }
    await tx.update(invoices).set({ status: "draft", journalEntryId: null, reuseEntryNumber: e?.number ?? null }).where(eq(invoices.id, invoiceId));
    if (e) await tx.delete(journalEntries).where(eq(journalEntries.id, e.id));
    await tx.insert(journalLineChanges).values({ companyId, entryId: null, invoiceId, lineId: null, field: "invoice_reopen", oldValue: `${e?.number ?? ""} · ${inv.fulfillmentDate} · bruttó ${hu(Number(inv.grossHuf))} Ft`, newValue: "javításra újranyitva", userId });
  });
}

/** Újrakönyvelés után: napló bejegyzés a számla új adatairól. */
export async function logInvoiceRepost(companyId: number, invoiceId: number, userId: number) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!inv?.journalEntryId) return;
  const [e] = await db.select().from(journalEntries).where(eq(journalEntries.id, inv.journalEntryId));
  await db.insert(journalLineChanges).values({ companyId, entryId: e.id, invoiceId, lineId: null, field: "invoice_repost", oldValue: null, newValue: `${e.number} · ${inv.fulfillmentDate} · bruttó ${hu(Number(inv.grossHuf))} Ft`, userId });
}

/** Pénzügyi rendezés javítása helyben (dátum, pénzeszköz, összeg); a tételszám – ha a napló és az év marad – megmarad. */
export async function editPayment(companyId: number, paymentId: number, userId: number, input: PaymentRequest) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)));
    if (!p) throw new Error("A rendezés nem található.");
    const [c] = await tx.select({ at: invoiceChecks.checkedAt }).from(invoiceChecks).where(eq(invoiceChecks.invoiceId, p.invoiceId));
    if (c?.at) throw new Error("Ellenőrzöttnek jelölt számla rendezése nem módosítható – előbb vedd le a jelölést.");
    const [e] = p.journalEntryId ? await tx.select().from(journalEntries).where(eq(journalEntries.id, p.journalEntryId)) : [];
    if (e?.reversedById) throw new Error("Ez a rendezés sztornózva van.");
    if (e?.checkedAt) throw new Error("A rendezés tétele ellenőrzöttnek van jelölve – előbb vedd le a jelölést.");
    await assertPeriodOpen(tx, companyId, p.date);
    const [oldAcc] = await tx.select().from(accounts).where(eq(accounts.id, p.moneyAccountId));
    await tx.delete(payments).where(eq(payments.id, p.id));
    if (e) await tx.delete(journalEntries).where(eq(journalEntries.id, e.id));
    const ne = await payInvoice(companyId, p.invoiceId, input, userId, tx, e?.number);
    const [newAcc] = await tx.select().from(accounts).where(eq(accounts.id, input.moneyAccountId));
    await tx.insert(journalLineChanges).values({
      companyId, entryId: ne.id, invoiceId: p.invoiceId, lineId: null, field: "payment_edit", userId,
      oldValue: `${e?.number ?? ""} · ${p.date} · ${oldAcc?.code ?? ""} · ${hu(Number(p.amountFx))}`,
      newValue: `${ne.number} · ${input.date} · ${newAcc?.code ?? ""} · ${hu(input.amountFx)}`,
    });
    return ne;
  });
}
